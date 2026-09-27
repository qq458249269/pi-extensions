/**
 * pi-shell — bash + powershell 合并为一个 shell 工具
 *
 * 收益（实测字节见 readme「本轮：首字 token 三步优化」）：两个 shell 工具的
 * description/parameters/guidelines 高度重复（wire 上 bash 558B + powershell 570B），
 * 合一后约 300B，且 system prompt 的 Available tools 少一行。
 *
 * 关键设计（都是为了不动既有扩展链）：
 *   - execute / renderCall / renderResult 全部委托 pi 公开的
 *     createBashToolDefinition / createPowerShellToolDefinition（根导出，带完整渲染器：
 *     截断提示、temp 文件路径、PI_* 环境变量、超时、abort、流式 partial 渲染），
 *     自研只写薄薄一层参数适配，因此不存在「无 renderCall 只显示工具名」的退化。
 *   - shellPath / shellCommandPrefix 从 settings.json 读（global → project 覆盖），
 *     与内建 bash 工具的构造参数一致，用户自定义 shell 仍然生效。
 *   - 不用事件先后顺序去隐藏 bash/powershell，而是三处配置同时生效：
 *     settings.json 的 defaultTools、lazy-tools.json 的 resident、本扩展 session_start。
 *   - `!cmd` 快捷命令走 handleBashCommand（UI 层），与 agent 工具注册无关，不受影响。
 *
 * 已知取舍：omnify 仍能按名把 bash/powershell 临时 load 回来（它们仍在注册表里，
 * 只是不在 active 集）——这是保留的逃生口，正常推理路径不会走到。
 *
 * 回退：删本文件 + /reload，并把 settings.json 的 defaultTools、lazy-tools.json 的
 * resident 里的 "shell" 改回 "bash","powershell"。
 */
import { createBashToolDefinition, createPowerShellToolDefinition, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Kind = "bash" | "powershell";
type Def = ReturnType<typeof createBashToolDefinition>;

const HIDDEN: readonly string[] = ["bash", "powershell"];

/** 手写 JSON Schema（而非 Type.Union）：anyOf 会被 provider 转成多分支，enum 更省更稳。 */
const PARAMS = {
	type: "object",
	required: ["command"],
	properties: {
		command: { type: "string", description: "Shell command to execute" },
		shell: { type: "string", enum: ["bash", "powershell"], description: "Which shell runs it (default bash)" },
		timeout: { type: "number", description: "Timeout in seconds (optional, no default timeout)" },
	},
} as unknown as TSchema;

type ShellArgs = { command: string; shell?: Kind; timeout?: number };

function readJson(path: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

let settingsCache: { cwd: string; options: { commandPrefix?: string; shellPath?: string } } | null = null;

/** 与 SettingsManager 一致：global ~/.pi/agent/settings.json，project <cwd>/.pi/settings.json 覆盖。 */
function shellOptions(cwd: string): { commandPrefix?: string; shellPath?: string } {
	if (settingsCache?.cwd === cwd) return settingsCache.options;
	const global = readJson(join(getAgentDir(), "settings.json"));
	const project = readJson(join(cwd, ".pi", "settings.json"));
	const pick = (key: string): string | undefined => {
		for (const src of [project, global]) {
			if (typeof src[key] === "string") return src[key] as string;
		}
		return undefined;
	};
	settingsCache = { cwd, options: { commandPrefix: pick("shellCommandPrefix"), shellPath: pick("shellPath") } };
	return settingsCache.options;
}

const defCache = new Map<string, Record<Kind, Def>>();

/** 按 cwd 缓存内建定义（内含本地 spawn operations，重建代价小但没必要）。 */
function defs(cwd: string): Record<Kind, Def> {
	let hit = defCache.get(cwd);
	if (!hit) {
		const options = shellOptions(cwd);
		hit = {
			bash: createBashToolDefinition(cwd, options),
			powershell: createPowerShellToolDefinition(cwd),
		};
		defCache.set(cwd, hit);
	}
	return hit;
}

const pick = (cwd: string, kind: unknown): Def => defs(cwd)[kind === "powershell" ? "powershell" : "bash"];

export default function piShell(pi: ExtensionAPI) {
	pi.registerTool({
		name: "shell",
		label: "shell",
		description:
			'Run a shell command in the current working directory. Defaults to bash; pass shell:"powershell" for PowerShell. Returns stdout and stderr, truncated to the last 2000 lines or 50KB (full output is saved to a temp file). Optionally provide a timeout in seconds.',
		promptSnippet: "Execute shell commands (bash or PowerShell, one tool)",
		promptGuidelines: [
			"Use shell for file operations like listing, searching, and finding files",
			"You can inspect PI_* environment variables for current model and session details.",
		],
		parameters: PARAMS,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const args = params as ShellArgs;
			const def = pick(ctx.cwd, args.shell);
			const input = { command: args.command, ...(args.timeout === undefined ? {} : { timeout: args.timeout }) };
			return def.execute(toolCallId, input, signal, onUpdate, ctx);
		},
		renderCall(params, theme, context) {
			const args = params as ShellArgs;
			const render = pick(context.cwd, args.shell).renderCall;
			if (render) return render(args, theme, context);
			return new Text(String(args?.command ?? ""), 0, 0);
		},
		renderResult(result, options, theme, context) {
			const render = pick(context.cwd, (context.args as ShellArgs | undefined)?.shell).renderResult;
			if (render) return render(result, options, theme, context);
			return new Text("", 0, 0);
		},
	});

	// 兜底隐藏内建双 shell：即便 lazy-tools 缺席，本扩展也保证 active 集里只有 shell。
	pi.on("session_start", async (_event, _ctx) => {
		const active = pi.getActiveTools();
		const next = active.filter((name) => !HIDDEN.includes(name));
		if (next.length !== active.length) pi.setActiveTools(next);
	});
}
