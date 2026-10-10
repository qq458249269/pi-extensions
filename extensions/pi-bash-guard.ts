/**
 * pi-bash-guard — readme §5「铁律二：所有命令都带超时」的执行层
 *
 * 为什么光靠 prompt 不够：pi 内建 `bash` 工具的 `timeout` 参数是**可选且无默认值**
 * （dist/core/tools/bash.js：`Type.Optional(... "optional, no default timeout")`），
 * 模型忘了传 = 命令永远跑着。历史症状是 `find`/`grep -r` 把会话卡几分钟；
 * 同理还有 `npm install`、`python 脚本`、`git clone` 这类慢命令——所以本扩展不只管搜索。
 *
 * 为什么超时后不用自己 kill：pi 在超时/abort 时调 `killProcessTree(pid)`——
 * Windows 走 `System32\taskkill.exe /F /T /PID`，POSIX 走 `kill(-pid, SIGKILL)`（进程组）。
 * 只要命令是**前台**跑的，超时那一刻整棵树（含子进程、管道另一端）都会被强杀。
 * 唯一逃得掉的是 `cmd &` / `nohup` / `setsid`：shell 立刻返回 → pi 清掉 timeout 计时器、
 *   注销 pid 追踪 → 命令在工具返回后继续跑，没人再管它。这类写法（搜索类）直接 block。
 *
 * 注入的是**上限**不是等待时间，给大一点也不亏——按「流水线生产者」分档：
 *   搜索类（find/grep/rg/fd…）   默认 30s，上限 120s   ← 与 pi-fd / pi-find 的 30s 对齐
 *   构建类（npm/pnpm/cargo/make…） 默认 1800s，上限 3600s ← 装依赖、编译、跑测试不会被腰斩
 *   其余一切                     默认 300s，上限 3600s
 * 分档看的是每条流水线（`a | b | c`）的**第一个**命令，也就是真正干活的那个：
 *   `find . | head`      → 30s（head 只是消费者）
 *   `python t.py | grep` → 300s（干活的是 python）
 *   `npm run build && find dist -type f` → 1800s（有构建段就按构建算）
 * 模型自己显式传的 timeout 会被尊重，只夹到该档上限；`timeout` 的单位是**秒**。
 *
 * 另一类不是「太久」而是「永远不返回」：编辑器、分页器、监视器、前台 dev server、
 * 前台常驻容器。它们会烧掉整个上限才被杀掉，期间一个字符也回不来 → 直接 block 并给替代写法。
 *
 * 第三类（2026-10-10 加）：**搜索根选错**——比「命令慢」更隐蔽，因为它不报错、不超时，
 * 就是安静地返回一堆无关结果（或什么都不返回）。实测本机量级：
 *   AppData/Local   194,968 个文件      C:\Windows      345,409 个文件
 *   AppData/Roaming 137,869 个文件      find ~ -maxdepth 6 封顶 60s 跑不完
 * 关键：**fd 的 ignore 规则在这些目录里同样不生效**——.gitignore 只在 git 仓库内认，
 * 用户目录 / 系统盘根本不是仓库，于是「换 fd 就快」这个前提不成立。
 *   C:\Windows 16.2s / AppData\Roaming 2.6s（fd 实测）→ 能跑完，但结果全是噪声。
 * 所以这里拦的是**搜索根**，不是命令名：禁 find 换不来速度，换 fd 也一样。
 *
 * 零 wire 成本：**不注册任何工具、不动 active 集**，只挂一个 `tool_call` 事件（§5 铁律允许的形态）。
 * 判定只做字符串扫描，没有 spawn、没有 I/O；非 bash 工具与非目标命令在第一层就 return。
 *
 * 已知边界（故意不做）：
 *   - `powershell` 工具**没有** timeout 参数，PowerShell 里无法注入（`find` 陷阱只能靠文字纪律，§4.2/§5）。
 *   - 只看每段首词，`xargs node script.js` 这种把慢命令藏在 xargs 里的写法不拆第二层；
 *     它仍会被「其余一切」那档 300s 默认值兜住。
 *   - 需要跑超过 1 小时的命令（长时间训练、CI 镜像）：拆段、后台化（`&`）或让用户自己跑。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 搜索类命令 basename 集合：命中就用最短的那档。 */
