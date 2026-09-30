/**
 * pi-pet-autostart — 桌面宠物的**薄客户端**：喂事件、转发命令、**有界地**拉起宿主
 *
 * ============================ 2026-09-30 重写：为什么 ============================
 * 上一版（原 2700 行）照着 `pi-dsh-pet` **0.0.1** 的架构写的：那时 HTTP+WS 服务住在 pi
 * 进程里、`/pet` 在本进程弹窗、pi 退出自己 taskkill 窗，所以需要本扩展自建一个「不属于 pi
 * 的宿主」把窗的寿命救出来（`pi-pet-host.cjs` + 全局端口 + 巡检 + 事件桥）。
 *
 * 上游现在 **0.0.2 = 独立应用**：宿主 `bin/pi-pet.cjs` 自己就是那个「不属于 pi 的进程」，
 * 单例锁、`ctrl.json` 意图、`state.json` 端口真源、`/health` `/feed` `/control` 都齐了。
 * 于是旧的两大职责（宿主化、整机单只）**上游自己已经做了**，本扩展继续做只剩两个后果：
 *
 *   1. **两个宿主互相锁死**：旧版把状态写在 `~/.pi/agent/state/pi-pet-global.json`，而上游
 *      `app/host.cjs` 的 `foreignStateFiles()` **明确会读这个文件**——读到 `role:"pi-pet-host"`
 *      + 活着的 pid 就判定「已经有宿主在跑」→ 上游 `pi-pet start` 永远起不来。
 *   2. **无限拉起 pi.exe → 电脑卡死**（用户报的故障，成因已实测确认）：上游 0.0.2 的扩展
 *      `cliSpec()` 用 `process.execPath` 当 node 跑 CLI，而 pi 自己就是 **Bun 打包的单文件**
 *      （本机 `D:\agent\pi\pi.exe`，111MB），于是 `spawn(pi.exe, ["…\\bin\\pi-pet.cjs","start"])`
 *      变成「**再起一个 pi**」：pi 把该路径当 prompt 位置参数，开一个完整交互会话卡住不退出
 *      （实测抓到 `pid 39172  pi.exe …pi-pet.cjs start`，21:35 起一直活着）。而它的
 *      `scheduleReconnect()` 每 2s 一轮、每轮先 `findHost()`——`status --json` 也走同一个
 *      `process.execPath`，一次 `ensureHost()` 能连起 30 个 status 进程（12s / 400ms），
 *      宿主起不来就无限重来 → 进程洪水 → 内存/CPU 打满 → 卡死机。（pi 里唯一那层探针
 *      `probeExistingHosts` 恰好被第 1 条的死锁卡成永远 false，所以这个循环**永不自停**。）
 *
 * 所以这一版**只做三件事**，每件都自带上限：
 *   ① 探活（读 `state.json` + `GET /health`，**零进程**）→ 复用整机那一个宿主；
 *   ② 拉宿主（**只在探活失败时**：mkdir 启动锁 + 整机冷却 + 指数退避 + 每进程尝试上限）；
 *   ③ 把本会话的 agent 事件喂进 `WS /feed?source=…&token=…`（单连接、退避重连、握手看门狗）。
 * 顺带接上 `/pet` `/pet-stop` `/pet-say` `/pet-status` `/pet-auto`（走 `/control`）。
 *
 * ================================ 三条铁律 ================================
 * **铁律 1：绝不 `spawn(process.execPath, …)`。** pi 的 `process.execPath` 是 pi 自己。
 *   `resolveRuntime()` 把 `node|bun` 之外的 exe 全拒掉（本机就会拒掉 `pi.exe`），
 *   这是上一场卡死的**唯一**触发点，别「优化」掉。
 * **铁律 2：探活不许起进程。** 端口/宿主信息只来自 `state.json` + HTTP，`spawn` 仅出现在
 *   `startHost()` 一处，且必须有锁 + 冷却 + 上限。任何「顺手 execFile 一下看看」的写法在
 *   多会话 × 反复 `/reload` 下都会变成进程洪水。
 * **铁律 3：不再往 `~/.pi/agent/state/pi-pet-global.json` 写 `role:"pi-pet-host"`。**
 *   上游把那个路径当「外来宿主状态文件」，写了它就挡住上游自己的宿主（= 回到死锁）。
 *   本扩展的状态文件是 `pi-pet-autostart.json`，只放本扩展自己的记账。
 *
 * ================================ 依赖关系 ================================
 * ```
 *  pi 进程（本扩展）                 pi-pet 宿主（node，独立 detached 进程）
 *   ├ ensureHost() ──spawn(node)──▶ bin/pi-pet.cjs start   ← 全机只可能有一个
 *   ├ WS /feed ───────────────────▶ 状态机 → WS /ws → Electron 窗
 *   └ /control（REST + token）────▶ show / hide / say / restart / set-ctrl
 * ```
 * 上游自带的扩展（`pi/extensions/index.ts`）**已被 settings.json 关掉**
 * （`{"source":"git:github.com/qq458249269/pi-dsh-pet","extensions":[]}`），因为它就是
 * 铁律 1 的受害者；本文件接管它的全部职责，**不依赖它加载**（所以不通过 `/pet` 命令反查
 * 包目录，见 `petPackageRoot()`）。
 *
 * 配置文件 `~/.pi/agent/extensions/pi-dsh-pet.json`（缺失 = 全默认）：
 *   { "autostart": true, "feed": true, "size": "normal", "maxPets": 1, "keepAlive": true,
 *     "window": true, "port": 0, "startTimeoutMs": 12000, "maxStartAttempts": 3,
 *     "reapStrays": true, "node": "", "home": "" }
 *   - autostart: false → 不自动拉宿主（仍可 `/pet` 手动拉）
 *   - feed: false      → 本会话不喂事件（宠物照常自己动）
 *   - window: false    → 拉宿主用 **`serve`**（只起服务不开窗，= `start --no-window`）
 *   - port: 0          → 拉宿主时不传 `--port`，由宿主自己挑（默认端口 47653，被占退随机）
 *   - startTimeoutMs   拉起后等 `/health` 的上限
 *   - maxStartAttempts **一个 pi 进程内**最多自己拉几次（超出只等，不再试）
 *   - reapStrays       清掉历史遗留的 `pi.exe …pi-pet.cjs` 野进程（整机 10 分钟一次）
 *   - node / home      指定跑宿主的运行时 / 上游数据目录（一般不用填）
 *
 * ====================== 2026-09-30 晚：对齐上游的「服务端」契约 ======================
 * 上游把桌宠做成了**独立服务 + 对外端口**（commit 8643105 / ef86a23），客户端要认的东西
 * 换了一套，本扩展跟着换（这一节的每条都能在 `app/main.cjs` 找到对应）：
 *
 *   启动动词  `pi-pet serve`（= start --no-window，只起服务）/ `pi-pet start`（前台，带窗）
 *   端口真源  `<home>/port` 一行数字（`writePortFile` 明说「pi 扩展 / dsh 插件 / 外部脚本
 *             读这一行就能连上」）；`state.json` 只是本仓库宿主额外写的账（pid/窗/心跳）。
 *             → `findHost()` 现在 `state.json` 与 `port` 文件**两个来源都认**，只要
 *               `/health` 核过 role + pid 活着就算数。
 *   鉴权      `<home>/token`，REST 与 `/feed` WS 共用（`/health`、`/ws` 免鉴权）。
 *   能力探测  `GET /control`（不带 action）→ 400 + `hint`；`GET /event`（不带 type）→
 *             400/200；401 = 鉴权被拒。上游 `probeCaps()` 就是这么判的，理由是
 *             「状态文件是任何进程都能写的普通文件」——外来/旧版宿主只有 /health /ws。
 *             → 本扩展 `probeCaps()` 同样两个只读探测，`say` 在没有控制面时退到事件面。
 *   退出码    0 正常 / 1 没在跑 / 2 参数错 / 3 缺 ws 依赖 / 4 端口问题（`main.cjs` 文件头）
 *             → 拉宿主时把子进程输出收进 `spawn-log.txt`，按码翻译成人话（之前 `stdio:"ignore"`
 *               把「缺依赖」「单例锁被占」这些真正的死因全丢了，只剩一句「没应答」）。
 *   自检      `pi-pet doctor`（素材/依赖/端口/窗）、`pi-pet status --json`、`pi-pet port`。
 *             → `/pet-status doctor` 转发它（用户主动触发的一次性进程，不在探活链路上）。
 *
 * 拉宿主只用 `serve` / `start` 这两个词（都是前台应用，`keepAlive()` 让它不退出 → 父会话
 * 死掉也不影响它）。若宿主退出码是 2（旧 CLI 不认 `serve` 这个词），**只回退一次**
 * `start --no-window`，绝不循环试词——那正是把机器拖死的老毛病。
 *
 * 只在 TUI 模式自动启动（`print` / `json` / `rpc` 不弹桌面窗）。
 * 回退：删本文件 + 从 settings.json 的 `packages` 删掉 `pi-dsh-pet` 那条对象 → `/reload`。
 */
import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/* ============================== 路径（env 可改，探针靠它指到临时目录） ============================== */

