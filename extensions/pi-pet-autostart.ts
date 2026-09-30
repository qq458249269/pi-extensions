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
 * 转发过去，于是「一只宠物」照样跟着**每个**会话的思考、敲代码动。
 *
 * ## 「一直在待机 / 突然多出第二只」的九个成因（2026-09-29/30 修）
 * 1. **pid 记账把桥一起跳过了**：`session_start` 里 `alreadyFiredThisProcess()` 直接 return，
 *    而它 return 在建桥之前。于是同进程内第二次 `session_start`（`/reload`、`/clear`、树跳转）
 *    之后，复用的窗**永远没人喂事件**——不动，就是一直待机。现在建桥提到那个闸**外面**，
 *    每次 `session_start` 都跑一遍 `ensureBridge()`（已有桥就跳过，自己开的窗不桥）。
 * 2. **闸门只认命令行，不验活**：上游用 `detached:false`+`shell:true`+`unref()` 拉 electron，
 *    清理只挂在 `process.on('exit'/'SIGINT'/'SIGTERM')`——**硬杀/崩溃就留下永久孤儿窗**。
 *    旧逻辑把 `pet-electron.cjs <port>` 进程一律当「已有 1 只」→ 吸附上去 → 桥到没人监听的
 *    端口 → 永远发不出东西。现在每个端口都探一次 `/health`。
 * 3. **探不通的端口被当成活的（最阴的一个）**：主人 pi 被硬杀后，它的 LISTENING socket 会被
 *    electron 子进程**带着一起活下来**——`netstat` 看着在监听，内核照常完成 TCP 握手，所以
 *    连接**不报错**，但永远没人 `accept`：`/health` 超时、WS upgrade 挂死。窗照常亮着、
 *    照常呼吸，就是收不到任何事件。**只要窗在，这个假端口就一直在**，是个自我维持的死循环。
 *    （实测：netstat 报 `LISTENING` 归 pid 95932，而该 pid 在 tasklist 里已不存在；
 *    杀掉 electron 后该 socket 立刻消失，证实是子进程持有的。）
 *    所以探不通**不能**当活窗：先用短超时探一次，`unknown` 就**再用长超时宽限探一次**
 *    （别误杀刚起、只是慢的窗），还不行就判失活收掉。留着它 = 永远待机；收掉它 = 自动重开一只能用的。
 * 4. **「扫不动」被当成「真没有」**：wmic 被新版 Windows 删掉 + PowerShell 兜底也失败时，
 *    旧代码拿到 `[]` 就去开第二扇。现在扫描结果带 `ok`，全挂则重试一次，仍失败就**照开但
 *    明确告警**（不让人没宠物，同时把「保证已降级」摆到台面上）。
 * 5. **桥坏了没人知道**：`connect` 的 error 以前是空 handler、close 后 5s 重连也不吭声。
 *    现在记 `{state, lastError, sent}` 并加**握手看门狗**（`PI_PET_BRIDGE_WATCHDOG_MS`，默认 6s），
 *    超时未 open 就报 `err`——不能让状态永远停在 `connecting` 装样子。`/pet-auto status` 一行摊开。
 * 6. **PowerShell 兜底整个是死的（2026-09-30 实测）**：脚本里 `[int]($_.CreationDate…).TotalMilliseconds`
 *    把 epoch 毫秒（≈1.79e12）强转 Int32 → **溢出报错，整个脚本一行都不吐**；而 `capture` 把空 stdout
 *    当失败。于是 wmic 只要一次超时（机器忙 / 被 AV 拖住），兜底也一起哑掉 → `ok:false` → 静默降级
 *    开第二扇。修：`[long]`。另外脚本按 `Name='electron.exe'` 列出**所有** Electron 进程，gpu/utility/
 *    renderer 子进程命令行里也带 `pet-electron.cjs` 但**没有端口** → `port=0`；`probeHealth` 把 0 判成
 *    `dead` → 被当孤儿 `taskkill`（会把好窗自己的子进程杀掉）。现在脚本只吐带端口的主进程，解析端再兜一道。
 * 7. **「这扇窗是谁开的」认得不准**：`markFired({...born[0], reused:false})` 把「派发后新出现的窗」
 *    一律当成自己的。baseline 用的是**第一次**扫描的结果（扫挂时=空集），而抢锁最长能等 25s——
 *    这期间别的会话开的窗会被记成「本进程自己开的」（`reused:false`），于是 `ownWindowPort()>0`：
 *    本会话既不建桥也不再开窗，宠物永远不动。现在只在**复核扫描可信**时才敢认领，否则记 `reused:true`
 *    并老老实实建桥。
 * 8. **窗被换掉后旧桥不死**：`ensureBridge` 见「已经有桥」就 return。`/pet-auto restart`（或窗崩了被
 *    重开）之后，老会话还挂在**已经不存在的端口**上，新窗没人接。现在每次 `session_start` 按当前活窗
 *    **对账**：停掉指向死端口的桥、接上新出现的活窗（扫描失败时维持原状，别因一次抖动误停好桥）。
 * 9. **`pending` 记账**：以前 `session_start` 先写「本进程已弹」再派发，中途扫挂/等窗超时就**永久**
 *    放弃（`alreadyFiredThisProcess()` 永远 true，只有 `/reload` 能解）。现在先记 `pending:true`，
 *    真等到窗（或复用）才转正；`pending` 超过 90s（`PI_PET_PENDING_TTL_MS`）放行重试。记账另加
 *    进程出生时刻 `startedAt`，防 pid 被回收后「新进程被当成老的那个」。派发失败 / 等不到新窗都明说。
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
 *   上游**没有** `app.requestSingleInstanceLock()`，即窗口层零级联；「整机一只」全靠本扩展。
 * 只在 TUI 模式自动开窗：`print` / `json` / `rpc`（含 bench 沙箱）不弹桌面窗口。
 *
 * 会话内随手切：
 *   `/pet-auto [on|off|size <档位>|max <只数>|bridge on|off|status|cleanup|restart]`
 * 回退：删本文件 + `/reload`（宠物包留着，手敲 `/pet` 照常）。
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
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
/** 首次探不通时再宽限探一次的时长（别把刚起、只是慢的窗判死） */
const SLOW_PROBE_TIMEOUT_MS = numEnv("PI_PET_SLOW_PROBE_MS", 5_000);
/** 桥的握手看门狗：超时就报 err，不让状态永远停在 connecting */
const BRIDGE_WATCHDOG_MS = numEnv("PI_PET_BRIDGE_WATCHDOG_MS", 6_000);

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

