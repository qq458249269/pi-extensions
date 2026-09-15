/**
 * Python Lint Hook Extension for pi (Global)
 *
 * Automatically runs `ruff check && pyright` after any Python file edit
 * and sends errors back to the agent for fixing.
 *
 * Activation: Detects Python projects by checking for:
 * - pyproject.toml
 * - setup.py
 * - .python-version
 * - app/ directory with .py files
 *
 * Commands: Runs `ruff check --fix . && pyright` (or pyright app/ if app/ exists)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

// Cache for Python project detection (keyed by project root)
const pythonProjectCache = new Map<string, boolean>();
const projectTypeCache = new Map<string, "app" | "standard">();

// Track whether we sent an error for a specific project root
const lastErrorSent = new Map<string, boolean>();

// Track edited files during the agent's response
let editedPythonFiles = new Set<string>();
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

    if (!filePath || !filePath.endsWith(".py")) {
      return;
    }

    // Skip test files, migrations, and virtual environments
    if (
      filePath.includes("node_modules") ||
      filePath.includes(".venv") ||
      filePath.includes("venv") ||
      filePath.includes("__pycache__") ||
      filePath.includes("/migrations/") ||
      filePath.includes("/tests/") ||
      filePath.includes("test_") ||
      filePath.includes("_test.py")
    ) {
      return;
    }

    // Find project root from the file path (walk up to find pyproject.toml or setup.py)
    const projectRoot = findProjectRoot(filePath);
    if (!projectRoot) {
      return;
    }

    // Check if this is a Python project (cached per project root)
    if (!detectPythonProject(projectRoot)) {
      return;
    }

    // Accumulate the edited file and track the project root
    editedPythonFiles.add(filePath);
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
    editedPythonFiles = new Set();
    currentProjectRoot = null;

    await runLintAndReport(ctx, projectRoot);
  });

  /**
   * Walk up from a file path to find the nearest Python project root
   */
  function findProjectRoot(filePath: string): string | null {
    // Resolve to absolute path if relative
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);
    let dir = dirname(absolutePath);

    // Walk up the directory tree
    while (dir && dir !== "/" && dir !== ".") {
      // Check for Python project indicators
      if (
        existsSync(join(dir, "pyproject.toml")) ||
        existsSync(join(dir, "setup.py")) ||
        existsSync(join(dir, "setup.cfg")) ||
        existsSync(join(dir, ".python-version"))
      ) {
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) break; // Reached root
      dir = parent;
    }

    return null;
  }

  function detectPythonProject(projectRoot: string): boolean {
    if (pythonProjectCache.has(projectRoot)) {
      return pythonProjectCache.get(projectRoot)!;
    }

    // Check for Python project indicators
    const hasPyproject = existsSync(join(projectRoot, "pyproject.toml"));
    const hasSetup = existsSync(join(projectRoot, "setup.py"));
    const hasPythonVersion = existsSync(join(projectRoot, ".python-version"));
    const hasAppDir = existsSync(join(projectRoot, "app"));

    if (hasPyproject || hasSetup || hasPythonVersion) {
      pythonProjectCache.set(projectRoot, true);
      projectTypeCache.set(projectRoot, hasAppDir ? "app" : "standard");
      return true;
    }

    pythonProjectCache.set(projectRoot, false);
    return false;
  }

  function getProjectType(projectRoot: string): "app" | "standard" {
    if (projectTypeCache.has(projectRoot)) {
      return projectTypeCache.get(projectRoot)!;
    }
    return "standard";
  }

  async function runLintAndReport(ctx: unknown, projectRoot: string) {
    const projectType = getProjectType(projectRoot);
    const target = projectType === "app" ? "app" : ".";

    // @ts-expect-error - ctx typing is complex
    ctx.ui.notify?.(`Running ruff check && pyright ${target} in ${projectRoot}...`, "info");

    // Run ruff check with auto-fix first
    const ruffResult = await runCommand("ruff", ["check", "--fix", target], projectRoot);

    // Run pyright
    const pyrightResult = await runCommand("pyright", [target], projectRoot);

    // Combine errors
    const errors: string[] = [];

    if (ruffResult.exitCode !== 0 && ruffResult.stderr) {
      errors.push(`=== Ruff Errors ===\n${ruffResult.stderr}`);
    }

    if (pyrightResult.exitCode !== 0) {
      const pyrightErrors = parsePyrightErrors(pyrightResult.stdout);
      if (pyrightErrors) {
        errors.push(`=== Pyright Errors ===\n${pyrightErrors}`);
      }
    }

    if (errors.length > 0) {
      // Only send the error if we haven't already sent one for this project
      if (!lastErrorSent.get(projectRoot)) {
        const errorMessage = `Python lint/type errors found. Please fix ALL errors (including pre-existing ones):

${errors.join("\n\n")}

Instructions:
1. Fix each error one by one
2. Do NOT skip or ignore any errors
3. Do NOT use type: ignore comments unless absolutely necessary
4. For ruff errors, try to fix the underlying issue rather than adding # noqa
5. Ensure proper type annotations on all functions
6. Run ruff check && pyright again after fixes to verify`;

        // Send a steering message to interrupt and get the agent to fix
        pi.sendUserMessage(errorMessage, { deliverAs: "followUp" });

        // Mark that we've sent an error for this project
        lastErrorSent.set(projectRoot, true);

        // @ts-expect-error - ctx typing is complex
        ctx.ui.notify?.("Lint/type errors found - sending to agent for fixing", "warning");
      }
    } else {
      // Clear the error state since there are no more errors
      lastErrorSent.set(projectRoot, false);
      // @ts-expect-error - ctx typing is complex
      ctx.ui.notify?.("✓ No lint/type errors", "info");
    }
  }

  function runCommand(command: string, args: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd,
        shell: true,
        timeout: 120000, // 2 minute timeout for large projects
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

  function parsePyrightErrors(output: string): string {
    if (!output.trim()) return "";

    // Pyright outputs errors in a specific format
    // Error lines typically have format: "  path:line:column - error: message"
    const lines = output.split("\n");
    const errorLines: string[] = [];
    let foundErrors = false;

    for (const line of lines) {
      // Error lines typically have format: "  path:line:column - error: message"
      if (line.includes(" - error:") || line.includes(" - warning:")) {
        errorLines.push(line);
        foundErrors = true;
      } else if (foundErrors && line.startsWith("  ") && !line.includes("errors,") && !line.includes("warnings,") && !line.includes("files checked")) {
        // Continuation of error message
        errorLines.push(line);
      }
    }

    return errorLines.join("\n").trim();
  }
}
