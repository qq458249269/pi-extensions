/**
 * pi-pet-autostart — 让 `pi-dsh-pet` 的桌面宠物**默认常驻**（会话一开就自己冒出来）
 *
 * 上游 `pi-dsh-pet` 只注册两个命令，本身不带任何「自动启动」开关：
 *   `/pet [small|normal|large]` 开窗、`/pet-stop` 关窗。
 * 也就是说装完还得每次手敲 `/pet`，会话一换就没了。本扩展补上这一层：
 *   `session_start` 时把 `/pet` 当成扩展命令派发出去（pi 官方路径：`sendUserMessage`
 *   + `expandPromptTemplates` → 命令由 pi 执行并 return，**不产生任何模型轮次**、
 *   **不注册任何工具**，所以 wire 字节零变化，见 readme §6）。
 *
 * 为什么用「派发命令」而不是自己 spawn Electron：
 *   端口是 pi-dsh-pet 在 `session_start` 里自己找的空闲端口（10240–49151 随机），
 *   外部拿不到；重复实现 launcher 就等于抄它 200 行、还得跟着它升级。
 *   派发 `/pet` 则由它自己的 handler 决定「开窗 / 已开则加一只 / 未起则先起服务」，
 *   顺带把 `add_pet` 广播、Electron 镜像（Windows 自动 npmmirror）都走它自己的代码。
 *
 * 默认启用，开关在 `~/.pi/agent/extensions/pi-dsh-pet.json`：
 *   { "autostart": true, "size": "normal", "delayMs": 400 }
 *   - autostart: false → 不自动开窗（仍可手敲 `/pet`）
 *   - size: small(260) | normal(400) | large(540)，非法值按 normal
 *   - delayMs: 等上游起 HTTP 服务的延时，默认 400ms；上游 handler 也能自己补起，纯粹是稳态
 *   文件不存在 / 读坏 → 按**默认启用**处理（与 no-find.json 同一套约定），读坏时通知一次
 *
 * 幂等：同一 pi 进程只自动开一次（pid 记账在 `~/.pi/agent/state/pi-pet-autostart.json`），
 *   所以切会话、`/reload`、树跳转都不会叠出第二只。关掉就 `/pet-stop`。
 * 只在 TUI 模式自动开窗：`print` / `json` / `rpc`（含 bench 沙箱）不弹桌面窗口。
 *
 * 会话内随手切：`/pet-auto [on|off|size <档位>|status]`（改动写回上面那个 json）。
 * 回退：删本文件 + `/reload`（宠物包留着，手敲 `/pet` 照常）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AGENT_DIR = path.join(homedir(), ".pi", "agent");
// 两个环境变量只为可测（.sc-test/probe-pet-autostart.mjs 指到临时目录），日常不用设
const CONFIG_PATH = process.env.PI_PET_CONFIG ?? path.join(AGENT_DIR, "extensions", "pi-dsh-pet.json");
const STATE_PATH = process.env.PI_PET_STATE ?? path.join(AGENT_DIR, "state", "pi-pet-autostart.json");

/** 上游注册的命令名（`pi.registerCommand('pet')`）。找不到就说明包没装/被卸了。 */
const PET_COMMAND = "pet";
const SIZES = ["small", "normal", "large"] as const;
type PetSize = (typeof SIZES)[number];

interface PetConfig {
	autostart?: boolean;
	size?: string;
	delayMs?: number;
}

/** 归一后的配置：size 一定是合法档位，autostart 一定是布尔。 */
interface ResolvedConfig {
	autostart: boolean;
	size: PetSize;
	delayMs: number;
}

const DEFAULTS: ResolvedConfig = { autostart: true, size: "normal", delayMs: 400 };

/** 读配置；文件缺失 = 默认启用；读坏也按默认启用，但记一笔好提示。 */
function loadConfig(): { config: ResolvedConfig; broken: boolean } {
	try {
		if (!existsSync(CONFIG_PATH)) return { config: { ...DEFAULTS }, broken: false };
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as PetConfig;
		const size = SIZES.includes(raw.size as PetSize) ? (raw.size as PetSize) : DEFAULTS.size;
		return {
			config: {
				// 只认显式 false：写错类型（如 "false"）时仍视为启用，避免宠物莫名消失
				autostart: raw.autostart === false ? false : true,
				size,
				delayMs: typeof raw.delayMs === "number" && raw.delayMs >= 0 ? raw.delayMs : DEFAULTS.delayMs,
			},
			broken: false,
		};
	} catch {
		return { config: { ...DEFAULTS }, broken: true };
	}
}