const SEARCH_BINARIES = new Set(["find", "grep", "egrep", "fgrep", "rg", "ag", "ack", "fd", "fdfind"]);
/** 包在命令外面的 wrapper：每条流水线都由它包住时视为「作者自己管了超时」，不再注入。 */
const TIMEOUT_WRAPPERS = new Set(["timeout", "gtimeout"]);
/** 首词之前允许出现的修饰词（sudo/env/time/xargs…），与 §4.2 判定规则同思路。 */
const LEADING_NOISE = new Set([
	"sudo",
	"doas",
	"time",
	"nice",
	"ionice",
	"nohup",
	"setsid",
	"stdbuf",
	"command",
	"exec",
	"xargs",
]);

/** 三档预算，单位秒。 */
const SEARCH_DEFAULT_S = 30;
const SEARCH_MAX_S = 120;
const BUILD_DEFAULT_S = 1800;
const OTHER_DEFAULT_S = 300;
/** 任何命令的硬上限（1 小时）；模型给了更大的压下来。 */
const HARD_MAX_S = 3600;

/** 构建/装依赖/跑测试类：首词命中即走长档。 */
const BUILD_HEADS = new Set([
	"npm",
	"npx",
	"pnpm",
	"yarn",
	"bun",
	"bunx",
	"pip",
	"pip3",
	"pipx",
	"poetry",
	"uv",
	"cargo",
	"go",
	"dotnet",
	"mvn",
	"gradle",
	"gradlew",
	"make",
	"gmake",
	"cmake",
	"ninja",
	"meson",
	"docker",
	"podman",
	"terraform",
	"composer",
	"bundle",
	"gem",
	"apt",
	"apt-get",
	"winget",
	"scoop",
	"choco",
	"tsc",
	"webpack",
	"rollup",
	"esbuild",
	"vite",
	"next",
	"nuxt",
	"nest",
	"tsup",
	"pytest",
	"tox",
	"nox",
	"jest",
	"vitest",
	"mocha",
	"playwright",
	"cypress",
	"nx",
	"lerna",
	"prettier",
	"biome",
	"eslint",
	"clang",
	"gcc",
	"g++",
	"rustc",
	"javac",
	"msbuild",
]);

/** 永远不会自己返回的命令（编辑器/分页器/监视器/交互式客户端）：给 timeout 也只是白等。 */
const NEVER_RETURN_HEADS = new Set([
	"vim",
	"vi",
	"nvim",
	"nano",
	"emacs",
	"kak",
	"hx",
	"helix",
	"micro",
	"less",
	"more",
	"man",
	"top",
	"htop",
	"btop",
	"atop",
	"glances",
	"nvtop",
	"watch",
	"tailf",
	"ssh",
	"telnet",
	"ftp",
	"sftp",
	"mysql",
	"psql",
	"mongo",
	"redis-cli",
	"sqlite3",
	"irb",
	"gdb",
	"lldb",
	"fzf",
	"lazygit",
	"ranger",
	"mc",
	"screen",
	"tmux",
	"su",
]);

/** REPL：光秃秃一个解释器名（`python build.py`、`python3 -V` 都放行）。 */
const REPL_HEADS = new Set(["node", "python", "python3", "py", "bun", "deno", "irb"]);
/** 前台 dev server：包管理器 + 服务类脚本（`npm run dev` / `yarn start`…）。 */
const SERVER_SCRIPTS = new Set(["dev", "start", "serve", "preview", "watch"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "npx", "bunx"]);