const AGENT_DIR = path.join(homedir(), ".pi", "agent");
const CONFIG_PATH = process.env.PI_PET_CONFIG ?? path.join(AGENT_DIR, "extensions", "pi-dsh-pet.json");
const SETTINGS_PATH = process.env.PI_PET_SETTINGS ?? path.join(AGENT_DIR, "settings.json");
/** 本扩展自己的记账（**不是**宿主状态，见铁律 3）。 */
const STATE_PATH = process.env.PI_PET_STATE ?? path.join(AGENT_DIR, "state", "pi-pet-autostart.json");
/** 启动锁：多个 pi 会话同时开 → 只有一个去 spawn 宿主。 */
const BOOT_LOCK_PATH = process.env.PI_PET_BOOT_LOCK ?? `${STATE_PATH}.boot.lock`;
/** 旧版留下的「外来状态文件」：上游会把它当宿主，挡着自己的宿主起不来。 */
const LEGACY_GLOBAL_PATH = path.join(AGENT_DIR, "state", "pi-pet-global.json");
/** 包根目录的判据（有 `bin/pi-pet.cjs` 才算数，光有 `pi/extensions/index.ts` 会被别的包骗）。 */
const CLI_REL = path.join("bin", "pi-pet.cjs");

const SIZES = ["small", "normal", "large"] as const;
type PetSize = (typeof SIZES)[number];
const MAX_PETS_CEILING = 8;

/** 启动锁 TTL：主人被硬杀留下的锁，超过这个时间允许接管。 */
const LOCK_TTL_MS = numEnv("PI_PET_LOCK_TTL_MS", 45_000);
/** 整机级冷却：两次「自己拉宿主」之间的最小间隔（多会话 / 反复 `/reload` 都算）。 */
const START_COOLDOWN_MS = numEnv("PI_PET_START_COOLDOWN_MS", 20_000);
/** 退避上限：连着失败时 20s → 40s → 80s … 最长 10 分钟一次。 */
const START_BACKOFF_MAX_MS = numEnv("PI_PET_START_BACKOFF_MAX_MS", 600_000);
/** `/feed` 重连退避：2s → 4s → 8s … 30s 封顶。 */
const FEED_BACKOFF_MAX_MS = numEnv("PI_PET_FEED_BACKOFF_MAX_MS", 30_000);
/** `/feed` 握手看门狗：超时就当这次失败（端口有人监听但没人应答那种假活）。 */
const FEED_WATCHDOG_MS = numEnv("PI_PET_FEED_WATCHDOG_MS", 6_000);
/** 野进程清理的整机间隔（PowerShell 扫全机要 ~2.7s，别每次 session_start 都跑）。 */
const REAP_INTERVAL_MS = numEnv("PI_PET_REAP_INTERVAL_MS", 600_000);
/** 思考中最多每 2s 推一帧（窗里动画自己循环，靠这个续期气泡）。 */
const THINKING_TICK_MS = 2_000;

function numEnv(name: string, fallback: number): number {
	const raw = Number(process.env[name]);
	return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 定时器默认 unref：扩展不该拖住 pi 退出（等待链上的用裸 setTimeout，不走这里）。 */
function unrefTimer<T>(timer: T): T {
	(timer as unknown as { unref?: () => void }).unref?.();
	return timer;
}

/* ============================== 配置 ============================== */

interface PetConfig {
	autostart?: boolean;
	feed?: boolean;
	size?: string;
	maxPets?: number;
	keepAlive?: boolean;
	window?: boolean;
	/** 拉宿主时传的 `--port`；0 = 不传，让宿主自己挑（它默认 47653，被占会退随机）。 */
	port?: number;
	startTimeoutMs?: number;
	maxStartAttempts?: number;
	reapStrays?: boolean;
	node?: string;
	home?: string;
}

interface ResolvedConfig {
	autostart: boolean;
	feed: boolean;
	size: PetSize;
	maxPets: number;
	keepAlive: boolean;
	window: boolean;
	port: number;
	startTimeoutMs: number;
	maxStartAttempts: number;
	reapStrays: boolean;
	/** 跑宿主的运行时（绝对路径）；空串 = 自动找 node / bun（**绝不是 pi 自己**）。 */
	node: string;
	/** 上游数据目录；空串 = `%APPDATA%/pi-dsh-pet`（Windows）或 `~/.pi-dsh-pet`。 */
	home: string;
}

const DEFAULTS: ResolvedConfig = {
	autostart: true,
	feed: true,
	size: "normal",
	maxPets: 1,
	keepAlive: true,
	window: true,
	port: 0,
	startTimeoutMs: numEnv("PI_PET_START_TIMEOUT_MS", 12_000),
	maxStartAttempts: numEnv("PI_PET_MAX_START_ATTEMPTS", 3),
	reapStrays: true,
	node: "",
	home: "",
};

/** 读配置；文件缺失 = 默认；读坏也按默认（`broken` 让扩展在会话里说一声）。 */
function loadConfig(): { config: ResolvedConfig; broken: boolean } {
	const read = (raw: PetConfig): ResolvedConfig => {
		const int = (v: unknown, min: number, max: number, fallback: number): number =>
			typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
		return {
			// 只认显式 false：字段写错时仍视为启用，避免宠物莫名消失
			autostart: raw.autostart !== false,
			feed: raw.feed !== false,
			size: SIZES.includes(raw.size as PetSize) ? (raw.size as PetSize) : DEFAULTS.size,
			maxPets: int(raw.maxPets, 1, MAX_PETS_CEILING, DEFAULTS.maxPets),
			keepAlive: raw.keepAlive !== false,
			window: raw.window !== false,
			port: int(raw.port, 0, 65_535, DEFAULTS.port),
			startTimeoutMs: int(raw.startTimeoutMs, 2_000, 120_000, DEFAULTS.startTimeoutMs),
			maxStartAttempts: int(raw.maxStartAttempts, 1, 20, DEFAULTS.maxStartAttempts),
			reapStrays: raw.reapStrays !== false,
			node: typeof raw.node === "string" ? raw.node.trim() : "",
			home: typeof raw.home === "string" ? raw.home.trim() : "",
		};
	};
	try {
		if (!existsSync(CONFIG_PATH)) return { config: { ...DEFAULTS }, broken: false };
		return { config: read(JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as PetConfig), broken: false };
	} catch {
		return { config: { ...DEFAULTS }, broken: true };
	}
}

function saveConfig(config: ResolvedConfig): void {
	try {
		mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
		writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	} catch {
		/* 写不回配置不算错：本次会话内照样生效 */
	}
}

/* ============================== 本扩展自己的记账 ============================== */

interface LocalState {
	/** 上次「自己拉宿主」的时刻（整机冷却用，跨会话共享）。 */
	lastStartAt?: number;
	/** 连着失败几次（退避用）。 */
	failures?: number;
	/** 上次清野进程的时刻。 */
	lastReapAt?: number;
}

function readLocalState(): LocalState {
	try {
		return JSON.parse(readFileSync(STATE_PATH, "utf8")) as LocalState;
	} catch {
		return {};
	}
}

/** 先写临时文件再改名：别的会话永远读不到半截 JSON。 */
function writeLocalState(patch: LocalState): void {
	try {
		mkdirSync(path.dirname(STATE_PATH), { recursive: true });
		const tmp = `${STATE_PATH}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify({ ...readLocalState(), ...patch }, null, 2)}\n`, "utf8");
		try {
			rmSync(STATE_PATH, { force: true });
		} catch {
			/* Windows 上 rename 不能覆盖已存在的文件 */
		}
		renameSync(tmp, STATE_PATH);
	} catch {
		/* 记账失败只是下次多重试一次 */
	}
}

/* ============================== 找上游：包目录 / 数据目录 / token ============================== */

function isPackageRoot(dir: string | null | undefined): dir is string {
	return typeof dir === "string" && dir !== "" && existsSync(path.join(dir, CLI_REL));
}

/** settings.json 的 packages 项 → 该装到哪（与 pi 的安装布局一致）。 */
function installedDirsFromSettings(): string[] {
	const dirs: string[] = [];
	let raw: unknown;
	try {
		raw = (JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as { packages?: unknown })?.packages;
	} catch {
		return dirs;
	}
	if (!Array.isArray(raw)) return dirs;
	for (const entry of raw) {
		const source = typeof entry === "string" ? entry : ((entry as { source?: string })?.source ?? "");
		if (source === "") continue;
		const withoutScheme = source.replace(/^(git|npm|local|file):/, "");
		if (source.startsWith("npm:")) {
			const name = withoutScheme.replace(/@[^@/]*$/, "");
			dirs.push(path.join(AGENT_DIR, "npm", "node_modules", name));
			dirs.push(path.join(AGENT_DIR, "node_modules", name));
		} else if (source.startsWith("git:")) {
			// `git:github.com/<owner>/<repo>`（可带 `@ref`）→ ~/.pi/agent/git/github.com/<owner>/<repo>
			const repo = withoutScheme.split("@")[0];
			dirs.push(path.join(AGENT_DIR, "git", ...repo.split("/")));
		} else {
			dirs.push(path.resolve(withoutScheme));
		}
	}
	return dirs;
}

/**
 * 上游包根目录。**不**走 `pi.getCommands()` 反查 `/pet` 命令的来源——上游扩展已被
 * settings 关掉（铁律 1 的受害者），那条路在有意禁用后就断了。这里按
 * `PI_PET_PKG` → settings.json → 常见安装位置 → `~/.pi/agent/git` 下两层扫 的顺序找。
 */
function petPackageRoot(): string | null {
	const candidates: string[] = [];
	if (process.env.PI_PET_PKG) candidates.push(process.env.PI_PET_PKG);
	candidates.push(...installedDirsFromSettings());
	candidates.push(path.join(AGENT_DIR, "npm", "node_modules", "pi-dsh-pet"), path.join(AGENT_DIR, "node_modules", "pi-dsh-pet"));
	try {
		// 换 owner / 换机器时兜底：git 布局固定是 <agent>/git/<host>/<owner>/<repo>
		for (const host of readdirSync(path.join(AGENT_DIR, "git"))) {
			const hostDir = path.join(AGENT_DIR, "git", host);
			if (!existsSync(hostDir)) continue;
			for (const owner of readdirSync(hostDir)) candidates.push(path.join(hostDir, owner, "pi-dsh-pet"));
		}
	} catch {
		/* 没有 git 布局就算了 */
	}
	for (const dir of candidates) if (isPackageRoot(dir)) return dir;
	return null;
}