/** 本进程出生时刻，四舍五入到秒（写/读之间有几毫秒抖动，比较时留 2s 容差）。 */
const PROCESS_STARTED_AT = Math.round((Date.now() - process.uptime() * 1000) / 1000) * 1000;
/** `pending` 记账的有效期：比一条 `openWindow` 的最坏耗时（≈25s 抢锁 + 25s 等窗）长一点。 */
const PENDING_TTL_MS = numEnv("PI_PET_PENDING_TTL_MS", 90_000);

interface PetState {
	pid?: number;
	/** 进程出生时刻（ms）：pid 会被回收，光比 pid 会把新进程认成老的那个。旧记录没这个字段。 */
	startedAt?: number;
	firedAt?: string;
	/** true = 只记了「本进程要开窗」，还没等到窗。超时后允许重试，不再一次失败就永久放弃。 */
	pending?: boolean;
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

/** 这条记账是不是本进程写的（pid 相同 + 出生时刻对得上）。 */
function isThisProcess(s: PetState): boolean {
	if (s.pid !== process.pid) return false;
	// 旧记录没有 startedAt：按老规矩只认 pid（兼容一次 /reload 前的记账）
	if (typeof s.startedAt !== "number") return true;
	return Math.abs(s.startedAt - PROCESS_STARTED_AT) <= 2_000;
}

/** 本进程是否已经自动开过窗（切会话 / /reload 都不重复弹）。 */
function alreadyFiredThisProcess(): boolean {
	const s = readState();
	if (!isThisProcess(s)) return false;
	if (s.pending !== true) return true;
	// 还在开窗途中：短时间内不重复开；拖太久（扫挂 / 等窗超时）就放行重试，
	// 不然一次失败会把「自动弹窗」永久关掉，只有 /reload 能解。
	const at = Date.parse(s.firedAt ?? "") || 0;
	return Date.now() - at < PENDING_TTL_MS;
}

/** 记「本 pid 弹过」+（可选）落在了哪扇窗上；`pending=true` 表示只是「打算开」。 */
function markFired(window?: PetState["window"], pending = false): void {
	const prev = readState();
	// 转 pending 时别把**别的进程**留下的窗继承过来：那会让 ownWindowPort() 认错自己的窗
	const keepWindow = window ?? (isThisProcess(prev) ? prev.window : undefined);
	writeState({ pid: process.pid, startedAt: PROCESS_STARTED_AT, firedAt: new Date().toISOString(), pending, window: keepWindow });
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

/** 一次扫描的结果。`ok:false` = 扫描后端全挂（**不等于**没窗），调用方必须区别对待。 */
interface ScanResult {
	windows: PetWindow[];
	ok: boolean;
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
	// 只吐命令行里带 `pet-electron.cjs <端口>` 的主进程。以前对每个 electron.exe 都吐一行（子进程
	// 的端口位补 0），那些 port=0 的行会被 probeHealth 判 dead → 当孤儿 taskkill 掉。
	"  if ($_.CommandLine -match 'pet-electron\\.cjs\\s+(\\d+)') {",
	// 必须是 [long]：epoch 毫秒 ≈1.79e12 超出 Int32，[int] 会溢出报错，**整个脚本一行都不吐**
	// （`capture` 把空 stdout 当失败）→ 兜底等于没有。
	"    '{0}|{1}|{2}' -f $_.ProcessId, [long]($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds, [int]$Matches[1]",
	"  }",
	"}",
].join("; ");

function parsePipeLines(stdout: string): PetWindow[] {
	const out: PetWindow[] = [];
	for (const raw of stdout.split(/\r?\n/)) {
		const m = raw.trim().match(/^(\d+)\|(\d+)\|(\d+)$/);
		// port=0 的行（没有端口的子进程）一律丢：probeHealth 把 0 判成 dead，留着会被当孤儿杀掉
		if (m && Number(m[3]) > 0) out.push({ pid: Number(m[1]), startedAt: Number(m[2]), port: Number(m[3]) });
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
 * 依次试各后端，第一个「跑通」的就是真相（跑通但 0 只 = 真没有）。
 * **全挂时返回 `ok:false`** 而不是 `[]`——「扫不动」和「真没有」必须分得开，
 * 否则扫不动就会被当成「0 只」再弹一扇，单只保证当场破功（见 `openWindow`）。
 * Windows: wmic ≈0.4s 主力 → PowerShell CIM ≈2.7s 兜底（新版 Windows 删了 wmic）；
 * 其它平台走 ps。都在 session_start 之后异步跑，不挡会话。
 */
async function scanRealWindows(): Promise<ScanResult> {
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
		if (out !== null) return { windows: backend.parse(out), ok: true };
	}
	return { windows: [], ok: false };
}

type Scanner = () => Promise<ScanResult>;

/** 探针用 `globalThis.__piPetScanWindows` 顶掉真扫描（.sc-test/probe-pet-autostart.mjs）。 */
function scanner(): Scanner {
	const hook = (globalThis as { __piPetScanWindows?: Scanner }).__piPetScanWindows;
	return typeof hook === "function" ? hook : scanRealWindows;
}

/** 扫描失败不能挡住会话；但要把「扫不动」如实带出去，别和「真没有」混为一谈。 */
async function scan(): Promise<ScanResult> {
	try {
		const raw = await scanner()();
		// 探针可能返回旧格式的裸数组，一律当 ok
		if (Array.isArray(raw)) return { windows: raw, ok: true };
		return { windows: raw?.windows ?? [], ok: raw?.ok !== false };
	} catch {
		return { windows: [], ok: false };
	}
}

/* ================== 窗的存活探测：光看进程表会被孤儿骗 ================== */

/**
 * 端口的三个状态，不只用 bool：
 *   - `up`      `/health` 回了 200 → 真的是活的服务
 *   - `dead`    连接被拒（ECONNREFUSED）→ **确定性**的「没人监听」，即孤儿
 *   - `unknown` 超时/其它错 → 机器忙或被杀，不确定，**不当孤儿处理**（宁可多留一只）
 * 区分开是为了不因为一次网络抖就把好窗误杀。
 */
type PortHealth = "up" | "dead" | "unknown";

/** 探上游的 `/health`（`startServer` 起好后该端点回 `{ok:true,port}`）。 */
function probeHealth(port: number, timeoutMs = 1_500): Promise<PortHealth> {
	return new Promise((resolve) => {
		if (!Number.isInteger(port) || port <= 0) return resolve("dead");
		let settled = false;
		const done = (h: PortHealth): void => {
			if (settled) return;
			settled = true;
			resolve(h);
		};
		let req: ReturnType<typeof httpRequest>;
		try {
			req = httpRequest({ host: "127.0.0.1", port, path: "/health", method: "GET", timeout: timeoutMs }, (res) => {
				res.resume();
				done(res.statusCode === 200 ? "up" : "unknown");
			});
		} catch {
			return done("unknown");
		}
		req.on("error", (err: NodeJS.ErrnoException) => done(err.code === "ECONNREFUSED" ? "dead" : "unknown"));
		req.on("timeout", () => {
			req.destroy();
			done("unknown");
		});
		req.end();
	});
}

type PortProbe = (port: number) => Promise<PortHealth>;

/** 探针用 `globalThis.__piPetProbePort` 顶掉真探测（默认放行，单独 case 才造孤儿）。 */
function portProbe(): PortProbe {
	const hook = (globalThis as { __piPetProbePort?: (p: number, t?: number) => Promise<PortHealth | boolean> }).__piPetProbePort;
	if (typeof hook !== "function") return probeHealth;
	return async (port: number, timeoutMs?: number) => {
		const raw = await hook(port, timeoutMs);
		return typeof raw === "boolean" ? (raw ? "up" : "dead") : raw;
	};
}

interface LiveSplit {
	/** 能用的窗（up + unknown）——只有这些能占 maxPets 的名额。 */
	alive: PetWindow[];
	/** 端口没人监听的孤儿：主人 pi 进程已死，窗还在但永远收不到事件。 */
	orphans: PetWindow[];
}

/** 把进程表按端口探一遍，分成「能用」和「孤儿」。 */
async function splitByHealth(wins: PetWindow[]): Promise<LiveSplit> {
	if (wins.length === 0) return { alive: [], orphans: [] };
	const probe = portProbe();
	const alive: PetWindow[] = [];
	const orphans: PetWindow[] = [];
	for (const w of wins) {
		let health: PortHealth = "unknown";
		try {
			health = await probe(w.port);
		} catch {
			health = "unknown";
		}
		// 探不通分两种，得分开判：
		//  - dead（ECONNREFUSED）：端口压根没人听 → 铁孤儿
		//  - unknown（超时 / 非 200）：**不等于能用**。最阴的一种是「死进程泄漏的 LISTENING
		//    socket」——netstat 看着在监听，内核照样完成握手，于是连接不报错，但永远没人
		//    accept，/health 和 WS upgrade 一起挂死。窗还亮着，事件发不进去，就是「一直待机」。
		//    所以再宽限探一次（别误杀刚起、只是慢的窗），还不行就判失活收掉：
		//    留着它 = 永远待机；收掉它 = 扩展自动重开一只能用的，明显划算。
		if (health === "unknown") {
			try {
				health = await probe(w.port, SLOW_PROBE_TIMEOUT_MS);
			} catch {
				health = "unknown";
			}
		}
		if (health === "up") alive.push(w);
		else orphans.push(w);
	}
	return { alive, orphans };
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

/** 轮询扫描直到冒出 baseline 之外的新**活**窗，或等到超时。 */
async function waitForNewWindow(baseline: Set<number>, timeoutMs: number, ignore: ReadonlySet<number> = new Set()): Promise<PetWindow[]> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		await sleep(POLL_MS);
		// 只认「真的能收事件」的窗：刚弹出来的 electron 要等本进程的 pet 服务接上，
		// 端口会先拒连接——不探一下就分不清「自己刚开的」和「别人的孤儿」。
		// `ignore` 是刚 taskkill 掉的窗：它们可能还在进程表里挂着，别把尸体认成活窗。
		const fresh = (await splitByHealth((await scan()).windows)).alive.filter(
			(w) => !baseline.has(w.pid) && !ignore.has(w.pid),
		);
		if (fresh.length > 0) return fresh;
		if (Date.now() >= deadline) return [];
	}
}

/**
 * 本进程自己开出来的那扇窗的端口（没有则 0）。
 * 自己的上游已经在广播了，再桥一次只是双发；反过来，**不是**自己的才必须桥——
 * 这就是「复用时一直在待机」的第二个成因。
 */
function ownWindowPort(): number {
	const s = readState();
	if (!isThisProcess(s)) return 0;
	const w = s.window;
	if (!w || w.reused !== false) return 0;
	// 窗可能已经关了、或者被 /pet-auto restart 换掉：进程不在了就不算自己的。
	// 否则本会话会一直以为「上游在替我广播」，新窗永远接不上桥。
	return pidAlive(w.pid) ? w.port : 0;
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
/** 端(口) → 停桥函数。对账要用：窗换掉后得知道该停哪条、还差哪条。 */
const activeBridges = new Map<number, () => void>();

/**
 * 桥的**真实**状态，给 `/pet-auto status` 看。
 * 以前这里全靠静默：connect 的 error 是空 handler、close 后 5s 重连也不吭声，
 * 于是「宠物一直待机」这件事没有任何线索（这正是它难查的原因）。
 */
interface BridgeInfo {
	port: number;
	state: "connecting" | "open" | "closed" | "error";
	/** 最后一次错的原因（连不上/被拒…），没有则空串。 */
	lastError: string;
	/** 桥建立至今成功发出的消息数。 */
	sent: number;
	since: number;
}

const bridgeStates = new Map<number, BridgeInfo>();

function setBridge(port: number, patch: Partial<BridgeInfo>): void {
	const prev = bridgeStates.get(port) ?? { port, state: "connecting", lastError: "", sent: 0, since: Date.now() };
	bridgeStates.set(port, { ...prev, ...patch });
}

/** 状态栏用的一行摘要。 */
function bridgeReport(): string {
	if (bridgeStates.size === 0) return "无（没找到可复用的窗）";
	return [...bridgeStates.values()]
		.map((b) => `:${b.port} ${b.state}${b.lastError ? `(${b.lastError})` : ""} 发${b.sent}`)
		.join("  ");
}

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
function bridgeTo(pi: ExtensionAPI, petPort: number): (() => void) | null {
	if (petPort <= 0 || bridgedPorts.has(petPort)) return null;
	const Ctor = (loadWs(petEntryPath(pi)) as { WebSocket?: new (url: string) => Record<string, unknown> } | null)?.WebSocket;
	if (typeof Ctor !== "function") {
		// 拿不到 ws 就明说，别再静默滑回「只会呼吸」
		setBridge(petPort, { state: "error", lastError: "拿不到 ws 依赖" });
		return null;
	}
	bridgedPorts.add(petPort);

	let sock: Record<string, unknown> | null = null;
	const send = (msg: string): void => {
		try {
			if (sock?.readyState === 1) {
				(sock.send as (m: string) => void)(msg);
				setBridge(petPort, { state: "open", lastError: "", sent: (bridgeStates.get(petPort)?.sent ?? 0) + 1 });
			}
		} catch (err) {
			/* 桥断了就断了，宠物照旧；记一笔好查 */
			setBridge(petPort, { state: "error", lastError: (err as Error).message.slice(0, 40) });
		}
	};
	let alive = true;
	const connect = (): void => {
		if (!alive) return;
		setBridge(petPort, { state: "connecting" });
		try {
			sock = new Ctor(`ws://127.0.0.1:${petPort}/ws`);
		} catch (err) {
			setBridge(petPort, { state: "error", lastError: (err as Error).message.slice(0, 40) });
			return;
		}
	const on = (event: "open" | "error" | "close", fn: (arg?: unknown) => void): void => {
			try {
				(sock?.on as ((e: string, f: (arg?: unknown) => void) => void) | undefined)?.(event, fn);
			} catch {
				/* 忽略 */
			}
		};
		on("open", () => {
			clearTimeout(watchdog);
			setBridge(petPort, { state: "open", lastError: "" });
		});
		// 「connecting」不能是终态：上面那个泄漏 socket 的情形下，握手永远不完成，
		// 状态就永远停在 connecting，看上去像在连、其实早死了。给它一个看门狗。
		const watchdog = setTimeout(() => {
			if (bridgeStates.get(petPort)?.state === "connecting") {
				setBridge(petPort, { state: "error", lastError: "连接超时：端口有人监听但无人应答" });
			}
		}, BRIDGE_WATCHDOG_MS);
		(watchdog as unknown as { unref?: () => void }).unref?.();
		on("error", (err) =>
			setBridge(petPort, { state: "error", lastError: String((err as Error)?.message ?? err ?? "connect failed").slice(0, 40) }),
		);
		on("close", () => {
			sock = null;
			// 主人会话退了再接回去。顺便把状态标出来，别让「静默」又变成无头案。
			setBridge(petPort, { state: "closed" });
			sleep(5_000).then(connect);
		});
	};
	connect();

	const offs = [
		pi.on("agent_start", () => {
			// 一轮新的 run 开始：先把可能残留的 thinking 节流清掉，
			// 否则 agent_settled 漏发时，本轮第一个 turn_start 不会立即报 thinking（只剩 2s 后的补发）
			stopThinking();
			send("agent_start");
		}),
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
		setBridge(petPort, { state: "closed", lastError: "已停" });
		try {
			(sock?.close as (() => void) | undefined)?.();
		} catch {
			/* 已经关了 */
		}
		sock = null;
	};
}

function stopBridges(): void {
	for (const stop of [...activeBridges.values()]) {
		try {
			stop();
		} catch {
			/* 忽略 */
		}
	}
	activeBridges.clear();
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

	/** 桥到**别的进程**的窗。自己开的那扇不用桥（上游已在广播，桥了只是双发）。 */
	const bridgeIfForeign = (port: number): void => {
		if (!runtime.bridge || port <= 0) return;
		if (port === ownWindowPort()) return;
		const stop = bridgeTo(pi, port);
		if (stop) activeBridges.set(port, stop);
	};

	/** 已经有**活的**窗 → 复用：不派发 `/pet`、不 add_pet，把本会话事件桥过去。 */
	const adopt = (wins: PetWindow[], ctx: Notifier): void => {
		const first = wins[0];
		notify(
			ctx,
			`已有 ${wins.length} 只宠物在跑（pid ${first.pid} :${first.port}），本会话复用，不再新开`,
		);
		markFired({ ...first, reused: true });
		bridgeIfForeign(first.port);
	};

	/**
	 * 端口没人监听 = 主人 pi 进程已死的孤儿。它不占名额也得收掉：
	 * 留着就会把本会话一直吸附上去，桥过去永远发不出东西（只会呼吸）。
	 * 只收 `dead`（连接被拒，确定性），`unknown`（超时等）一律放过，不误杀好窗。
	 * 返回收掉的个数，提示由调用方拼（cleanup 要把它并进自己那条）。
	 */
	const reapOrphans = async (orphans: PetWindow[]): Promise<number> => {
		let closed = 0;
		for (const w of orphans) if (await killer()(w)) closed++;
		return closed;
	};

	/**
	 * 每次 `session_start` 都跑一遍，**不受** `fired` / `alreadyFiredThisProcess()` 限制。
	 * 那两个闸只该管「别重复开窗」，不该管「别重复建桥」：同进程内第二次
	 * session_start（`/reload`、`/clear`、tree 跳转）以前在这里就 return 了，
	 * 复用的窗从此没人喂事件，永久待机。
	 */
	const ensureBridge = async (): Promise<void> => {
		if (!runtime.bridge) return;
		const shot = await scan();
		// 扫不动就维持现状：一次扫描抖动不该把好桥全停掉（同「扫不动 ≠ 没有窗」）
		if (!shot.ok) return;
		const { alive } = await splitByHealth(shot.windows);
		const own = ownWindowPort();
		const foreign = new Map<number, PetWindow>();
		for (const w of alive) if (w.port > 0 && w.port !== own) foreign.set(w.port, w);
		// 窗被关掉 / 换掉（`/pet-auto restart`、崩了重开）之后，旧桥必须停：
		// 否则本会话永远挂在已经不存在的端口上，新窗没人接 = 宠物窗重启了也没人动。
		for (const [port, stop] of [...activeBridges]) {
			if (foreign.has(port)) continue;
			stop();
			activeBridges.delete(port);
		}
		for (const port of foreign.keys()) bridgeIfForeign(port);
	};

	/**
	 * 跨进程的开窗流程：扫描 → 验活 → 不够就抢锁 → 复核 → 派发 `/pet` → 等自己的窗冒出来。
	 * 任何一个「已经有活窗」的分支都走 `adopt`（复用），绝不叠第二扇。
	 */
	const openWindow = async (size: PetSize, ctx: Notifier, ignore: ReadonlySet<number> = new Set()): Promise<void> => {
		// 刚 taskkill 掉的窗可能还在进程表里挂着，先剔掉，别把尸体当活窗复用
		const live = (r: ScanResult): PetWindow[] => r.windows.filter((w) => !ignore.has(w.pid));
		// 「扫不动」≠「真没有窗」。先重试一次；还是不行就照开，但**明说**保证已降级，
		// 否则用户只会看到莫名其妙的两只，还查不出原因。
		let shot = await scan();
		if (!shot.ok) {
			await sleep(POLL_MS);
			shot = await scan();
		}
		if (!shot.ok) {
			notify(ctx, "扫不到全机宠物窗（wmic / PowerShell 都没成功），单只保证已降级，仍按配置开一扇", "warning");
		}
		// 验活：端口没人监听的孤儿不占名额（否则会一直吸附在死窗上）
		const base = await splitByHealth(live(shot));
		const reapedBase = await reapOrphans(base.orphans);
		if (reapedBase > 0) {
			notify(ctx, `清掉 ${reapedBase} 个孤儿宠物窗（主人 pi 进程已死，端口没人监听，收不到任何事件）`);
		}
		if (base.alive.length >= runtime.maxPets) {
			adopt(base.alive, ctx);
			return;
		}

		if (!acquireLock()) {
			// 别的会话正在开：等它开出来复用，别抢着再开一扇
			const born = await waitForNewWindow(new Set(live(shot).map((w) => w.pid)), LAUNCH_WAIT_MS, ignore);
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
			const recheckShot = await scan();
			const recheck = await splitByHealth(live(recheckShot));
			const reapedAgain = await reapOrphans(recheck.orphans);
			if (reapedAgain > 0) notify(ctx, `清掉 ${reapedAgain} 个孤儿宠物窗（主人 pi 进程已死）`);
			if (recheck.alive.length >= runtime.maxPets) {
				adopt(recheck.alive, ctx);
				return;
			}
			// 派发扩展命令：pi 认 `/` 开头 + expandPromptTemplates，命令执行完即 return，
			// 不进 prompt、不起 LLM 轮次（agent-session.js 的 _tryExecuteExtensionCommand）
			try {
				pi.sendUserMessage(`/${PET_COMMAND} ${size}`, { expandPromptTemplates: true });
			} catch (err) {
				// 派发失败（极少）：宠物没开出来，不影响会话，但别静默——不然又是一桩无头案
				notify(ctx, `派发 /pet 失败：${String((err as Error)?.message ?? err).slice(0, 60)}`, "warning");
				return;
			}
			const born = await waitForNewWindow(new Set(live(recheckShot).map((w) => w.pid)), WATCH_MS, ignore);
			if (born.length > 0) {
				// 只有**复核扫描可信**时才敢认领「这是我自己开的那扇」：扫挂时 baseline 是空集，
				// 派发前后冒出来的别人的窗会被记成 reused:false → ownWindowPort()>0 →
				// 本会话既不建桥也不再开窗，宠物永远不动。不确定就记成「复用」，照样建桥。
				markFired({ ...born[0], reused: !recheckShot.ok });
				if (!recheckShot.ok) bridgeIfForeign(born[0].port);
			} else {
				notify(ctx, "派发 /pet 后 25s 内没等到新宠物窗（上游可能仍以为窗已开），可用 /pet-auto restart 换一只", "warning");
			}
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

		if (ctx.mode !== "tui") return; // print / json / rpc（bench 沙箱）不弹桌面窗

		// 建桥**独立于**下面的开窗闸：已经有活窗就接上，没有才考虑开。
		// 放在闸外是修「/reload 或切会话后复用的窗永久待机」的关键。
		void ensureBridge();

		if (!runtime.autostart) return;
		if (fired || alreadyFiredThisProcess()) return;
		if (broken) notify(ctx, `pi-dsh-pet 配置读坏，按默认启用处理：${CONFIG_PATH}`, "warning");

		fired = true;
		markFired(undefined, true); // 先记「打算开」，真等到窗（或复用）再转正
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
				// 已经开着活窗的，本进程马上补一条桥
				const wins = (await scan()).windows;
				const { alive } = await splitByHealth(wins);
				for (const w of alive) bridgeIfForeign(w.port);
				notify(ctx, `事件桥已开${alive.length > 0 ? `（接到 pid ${alive[0].pid} :${alive[0].port}）` : "（没扫到可接的活窗）"}`);
				return;
			}
			if (verb === "cleanup") {
				const { alive, orphans } = await splitByHealth((await scan()).windows);
				// 拿不到出生时刻的（startedAt=0）当最新的处理 → 优先收掉
				const wins = alive.sort((a, b) => (a.startedAt || Number.MAX_SAFE_INTEGER) - (b.startedAt || Number.MAX_SAFE_INTEGER));
				const keep = wins.slice(0, runtime.maxPets);
				const drop = wins.slice(runtime.maxPets);
				if (drop.length === 0 && orphans.length === 0) {
					notify(ctx, `现在 ${wins.length} 只，没多余的（上限 ${runtime.maxPets}）`);
					return;
				}
				let closed = 0;
				for (const w of drop) if (await killer()(w)) closed++;
				const reaped = await reapOrphans(orphans, ctx);
				notify(
					ctx,
					`关掉了 ${closed} 只多余的宠物窗，保留最老的 ${keep.length} 只` +
						(keep.length > 0 ? `（${keep.map((w) => `pid ${w.pid}:${w.port}`).join(" / ")}）` : "") +
						(reaped > 0 ? `；另清掉 ${reaped} 个孤儿窗` : "") +
						`｜想换一只大的用 /pet-auto restart`,
				);
				return;
			}
			if (verb === "restart") {
				const { windows } = await scan();
				for (const w of windows) await killer()(w);
				// taskkill 之后进程表还会挂一会儿：把这些 pid 拉黑到本轮开窗结束，
				// 否则复核时会把刚杀的窗当活窗复用 → 桥到尸体上，永远收不到事件
				const ignore = new Set(windows.map((w) => w.pid));
				fired = false;
				stopBridges();
				// 上游要等它自己的 exit 回调把 electronProc 置空，否则再派发 /pet 会被当成
				// 「窗已开」→ 变成 add_pet（钩子在的话就被拦掉，窗就一直不出来了）
				await sleep(RESTART_WAIT_MS);
				await openWindow(runtime.size, ctx, ignore);
				return;
			}

			// 默认（无参 / status）：把「限额到底生效了没」摊开给用户看
			const shot = await scan();
			const { alive, orphans } = await splitByHealth(shot.windows);
			const wins = alive.sort((a, b) => a.startedAt - b.startedAt);
			const state = readState();
			const own = ownWindowPort();
			notify(
				ctx,
				`pi-dsh-pet autostart=${runtime.autostart} size=${runtime.size} delayMs=${runtime.delayMs} ` +
				`maxPets=${runtime.maxPets} bridge=${runtime.bridge ? "on" : "off"} ` +
					// 这两个不是一个东西，分开写：fired 是**本模块实例**开没开过（/reload 会重置），
					// alreadyFiredThisProcess() 是 pid 记账说本进程开没开过（跨 /reload 仍在）。
					// 合成一个「本进程已弹」会自相矛盾：/reload 后 fired=false，而窗明明是本进程开的。
					`本实例已开=${fired} 记账命中=${alreadyFiredThisProcess()}` +
					`\n宠物包=${petInstalled() ? "已装" : "未装"} 扫进程=${shot.ok ? "ok" : "失败(保证降级)"}` +
					` 活窗=${wins.length}/${runtime.maxPets}` +
					(wins.length > 0 ? `（${wins.map((w) => `pid ${w.pid}:${w.port}`).join(" / ")}）` : "") +
					` 孤儿窗=${orphans.length}` +
					(orphans.length > 0 ? `（${orphans.map((w) => `pid ${w.pid}:${w.port}`).join(" / ")}，cleanup 可收）` : "") +
					` add_pet 已拦=${blockedAddPet} 钩子=${addPetBlocked ? "已装" : "没装"}` +
					`\n事件桥：${bridgeReport()}` +
					(own > 0 ? `（:${own} 是本进程自己开的，上游直发不桥）` : "") +
					`\n记账：${STATE_PATH}${state.window ? `（上次落在 pid ${state.window.pid}:${state.window.port}${state.window.reused ? " 复用" : ""}）` : ""}` +
					`｜多的用 cleanup 收，只留一只且要新开窗用 restart`,
			);
		},
	});
}