/** 剥掉环境赋值与重定向后的 token 列表。 */
function tokens(segment: string): string[] {
	return segment
		.replace(/^`+|`+$/g, "")
		.split(/\s+/)
		.map((t) => t.replace(/^[("']+|[)"']+$/g, "").replace(/^["']|["']$/g, ""))
		.filter((t) => t && !/^(?:\d*|>|<|&)>/.test(t) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
}

/** 首词（跳过修饰词及其参数），去掉路径与 `.exe`。 */
function firstWord(segment: string): string | undefined {
	for (const token of tokens(segment)) {
		const bare = token.replace(/\.exe$/i, "").toLowerCase();
		// 修饰词本身带参数（-u user / -o0 / -n 5），只跳这个词，下一轮继续看它的参数
		if (LEADING_NOISE.has(bare)) continue;
		if (token.startsWith("-")) continue;
		return (token.split(/[/\\]/).pop() ?? token).replace(/\.exe$/i, "").toLowerCase();
	}
	return undefined;
}

/** 段里除了首词还有没有实参（区分 `python` REPL 与 `python x.py`）。 */
function hasArgs(segment: string): boolean {
	for (const token of tokens(segment)) {
		const bare = token.replace(/\.exe$/i, "").toLowerCase();
		if (LEADING_NOISE.has(bare) || token.startsWith("-")) continue;
		return true;
	}
	return false;
}

/** `python` / `node` 光杆一个词 = REPL。 */
function isBareRepl(segment: string): boolean {
	const list = tokens(segment);
	const head = (list[0] ?? "").split(/[/\\]/).pop()?.replace(/\.exe$/i, "").toLowerCase();
	return list.length === 1 && head !== undefined && REPL_HEADS.has(head);
}

/** `npm run dev` / `yarn start` 这类前台服务。 */
function isServerRunner(segment: string): boolean {
	const head = firstWord(segment);
	if (head === undefined || !PACKAGE_MANAGERS.has(head)) return false;
	return tokens(segment)
		.slice(1)
		.map((t) => t.toLowerCase())
		.some((t) => SERVER_SCRIPTS.has(t));
}

/** `docker run` 不带 `-d` 也不带 `--rm` = 常驻容器，会一直占着；一次性容器放行。 */
function isLongLivedContainer(segment: string): boolean {
	const head = firstWord(segment);
	if (head !== "docker" && head !== "podman" && head !== "docker-compose") return false;
	if (!/\b(?:run|compose\s+up|up)\b/.test(segment)) return false;
	const list = tokens(segment);
	return !list.some((t) => t === "-d" || t === "--detach" || t === "--rm");
}

export type CommandClass = "search" | "build" | "other";
/** 一段命令 + 它的首词（判定时反复要用，预先算好免得索引错位）。 */
interface Stage {
	segment: string;
	head: string | undefined;
}

/**
 * 切成命令组（`;` `&&` `||` 换行），组内再按 `|` 切成流水线各段。
 * 注意 `||` 必须排在 `|` 前面匹配，正则的交替是按顺序试的。
 */
function pipelineGroups(command: string): Stage[][] {
	return command
		.split(/\r?\n|;|\|\||&&/)
		.map((group) => group.trim())
		.filter(Boolean)
		.map((group) =>
			group
				.split("|")
				.map((segment) => segment.trim())
				.filter(Boolean)
				.map((segment) => ({ segment, head: firstWord(segment) })),
		)
		.filter((group) => group.length > 0);
}

/** 单段归类。 */
function classifyStage(stage: Stage): CommandClass {
	const head = stage.head;
	if (head === undefined) return "other";
	if (SEARCH_BINARIES.has(head)) return "search";
	if (BUILD_HEADS.has(head)) return "build";
	// `python -m build`、`npx tsc` 之类：首词是解释器时看后续 token
	if (REPL_HEADS.has(head) && /^\S+\s+(-m|-c)\s+\S+/.test(stage.segment)) return "build";
	return "other";
}

/** 该命令该用哪一档：返回 [默认秒, 上限秒]。流水线看生产者（第一个 stage）。 */
export function budgetFor(command: string): { fallback: number; max: number } {
	const classes = pipelineGroups(command).map((group) => classifyStage(group[0]));
	if (classes.includes("build")) return { fallback: BUILD_DEFAULT_S, max: HARD_MAX_S };
	if (classes.includes("search")) return { fallback: SEARCH_DEFAULT_S, max: SEARCH_MAX_S };
	return { fallback: OTHER_DEFAULT_S, max: HARD_MAX_S };
}

export interface GuardVerdict {
	/** 缺失时该注入的 bash `timeout`（秒）。 */
	timeoutSeconds?: number;
	/** 非空 = 拦下并给模型的解释。 */
	block?: string;
}

/**
 * 「不该作为搜索根」的目录名——海量、非仓库、且不可能是要找的代码。
 * 命中就拦，改成让模型先缩到项目目录。
 *
 * 形如 `~/AppData`、`C:\Windows`、`~`（家目录本身）都在此列。
 * 刻意**不拦** `.git` / `node_modules` 这类：它们只是编译/元数据目录，
 * 模型有时确实要往里钻（查依赖版本号、看 object 存的blob），拦了就是误伤。
 */
const OVERSIZED_ROOTS: { pattern: RegExp; label: string; why: string }[] = [
	{ pattern: /^~$|^~[\\/]$/, label: "the user home (tilde)", why: "the home tree is not a git repository, so fd's .gitignore rules do not apply there (measured: AppData alone holds >330k files)." },
	// 同一目录的两种写法都要认：Windows `C:\Users\me` / MSYS `/c/Users/me` / POSIX `/home/me`
	{ pattern: /^(?:[A-Za-z]:[\\/]|[\\/][A-Za-z][\\/])?(?:Users)[\\/][^\\/]+(?:[\\/]AppData)?[\\/]?$|^~[\\/]AppData[\\/]?$|^[\\/]home[\\/][^\\/]+[\\/]?$/i,
	  label: "the user home / AppData", why: "~ and AppData are not git repos, so fd's .gitignore rules do not apply there either (measured: AppData alone holds >330k files)." },
	// 同理：`C:\Windows` / `/c/Windows` / `/c/Program Files`
	{ pattern: /^(?:[A-Za-z]:[\\/]|[\\/][A-Za-z][\\/])?(?:Windows|System Volume Information|Recovery)[\\/]?$|^(?:[A-Za-z]:[\\/]|[\\/][A-Za-z][\\/])?Program Files(?: \(x86\))?[\\/]?$/i,
	  label: "a Windows system directory", why: "C:\\Windows alone holds >345k files (measured: 16.2s for a single fd scan)." },
	// 盘根：`C:\` / `/c/` / `/` / `C:`
	{ pattern: /^(?:[A-Za-z]:[\\/]|[\\/][A-Za-z][\\/]|[\\/])$/, label: "a drive/ filesystem root", why: "a bare root scans every file on the volume." },
];

/**
 * 从一段命令里找“可能作为搜索根的路径实参”。
 *
 * 只取**首个非 flag 实参**（find/rg 的惯例就是 `find <path> …`），
 * 避免把 `-name '*.ts'` 里的pattern 或后缀参数误当成搜索根。
 * 多个搜索根时取最差的一个——任一个超限就足以拖垮整条命令。
 */
function candidateSearchRoots(segment: string, skip = 1): string[] {
	const roots: string[] = [];
	const list = tokens(segment);
	for (let i = list[0] !== undefined && !list[0].startsWith("-") ? skip : 0; i < list.length; i++) {
		const token = list[i];
		if (token.startsWith("-")) {
			continue;
		}
		roots.push(token);
		if (roots.length >= 2) break;
	}
	return roots;
}

/** 命中任意一条超限搜索根则返回原因，否则 null。 */
function oversizedRootReason(segment: string): string | null {
	const head = firstWord(segment);
	// rg/ag/ack 的第一个位置参数是**正则**不是路径，真正作为搜索根的是第二个
	// （`rg foo .` vs `rg foo /c/Windows`）；find/fd 则从第一个实参开始。
	const skipFirst = head === "rg" || head === "ag" || head === "ack" ? 2 : 1;
	const roots = candidateSearchRoots(segment, skipFirst);
	for (const root of roots) {
		// 相对路径 / `.` 不可能是超限根
		if (root === "." || root === ".." || root === "./") continue;
		for (const rule of OVERSIZED_ROOTS) {
			if (rule.pattern.test(root)) return `${root} → ${rule.label}`;
		}
	}
	return null;
}

/** 纯函数，便于 .sc-test 单测（不挂 pi 也能跑）。 */
export function judgeBashCommand(command: string): GuardVerdict {
	const groups = pipelineGroups(command);
	const stages = groups.flat();
	if (stages.length === 0) return {};

	// 规则 A：永远不会返回的命令 → 给 timeout 也只是白等一个上限，直接 block。
	const stuck = stages.find(
		(stage) =>
			(stage.head !== undefined && NEVER_RETURN_HEADS.has(stage.head)) ||
			isBareRepl(stage.segment) ||
			isServerRunner(stage.segment) ||
			isLongLivedContainer(stage.segment) ||
			/\btail\s+(?:-[a-zA-Z]*f\b|--follow\b)/.test(stage.segment) ||
			/\bjournalctl\b[^\n]*\s-f\b/.test(stage.segment) ||
			/\bpython[0-9.]*\s+-m\s+http\.server\b/.test(stage.segment) ||
			/\bhttp-server\b/.test(stage.segment),
	);
	if (stuck) {
		return {
			block:
				`Blocked: \`${stuck.head ?? stuck.segment}\` runs in the foreground and never returns on its own — a timeout would ` +
				`only cap how long this call hangs with zero output. Do the productive part in the foreground (build/test first, ` +
				`then query the result), or start a genuinely long-lived process explicitly in the background (\`… &\`) and poll ` +
				`it later with a separate command.`,
		};
	}

	// 规则 B：搜索类被后台化 → 它本该秒回，却能活过超时与 killProcessTree，纯粹是漏网。
	const withoutRedirects = command.replace(/\d?>&\d?/g, " ");
	const backgrounded =
		/(?:^|[\s;|])&(?:[\s;|]|$)/.test(withoutRedirects) ||
		/\b(?:nohup|setsid|start-process|start\s+\/b)\b/i.test(command);
	if (backgrounded && classes(groups).includes("search")) {
		const searchHeads = stages.map((s) => s.head).filter((h): h is string => h !== undefined && SEARCH_BINARIES.has(h));
		return {
			block:
				`Blocked: the search command (${searchHeads.join(", ")}) is backgrounded (\`&\` / nohup / setsid), so it outlives ` +
				`the call — the shell returns immediately, pi drops its timeout timer and pid tracking, and nothing kills the search ` +
				`afterwards. Run it in the foreground and let pi's \`timeout\` kill the whole process tree (taskkill /F /T on Windows, ` +
				`kill(-pid) elsewhere). If you really need it in the background, wrap it yourself: \`timeout -k 2s 120s <cmd> &\``,
		};
	}

// 规则 E：搜索根选到海量非仓库目录（~ / AppData / 系统盘）→ 换命令名也没用，拦。
	if (classes(groups).includes("search")) {
		for (const stage of stages) {
			const reason = oversizedRootReason(stage.segment);
			if (reason) {
				const searchHeads = stages.map((s) => s.head).filter((h): h is string => h !== undefined && SEARCH_BINARIES.has(h));
				return {
					block:
						`Blocked: the search command (${searchHeads.join(", ")}) targets ${reason}. ` +
						`That tree holds hundreds of thousands of files and is not a git repository, so fd's .gitignore rules ` +
						`don't apply either — switching to fd would not help. Anchor the search at the project directory ` +
						`(e.g. \`fd -t f -e ts <pattern> .\` from the repo root, or pass a subdir) and scope it; ` +
						`only search these trees deliberately with a narrow path/glob and an explicit timeout.`,
				};
			}
		}
	}

	// 规则 C：每条流水线都被 coreutils timeout 包住 → 作者自己管了，不插手。
	if (groups.every((group) => group.length === 1 && group[0].head !== undefined && TIMEOUT_WRAPPERS.has(group[0].head))) {
		return {};
	}

	// 规则 D：按档注入上限。
	return { timeoutSeconds: budgetFor(command).fallback };
}

/** 流水线生产者的归类序列（判定与预算共用，避免两处逻辑漂移）。 */
function classes(groups: Stage[][]): CommandClass[] {
	return groups.map((group) => classifyStage(group[0]));
}

/** 模型已给的 timeout（秒）：夹到该档上限；缺失/非法 → 回落该档默认。 */
export function resolveBashTimeout(given: unknown, max: number, fallback: number): number {
	const base = typeof given === "number" && Number.isFinite(given) && given > 0 ? given : fallback;
	return Math.min(max, Math.max(1, Math.trunc(base)));
}

/** fd 工具漏传 timeoutMs 时补的默认值（与 pi-fd 的 DEFAULT_TIMEOUT_MS 一致）。 */
export const DEFAULT_FD_TIMEOUT_MS = 30_000;

export default function piBashGuard(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event) => {
		if (event.toolName === "bash") {
			const input = event.input as { command?: string; timeout?: number };
			if (typeof input.command !== "string" || input.command.trim().length === 0) return;
			const verdict = judgeBashCommand(input.command);
			if (verdict.block) return { block: true, reason: verdict.block };
			if (verdict.timeoutSeconds !== undefined) {
				const { fallback, max } = budgetFor(input.command);
				input.timeout = resolveBashTimeout(input.timeout, max, fallback);
			}
			return;
		}
		if (event.toolName === "fd") {
			const input = event.input as { timeoutMs?: number };
			if (typeof input.timeoutMs !== "number" || !Number.isFinite(input.timeoutMs)) {
				input.timeoutMs = DEFAULT_FD_TIMEOUT_MS;
			}
		}
	});
}