/**
 * 上游数据目录（`state.json` / `ctrl.json` / `token` / `log.txt` 都在这）。
 * 规则与上游 `app/paths.cjs` 一致：`PI_PET_HOME` > `%APPDATA%/pi-dsh-pet` > `~/.pi-dsh-pet`；
 * 这里再加一条：**哪个候选里真的有 token/state 就用哪个**（用户手改过目录也不会认错）。
 */
function petHomeDir(configured = ""): string {
	const appdata = process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming");
	const defaults = process.platform === "win32" ? [path.join(appdata, "pi-dsh-pet")] : [];
	defaults.push(path.join(homedir(), ".pi-dsh-pet"));
	const candidates = [configured, process.env.PI_PET_HOME ?? "", ...defaults].filter((s) => s !== "");
	const used = candidates.find((dir) => existsSync(path.join(dir, "token")) || existsSync(path.join(dir, "state.json")));
	return used ?? candidates[0] ?? path.join(homedir(), ".pi-dsh-pet");
}

/** REST/WS 鉴权 token（宿主起来时写一次，之后不变）。 */
function petToken(home: string): string {
	try {
		return readFileSync(path.join(home, "token"), "utf8").trim();
	} catch {
		return "";
	}
}

/**
 * `<home>/port` —— 上游 `writePortFile()` 明写「pi 扩展 / dsh 插件 / 外部脚本读这一行就能
 * 连上」。这是**新服务端对外的端口真源**；`state.json` 只是本仓库宿主额外记的账。
 * 上一版只认 `state.json`，于是「宿主在跑但 state.json 没了/被别 home 占了」就一律判
 * 「没宿主」→ 白白再拉一个（正是两个宿主互相锁死的入场券）。0 = 没写。
 */
function readPortFile(home: string): number {
	try {
		const n = Number(readFileSync(path.join(home, "port"), "utf8").trim());
		return Number.isInteger(n) && n > 0 && n <= 65_535 ? n : 0;
	} catch {
		return 0;
	}
}

/* ============================== 宿主探活：读文件 + HTTP，零进程 ============================== */

/** `state.json` / `/health` 的公共字段（两者形状基本一致，只取用得到的）。 */
interface HostState {
	role?: string;
	pid?: number;
	port?: number;
	token?: string;
	startedAt?: number;
	heartbeatAt?: number;
	windowPid?: number;
	windowState?: string;
clients?: number;
	feeds?: number;
	/** `/health` 会带上：`{ "pi-1234": 1 }`，多会话谁在喂一目了然。 */
	feedsBySource?: Record<string, number>;
	state?: string;
	restarts?: number;
	[key: string]: unknown;
}

interface HostInfo extends HostState {
	port: number;
	pid: number;
	token: string;
	/** 端口是从哪儿读到的：`state.json` / `port` 文件 / `/health` 自己说的。 */
	stateSource: "state.json" | "port 文件" | "/health";
}

function readJsonFile<T>(file: string): T | null {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as T;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

function readHostState(home: string): HostState | null {
	return readJsonFile<HostState>(path.join(home, "state.json"));
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

/** 心跳超过这个值就当「状态文件是陈旧的」（上游写心跳的间隔是 5s）。 */
const HEARTBEAT_STALE_MS = 15_000;

/**
 * GET /health。**必须**核 `role === "pi-pet-host"`：状态文件/端口是任何进程都能写的普通东西，
 * 光看它说「有宠物」就信，等于把脏数据当宠物（本机就踩过：旧扩展写的
 * `pi-pet-global.json` 被上游当成「外来宿主」）。
 */
type HostHealth = (port: number, timeoutMs?: number) => Promise<HostState | null>;

const hostHealth: HostHealth = (port, timeoutMs = 1_200) =>
	((globalThis as { __piPetHostHealth?: HostHealth }).__piPetHostHealth ?? realHostHealth)(port, timeoutMs);

function realHostHealth(port: number, timeoutMs = 1_200): Promise<HostState | null> {
	return new Promise((resolve) => {
		let done = false;
		const finish = (value: HostState | null): void => {
			if (done) return;
			done = true;
			resolve(value);
		};
		let req: ReturnType<typeof httpRequest>;
		try {
			req = httpRequest({ host: "127.0.0.1", port, path: "/health", method: "GET", timeout: timeoutMs }, (res) => {
				if (res.statusCode !== 200) {
					res.resume();
					return finish(null);
				}
				let buf = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					buf += chunk;
					if (buf.length > 65_536) req.destroy();
				});
				res.on("end", () => {
					try {
						const parsed = JSON.parse(buf) as HostState;
						finish(parsed?.role === "pi-pet-host" ? parsed : null);
					} catch {
						finish(null);
					}
				});
			});
		} catch {
			return finish(null);
		}
		req.on("timeout", () => {
			req.destroy();
			finish(null);
		});
		req.on("error", () => finish(null));
		req.end();
	});
}

/**
 * 找到「整机那一个宿主」。**新服务端契约**：端口有两个来源（`state.json` 与 `<home>/port`），
 * 两者都不权威——`/health` 才是（所以必须核 `role` 与 pid）。全程零进程（铁律 2）。
 * 探不到返回 null（**不等于**「没有」，只是「现在没应答」）。
 */
async function findHost(home: string, timeoutMs = 1_200): Promise<HostInfo | null> {
	const state = readHostState(home);
	const statePort = Number(state?.port) || 0;
	const filePort = readPortFile(home);
	const port = statePort || filePort;
	if (!Number.isInteger(port) || port <= 0) return null;
	const health = await hostHealth(port, timeoutMs);
	// role 核在这一层（而不是只在真 HTTP 那条路上）：状态文件/端口文件是任何进程都能写的普通
	// 东西，光看它说「有宠物」就信 = 把脏数据当宠物（本机踩过：旧扩展写的 pi-pet-global.json）。
	if (health?.role !== "pi-pet-host") return null;
	// state.json 里的 pid 不在了 / 心跳陈旧 → 不信它（被硬杀的宿主会留下这种状态文件），
	// 但**端口仍然可以拿去问** /health：活着的新宿主可能只来得及写 `port` 文件。
	const statePid = Number(state?.pid) || 0;
	const heartbeat = Number(state?.heartbeatAt) || 0;
	const stateFresh = statePid > 0 && pidAlive(statePid) && (heartbeat === 0 || Date.now() - heartbeat <= HEARTBEAT_STALE_MS);
	const pid = Number(health.pid) || statePid;
	if (!stateFresh && !(Number.isInteger(pid) && pid > 0 && pidAlive(pid))) return null;
	const token = petToken(home) || String(health.token ?? "") || String(state?.token ?? "");
	const source: HostInfo["stateSource"] = stateFresh && statePort > 0 ? "state.json" : filePort > 0 ? "port 文件" : "/health";
	return { ...health, port: Number(health.port ?? port), pid, token, stateSource: source };
}

/** 等某个宿主把 `/health` 应答出来（拉起后轮询；轮询只读文件 + 发 HTTP，不起进程）。 */
async function waitForHost(home: string, timeoutMs: number, pollMs = 400): Promise<HostInfo | null> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = await findHost(home);
		if (found) return found;
		if (Date.now() >= deadline) return null;
		await sleep(pollMs);
	}
}

/* ============================== 启动锁（多会话只有一个去 spawn） ============================== */

const heldLocks = new Set<string>();

function lockStaleAt(lockPath: string): boolean {
	try {
		const owner = JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8")) as { pid?: number; at?: number };
		if (typeof owner.pid === "number" && pidAlive(owner.pid)) {
			return Date.now() - (Number(owner.at) || 0) > LOCK_TTL_MS;
		}
		return true;
	} catch {
		return true;
	}
}

/** mkdir 跨进程原子：抢到 = 归我拉宿主；抢不到且锁不陈旧 = 别人正在拉，等它公布端口。 */
function acquireLockAt(lockPath: string): boolean {
	if (heldLocks.has(lockPath)) return true;
	try {
		mkdirSync(lockPath);
	} catch {
		if (!lockStaleAt(lockPath)) return false;
		// 陈旧锁（主人进程被硬杀留下的）：清掉重抢一次
		try {
			rmSync(lockPath, { recursive: true, force: true });
			mkdirSync(lockPath);
		} catch {
			return false;
		}
	}
	heldLocks.add(lockPath);
	try {
		writeFileSync(
			path.join(lockPath, "owner.json"),
			`${JSON.stringify({ pid: process.pid, at: Date.now() }, null, 2)}\n`,
			"utf8",
		);
	} catch {
		/* 写不上 owner：最坏是下个会话等满 TTL */
	}
	return true;
}

function releaseLockAt(lockPath: string): void {
	if (!heldLocks.delete(lockPath)) return;
	try {
		rmSync(lockPath, { recursive: true, force: true });
	} catch {
		/* 留着等 TTL 过期被接管 */
	}
}

/* ============================== 运行时解析（铁律 1 在这里） ============================== */

/** PATH 上找可执行文件（Windows 要带 PATHEXT；PATH 项可能带引号，要剥掉）。 */
function findOnPath(exe: string): string | null {
	const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(path.delimiter) : [""];
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!dir) continue;
		const base = dir.replace(/^"|"$/g, "");
		for (const ext of exts) {
			const candidate = path.join(base, ext ? `${exe}${ext}` : exe);
			try {
				if (existsSync(candidate)) return candidate;
			} catch {
				/* 无权限目录跳过 */
			}
		}
	}
	return null;
}