function saveConfig(config: PetConfig): void {
	mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** 本进程是否已经自动开过窗（切会话 / /reload 都不重复弹）。 */
function alreadyFiredThisProcess(): boolean {
	try {
		return existsSync(STATE_PATH) && (JSON.parse(readFileSync(STATE_PATH, "utf8")) as { pid?: number }).pid === process.pid;
	} catch {
		return false;
	}
}

function markFired(): void {
	try {
		mkdirSync(path.dirname(STATE_PATH), { recursive: true });
		writeFileSync(STATE_PATH, `${JSON.stringify({ pid: process.pid, firedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
	} catch {
		/* 记账失败只是下次多弹一次，不值得打断会话 */
	}
}

export default function piPetAutostart(pi: ExtensionAPI): void {
	const { config, broken } = loadConfig();
	let runtime = { ...config };
	let fired = false;

	/** 上游包是否在（命令表里能查到）。不在就静默跳过——没装宠物的人不该被提醒。 */
	const petInstalled = (): boolean =>
		pi.getCommands().some((c) => c.source === "extension" && c.name === PET_COMMAND);

	const launch = (size: PetSize): void => {
		// 派发扩展命令：pi 认 `/` 开头 + expandPromptTemplates，命令执行完即 return，
		// 不进 prompt、不起 LLM 轮次（agent-session.js 的 _tryExecuteExtensionCommand）
		try {
			pi.sendUserMessage(`/${PET_COMMAND} ${size}`, { expandPromptTemplates: true });
		} catch {
			/* 派发失败（极少）：宠物没开出来，不影响会话 */
		}
	};

	pi.on("session_start", (_event, ctx) => {
		if (!runtime.autostart) return;
		if (fired || alreadyFiredThisProcess()) return;
		if (ctx.mode !== "tui") return; // print / json / rpc（bench 沙箱）不弹桌面窗
		if (broken) ctx.ui.notify(`pi-dsh-pet 配置读坏，按默认启用处理：${CONFIG_PATH}`, "warning");
		if (!petInstalled()) return;

		fired = true;
		markFired();
		const size = runtime.size;
		const delay = runtime.delayMs;
		// 上游的 session_start 里在起 HTTP 服务；错开一点让它先就绪（它也能自己补起，这里只是稳态）
		if (delay > 0) setTimeout(() => launch(size), delay);
		else launch(size);
	});

	pi.registerCommand("pet-auto", {
		description: "Toggle pi-dsh-pet autostart (on|off|size <small|normal|large>|status)",
		getArgumentCompletions: (prefix) =>
			["on", "off", "size", "status"]
				.filter((v) => v.startsWith(prefix))
				.map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const [verb, value] = (args || "").trim().split(/\s+/);
			if (verb === "on" || verb === "off") {
				runtime.autostart = verb === "on";
				fired = false; // 本进程内允许立刻重试
				saveConfig(runtime);
				ctx.ui.notify(`pi-dsh-pet 自动启动：${runtime.autostart ? "on" : "off"}（${CONFIG_PATH}）`, "info");
				return;
			}
			if (verb === "size") {
				if (!SIZES.includes(value as PetSize)) {
					ctx.ui.notify(`档位只能是 ${SIZES.join(" / ")}`, "error");
					return;
				}
				runtime.size = value as PetSize;
				saveConfig(runtime);
				ctx.ui.notify(`pi-dsh-pet 默认尺寸：${runtime.size}（下次 /pet 或自动启动生效）`, "info");
				return;
			}
			ctx.ui.notify(
				`pi-dsh-pet autostart=${runtime.autostart} size=${runtime.size} delayMs=${runtime.delayMs} ` +
					`本进程已弹=${fired} 宠物包=${petInstalled() ? "已装" : "未装"}`,
				"info",
			);
		},
	});
}
