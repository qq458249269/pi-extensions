/**
 * Rust Lint Hook Extension for pi (Global)
 *
 * Automatically runs clippy after any Rust file edit
 * and sends errors back to the agent for fixing.
 *
 * Activation: Detects Rust projects by checking for:
 * - Cargo.toml in the project root
 *
 * Commands: Runs `cargo clippy --all-targets --all-features -- -D warnings`
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

// Cache for Rust project detection (keyed by project root)
const rustProjectCache = new Map<string, boolean>();

// Track whether we sent an error for a specific project root
const lastErrorSent = new Map<string, boolean>();

// Track edited files during the agent's response
let editedRustFiles = new Set<string>();
let currentProjectRoot: string | null = null;

export default function (pi: ExtensionAPI) {
  // 1. Accumulate edited files during the agent's response
  pi.on("tool_result", async (event, _ctx) => {
    // Only process edit and write tools
    if (event.toolName !== "edit" && event.toolName !== "write") {
      return;
    }

    // Skip if this was an error
    if (event.isError) {
      return;
    }

    // Get the file path from the tool input
    const input = event.input as { path?: string };
    const filePath = input.path;

    if (!filePath || !filePath.endsWith(".rs")) {
      return;
    }

    // Skip generated files and target directory
    if (
      filePath.includes("/target/") ||
      filePath.includes(".generated.") ||
      filePath.endsWith(".generated.rs")
    ) {
      return;
    }

    // Find project root from the file path (walk up to find Cargo.toml)
    const projectRoot = findProjectRoot(filePath);
    if (!projectRoot) {
      return;
    }

    // Check if this is a Rust project (cached per project root)
    if (!detectRustProject(projectRoot)) {
      return;
    }

    // Accumulate the edited file and track the project root
    editedRustFiles.add(filePath);
    currentProjectRoot = projectRoot;
  });

  // 2. Run linter ONCE at the end of the agent's response
  pi.on("agent_end", async (_event, ctx) => {
    if (!currentProjectRoot) {
      // If we had previously sent an error but no files were edited this turn,
      // reset the error state to clear stale messages
      for (const [projectRoot] of lastErrorSent) {
        lastErrorSent.set(projectRoot, false);
      }
      return;
    }

    // Capture the project root and reset state for next prompt
    const projectRoot = currentProjectRoot;
    editedRustFiles = new Set();
    currentProjectRoot = null;

    await runLintAndReport(ctx, projectRoot);
  });

  /**
   * Walk up from a file path to find the nearest Cargo.toml directory
   */
  function findProjectRoot(filePath: string): string | null {
    // Resolve to absolute path if relative
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);
    let dir = dirname(absolutePath);

    // Walk up the directory tree
    while (dir && dir !== "/" && dir !== ".") {
      if (existsSync(join(dir, "Cargo.toml"))) {
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) break; // Reached root
      dir = parent;
    }

    return null;
  }

  function detectRustProject(projectRoot: string): boolean {
    if (rustProjectCache.has(projectRoot)) {
      return rustProjectCache.get(projectRoot)!;
    }

    const isRust = existsSync(join(projectRoot, "Cargo.toml"));
    rustProjectCache.set(projectRoot, isRust);
    return isRust;
  }

  async function runLintAndReport(ctx: unknown, projectRoot: string) {
    // @ts-expect-error - ctx typing is complex
    ctx.ui.notify?.(`Running cargo clippy in ${projectRoot}...`, "info");

    // Run clippy with all targets and features, treating warnings as errors
    const clippyResult = await runCommand("cargo", [
      "clippy",
      "--all-targets",
      "--all-features",
      "--",
      "-D",
      "warnings",
    ], projectRoot);

    if (clippyResult.exitCode !== 0) {
      const errors = parseClippyErrors(clippyResult.stdout + "\n" + clippyResult.stderr);

      if (errors) {
        // Only send the error if we haven't already sent one for this project
        if (!lastErrorSent.get(projectRoot)) {
          const errorMessage = `Rust clippy errors found. Please fix ALL errors and warnings (including pre-existing ones):

${errors}

Instructions:
1. Fix each error/warning one by one
2. Do NOT skip or ignore any errors
3. Do NOT use #[allow(clippy::...)] unless absolutely necessary and you explain why
4. For common patterns, prefer idiomatic Rust:
   - Use iter() instead of explicit loops where appropriate
   - Use if let / match for Option and Result handling
   - Use ? operator for error propagation
   - Avoid .clone() unless necessary
   - Use &str instead of String for function parameters when possible
5. Run cargo clippy again after fixes to verify`;

          // Send a followUp message to queue for after agent finishes current response
          pi.sendUserMessage(errorMessage, { deliverAs: "followUp" });

          // Mark that we've sent an error for this project
          lastErrorSent.set(projectRoot, true);

          // @ts-expect-error - ctx typing is complex
          ctx.ui.notify?.("Clippy errors found - sending to agent for fixing", "warning");
        }
      }
    } else {
      // Also run cargo check to catch any remaining compilation errors
      const checkResult = await runCommand("cargo", ["check", "--all-targets", "--all-features"], projectRoot);

      if (checkResult.exitCode !== 0) {
        const errors = parseCheckErrors(checkResult.stdout + "\n" + checkResult.stderr);

        if (errors) {
          // Only send the error if we haven't already sent one for this project
          if (!lastErrorSent.get(projectRoot)) {
            const errorMessage = `Rust compilation errors found. Please fix ALL errors (including pre-existing ones):

${errors}

Instructions:
1. Fix each error one by one
2. Ensure all types are correct
3. Handle all Result/Option cases properly
4. Run cargo check again after fixes to verify`;

            pi.sendUserMessage(errorMessage, { deliverAs: "followUp" });

            // Mark that we've sent an error for this project
            lastErrorSent.set(projectRoot, true);

            // @ts-expect-error - ctx typing is complex
            ctx.ui.notify?.("Compilation errors found - sending to agent for fixing", "warning");
          }
        }
      } else {
        // Clear the error state since there are no more errors
        lastErrorSent.set(projectRoot, false);
        // @ts-expect-error - ctx typing is complex
        ctx.ui.notify?.("✓ No clippy/check errors", "info");
      }
    }
  }

  function runCommand(command: string, args: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd,
        shell: true,
        timeout: 300000, // 5 minute timeout for large Rust projects (compilation can be slow)
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
        });
      });

      proc.on("error", (err) => {
        resolve({
          exitCode: 1,
          stdout: "",
          stderr: `Failed to run ${command}: ${err.message}`,
        });
      });
    });
  }

  function parseClippyErrors(output: string): string {
    if (!output.trim()) return "";

    // Clippy output format:
    // error: message
    //   --> src/file.rs:line:col
    //   |
    //   | code
    //   | ^^^
    //   |
    //   = note: additional info
    //
    // warning: message (treated as error with -D warnings)
    //   --> src/file.rs:line:col

    const lines = output.split("\n").filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;

      // Filter out success indicators
      const lower = trimmed.toLowerCase();
      if (
        lower.includes("compiling") ||
        lower.includes("finished") ||
        lower.includes("fresh") ||
        lower.includes("downloading") ||
        lower.startsWith("warning: unused") // Skip some noise, but keep actual issues
      ) {
        // Keep warning lines that have actual content
        if (trimmed.startsWith("warning:") && !trimmed.includes("-->")) {
          return true;
        }
        return false;
      }

      return true;
    });

    // Group related lines together
    const grouped: string[] = [];
    let currentGroup: string[] = [];
    let inError = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Start of a new error/warning
      if (trimmed.startsWith("error:") || trimmed.startsWith("warning:")) {
        if (currentGroup.length > 0) {
          grouped.push(currentGroup.join("\n"));
        }
        currentGroup = [line];
        inError = true;
      } else if (inError) {
        // Continue the current error group
        if (
          trimmed.startsWith("-->") ||
          trimmed.startsWith("|") ||
          trimmed.startsWith("=") ||
          trimmed.startsWith("note:") ||
          trimmed.startsWith("help:") ||
          trimmed === "" ||
          trimmed.match(/^\d+\s*\|/)
        ) {
          currentGroup.push(line);
        } else if (
          trimmed.startsWith("error:") ||
          trimmed.startsWith("warning:")
        ) {
          // New error, save current and start new
          grouped.push(currentGroup.join("\n"));
          currentGroup = [line];
        } else {
          // End of error group
          currentGroup.push(line);
        }
      }
    }

    if (currentGroup.length > 0) {
      grouped.push(currentGroup.join("\n"));
    }

    return grouped.join("\n\n").trim();
  }

  function parseCheckErrors(output: string): string {
    if (!output.trim()) return "";

    // Similar to clippy but for cargo check output
    const lines = output.split("\n").filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;

      const lower = trimmed.toLowerCase();
      return (
        !lower.includes("compiling") &&
        !lower.includes("checking") &&
        !lower.includes("finished") &&
        !lower.includes("fresh") &&
        !lower.includes("downloading")
      );
    });

    return lines.join("\n").trim();
  }
}