/** 只有 node / bun 才配当「跑宿主」的运行时。`pi.exe`（Bun 打包的 pi）在这里被拒。 */
function isNodeOrBun(bin: string): boolean {
	return /^(node|bun)(\.exe|\.cmd|\.bat)?$/i.test(path.basename(bin));
}

/**
 * 宿主拿什么运行时跑。顺序：配置 `node` > `PI_PET_NODE` > PATH 上的 node > PATH 上的 bun。
 *
 * **铁律 1 的落点**：`process.execPath` 在这里**不是**候选。本机 pi 是 Bun 打包的单文件
 * （`pi.exe`），拿它跑 `bin/pi-pet.cjs` 等于「pi 启动 pi」，而 pi 会把脚本路径当 prompt
 * 位置参数开一个完整会话卡住不退出；上游扩展正是这么干的，配合它 2s 一轮的
 * `scheduleReconnect` 就是无限拉起 → 卡死机（见文件头）。唯一豁免：`process.execPath`
 * **本身就是** node/bun 时（真 node 跑的 pi）没毛病。
 */
function resolveRuntime(configured = ""): string | null {
	const candidates = [configured, process.env.PI_PET_NODE ?? "", findOnPath("node") ?? "", findOnPath("bun") ?? ""]
		.map((s) => s.trim())
		.filter((s) => s !== "");
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		if (!isNodeOrBun(candidate)) continue;
		return candidate;
	}
	const self = process.execPath ?? "";
	if (self !== "" && isNodeOrBun(self) && existsSync(self)) return self;
	return null;
}

/* ============================== 拉宿主（本文件唯一 spawn 的地方） ============================== */

interface SpawnSpec {
	command: string;
	args: string[];
	detached: boolean;
	windowsHide: true;
	/** 子进程 stdout/stderr 落到这个文件（**不用管道**）。 */
	logFile: string;
}

/** 子进程退了：退出码 + 它自己说的最后几句话（`main.cjs` 的诊断全在这里）。 */
interface ExitInfo {
	code: number | null;
	output: string;
}

/** spawner 返回值：pid 供日志/告警用；`exited` 给出「子进程已经退了」的 promise。 */
interface SpawnHandle {
	pid?: number;
	exited: Promise<ExitInfo | null>;
}

type HostSpawner = (spec: SpawnSpec) => SpawnHandle;

/** 拉宿主时把子进程的话记在这儿（每次拉起覆盖写，不会攒成垃圾）。 */
const SPAWN_LOG_PATH = path.join(path.dirname(STATE_PATH), "spawn-log.txt");

/** 读文件尾部（给失败诊断用；宿主日志可能很长，只看最后几 KB）。 */
function readTail(file: string, maxBytes = 4_000): string {
	try {
		const raw = readFileSync(file, "utf8");
		return raw.length > maxBytes ? raw.slice(-maxBytes) : raw;
	} catch {
		return "";
	}
}

/** 探针用 `globalThis.__piPetSpawnHost` 顶掉真拉起（免得测试机上真冒出宠物）。 */
function hostSpawner(): HostSpawner {
	const hook = (globalThis as { __piPetSpawnHost?: HostSpawner }).__piPetSpawnHost;
	if (typeof hook === "function") return hook;
	return (spec) => {
		// **为什么用日志文件而不是 pipe**：`pi-pet start/serve` 是前台应用，会一直往 stdout
		// 写；父会话一旦退出（正常退出 / 被 taskkill /t），管道的读端就没了，宿主后续的写入
		// 变成 EPIPE，Node 会抛未捕获的 stream error → 宠物当场崩（“桌宠活得比会话长”反了）。
		// 落文件没有这个尾巴，还能把真正的死因（缺 ws 依赖 / 单例锁被占）留下来。
		let fd: number | null = null;
		try {
			mkdirSync(path.dirname(spec.logFile), { recursive: true });
			fd = openSync(spec.logFile, "w");
		} catch {
			/* 写不了日志就退回 ignore：拉宿主本身不依赖它 */
		}
		const child = spawn(spec.command, spec.args, {
			detached: spec.detached,
			windowsHide: spec.windowsHide,
			stdio: ["ignore", fd ?? "ignore", fd ?? "ignore"],
		});
		if (fd !== null) {
			try {
				closeSync(fd);
			} catch {
				/* 句柄交给子进程了，父这边关了也一样 */
			}
		}
		let settle: (info: ExitInfo | null) => void = () => {};
		const exited = new Promise<ExitInfo | null>((resolve) => {
			settle = resolve;
		});
		child.on("error", (err) => settle({ code: null, output: `spawn 失败：${err.message}` })); // ENOENT 等：起不来，别让调用方白等满超时
		child.on("exit", (code) => settle({ code: code ?? null, output: readTail(spec.logFile) }));
		// detached：宿主不在父进程的控制台事件范围里（关 cmd / Ctrl+C 都不沾），父进程被
		// taskkill /t 时也不会连坐它。windowsHide：自己没有控制台。
		try {
			child.unref();
		} catch {
			/* 不影响 */
		}
		return { pid: child.pid, exited };
	};
}

/** 宿主自己说的「已经有一只」：不是失败，是别人的宿主在跑 → 该等它而不是报账。 */
const ALREADY_RUNNING = /已经在跑|已经有一只|already-running|单例锁/;

/** 挑出最值得看的一两行诊断（`main.cjs` 的 `out()` 行首有 `✓ ✗ ⚠`，它们最像结论）。 */
function keyLines(output: string): string {
	const lines = output
		.split(/\r?\n/)
		.map((line) => line.replace(/^[✓✗⚠]\s*/, "").trimEnd())
		.filter((line) => line !== "");
	const marked = lines.filter((line) => /^(✗|⚠)|起不来|缺|锁|端口|error|Error/.test(line));
	return (marked.length > 0 ? marked : lines).slice(0, 3).join(" / ") || "（无输出）";
}

/**
 * 把退出码翻译成人话。`app/main.cjs` 文件头写死了这套码：
 * 0 正常 / 1 没在跑而你要求它跑 / 2 参数错 / 3 依赖或资产缺失 / 4 端口问题。
 * 上一版 `stdio:"ignore"` 把这些全丢了，用户只看到一句「没应答」。
 */
function exitAdvice(exit: ExitInfo | null, root: string, home: string, timeoutMs: number): string {
	const detail = keyLines(exit?.output ?? "");
	if (exit === null) return `拉起的子进程没了，${Math.round(timeoutMs / 1000)}s 内也没应答`;
	const code = exit.code;
	if (code === 2) return `CLI 参数错（退出码 2）：${detail}`;
	if (code === 3) return `宿主缺依赖/资产（退出码 3）：${detail} → cd "${root}" && npm install`;
	if (code === 4) return `端口或启动失败（退出码 4）：${detail} → 看看 ${path.join(home, "port")} 是不是指向一个已经没人管的端口`;
	if (code === 1) return `宿主没起来（退出码 1）：${detail}`;
	if (code === 0) return `宿主自己退出了（退出码 0）：${detail}`;
	return `退出码 ${code ?? "?"}：${detail}`;
}

/** 跑一条命令取 stdout（只给野进程清理用，**不**参与任何探活）。 */
function capture(file: string, args: string[], timeout = 8_000): Promise<string | null> {
	return new Promise((resolve) => {
		try {
			execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 << 20, encoding: "utf8" }, (err, stdout) =>
				resolve(err || !stdout ? null : String(stdout)),
			);
		} catch {
			resolve(null);
		}
	});
}

/* ============================== 野进程清理（上一场卡死的残留） ============================== */

/**
 * 列出「把 pi-pet CLI 当 node 跑」的野进程：`pi.exe …bin/pi-pet.cjs …`。
 * 那是上一场 bug 的尸体：每个都是一个卡住的完整 pi 会话（40–200MB），攒几十个就卡死机。
 * 判据用「exe 基名 == pi 自己」+「命令行含 pi-pet.cjs」双条件，别的 pi 会话一个都不碰
 * （本会话的命令行形如 `pi  -ne`，不含 pi-pet.cjs）。
 */
const REAP_PS = [
	"$ErrorActionPreference='SilentlyContinue'",
	"$self=[System.Diagnostics.Process]::GetCurrentProcess().ProcessName",
	`Get-CimInstance Win32_Process -Filter "Name='$self.exe'"`,
	"  | Where-Object { $_.CommandLine -and $_.CommandLine -match 'pi-pet\\.cjs' }",
	"  | ForEach-Object { '{0}' -f $_.ProcessId }",
].join("; ");

async function reapStrayCliProcesses(): Promise<number> {
	const selfPid = process.pid;
	const pids: number[] = [];
	if (process.platform === "win32") {
		const out = await capture("powershell", ["-NoProfile", "-NonInteractive", "-Command", REAP_PS]);
		for (const line of (out ?? "").split(/\r?\n/)) {
			const pid = Number(line.trim());
			if (Number.isInteger(pid) && pid > 0 && pid !== selfPid) pids.push(pid);
		}
	} else {
		const ps = await capture("ps", ["-eo", "pid=,args="]);
		for (const line of (ps ?? "").split(/\r?\n/)) {
			const m = line.match(/^\s*(\d+)\s+(.*)$/);
			// 只认命令行里带 pi-pet CLI 的，别误伤同名进程
			if (m && Number(m[1]) !== selfPid && m[2].includes("pi-pet.cjs")) pids.push(Number(m[1]));
		}
	}
	let killed = 0;
	for (const pid of pids) {
		if (pid === selfPid) continue;
		if (process.platform === "win32") {
			const out = await capture("taskkill", ["/pid", String(pid), "/f", "/t"]);
			if (out !== null || true) killed++; // taskkill 失败只会是因为它已经没了
		} else {
			try {
				process.kill(pid, "SIGKILL");
				killed++;
			} catch {
				/* 已经没了 */
			}
		}
	}
	return killed;
}

