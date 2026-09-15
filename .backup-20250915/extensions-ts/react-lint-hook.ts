/**
 * React Lint Hook Extension for pi (Global)
 *
 * Automatically runs lint and typecheck after any React/TypeScript file edit
 * and sends errors back to the agent for fixing.
 *
 * Activation: Detects React projects by checking for:
 * - package.json with "react" in dependencies
 * - .tsx/.jsx files in src/ directory
 *
 * Commands: Uses the package manager detected from lock files:
 * - bun run lint && bun run typecheck
 * - npm run lint && npm run typecheck
 * - yarn lint && yarn typecheck
 * - pnpm lint && pnpm typecheck
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

// Debug logging to file
const LOG_FILE = join(process.env.HOME || "/tmp", ".pi-react-lint-debug.log");
function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {}
}

// Cache for React project detection (keyed by project root)
const reactProjectCache = new Map<string, boolean>();
const packageManagerCache = new Map<string, string>();

// Track whether we sent an error for a specific project root
const lastErrorSent = new Map<string, boolean>();

// Track edited files during the agent's response
let editedFiles = new Set<string>();
let currentProjectRoot: string | null = null;

export default function (pi: ExtensionAPI) {
  log("Extension loaded (v3 with agent_end pattern)");

  // 1. Accumulate edited files during the agent's response
  pi.on("tool_result", async (event, _ctx) => {
    log(`tool_result: toolName=${event.toolName}, isError=${event.isError}`);

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

    log(`filePath from input: ${filePath}`);

    if (!filePath) {
      return;
    }

    // Only process TypeScript/JavaScript files
    const validExtensions = [".ts", ".tsx", ".js", ".jsx"];
    if (!validExtensions.some((ext) => filePath.endsWith(ext))) {
      log(`File extension not matched, skipping`);
      return;
    }

    // Skip test files, config files, and node_modules
    if (
      filePath.includes(".test.") ||
      filePath.includes(".spec.") ||
      filePath.includes("__tests__") ||
      filePath.includes("node_modules") ||
      filePath.includes(".config.") ||
      filePath.endsWith(".d.ts")
    ) {
      log(`File is test/config/node_modules, skipping`);
      return;
    }

    // Find project root from the file path (walk up to find package.json)
    const projectRoot = findProjectRoot(filePath);
    log(`findProjectRoot(${filePath}) = ${projectRoot}`);

    if (!projectRoot) {
      log(`No project root found, skipping`);
      return;
    }

    // Check if this is a React project (cached per project root)
    if (!detectReactProject(projectRoot)) {
      log(`Not a React project, skipping`);
      return;
    }

    log(`React project detected at ${projectRoot}`);

    // Accumulate the edited file and track the project root
    editedFiles.add(filePath);
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
    editedFiles = new Set();
    currentProjectRoot = null;

    await runLintAndReport(ctx, projectRoot);
  });

  /**
   * Walk up from a file path to find the nearest package.json directory
   */
  function findProjectRoot(filePath: string): string | null {
    // Resolve to absolute path if relative
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);
    let dir = dirname(absolutePath);
    log(`findProjectRoot: starting from ${absolutePath}, dir=${dir}`);

    // Walk up the directory tree
    while (dir && dir !== "/" && dir !== ".") {
      const pkgPath = join(dir, "package.json");
      log(`findProjectRoot: checking ${pkgPath}, exists=${existsSync(pkgPath)}`);
      if (existsSync(pkgPath)) {
        log(`findProjectRoot: found project root at ${dir}`);
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) break; // Reached root
      dir = parent;
    }

    log(`findProjectRoot: no project root found`);
    return null;
  }

  function detectReactProject(projectRoot: string): boolean {
    if (reactProjectCache.has(projectRoot)) {
      return reactProjectCache.get(projectRoot)!;
    }

    const packageJsonPath = join(projectRoot, "package.json");

    // Check if package.json exists and has react
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

        if (deps.react || deps["@types/react"]) {
          reactProjectCache.set(projectRoot, true);
          return true;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check for tsx/jsx files in src/
    const srcPath = join(projectRoot, "src");
    if (existsSync(srcPath)) {
      // Simple heuristic: if src/ exists, likely a frontend project
      reactProjectCache.set(projectRoot, true);
      return true;
    }

    reactProjectCache.set(projectRoot, false);
    return false;
  }

  function getPackageManager(projectRoot: string): string {
    if (packageManagerCache.has(projectRoot)) {
      const cached = packageManagerCache.get(projectRoot)!;
      log(`getPackageManager: cached ${projectRoot} -> ${cached}`);
      return cached;
    }

    // Check for lock files to determine package manager
    const bunLock = existsSync(join(projectRoot, "bun.lock"));
    const bunLockb = existsSync(join(projectRoot, "bun.lockb"));
    const pnpmLock = existsSync(join(projectRoot, "pnpm-lock.yaml"));
    const yarnLock = existsSync(join(projectRoot, "yarn.lock"));

    log(`getPackageManager: locks for ${projectRoot} - bun.lock=${bunLock}, bun.lockb=${bunLockb}, pnpm=${pnpmLock}, yarn=${yarnLock}`);

    if (bunLock || bunLockb) {
      packageManagerCache.set(projectRoot, "bun");
    } else if (pnpmLock) {
      packageManagerCache.set(projectRoot, "pnpm");
    } else if (yarnLock) {
      packageManagerCache.set(projectRoot, "yarn");
    } else {
      packageManagerCache.set(projectRoot, "npm");
    }

    log(`getPackageManager: detected ${packageManagerCache.get(projectRoot)} for ${projectRoot}`);
    return packageManagerCache.get(projectRoot)!;
  }

  async function runLintAndReport(ctx: unknown, projectRoot: string) {
    const pm = getPackageManager(projectRoot);
    log(`runLintAndReport: projectRoot=${projectRoot}, pm=${pm}`);

    // @ts-expect-error - ctx typing is complex
    ctx.ui.notify?.(`Running ${pm} run lint && typecheck in ${projectRoot}...`, "info");

    // Run lint first
    const lintResult = await runCommand(pm, ["run", "lint"], projectRoot);

    // Run typecheck
    const typecheckResult = await runCommand(pm, ["run", "typecheck"], projectRoot);

    // Combine errors
    const errors: string[] = [];

    if (lintResult.exitCode !== 0) {
      const lintErrors = parseLintErrors(lintResult.stdout + "\n" + lintResult.stderr);
      if (lintErrors) {
        errors.push(`=== Lint Errors ===\n${lintErrors}`);
      }
    }

    if (typecheckResult.exitCode !== 0) {
      const typeErrors = parseTypeErrors(typecheckResult.stdout + "\n" + typecheckResult.stderr);
      if (typeErrors) {
        errors.push(`=== Type Errors ===\n${typeErrors}`);
      }
    }

    if (errors.length > 0) {
      // Only send the error if we haven't already sent one for this project
      if (!lastErrorSent.get(projectRoot)) {
        const errorMessage = `React/TypeScript errors found. Please fix ALL errors and warnings (including pre-existing ones):

${errors.join("\n\n")}

Instructions:
1. Fix each error/warning one by one
2. Do NOT skip or ignore any errors
3. Do NOT use @ts-ignore or @ts-expect-error unless absolutely necessary
4. For lint errors, try to fix the underlying issue rather than disabling the rule
5. Run lint && typecheck again after fixes to verify`;

        // Send a followUp message to queue for after agent finishes current response
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

  function parseLintErrors(output: string): string {
    if (!output.trim()) return "";

    // Filter out success messages and empty lines
    const lines = output.split("\n").filter((line) => {
      const trimmed = line.trim().toLowerCase();
      return (
        trimmed &&
        !trimmed.includes("0 error") &&
        !trimmed.includes("0 warning") &&
        !trimmed.includes("no problems found") &&
        !trimmed.includes("check passed") &&
        !trimmed.startsWith("success")
      );
    });

    return lines.join("\n").trim();
  }

  function parseTypeErrors(output: string): string {
    if (!output.trim()) return "";

    // TypeScript errors typically have format: "path:line:col - error TSxxxx: message"
    const lines = output.split("\n").filter((line) => {
      const trimmed = line.trim().toLowerCase();
      return (
        trimmed &&
        !trimmed.includes("0 error") &&
        !trimmed.includes("found 0 errors") &&
        !trimmed.includes("no errors found") &&
        !trimmed.startsWith("success")
      );
    });

    return lines.join("\n").trim();
  }
}
