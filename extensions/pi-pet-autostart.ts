/**
 * pi-pet-autostart — 让 `pi-dsh-pet` 的桌面宠物**默认常驻、且整机只留一只**
 *
 * 上游 `pi-dsh-pet` 只注册两个命令，本身不带任何「自动启动」开关：
 *   `/pet [small|normal|large]` 开窗、`/pet-stop` 关窗。
 * 也就是说装完还得每次手敲 `/pet`，会话一换就没了。本扩展补上这一层：
 *   `session_start` 时把 `/pet` 当成扩展命令派发出去（pi 官方路径：`sendUserMessage`
 *   + `expandPromptTemplates` → 命令由 pi 执行并 return，**不产生任何模型轮次**、
 *   **不注册任何工具**，所以 wire 字节零变化，见 readme §6）。
 *
 * ## 为什么还要「限一只」
 * 只做自动启动会越弹越多，原因有两个，都是跨进程的、记账按 pid 根本拦不住：
 *   1. **每个会话一扇窗**：原记账只认「本 pi 进程已弹过」，换会话 / `/reload` / 多开
 *      一个 pi 就是一个新 pid → 又一扇窗。开 9 个会话就 9 只。
 *   2. **一扇窗里 `add_pet`**：上游 `/pet` 在窗已开时不新开窗，而是广播
 *      `add_pet:<size>` 让窗口里**再加一只**。手敲第二次 `/pet` 就多一只。
 * 所以这里加两道闸：
 *   - **窗口闸（跨进程）**：`session_start` 先扫全机的宠物窗（`pet-electron.cjs` 主进程
 *     + 端口），已有 ≥ `maxPets` 扇就**复用**（不派发 `/pet`），并用 `mkdir` 原子锁挡住
 *     「两个会话同时开」的竞态。
 *   - **数量闸（进程内）**：`maxPets=1` 时在 `WebSocket.prototype.send` 上挂钩子，丢掉
 *     `add_pet*` 消息——只认这个前缀，其余帧原样放行。钩子从**上游自己的入口文件**起算
 *     `require('ws')`，否则可能打在另一份 ws 实例上（这机器有 `agent/node_modules/ws` 和
 *     `agent/npm/node_modules/ws` 两份）。
 *
 * ## 复用时的事件桥
 * 复用的窗连着**别的** pi 进程的服务，只听那个进程的广播。这里再连一条 WS 当转接头，
 * 把本会话的 `agent_start` / `thinking` / `tool_call` / `agent_idle` 用同样的消息格式
 * 转发过去，于是「一只宠物」照样跟着**每个**会话的思考、敲代码动。没有 ws 依赖就静默
 * 跳过（宠物照常呼吸，只是不跟本会话联动）。
 *
 * 默认启用，开关在 `~/.pi/agent/extensions/pi-dsh-pet.json`：
 *   { "autostart": true, "size": "normal", "delayMs": 400, "maxPets": 1, "bridge": true }
 *   - autostart: false → 不自动开窗（仍可手敲 `/pet`）
 *   - size: small(260) | normal(400) | large(540)，非法值按 normal
 *   - delayMs: 等上游起 HTTP 服务的延时，默认 400ms；上游 handler 也能自己补起，纯粹是稳态
 *   - maxPets: 同时最多几只（1–8，默认 1）；已经多了用 `/pet-auto cleanup` 收掉多余的
 *   - bridge: 复用别人的窗时是否转发本会话事件（默认开）
 *   文件不存在 / 读坏 → 按**默认启用**处理（与 no-find.json 同一套约定），读坏时通知一次
 *
 * 幂等：同一 pi 进程只自动开一次（pid 记账在 `~/.pi/agent/state/pi-pet-autostart.json`），
 *   所以切会话、`/reload`、树跳转都不会叠出第二只。关掉就 `/pet-stop`。
 *   注：`/reload` 会重载扩展但**不换 pid**，跨进程的窗靠上面的窗口闸兜底。
 * 只在 TUI 模式自动开窗：`print` / `json` / `rpc`（含 bench 沙箱）不弹桌面窗口。
 *
 * 会话内随手切：
 *   `/pet-auto [on|off|size <档位>|max <只数>|bridge on|off|status|cleanup|restart]`
 * 回退：删本文件 + `/reload`（宠物包留着，手敲 `/pet` 照常）。
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AGENT_DIR = path.join(homedir(), ".pi", "agent");
// 两个环境变量只为可测（.sc-test/probe-pet-autostart.mjs 指到临时目录），日常不用设
const CONFIG_PATH = process.env.PI_PET_CONFIG ?? path.join(AGENT_DIR, "extensions", "pi-dsh-pet.json");
const STATE_PATH = process.env.PI_PET_STATE ?? path.join(AGENT_DIR, "state", "pi-pet-autostart.json");
/** 开窗锁：mkdir 跨进程原子，谁建成功谁负责开窗，别的会话等它开出来复用。 */
const LOCK_PATH = process.env.PI_PET_LOCK ?? `${STATE_PATH}.lock`;