/* ============================== /feed 客户端（单连接 + 退避重连） ============================== */

/** WS 客户端：优先全局 `WebSocket`（Bun / Node≥22 都有），否则退到 `ws` 依赖。 */
interface SocketLike {
	send(data: string): void;
	close(): void;
}

function openSocket(url: string, handlers: { open: () => void; close: () => void; error: (err: Error) => void }): SocketLike | null {
	const dom = (globalThis as { WebSocket?: new (u: string) => unknown }).WebSocket;
	if (typeof dom === "function") {
		try {
			const ws = new dom(url) as { send(data: string): void; close(): void; addEventListener(type: string, fn: (ev: unknown) => void): void };
			ws.addEventListener("open", () => handlers.open());
			ws.addEventListener("close", () => handlers.close());
			ws.addEventListener("error", (ev) => handlers.error(new Error(String((ev as { message?: string })?.message ?? "ws error"))));
			return { send: (d) => ws.send(d), close: () => ws.close() };
		} catch {
			/* 构造失败就退到 ws 包 */
		}
	}
	try {
		for (const base of [import.meta.url, path.join(AGENT_DIR, "package.json"), process.cwd()]) {
			const Ctor = createRequire(base)("ws") as { WebSocket?: new (u: string) => unknown } | undefined;
			if (typeof Ctor?.WebSocket !== "function") continue;
			const ws = new Ctor.WebSocket(url) as { send(d: string): void; close(): void; on(e: string, fn: (...args: unknown[]) => void): void };
			ws.on("open", () => handlers.open());
			ws.on("close", () => handlers.close());
			ws.on("error", (err: unknown) => handlers.error(err as Error));
			return { send: (d) => ws.send(d), close: () => ws.close() };
		}
	} catch {
		/* 没有 ws 依赖 */
	}
	return null;
}

/** 桥的对外状态，给 `/pet-status` 看（不让它永远停在「connecting」装样子）。 */
interface FeedInfo {
	state: "connecting" | "open" | "closed" | "error" | "idle";
	lastError: string;
	sent: number;
	port: number;
	since: number;
}

/* ============================== 控制面（REST /control） ============================== */

type ControlResult = { ok: boolean; detail?: string; error?: string };

async function postJson(port: number, pathname: string, body: unknown, token: string): Promise<ControlResult> {
	const payload = Buffer.from(JSON.stringify(body), "utf8");
	return new Promise((resolve) => {
		let done = false;
		const finish = (value: ControlResult): void => {
			if (done) return;
			done = true;
			resolve(value);
		};
		let req: ReturnType<typeof httpRequest>;
		try {
			req = httpRequest(
				{
					host: "127.0.0.1",
					port,
					path: pathname,
					method: "POST",
					timeout: 3_000,
					headers: {
						"content-type": "application/json",
						"content-length": payload.length,
						...(token !== "" ? { authorization: `Bearer ${token}` } : {}),
					},
				},
				(res) => {
					let buf = "";
					res.setEncoding("utf8");
					res.on("data", (chunk: string) => {
						buf += chunk;
					});
					res.on("end", () => {
						try {
							const parsed = JSON.parse(buf) as ControlResult;
							finish(parsed && typeof parsed.ok === "boolean" ? parsed : { ok: res.statusCode === 200 });
						} catch {
							finish({ ok: res.statusCode === 200, error: buf.slice(0, 120) });
						}
					});
				},
			);
		} catch (err) {
			return finish({ ok: false, error: String((err as Error).message ?? err) });
		}
		req.on("timeout", () => {
			req.destroy();
			finish({ ok: false, error: "超时" });
		});
		req.on("error", (err) => finish({ ok: false, error: err.code ?? err.message }));
		req.write(payload);
		req.end();
	});
}

/** GET + JSON：给能力探测用（`/control`、`/event` 不带参数时宿主自己会回 400/404）。 */
type GetResult = { status: number; body: Record<string, unknown> | null; error: string };

function getJson(port: number, pathname: string, token: string, timeoutMs = 2_000): Promise<GetResult> {
	return new Promise((resolve) => {
		let done = false;
		const finish = (value: GetResult): void => {
			if (done) return;
			done = true;
			resolve(value);
		};
		let req: ReturnType<typeof httpRequest>;
		try {
			req = httpRequest(
				{
					host: "127.0.0.1",
					port,
					path: pathname,
					method: "GET",
					timeout: timeoutMs,
					headers: token !== "" ? { authorization: `Bearer ${token}` } : {},
				},
				(res) => {
					let buf = "";
					res.setEncoding("utf8");
					res.on("data", (chunk: string) => {
						buf += chunk;
						if (buf.length > 65_536) req.destroy();
					});
					res.on("end", () => {
						let body: Record<string, unknown> | null = null;
						try {
							const parsed = JSON.parse(buf) as unknown;
							body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
						} catch {
							/* 404 之类不是 JSON：状态码本身就是信号 */
						}
						finish({ status: res.statusCode ?? 0, body, error: "" });
					});
				},
			);
		} catch (err) {
			return finish({ status: 0, body: null, error: String((err as Error).message ?? err) });
		}
		req.on("timeout", () => {
			req.destroy();
			finish({ status: 0, body: null, error: "超时" });
		});
		req.on("error", (err) => finish({ status: 0, body: null, error: (err as NodeJS.ErrnoException).code ?? err.message }));
		req.end();
	});
}

/** POST `/event`：没有控制面的旧宿主上，`say` 在事件面也有（帧 `{type:"say",text}`）。 */
function postEvent(port: number, body: unknown, token: string): Promise<ControlResult> {
	return postJson(port, "/event", body, token);
}

/** 这个宿主支持哪些面。跟上游 `app/main.cjs` 的 `probeCaps()` 大体一致，但控制面的判据放宽了（见下）。 */
interface HostCaps {
	/**
	 * 控制面：**`GET /control` 不是 404** 就算数（400 = 端点在、只是不接受空 action）。
	 * 上游 `probeCaps()` 判的是「400 **且 body.hint 非空**」，但实测 v0.0.2 的宿主回的是
	 * 400 + **空 body**（带 hint 的那条只在 POST 分支）→ 上游自己的 CLI 会把自己当成
	 * 「没有控制面」。这里放宽：宁可信「有」，也不把真宿主拒之门外（那的表现就是
	 * `/pet` 永远叫不出窗 = 「拉不起来 pet」）。某个动作行不行，打完再看。
	 */
	control: boolean;
	/** 事件面：`GET /event` 不带 type → 400/200；旧宿主没这个端点 → 404。 */
	event: boolean;
	/** 鉴权：两个探测都不是 401。 */
	auth: boolean;
	/** 控制面自报的可用动作（`: hint`），拿它告诉用户「它只支持什么」（不一定有）。 */
	actions: string;
}

const capsCache = new Map<string, { at: number; caps: HostCaps | null }>();
const CAPS_TTL_MS = 5_000;

/**
 * 两个 **GET** 探测：都不带 body、不改任何状态（铁律 2：只发 HTTP）。
 * **什么时候探**：只有某个控制动作已经失败之后（`control()` 里「先打再探」）——正常路径
 * 一次 POST 就够了，探测不白跑。而失败之后必须探：`state.json` / `port` 是任何进程都能写的
 * 普通文件，**外来宿主**（旧 pi 扩展起的那套、或别的 home 的宿主）只有 `/health` `/ws`，
 * 喊 `say` / `restart` 只会丢一个裸 404 给用户；探到没有就直说「它只支持什么、怎么换」。
 */
async function probeCaps(port: number, token: string): Promise<HostCaps | null> {
	const key = `${port}:${token}`;
	const hit = capsCache.get(key);
	if (hit && Date.now() - hit.at < CAPS_TTL_MS) return hit.caps;
	const [ctl, evt] = await Promise.all([getJson(port, "/control", token), getJson(port, "/event", token)]);
	if (ctl.status === 0 && evt.status === 0) return null; // 两个都连不上：不是「没能力」，是没宿主
	const hint = typeof ctl.body?.hint === "string" ? (ctl.body.hint as string) : "";
	const caps: HostCaps = {
		control: ctl.status === 400 || ctl.status === 200,
		event: evt.status === 400 || evt.status === 200,
		auth: ctl.status !== 401 && evt.status !== 401,
		actions: hint,
	};
	capsCache.set(key, { at: Date.now(), caps });
	return caps;
}

/* ============================== 扩展本体 ============================== */

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

/** 所有通知都带上这个前缀，用户一眼知道是宠物这一路在说话。 */
const TAG = "桌面宠物";
export default function piPetAutostart(pi: ExtensionAPI): void {
	const { config, broken } = loadConfig();
	/** 运行时会话内可改（`/pet-auto size|max`）。 */
	let cfg = { ...config };
	/** 本进程已经尝试拉过几次宿主（上限 = `cfg.maxStartAttempts`，超出就只等不试）。 */
	let startAttempts = 0;
	/** `/feed` 连接与退避。 */
	let feed: FeedInfo = { state: "idle", lastError: "", sent: 0, port: 0, since: 0 };
	let sock: SocketLike | null = null;
	/**
	 * 在途的 `connectFeed()`（含它那句 `await findHost()` 的 HTTP）。
	 * 必须有这道闸：否则看门狗 / 会话事件 / 重连定时器撞在一起会各开一条 socket，
	 * 而 `sock` 只留最后一条 —— 前面那几条没人关（`close` 回调还会误杀活着的那条），
	 * 宿主那边 `feeds` 只增不减。开着是真连接泄漏，长会话必拖垮宿主。
	 */
	let feedPending: Promise<void> | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectDelayMs = 2_000;
	let thinkingTimer: ReturnType<typeof setInterval> | null = null;
	/** 本会话在宿主眼里的名字：`pi-<pid>`；多会话各自一条状态（宿主按 source 归一）。 */
	const source = `pi-${process.pid}`;

	const homeDir = (): string => petHomeDir(cfg.home);

	function setFeed(patch: Partial<FeedInfo>): void {
		feed = { ...feed, ...patch };
	}

	function stopThinking(): void {
		if (!thinkingTimer) return;
		clearInterval(thinkingTimer);
		thinkingTimer = null;
	}

	function feedReport(): string {
		const since = feed.since ? `，${Math.round((Date.now() - feed.since) / 1000)}s 前` : "";
		return `${feed.state}${feed.port ? ` :${feed.port}` : ""}${feed.lastError !== "" ? `（${feed.lastError}）` : ""} · 发 ${feed.sent} 帧${since}`;
	}

	/* ------------------------------ /feed ------------------------------ */

	function scheduleReconnect(): void {
		if (reconnectTimer) return;
		reconnectTimer = unrefTimer(
			setTimeout(() => {
				reconnectTimer = null;
				reconnectDelayMs = Math.min(reconnectDelayMs * 2, FEED_BACKOFF_MAX_MS);
				void connectFeed();
			}, reconnectDelayMs),
		);
	}

	/**
	 * 接上宿主的 `WS /feed`。**这条链路上不许 spawn**：重连只做「读 state.json + 发 HTTP」
	 * （铁律 2）。上一场就是在这里每 2s 起一批进程把机器拖死的。
	 */
	async function connectFeed(): Promise<void> {
		if (sock || feedPending) return; // 已有一条 / 正在连 —— 别再开一条（见 feedPending 那段）
		feedPending = (async () => {
			const home = homeDir();
			const host = await findHost(home);
			if (!host) {
				setFeed({ state: "closed", lastError: "没找到在跑的宿主", port: 0 });
				scheduleReconnect();
				return;
			}
			if (host.token === "") {
				// 没 token 就别去撞 401：明说，别让人以为是网络问题
				setFeed({ state: "error", lastError: "宿主没有 token（home 认错了？）", port: host.port });
				scheduleReconnect();
				return;
			}
			setFeed({ state: "connecting", port: host.port, lastError: "", since: feed.since || Date.now() });
			const url = `ws://127.0.0.1:${host.port}/feed?source=${encodeURIComponent(source)}&token=${encodeURIComponent(host.token)}`;
			let handle: SocketLike | null = null;
			handle = openSocket(url, {
				open: () => {
					reconnectDelayMs = 2_000;
					setFeed({ state: "open", lastError: "" });
				},
				close: () => {
					// 只有自己那条被关掉时才置空：过期的回调不能误杀现在这条
					if (sock === handle) sock = null;
					setFeed({ state: "closed" });
					scheduleReconnect();
				},
				error: (err) => setFeed({ state: "error", lastError: String(err?.message ?? err).slice(0, 60) }),
			});
			if (!handle) {
				setFeed({ state: "error", lastError: "这台机器上没有 WebSocket（全局 WebSocket 与 ws 依赖都没有）" });
				scheduleReconnect();
				return;
			}
			if (sock) {
				try {
					sock.close(); // 理论上进不来（进来时闸就拦住了）；真进来也不能留着泄漏
				} catch {
					/* ignore */
				}
			}
			sock = handle;
			// 握手看门狗：端口有人监听但没人应答时，状态不能永远停在 connecting
			unrefTimer(
				setTimeout(() => {
					if (feed.state === "connecting" && sock === handle) setFeed({ state: "error", lastError: "握手超时：端口有人监听但无人应答" });
				}, FEED_WATCHDOG_MS),
			);
		})();
		try {
			await feedPending;
		} finally {
			feedPending = null;
		}
	}

	function send(frame: unknown): void {
		if (!sock || feed.state !== "open") return;
		try {
			sock.send(typeof frame === "string" ? frame : JSON.stringify(frame));
			setFeed({ sent: feed.sent + 1 });
		} catch (err) {
			setFeed({ state: "error", lastError: String((err as Error).message).slice(0, 60) });
		}
	}

	/* ------------------------------ 意图（ctrl.json） ------------------------------ */

	/**
	 * 写上游的 `ctrl.json`（宿主每 2s 读一次）。**这是跨进程契约，形状别自创**：
	 * `desired`（总闸，false = 关窗退出）/ `keepAlive` / `maxPets` / `size` / `window` / `restartNonce`。
	 * `desired` 只在「本会话真的要」时写：不要的人不吭声，免得把别人正在用的宿主关掉。
	 */
	function writeCtrl(patch: Record<string, unknown>): void {
		const file = path.join(homeDir(), "ctrl.json");
		try {
			const prev = readJsonFile<Record<string, unknown>>(file) ?? {};
			mkdirSync(path.dirname(file), { recursive: true });
			const tmp = `${file}.${process.pid}.tmp`;
			writeFileSync(tmp, `${JSON.stringify({ ...prev, ...patch }, null, 2)}\n`, "utf8");
			try {
				rmSync(file, { force: true });
			} catch {
				/* Windows rename 不能覆盖 */
			}
			renameSync(tmp, file);
		} catch {
			/* 写不进意图不算错：宿主照旧跑 */
		}
	}

	function ctrlIntent(): Record<string, unknown> {
		return { keepAlive: cfg.keepAlive, maxPets: cfg.maxPets, size: cfg.size, window: cfg.window, ...(cfg.autostart ? { desired: true } : {}) };
	}

	/* ------------------------------ 拉宿主 ------------------------------ */

/**
	 * 等宿主应答，**或者**子进程已经退出（起不来就别空等满超时——那是最容易写出进程洪水的地方）。
	 * 退出信息要一起带出来：真正的死因全在子进程的话里（见 `exitAdvice`）。
	 */
	async function waitForHostOrExit(
		home: string,
		timeoutMs: number,
		exited: Promise<ExitInfo | null>,
	): Promise<{ host: HostInfo | null; exit: ExitInfo | null }> {
		const deadline = Date.now() + timeoutMs;
		let exit: ExitInfo | null | undefined;
		void exited.then((info) => {
			exit = info;
		});
		for (;;) {
			const found = await findHost(home);
			if (found) return { host: found, exit: exit ?? null };
			if (exit !== undefined) return { host: null, exit: exit ?? null };
			if (Date.now() >= deadline) return { host: null, exit: null };
			await sleep(400);
		}
	}

	/**
	 * 拉起宿主（**本文件唯一的 spawn**，铁律 2）。
	 *
	 * 动词只用上游自己的两个（`app/main.cjs` 文件头）：
	 *   `serve`  只起服务不开窗（= `start --no-window`）→ `cfg.window === false` 时用
	 *   `start`  前台宿主 + 窗                     → `cfg.window === true` 时用
	 * 若退出码是 2（旧 CLI 不认 `serve` 这个词，报「参数错」），**只回退一次** `start --no-window`；
	 * 别的失败不再换词重试——那正是把机器拖死的老毛病。
	 */
	async function startHost(ctx: Notifier, home: string, root: string, runtime: string): Promise<HostInfo | null> {
		const verbs: string[][] = cfg.window ? [["start"]] : [["serve"], ["start", "--no-window"]];
		let advice = "";
		for (let attempt = 0; attempt < verbs.length; attempt++) {
			const verb = verbs[attempt];
			const args = [path.join(root, CLI_REL), ...verb];
			if (cfg.port > 0) args.push("--port", String(cfg.port));
			startAttempts++;
			writeLocalState({ lastStartAt: Date.now() });
			writeCtrl(ctrlIntent());
			const handle = hostSpawner()({ command: runtime, args, detached: true, windowsHide: true, logFile: SPAWN_LOG_PATH });
			const { host, exit } = await waitForHostOrExit(home, cfg.startTimeoutMs, handle.exited);
			if (host) {
				writeLocalState({ failures: 0 });
				notify(
					ctx,
					`${TAG}宿主 pid ${host.pid} :${host.port}（${path.basename(runtime)} ${verb.join(" ")}）` +
						"—— 这只属于整台机器，不随本会话关闭",
				);
				return host;
			}
			advice = exitAdvice(exit, root, home, cfg.startTimeoutMs);
			// 别人已经有一只：这不是失败，是别人的宿主在起 → 等它把 /health 应答出来
			if (exit?.output && ALREADY_RUNNING.test(exit.output)) {
				const other = await waitForHost(home, cfg.startTimeoutMs);
				if (other) return other;
				notify(
					ctx,
					`${TAG}：机器上已经有一只宠物宿主（${advice}），但 ${Math.round(cfg.startTimeoutMs / 1000)}s 内 /health 没应答。` +
						`看 ${path.join(home, "log.txt")}；home/port 与 home/state.json 可能指向另一个 home`,
					"warning",
				);
				return null;
			}
			// 旧 CLI 不认 `serve`（退出码 2 = 参数错）→ 有界回退一次；其余失败不再试
			if (exit?.code === 2 && attempt === 0 && !cfg.window) {
				notify(ctx, `${TAG}：这个 pi-dsh-pet 版本不认 serve 动词，改用 start --no-window 再试一次`, "warning");
				continue;
			}
			break;
		}
		writeLocalState({ failures: (Number(readLocalState().failures) || 0) + 1 });
		notify(ctx, `${TAG}：拉起宿主失败 —— ${advice}（子进程输出全文：${SPAWN_LOG_PATH}）`, "warning");
		return null;
	}

	/**
	 * 确保整机那一个宿主在跑。三道闸按顺序过，任何一道过不去就**返回 null，不硬来**：
	 *   ① 探活（零进程）；有就直接用；
	 *   ② 整机冷却（默认 20s）+ 指数退避（连着失败越长）+ 每进程尝试上限
	 *      → 多会话 / 反复 `/reload` / 失败重试都不会变成进程洪水；
	 *   ③ mkdir 启动锁 → 只有一个会话真的 spawn，其余等它公布端口。
	 */
	async function ensureHost(ctx: Notifier, allowStart = true): Promise<HostInfo | null> {
		const home = homeDir();
		const existing = await findHost(home);
		if (existing) return existing;
		if (!allowStart) return null;

		const state = readLocalState();
		const sinceLast = Date.now() - (Number(state.lastStartAt) || 0);
		const backoff = Math.min(START_COOLDOWN_MS * 2 ** Math.max(0, (Number(state.failures) || 1) - 1), START_BACKOFF_MAX_MS);
		if (sinceLast < backoff) {
			// 冷却中：仍然等一等（别人可能正在拉），但不自己 spawn
			return waitForHost(home, Math.min(backoff - sinceLast, cfg.startTimeoutMs));
		}
		if (startAttempts >= cfg.maxStartAttempts) {
			setFeed({ state: "error", lastError: `本进程已尝试 ${startAttempts} 次拉宿主，放弃（/pet-status 看原因）` });
			return null;
		}

		if (!acquireLockAt(BOOT_LOCK_PATH)) {
			// 别的会话正在拉：等它把端口公布出来（输家不重复 spawn）
			return waitForHost(home, cfg.startTimeoutMs);
		}
		try {
			// 拿到锁再探一次：等锁期间可能刚好有人起来了
			const recheck = await findHost(home);
			if (recheck) return recheck;

			const root = petPackageRoot();
			if (!root) {
				notify(ctx, `${TAG}：找不到 pi-dsh-pet 的安装目录（有 ${CLI_REL} 才算），本会话不自动拉宿主`, "warning");
				startAttempts = cfg.maxStartAttempts; // 找不到包就别反复试了
				return null;
			}
			const runtime = resolveRuntime(cfg.node);
			if (!runtime) {
				notify(
					ctx,
					`${TAG}：找不到能跑宿主的 node/bun（PATH 上没有，配置的 node=${cfg.node || "(空)"} 也不存在）。` +
						"注意不能用 pi 自己——pi.exe 是 Bun 打包的 pi，拿它跑宿主会开出会话卡死",
					"warning",
				);
				startAttempts = cfg.maxStartAttempts;
				return null;
			}
// 上游自己的单例锁还被人占着（有人正在起 / 起不来在收尾）→ 只等，不叠第二个宿主
			const upstreamLock = path.join(home, "host.lock");
			if (acquireLockAt(upstreamLock)) releaseLockAt(upstreamLock); // 借一下判断：抢得到说明没人占
			else return waitForHost(home, cfg.startTimeoutMs);

			return await startHost(ctx, home, root, runtime);
		} finally {
			releaseLockAt(BOOT_LOCK_PATH);
		}
	}

	/**
	 * REST 调宿主控制面（带 token）。
	 *
	 * **先打再探，不预判**：`GET /control` 只能回答「这个端点在不在」，回答不了「我这个动作
	 * 行不行」，所以热路径上只有一次 POST；失败才多两个只读 GET 去探能力。**外来/旧版
	 * 宿主没有控制面**，那时
	 *   - `say` 退到事件面 `POST /event {type:"say"}`（那个帧旧宿主也认）；
	 *   - 其余动作（开/收窗、换窗、set-ctrl）直接说「它只支持什么、怎么换成新宿主」，
	 *     而不是丢一个裸 404 给用户。
	 */
	async function control(action: string, extra: Record<string, unknown> = {}): Promise<ControlResult> {
		const host = await findHost(homeDir());
		if (!host) return { ok: false, error: "宠物宿主没在跑（/pet-auto on 打开，或手动 pi-pet start）" };
		const result = await postJson(host.port, "/control", { action, ...extra }, host.token);
		if (result.ok) return result;
		const caps = await probeCaps(host.port, host.token);
		if (caps && !caps.control) {
			if (action === "say" && caps.event) return postEvent(host.port, { type: "say", text: String(extra.text ?? "") }, host.token);
			return {
				ok: false,
				error:
					`这个宿主没有控制面（端口来源 ${host.stateSource}${caps.actions ? `，它只支持：${caps.actions}` : ""}）。` +
					"换成本仓库的宿主：pi-pet stop → pi-pet start",
			};
		}
		if (caps && !caps.auth) return { ok: false, error: `宿主不认本机的 token（home 认错了？token 在 ${path.join(homeDir(), "token")}）` };
		return result;
	}

	/* ------------------------------ 野进程清理 ------------------------------ */

	/**
	 * 清掉上一场 bug 的尸体：`pi.exe …bin/pi-pet.cjs …`（每个都是一个卡住的完整 pi 会话）。
	 * 整机 10 分钟最多跑一次（扫全机要起 PowerShell），所以必须记账节流。
	 */
	async function reapStraysOnce(ctx: Notifier): Promise<void> {
		if (!cfg.reapStrays) return;
		const state = readLocalState();
		if (Date.now() - (Number(state.lastReapAt) || 0) < REAP_INTERVAL_MS) return;
		writeLocalState({ lastReapAt: Date.now() });
		const killed = await reapStrayCliProcesses();
		if (killed > 0) notify(ctx, `${TAG}：清掉 ${killed} 个野进程（pi.exe 把 pi-pet CLI 当 node 跑留下的空会话，各占几十 MB）`, "warning");
	}

	/* ------------------------------ session_start ------------------------------ */

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return; // print / json / rpc（bench 沙箱）不弹桌面窗
		if (!petPackageRoot()) return; // 没装宠物包的人不该被提醒，也不该被拉起宿主
		if (broken) notify(ctx, `${TAG}配置读坏，按默认启用处理：${CONFIG_PATH}`, "warning");

		void (async () => {
			// 一次性迁移：旧版写的「外来状态文件」会让上游的宿主永远起不来（见文件头第 1 条）
			try {
				rmSync(LEGACY_GLOBAL_PATH, { force: true });
			} catch {
				/* 删不掉就靠上游心跳过期 */
			}
			await reapStraysOnce(ctx);
			const host = await ensureHost(ctx, cfg.autostart);
			if (cfg.feed) {
				if (host) await connectFeed();
				else scheduleReconnect(); // 宿主起来之后自己接上（退避重连，零进程）
			}
		})().catch((err) => {
			// session_start 里抛出去会让整个钩子报错（pi 会弹扩展错误），这里兜住
			notify(ctx, `${TAG}启动出错（已忽略）：${String((err as Error)?.message ?? err).slice(0, 80)}`, "warning");
		});

		// 事件 → 帧。宿主那边是状态机：自己去重、自己挑「最近活跃的会话」，
		// 所以这里只管把话说清楚，不需要（也不该）自己做多会话仲裁。
		pi.on("agent_start", () => {
			stopThinking();
			send({ type: "thinking" });
		});
		pi.on("turn_start", () => {
			if (thinkingTimer) return;
			send({ type: "thinking" });
			// 长思考时每 2s 续一帧：宿主会去重，窗里靠它续期气泡
			thinkingTimer = unrefTimer(setInterval(() => send({ type: "thinking" }), THINKING_TICK_MS));
		});
		pi.on("tool_call", (event) => {
			const tool = String(event.toolName ?? "other");
			const input = event.input as Record<string, unknown> | undefined;
			// 只挑一个「人类看得懂」的细节字段，别把整个 input（含大段正文）塞进气泡
			const detail =
				typeof input?.command === "string"
					? input.command
					: typeof input?.filePath === "string"
						? input.filePath
						: typeof input?.path === "string"
							? input.path
							: typeof input?.pattern === "string"
								? input.pattern
								: typeof input?.file === "string"
									? input.file
									: undefined;
			send({ type: "tool_call", tool, ...(detail !== undefined ? { detail: String(detail).slice(0, 200) } : {}) });
		});
		pi.on("agent_settled", () => {
			stopThinking();
			// done = 回到空闲 + 冒一个「完成」气泡（与 v1 的 agent_idle 等价，见 app/bus.cjs）
			send({ type: "done" });
		});
		pi.on("session_shutdown", () => {
			// 只断自己的 socket，**绝不**去关宿主/窗：桌宠要活得比 pi 会话长。
			// 也不发 done：宿主那边整条 ws:<source> 断了，自己会重算状态
			if (reconnectTimer) clearTimeout(reconnectTimer);
			reconnectTimer = null;
			stopThinking();
			try {
				sock?.close();
			} catch {
				/* 已经关了 */
			}
			sock = null;
		});
	});

	/* ------------------------------ 命令 ------------------------------ */

	pi.registerCommand("pet", {
		description: "打开宠物窗口（可跟大小：/pet small）",
		handler: async (args: string, ctx) => {
			if (ctx.mode !== "tui") return;
			const wanted = args.trim().split(/\s+/)[0] ?? "";
			if (SIZES.includes(wanted as PetSize)) {
				cfg.size = wanted as PetSize;
				writeCtrl({ size: cfg.size });
			}
			// 手动开窗 = 用户明确要 → 本次允许拉宿主，不受 autostart 限制
			startAttempts = 0;
			writeLocalState({ failures: 0 });
			const host = await ensureHost(ctx, true);
			if (!host) {
				notify(ctx, `${TAG}：没能拉起宿主。/pet-status 看本扩展看到的状态，${homeDir()}/log.txt 看宿主自己的`, "warning");
				return;
			}
			const result = await control("show-window");
			notify(ctx, result.ok ? `${TAG}已叫出窗口（${host.pid} :${host.port}）` : `${TAG}叫窗口失败：${result.error ?? "未知"}`, result.ok ? "info" : "warning");
		},
		getArgumentCompletions: () => SIZES.map((size) => ({ value: size, label: size, description: `把宠物调成 ${size}` })),
	});

	pi.registerCommand("pet-stop", {
		description: "收起宠物窗口（宿主留着，下次 /pet 秒开）",
		handler: async (_args, ctx) => {
			const result = await control("hide-window");
			notify(ctx, result.ok ? `${TAG}窗口已收起` : `${TAG}收窗口失败：${result.error ?? "未知"}`, result.ok ? "info" : "warning");
		},
	});

	pi.registerCommand("pet-say", {
		description: "让宠物说一句话：/pet-say 干得漂亮",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (text === "") {
				notify(ctx, `${TAG}用法：/pet-say <想说的话>`, "warning");
				return;
			}
			// 走控制面（会记进宿主 log）；`say` 是 v0.0.2 的正式动作，比 POST /event 更清楚
			const result = await control("say", { text });
			notify(ctx, result.ok ? `${TAG}说：${text}` : `${TAG}说失败：${result.error ?? "未知"}`, result.ok ? "info" : "warning");
		},
	});