/** 上游注册的命令名（`pi.registerCommand('pet')`）。找不到就说明包没装/被卸了。 */
const PET_COMMAND = "pet";
const SIZES = ["small", "normal", "large"] as const;
type PetSize = (typeof SIZES)[number];
/** maxPets 上限：再多也没意义（每只一个 electron 渲染进程），也免得有人写 999。 */
const MAX_PETS_CEILING = 8;
/** 锁的存活上限：主人进程被硬杀时留下的陈旧锁，超过这个时间就允许接管。 */
const LOCK_TTL_MS = 45_000;
/** 轮询间隔 / 两个等待上限（等别人的窗、等自己的窗；npx 首次拉 Electron 可能要十几秒）。 */
const POLL_MS = numEnv("PI_PET_POLL_MS", 1_500);
const LAUNCH_WAIT_MS = numEnv("PI_PET_LAUNCH_WAIT_MS", 25_000);
const WATCH_MS = numEnv("PI_PET_WATCH_MS", 25_000);
/** `/pet-auto restart` 关完窗后要等上游的 exit 回调把 electronProc 置空，否则再派发 /pet 会被当成 add_pet。 */
const RESTART_WAIT_MS = numEnv("PI_PET_RESTART_WAIT_MS", 1_200);

/** 等待类参数只为可测（探针把它们压到毫秒级），日常不用设。 */
function numEnv(name: string, fallback: number): number {
	const raw = Number(process.env[name]);
	return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

interface PetConfig {
	autostart?: boolean;
	size?: string;
	delayMs?: number;
	maxPets?: number;
	bridge?: boolean;
}

/** 归一后的配置：size 一定是合法档位，autostart 一定是布尔，maxPets 落在 1–8。 */
interface ResolvedConfig {
	autostart: boolean;
	size: PetSize;
	delayMs: number;
	maxPets: number;
	bridge: boolean;
}

const DEFAULTS: ResolvedConfig = { autostart: true, size: "normal", delayMs: 400, maxPets: 1, bridge: true };

/** 读配置；文件缺失 = 默认启用；读坏也按默认启用，但记一笔好提示。 */
function loadConfig(): { config: ResolvedConfig; broken: boolean } {
	try {
		if (!existsSync(CONFIG_PATH)) return { config: { ...DEFAULTS }, broken: false };
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as PetConfig;
		const size = SIZES.includes(raw.size as PetSize) ? (raw.size as PetSize) : DEFAULTS.size;
		const want = raw.maxPets;
		return {
			config: {
				// 只认显式 false：写错类型（如 "false"）时仍视为启用，避免宠物莫名消失
				autostart: raw.autostart === false ? false : true,
				size,
				delayMs: typeof raw.delayMs === "number" && raw.delayMs >= 0 ? raw.delayMs : DEFAULTS.delayMs,
				// 只数「同时活着的宠物」，1 是本扩展的默认；0 / 负数 / 非整数一律回到 1
				maxPets:
					typeof want === "number" && Number.isInteger(want) && want >= 1
						? Math.min(want, MAX_PETS_CEILING)
						: DEFAULTS.maxPets,
				bridge: raw.bridge === false ? false : true,
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

/* ================================ 状态记账 ================================ */

interface PetState {
	pid?: number;
	firedAt?: string;
	/** 最后一次「开窗 or 复用」的结果，给 `/pet-auto status` 看。 */
	window?: { pid: number; port: number; startedAt: number; reused: boolean };
}

function readState(): PetState {
	try {
		return JSON.parse(readFileSync(STATE_PATH, "utf8")) as PetState;
	} catch {
		return {};
	}
}

function writeState(state: PetState): void {
	try {
		mkdirSync(path.dirname(STATE_PATH), { recursive: true });
		writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	} catch {
		/* 记账失败只是下次多弹一次，不值得打断会话 */
	}
}

/** 本进程是否已经自动开过窗（切会话 / /reload 都不重复弹）。 */
function alreadyFiredThisProcess(): boolean {
	return readState().pid === process.pid;
}

/** 记「本 pid 弹过」+（可选）落在了哪扇窗上。 */
function markFired(window?: PetState["window"]): void {
	const prev = readState();
	writeState({ pid: process.pid, firedAt: new Date().toISOString(), window: window ?? prev.window });
}

/* ====================== 跨进程：现在到底有几只宠物在跑 ====================== */

/**
 * 判定特征：上游用 `npx electron pi/assets/pet-electron.cjs <port>` 起窗，**只有主进程**
 * 的命令行带 `pet-electron.cjs <port>`（gpu / utility / renderer 子进程带的是
 * `--app-path=…/pi\assets`，没有这段，所以别拿 "pi-dsh-pet" 当特征，会把子进程数进来）。
 */
const SCAN_MARK = "pet-electron.cjs";

interface PetWindow {
	pid: number;
	port: number;
	/** 毫秒时间戳，只为排序（谁先开的）；拿不到就记 0，cleanup 时当最新的处理。 */
	startedAt: number;
}

/** `…/pet-electron.cjs 43260` 里的端口。 */
function extractPort(args: string): number {
	const m = args.match(/pet-electron\.cjs\s+(\d+)/);
	return m ? Number(m[1]) : 0;
}

/** wmic 的 `20260929142048.759016+480` → 毫秒时间戳。 */
function wmicTimeToMs(value: string): number {
	const day = value.slice(0, 8);
	const clock = value.slice(8, 14);
	const ms = Number(value.slice(14, 17)) || 0;
	const offsetMin = Number(value.slice(value.indexOf("+") + 1)) || 0;
	if (day.length !== 8 || clock.length !== 6) return 0;
	return (
		Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8), +clock.slice(0, 2), +clock.slice(2, 4), +clock.slice(4, 6), ms) -
		offsetMin * 60_000
	);
}

/** `wmic /format:list`：记录之间空行分隔，每行 `key=value`。 */
function parseWmic(stdout: string): PetWindow[] {
	const out: PetWindow[] = [];
	let args = "";
	let pid = 0;
	let startedAt = 0;
	const flush = (): void => {
		if (pid > 0 && args.includes(SCAN_MARK)) out.push({ pid, port: extractPort(args), startedAt });
		args = "";
		pid = 0;
		startedAt = 0;
	};
	for (const raw of stdout.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) {
			flush();
			continue;
		}
		const eq = line.indexOf("=");
		if (eq < 0) continue;
		const key = line.slice(0, eq);
		const value = line.slice(eq + 1);
		if (key === "CommandLine") args = value;
		else if (key === "ProcessId") pid = Number(value);
		else if (key === "CreationDate") startedAt = wmicTimeToMs(value);
	}
	flush();
	return out;
}

/** `ps -eo pid=,etimes=,args=`：`etimes` 是已运行秒数，取负得到出生时刻。 */
function parsePs(stdout: string): PetWindow[] {
	const out: PetWindow[] = [];
	for (const raw of stdout.split(/\r?\n/)) {
		const m = raw.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
		if (!m || !m[3].includes(SCAN_MARK)) continue;
		out.push({ pid: Number(m[1]), port: extractPort(m[3]), startedAt: Date.now() - Number(m[2]) * 1000 });
	}
	return out;
}

/** PowerShell 兜底：脚本自己吐 `pid|毫秒|端口`。 */
const PS_SCAN = [
	"$ErrorActionPreference='SilentlyContinue'",
	"Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | ForEach-Object {",
	"  $port = 0",
	"  if ($_.CommandLine -match 'pet-electron\\.cjs\\s+(\\d+)') { $port = [int]$Matches[1] }",
	"  '{0}|{1}|{2}' -f $_.ProcessId, [int]($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds, $port",
	"}",
].join("; ");

function parsePipeLines(stdout: string): PetWindow[] {
	const out: PetWindow[] = [];
	for (const raw of stdout.split(/\r?\n/)) {
		const m = raw.trim().match(/^(\d+)\|(\d+)\|(\d+)$/);
		if (m) out.push({ pid: Number(m[1]), startedAt: Number(m[2]), port: Number(m[3]) });
	}
	return out;
}

/** 跑一条命令取 stdout；ENOENT / 非零退出 / 超时都算失败（null），交给下一个后端。 */
function capture(file: string, args: string[], timeout = 5_000): Promise<string | null> {
	return new Promise((resolve) => {
		try {
			execFile(
				file,
				args,
				{ timeout, windowsHide: true, maxBuffer: 4 << 20, encoding: "utf8" },
				(err, stdout) => resolve(err || !stdout ? null : String(stdout)),
			);
		} catch {
			resolve(null);
		}
	});
}

/**
 * 依次试各后端，第一个「跑通」的就是真相（跑通但 0 只 = 真没有，不是失败）。
 * Windows: wmic ≈0.4s 主力 → PowerShell CIM ≈2.7s 兜底（新版 Windows 删了 wmic）；
 * 其它平台走 ps。都在 session_start 之后异步跑，不挡会话。
 */
async function scanRealWindows(): Promise<PetWindow[]> {
	const backends =
		process.platform === "win32"
			? [
					{
						file: "wmic",
						args: ["process", "where", "name='electron.exe'", "get", "CreationDate,CommandLine,ProcessId", "/format:list"],
						parse: parseWmic,
					},
					{ file: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", PS_SCAN], parse: parsePipeLines },
				]
			: [{ file: "ps", args: ["-eo", "pid=,etimes=,args="], parse: parsePs }];
	for (const backend of backends) {
		const out = await capture(backend.file, backend.args);
		if (out !== null) return backend.parse(out);
	}
	return [];
}

type Scanner = () => Promise<PetWindow[]>;

/** 探针用 `globalThis.__piPetScanWindows` 顶掉真扫描（.sc-test/probe-pet-autostart.mjs）。 */
function scanner(): Scanner {
	const hook = (globalThis as { __piPetScanWindows?: Scanner }).__piPetScanWindows;
	return typeof hook === "function" ? hook : scanRealWindows;
}

/** 扫描失败不能挡住会话：出错一律当成「没扫到」，顶多多弹一次（老行为）。 */
async function scan(): Promise<PetWindow[]> {
	try {
		return await scanner()();
	} catch {
		return [];
	}
}

function pidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** 关掉一只宠物窗（Windows 用 taskkill /t 连带 gpu/renderer 子进程）。 */
async function killWindow(w: PetWindow): Promise<boolean> {
	if (!pidAlive(w.pid)) return false;
	if (process.platform === "win32") {
		await capture("taskkill", ["/pid", String(w.pid), "/f", "/t"]);
	} else {
		try {
			process.kill(w.pid, "SIGTERM");
		} catch {
			/* 已经没了 */
		}
	}
	return true;
}

/** 探针用 `globalThis.__piPetKillWindow` 顶掉真 taskkill（免得误杀测试机上的东西）。 */
type Killer = (w: PetWindow) => Promise<boolean> | boolean;
function killer(): Killer {
	const hook = (globalThis as { __piPetKillWindow?: Killer }).__piPetKillWindow;
	return typeof hook === "function" ? hook : killWindow;
}

/* ================================ 开窗锁 ================================ */

let holdingLock = false;

/** 主人进程已死、或锁太老（硬杀留下的）→ 允许接管。 */
function lockStale(): boolean {
	try {
		const owner = JSON.parse(readFileSync(path.join(LOCK_PATH, "owner.json"), "utf8")) as { pid?: number; at?: number };
		if (typeof owner.pid === "number" && pidAlive(owner.pid)) {
			return Date.now() - (Number(owner.at) || 0) > LOCK_TTL_MS;
		}
		return true;
	} catch {
		return true;
	}
}

/** mkdir 是跨进程原子的：抢到 = 归我开窗；抢不到且锁不陈旧 = 别人正在开。 */
function acquireLock(): boolean {
	if (holdingLock) return true;
	try {
		mkdirSync(LOCK_PATH);
	} catch {
		if (!lockStale()) return false;
		// 陈旧锁（主人进程硬杀留下的）：清掉重抢一次
		try {
			rmSync(LOCK_PATH, { recursive: true, force: true });
			mkdirSync(LOCK_PATH);
		} catch {
			return false;
		}
	}
	holdingLock = true;
	try {
		writeFileSync(
			path.join(LOCK_PATH, "owner.json"),
			`${JSON.stringify({ pid: process.pid, at: Date.now() }, null, 2)}\n`,
			"utf8",
		);
	} catch {
		/* 写不上 owner 也认了：最坏情况是下个会话等满 TTL */
	}
	return true;
}

/**
 * 进程退出时释放锁。只往 `process` 上挂**一个**监听（`/reload` 会反复重新求值本模块，
 * 每次都 `once` 一个会攒到 MaxListenersExceededWarning），退出时遍历当前所有实例的钩子。
 */
const EXIT_HOOKS = Symbol.for("pi-pet-autostart.exit-hooks");
function releaseLockOnExit(hook: () => void): void {
	const host = process as unknown as Record<symbol, { hooks: Array<() => void> } | undefined>;
	const reg = (host[EXIT_HOOKS] ??= { hooks: [] });
	reg.hooks.push(hook);
	if (reg.hooks.length > 1) return;
	process.once("exit", () => {
		for (const h of reg.hooks.splice(0)) {
			try {
				h();
			} catch {
				/* 退出阶段不再纠错 */
			}
		}
	});
}

function releaseLock(): void {
	if (!holdingLock) return;
	holdingLock = false;
	try {
		rmSync(LOCK_PATH, { recursive: true, force: true });
	} catch {
		/* 留着就留着，等 TTL 过期被接管 */
	}
}

/**
 * 等待用真实计时器（不 unref）：整条 `openWindow` 链都挂在这些 await 上，
 * unref 掉会在「进程里没别的事」时直接放走 promise（探针 case 19 就撞到过）。
 * 上限由 LAUNCH_WAIT_MS / WATCH_MS / RESTART_WAIT_MS 圈住，最多拖 25s。
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 轮询扫描直到冒出 baseline 之外的新窗，或等到超时。 */
async function waitForNewWindow(baseline: Set<number>, timeoutMs: number): Promise<PetWindow[]> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		await sleep(POLL_MS);
		const fresh = (await scan()).filter((w) => !baseline.has(w.pid));
		if (fresh.length > 0) return fresh;
		if (Date.now() >= deadline) return [];
	}
}

/* ====================== 进程内：拦下 add_pet（第二只） ====================== */

/** 被钩子拦下的 add_pet 次数，给 `/pet-auto status` 看。 */
let blockedAddPet = 0;

/**
 * 从**上游自己的入口文件**起算 `require('ws')`：这机器上 `agent/node_modules/ws` 与
 * `agent/npm/node_modules/ws` 是两份，打在错的实例上钩子等于没打。
 */
function loadWs(petEntry?: string): { prototype?: Record<string, unknown> } | null {
	const bases = [petEntry, path.join(AGENT_DIR, "package.json"), import.meta.url].filter(Boolean) as string[];
	for (const base of bases) {
		try {
			return createRequire(base)("ws") as { prototype?: Record<string, unknown> };
		} catch {
			/* 这个位置 require 不到 ws，换下一个 */
		}
	}
	return null;
}

/** 上游 `/pet` 的注册入口文件（从命令表拿），用来从它的位置解析 `ws`。 */
function petEntryPath(pi: ExtensionAPI): string | undefined {
	return pi.getCommands().find((c) => c.source === "extension" && c.name === PET_COMMAND)?.sourceInfo?.path;
}

/**
 * 上游 `/pet` 在「窗已开」时广播 `add_pet:<size>`，让窗里**再加一只**——这是宠物
 * 越叠越多的第二个来源。宠物服务广播时逐个 client 调 `ws.send()`，所以在
 * `WebSocket.prototype.send` 上挂个只认 `add_pet` 前缀的钩子就能拦掉，其余帧原样放行。
 * 钩子只装一次（幂等标记打在 prototype 上），是否拦截看实时的 `atLimit()`。
 */
function installAddPetBlock(pi: ExtensionAPI, atLimit: () => boolean): boolean {
	const proto = loadWs(petEntryPath(pi))?.prototype;
	if (!proto || typeof proto.send !== "function") return false;
	if (proto.piPetAddPetBlock === true) return true;
	const original = proto.send as (this: unknown, data: unknown, ...rest: unknown[]) => unknown;
	proto.send = function patchedSend(this: unknown, data: unknown, ...rest: unknown[]): unknown {
		try {
			const text = typeof data === "string" ? data : String(data);
			if (text === "add_pet" || text.startsWith("add_pet:")) {
				if (atLimit()) {
					blockedAddPet++;
					return undefined;
				}
			}
		} catch {
			/* 不是文本帧就当普通帧放行 */
		}
		return original.call(this, data, ...rest);
	};
	proto.piPetAddPetBlock = true;
	return true;
}

/* ================== 复用时的事件桥：把本会话接到别人的窗 ================== */

const bridgedPorts = new Set<number>();
let thinkingTimer: ReturnType<typeof setInterval> | null = null;
let bridgeStops: Array<() => void> = [];

function stopThinking(): void {
	if (thinkingTimer) {
		clearInterval(thinkingTimer);
		thinkingTimer = null;
	}
}

/**
 * 复用的窗连着别的 pi 进程的服务，只听那个进程的广播。这里当一次转接头：自己再连一条
 * WS，把同样的消息（agent_start / thinking / tool_call / agent_idle）转发过去，于是
 * 「一只宠物」照样跟着**每个**会话的思考、敲代码动。
 * 没有 ws 依赖就静默跳过——宠物照常呼吸，只是不跟本会话联动。
 * 返回停桥函数（`/pet-auto bridge off` 用；`pi.on` 的返回值就是退订）。
 */
function bridgeTo(pi: ExtensionAPI, petPort: number): () => void {
	if (petPort <= 0 || bridgedPorts.has(petPort)) return () => {};
	const Ctor = (loadWs(petEntryPath(pi)) as { WebSocket?: new (url: string) => Record<string, unknown> } | null)?.WebSocket;
	if (typeof Ctor !== "function") return () => {};
	bridgedPorts.add(petPort);

	let sock: Record<string, unknown> | null = null;
	const send = (msg: string): void => {
		try {
			if (sock?.readyState === 1) (sock.send as (m: string) => void)(msg);
		} catch {
			/* 桥断了就断了，宠物照旧 */
		}
	};
	let alive = true;
	const connect = (): void => {
		if (!alive) return;
		try {
			sock = new Ctor(`ws://127.0.0.1:${petPort}/ws`);
		} catch {
			return;
		}
		const on = (event: "error" | "close", fn: () => void): void => {
			try {
				(sock?.on as ((e: string, f: () => void) => void) | undefined)?.(event, fn);
			} catch {
				/* 忽略 */
			}
		};
		on("error", () => {});
		on("close", () => {
			sock = null;
			sleep(5_000).then(connect); // 主人会话退了再接回去
		});
	};
	connect();

	const offs = [
		pi.on("agent_start", () => send("agent_start")),
		pi.on("agent_settled", () => {
			stopThinking();
			send("agent_idle");
		}),
		// 和上游一样：思考中最多每 2s 推一次，别刷爆
		pi.on("turn_start", () => {
			if (thinkingTimer) return;
			send("thinking");
			thinkingTimer = setInterval(() => send("thinking"), 2_000);
			(thinkingTimer as unknown as { unref?: () => void }).unref?.();
		}),
		pi.on("tool_call", (event) => send(JSON.stringify({ type: "tool_call", tool: event.toolName }))),
	];
	return () => {
		alive = false;
		stopThinking();
		for (const off of offs) off();
		bridgedPorts.delete(petPort);
		try {
			(sock?.close as (() => void) | undefined)?.();
		} catch {
			/* 已经关了 */
		}
		sock = null;
	};
}

function stopBridges(): void {
	for (const stop of bridgeStops.splice(0)) {
		try {
			stop();
		} catch {
			/* 忽略 */
		}
	}
	bridgedPorts.clear();
}

/* ================================ 扩展本体 ================================ */

/** ctx 里只用得到 ui.notify；它和事件 ctx、命令 ctx 都兼容。 */
type NotifyLevel = "info" | "warning" | "error";
type Notifier = { ui: { notify: (message: string, type?: NotifyLevel) => void } };

/** notify 包一层：ctx 在 reload / 切会话后会失效，延迟回调里 notify 可能抛。 */
function notify(ctx: Notifier, message: string, level: NotifyLevel = "info"): void {
	try {
		ctx.ui.notify(message, level);
	} catch {
		/* 会话已经换走了 */
	}
}

export default function piPetAutostart(pi: ExtensionAPI): void {
	const { config, broken } = loadConfig();
	let runtime = { ...config };
	let fired = false;
	let addPetBlocked = false;

	/** 上游包是否在（命令表里能查到）。不在就静默跳过——没装宠物的人不该被提醒。 */
	const petInstalled = (): boolean =>
		pi.getCommands().some((c) => c.source === "extension" && c.name === PET_COMMAND);

	/** 已经有窗在跑 → 复用：不派发 `/pet`、不 add_pet，把本会话事件桥过去。 */
	const adopt = (wins: PetWindow[], ctx: Notifier): void => {
		const first = wins[0];
		notify(
			ctx,
			`已有 ${wins.length} 只宠物在跑（pid ${first.pid} :${first.port}），本会话复用，不再新开`,
		);
		markFired({ ...first, reused: true });
		if (runtime.bridge) bridgeStops.push(bridgeTo(pi, first.port));
	};

	/**
	 * 跨进程的开窗流程：扫描 → 不够就抢锁 → 复核 → 派发 `/pet` → 等自己的窗冒出来。
	 * 任何一个「已经有窗」的分支都走 `adopt`（复用），绝不叠第二扇。
	 */
	const openWindow = async (size: PetSize, ctx: Notifier): Promise<void> => {
		const baseline = await scan();
		if (baseline.length >= runtime.maxPets) {
			adopt(baseline, ctx);
			return;
		}

		if (!acquireLock()) {
			// 别的会话正在开：等它开出来复用，别抢着再开一扇
			const born = await waitForNewWindow(new Set(baseline.map((w) => w.pid)), LAUNCH_WAIT_MS);
			if (born.length > 0) {
				adopt(born, ctx);
				return;
			}
			if (!acquireLock()) {
				notify(ctx, "别的会话正在开宠物窗，本会话就不重复弹了", "info");
				return;
			}
		}

		try {
			// 拿到锁后再扫一次：抢锁期间可能刚好有人开出来
			const recheck = await scan();
			if (recheck.length >= runtime.maxPets) {
				adopt(recheck, ctx);
				return;
			}
			// 派发扩展命令：pi 认 `/` 开头 + expandPromptTemplates，命令执行完即 return，
			// 不进 prompt、不起 LLM 轮次（agent-session.js 的 _tryExecuteExtensionCommand）
			try {
				pi.sendUserMessage(`/${PET_COMMAND} ${size}`, { expandPromptTemplates: true });
			} catch {
				/* 派发失败（极少）：宠物没开出来，不影响会话 */
				return;
			}
			const born = await waitForNewWindow(new Set(recheck.map((w) => w.pid)), WATCH_MS);
			if (born.length > 0) markFired({ ...born[0], reused: false });
		} finally {
			releaseLock();
		}
	};

	// 进程被硬杀时别把锁留给下个会话
	releaseLockOnExit(releaseLock);

	pi.on("session_start", (_event, ctx) => {
		if (!petInstalled()) return; // 没装宠物包的人不该被提醒，也不该被挂钩子
		// 拦 add_pet 的钩子与自动启动无关：只要上限是 1 就得拦（bench 沙箱等非 tui 模式除外）
		if (ctx.mode === "tui" && !addPetBlocked) addPetBlocked = installAddPetBlock(pi, () => runtime.maxPets <= 1);

		if (!runtime.autostart) return;
		if (fired || alreadyFiredThisProcess()) return;
		if (ctx.mode !== "tui") return; // print / json / rpc（bench 沙箱）不弹桌面窗
		if (broken) notify(ctx, `pi-dsh-pet 配置读坏，按默认启用处理：${CONFIG_PATH}`, "warning");

		fired = true;
		markFired();
		const size = runtime.size;
		const delay = runtime.delayMs;
		// 上游的 session_start 里在起 HTTP 服务；错开一点让它先就绪（它也能自己补起，这里只是稳态）
		// 整段（扫进程 + 等锁 + 等窗）都放后台：wmic 起步 0.4s，不能挡住 session_start
		if (delay > 0) setTimeout(() => void openWindow(size, ctx), delay);
		else void openWindow(size, ctx);
	});

	pi.registerCommand("pet-auto", {
		description: "Toggle pi-dsh-pet autostart (on|off|size <档位>|max <只数>|bridge on|off|status|cleanup|restart)",
		getArgumentCompletions: (prefix) =>
			["on", "off", "size", "max", "bridge", "status", "cleanup", "restart"]
				.filter((v) => v.startsWith(prefix))
				.map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const [verb, value] = (args || "").trim().split(/\s+/);
			if (verb === "on" || verb === "off") {
				runtime.autostart = verb === "on";
				fired = false; // 本进程内允许立刻重试
				saveConfig(runtime);
				notify(ctx, `pi-dsh-pet 自动启动：${runtime.autostart ? "on" : "off"}（${CONFIG_PATH}）`);
				return;
			}
			if (verb === "size") {
				if (!SIZES.includes(value as PetSize)) {
					notify(ctx, `档位只能是 ${SIZES.join(" / ")}`, "error");
					return;
				}
				runtime.size = value as PetSize;
				saveConfig(runtime);
				notify(ctx, `pi-dsh-pet 默认尺寸：${runtime.size}（下次 /pet 或自动启动生效）`);
				return;
			}
			if (verb === "max") {
				const want = Number(value);
				if (!Number.isInteger(want) || want < 1 || want > MAX_PETS_CEILING) {
					notify(ctx, `只数只能是 1–${MAX_PETS_CEILING} 的整数`, "error");
					return;
				}
				runtime.maxPets = want;
				saveConfig(runtime);
				notify(ctx, `pi-dsh-pet 同时最多 ${want} 只（现有多余的用 /pet-auto cleanup 收掉）`);
				return;
			}
			if (verb === "bridge") {
				if (value === "off") {
					runtime.bridge = false;
					stopBridges();
					saveConfig(runtime);
					notify(ctx, "事件桥已关：复用的宠物只跟开它那个会话动");
					return;
				}
				if (value !== "on") {
					notify(ctx, "用法：/pet-auto bridge on|off", "error");
					return;
				}
				runtime.bridge = true;
				saveConfig(runtime);
				// 已经开着窗的，本进程马上补一条桥
				const wins = await scan();
				if (wins.length > 0) bridgeStops.push(bridgeTo(pi, wins[0].port));
				notify(ctx, `事件桥已开${wins.length > 0 ? `（接到 pid ${wins[0].pid} :${wins[0].port}）` : ""}`);
				return;
			}
			if (verb === "cleanup") {
				// 拿不到出生时刻的（startedAt=0）当最新的处理 → 优先收掉
				const wins = (await scan()).sort((a, b) => (a.startedAt || Number.MAX_SAFE_INTEGER) - (b.startedAt || Number.MAX_SAFE_INTEGER));
				const keep = wins.slice(0, runtime.maxPets);
				const drop = wins.slice(runtime.maxPets);
				if (drop.length === 0) {
					notify(ctx, `现在 ${wins.length} 只，没多余的（上限 ${runtime.maxPets}）`);
					return;
				}
				let closed = 0;
				for (const w of drop) if (await killer()(w)) closed++;
				notify(
					ctx,
					`关掉了 ${closed} 只多余的宠物窗，保留最老的 ${keep.length} 只` +
						(keep.length > 0 ? `（${keep.map((w) => `pid ${w.pid}:${w.port}`).join(" / ")}）` : "") +
						`｜想换一只大的用 /pet-auto restart`,
				);
				return;
			}
			if (verb === "restart") {
				const wins = await scan();
				for (const w of wins) await killer()(w);
				fired = false;
				stopBridges();
				// 上游要等它自己的 exit 回调把 electronProc 置空，否则再派发 /pet 会被当成
				// 「窗已开」→ 变成 add_pet（钩子在的话就被拦掉，窗就一直不出来了）
				await sleep(RESTART_WAIT_MS);
				await openWindow(runtime.size, ctx);
				return;
			}

			// 默认（无参 / status）：把「限额到底生效了没」摊开给用户看
			const wins = (await scan()).sort((a, b) => a.startedAt - b.startedAt);
			const state = readState();
			notify(
				ctx,
				`pi-dsh-pet autostart=${runtime.autostart} size=${runtime.size} delayMs=${runtime.delayMs} ` +
					`maxPets=${runtime.maxPets} bridge=${runtime.bridge ? "on" : "off"} 本进程已弹=${fired}` +
					`\n宠物包=${petInstalled() ? "已装" : "未装"} 宠物窗=${wins.length}/${runtime.maxPets}` +
					(wins.length > 0 ? `（${wins.map((w) => `pid ${w.pid}:${w.port}`).join(" / ")}）` : "") +
					` add_pet 已拦=${blockedAddPet} 钩子=${addPetBlocked ? "已装" : "没装"}` +
					`\n记账：${STATE_PATH}${state.window ? `（上次落在 pid ${state.window.pid}:${state.window.port}${state.window.reused ? " 复用" : ""}）` : ""}` +
					`｜多的用 cleanup 收，只留一只且要新开窗用 restart`,
			);
		},
	});
}