pi.registerCommand("pet-status", {
		description: "宠物现状：/pet-status（或 /pet-status doctor 跑上游自检）",
		getArgumentCompletions: () => [{ value: "doctor", label: "doctor", description: "跑 pi-pet doctor（素材/依赖/端口/窗）" }],
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			const home = homeDir();
			const root = petPackageRoot();
			const runtime = resolveRuntime(cfg.node);
			// `/pet-status doctor`：转发上游自检。这是**用户主动触发**的一次进程，不在探活
			// 链路上（铁律 2 允许：它是给人看的一次性输出，不是每秒重试的探针）。
			if ((args.trim().split(/\s+/)[0] ?? "").toLowerCase() === "doctor") {
				if (!root || !runtime) {
					notify(ctx, `${TAG}：doctor 跑不了（包 ${root ?? "没找到"} / 运行时 ${runtime ?? "没找到"}）`, "warning");
					return;
				}
				const text = await capture(runtime, [path.join(root, CLI_REL), "doctor"], 30_000);
				notify(ctx, `${TAG} pi-pet doctor\n${(text ?? "（没输出：doctor 退出了）").trim().slice(0, 1_400)}`);
				return;
			}
			const host = await findHost(home);
			const caps = host ? await probeCaps(host.port, host.token) : null;
			const pkg = readJsonFile<{ version?: string }>(path.join(root ?? "", "package.json"));
			const portFile = readPortFile(home);
			const lines = host
				? [
						`宿主：pid ${host.pid} :${host.port}（端口来源 ${host.stateSource}，${home}/port 写的是 ${portFile || "（没写）"}）`,
						`窗：${String(host.windowState ?? "?")}${host.windowPid ? ` pid ${host.windowPid}` : ""} · 窗客户端 ${host.clients ?? 0} · 换窗 ${host.restarts ?? 0} 次`,
						`生产者：feeds ${host.feeds ?? 0}${host.feedsBySource ? ` · ${JSON.stringify(host.feedsBySource)}` : ""}`,
						`能力：控制面 ${caps?.control ? "有" : caps ? "没有" : "?"} · 事件面 ${caps?.event ? "有" : caps ? "没有" : "?"} · 鉴权 ${caps?.auth ? "通过" : caps ? "被拒" : "?"}` +
							`${caps?.actions ? `\n  它支持的动作：${caps.actions}` : ""}`,
						`活：${Math.max(0, Math.round(((Number(host.heartbeatAt) || Date.now()) - (Number(host.startedAt) || Date.now())) / 1000))}s · 状态 ${String(host.state ?? "?")}`,
					]
				: [
						`宿主：没在跑（home ${home} · port 文件 ${portFile || "（没写）"} · state.json ${existsSync(path.join(home, "state.json")) ? "在" : "没有"}）`,
						"      → /pet 手动拉；或 /pet-status doctor 看上游自检",
					];
			lines.push(
				`包：${root ?? "(没找到 bin/pi-pet.cjs)"} ${pkg?.version ? `v${pkg.version}` : ""}`,
				`运行时：${runtime ?? "(PATH 上没有 node/bun —— 注意不能用 pi 自己)"}`,
				`本会话 feed：${feedReport()}（source ${source}）`,
				`意图 ctrl：${JSON.stringify(readJsonFile(path.join(home, "ctrl.json")) ?? {})}`,
				`拉宿主：本进程试过 ${startAttempts}/${cfg.maxStartAttempts} 次（动词 ${cfg.window ? "start" : "serve"}）· 整机冷却 ${Math.round(START_COOLDOWN_MS / 1000)}s · autostart=${cfg.autostart} feed=${cfg.feed} window=${cfg.window}` +
					`${cfg.port > 0 ? ` · --port ${cfg.port}` : ""}`,
			);
			notify(ctx, `${TAG}\n${lines.join("\n")}`);
		},
	});

	pi.registerCommand("pet-auto", {
		description: "自启动/意图开关：/pet-auto [on|off|status|size <s>|max <n>|window on|off|restart]",
		handler: async (args, ctx) => {
			const [sub, value] = args.trim().split(/\s+/, 2);
			switch ((sub || "status").toLowerCase()) {
				case "on":
					cfg.autostart = true;
					writeCtrl(ctrlIntent());
					// 用户刚打开开关 → 立刻兑现；冷却/锁/上限都还在，不会变洪水
					const host = await ensureHost(ctx, true);
					if (!host) notify(ctx, `${TAG}已打开自启动，但这次没拉起宿主（/pet-status 看原因；冷却期内会等下一轮）`, "warning");
					break;
				case "off":
					cfg.autostart = false;
					writeCtrl({ desired: false }); // 上游读到 desired:false 就关窗退出
					notify(ctx, `${TAG}已关自启动（宿主会自己退出；本会话还会喂事件直到宿主没了）`);
					break;
				case "size": {
					const size = SIZES.includes(value as PetSize) ? (value as PetSize) : null;
					if (!size) {
						notify(ctx, `${TAG}大小只能是 ${SIZES.join(" / ")}`, "warning");
						break;
					}
					cfg.size = size;
					writeCtrl({ size });
					const result = await control("set-ctrl", { size });
					notify(ctx, result.ok === false ? `${TAG}宿主没应答（${result.error}）` : `${TAG}大小 → ${size}`);
					break;
				}
				case "max": {
					const n = Number(value);
					if (!Number.isInteger(n) || n < 1 || n > MAX_PETS_CEILING) {
						notify(ctx, `${TAG}只支持 1–${MAX_PETS_CEILING} 只`, "warning");
						break;
					}
					cfg.maxPets = n;
					writeCtrl({ maxPets: n });
					const result = await control("set-ctrl", { maxPets: n });
					notify(ctx, result.ok === false ? `${TAG}宿主没应答（${result.error}）` : `${TAG}最多 ${n} 只`);
					break;
				}
case "window":
					cfg.window = (value ?? "on").toLowerCase() !== "off";
					writeCtrl({ window: cfg.window });
					await control(cfg.window ? "show-window" : "hide-window");
					notify(ctx, `${TAG}窗 ${cfg.window ? "开" : "关"}（只影响下次拉起宿主：${cfg.window ? "start（带窗）" : "serve（只起服务）"}）`);
					break;
case "restart": {
					// 上游的 `restart` = 「换一扇新窗」（由宿主自己关旧窗再拉，客户端不该 taskkill）。
					// 动作名用 `restart-window`（v0.0.2 的正式名字，`restart` 只是别名）。
					const result = await control("restart-window");
					notify(ctx, result.ok ? `${TAG}换了一扇新窗（1.5s 后）` : `${TAG}换窗失败：${result.error ?? "未知"}`, result.ok ? "info" : "warning");
					break;
				}
				default:
					notify(
						ctx,
						`${TAG}自启动 ${cfg.autostart ? "开" : "关"} · feed ${cfg.feed ? "开" : "关"} · 大小 ${cfg.size} · 最多 ${cfg.maxPets} 只 · 拉起宿主时开窗 ${cfg.window ? "是" : "否"}\n` +
							"改：/pet-auto on|off | /pet-auto size small|normal|large | /pet-auto max 3 | /pet-auto window off | /pet-auto restart",
					);
			}
			saveConfig(cfg);
		},
		getArgumentCompletions: (arg) =>
			arg.trim() === ""
				? [
						{ value: "status", label: "status", description: "看当前意图" },
						{ value: "on", label: "on", description: "开自启动并立刻兑现" },
						{ value: "off", label: "off", description: "关自启动（宿主自行退出）" },
						{ value: "size", label: "size small|normal|large", description: "改体型" },
						{ value: "max", label: "max 1–8", description: "改同时几只" },
						{ value: "window", label: "window on|off", description: "改拉起宿主时要不要开窗" },
						{ value: "restart", label: "restart", description: "换一扇新窗" },
					]
				: [],
	});
}