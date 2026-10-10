/**
 * pi-fd — 用 fd 的原生接口取代 pi-find 那个「只认 glob」的 `find` 工具
 *
 * 为什么要换：
 *   `@tian.zuo/pi-find` 的 `find` 底层本来就是 fd（lib/tools.ts 里 exec fd），
 *   但它只开了 glob 模式的一层薄壳：pattern + path 两个参数。于是这些都做不到
 *   ——「列出所有 .ts」（必须给个 glob）、「只看最近 30 天改过的」、「按正则匹配路径」、
 *   「区分文件/目录/可执行文件」。这些在 fd 里都是一行参数。
 *
 * 换成本：常驻集里 find（504B）→ fd（本工具）。readme §6.3 已算过，
 *   搜索类工具常驻省的是 1–2 个往返轮次，比那点 token 便宜。
 *
 * 行为对齐（故意与被替掉的 find 保持一致的部分）：
 *   - 尊重 .gitignore、默认跳过 hidden（fd 默认行为，find 原本也是）；
 *   - 结果上限 200 条、超限/超时都显式提示，不静默截断；
 *   - 路径不存在/不是目录 → 明确报错，不返回空结果。
 *
 * 超时纪律（readme §5 铁律二「find/grep 一律带超时」）：
 *   - 每次执行都有墙钟预算：默认 30s，`timeoutMs` 可调，硬上限 120s（防手滑传 600000）。
 *   - 参数可选但**模型侧必须显式传**（写进 promptGuidelines + 参数描述），省了也有默认兜底，
 *     不会出现「裸跑到底」的第三种状态。
 *   - 超时按部分结果处理：kill → 已收到的行照常返回，并附 [Search timed out ...] 提示。
 *   - 上游 `@tian.zuo/pi-find` 的 `find`/`grep` 走自己的 SEARCH_TIMEOUT_MS=30_000（不可调），
 *     所以工具层三家口径一致：都是 30s 起、都会显式说超时。
 *
 * 与 find 的关系：`@tian.zuo/pi-find` 仍会注册 `find`（扩展注册不过 defaultTools 闸），
 *   只是它不在 resident 里 → 被 pi-lazy-tools 隐藏，需要时 omnify 仍能按名捞回来兜底。
 *
 * 零依赖：只 spawn fd（pi 自带副本 ~/.pi/agent/bin/fd，本机 10.3.0；否则 PATH 上的 fd/fdfind）。
 * 回退：删本文件 + /reload，并把 lazy-tools.json 的 "fd" 换回 "find"。
 */
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** 单次结果上限，与被替掉的 find 一致；超限会显式提示。 */
const RESULT_LIMIT = 200;
/** 默认墙钟预算，与 pi-find 的 SEARCH_TIMEOUT_MS 对齐；fd 走 ignore 匹配，正常远快于此。 */
const DEFAULT_TIMEOUT_MS = 30_000;
/** 硬上限：允许调大，不允许放到「等于没有」。 */
const MAX_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_BUFFER = 4 * 1024 * 1024;

/**
 * 默认跳过的「编译产物 / 依赖 / 缓存」目录名（fd 的 `-E/--exclude`）。
 *
 * 为什么必须自带：fd 默认只做两件事——尊重 `.gitignore`、跳过 hidden。
 * 这两条**盖不住编译目录**：`node_modules` / `dist` / `target` / `coverage` /
 * `__pycache__` 既不是 hidden，也常常不在 `.gitignore` 里（本仓库的
 * `.gitignore` 就只写了 `.sc-test/`、`.zvec-grep/`、`.pi/`）。于是 `maxDepth:6`
 * 照样一层层钻进这些目录爬——限深度只压**深度**，压不了一层的宽度，
 * 一层就可能几万文件，这正是「有 maxdepth 6 还是找很久」的成因。
 *
 * 只列非 hidden 的：`.next`/`.nuxt`/`.cache`/`.venv`/`.turbo` 这些点开头的
 * fd 本来就跳（除非 `hidden:true`），列进来是冗余。
 *
 * 附带的正确性保证（已实测，`.sc-test/probe-fd.mjs` 有回归）：
 *   `-E dist` 配 `path:"dist"` 仍能搜到 `dist/` 里的内容——`--exclude` 只剪枝遍历，
 *   不剪搜索根本身。所以「查 dist 里有什么文件」这种正当需求不会被这层排除误伤；
 *   真要按名字找编译目录本身（`{pattern:"dist"}`）或彻底关掉，用 `noDefaultExcludes`。
 */
const DEFAULT_EXCLUDE_DIRS = [
	"node_modules",
	"dist",
	"build",
	"out",
	"target",
	"coverage",
	"__pycache__",
	"vendor",
	"venv",
	"Pods",
	"DerivedData",
	"bower_components",
	"cmake-build-debug",
	"cmake-build-release",
];

const TYPE_FLAGS: Record<string, string> = {
	file: "f",
	directory: "d",
	symlink: "l",
	executable: "x",
	empty: "e",
};

const TYPE_VALUES = Object.keys(TYPE_FLAGS);

interface FdParams {
	pattern?: string;
	path?: string;
	type?: string;
	extension?: string;
	glob?: string;
	changedWithin?: string;
	maxDepth?: number;
	hidden?: boolean;
	exclude?: string;
	noDefaultExcludes?: boolean;
	timeoutMs?: number;
}

/**
 * 组装 `--exclude` 列表：先默认排除编译目录（可关），再拼模型给的 `exclude`。
 *
 * fd 的 `--exclude` 用 glob 匹配路径任意一段（写裸名字即可，不用写成递归 glob），
 * 已实测：`-E node_modules` 能同时排掉顶层和 `src/foo/node_modules`。
 */
function buildExcludes(p: FdParams): string[] {
	const list = p.noDefaultExcludes ? [] : DEFAULT_EXCLUDE_DIRS;
	const extra = (p.exclude ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	// 去重但保序：额外项放后面，模型指定的同名项不会重复传
	return [...new Set([...list, ...extra])];
}

/** 把模型给的 timeoutMs 夹进 [1s, 120s]；缺失/非法/非有限数一律回落到默认 30s。 */
function resolveTimeoutMs(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
	return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(value)));
}

/** fd 可执行文件候选：pi 自带副本优先，其次 PATH（Debian/Ubuntu 上叫 fdfind）。 */
function candidates(): string[] {
	return [
		path.join(homedir(), ".pi", "agent", "bin", process.platform === "win32" ? "fd.exe" : "fd"),
		"fd",
		"fdfind",
	];
}

let cachedFd: string | null = null;

/** 解析出可用的 fd（只探测一次）；都没有则返回 null 由工具报错。 */
function resolveFd(): string | null {
	if (cachedFd) return cachedFd;
	for (const candidate of candidates()) {
		const absolute = path.isAbsolute(candidate);
		if (absolute && !existsSync(candidate)) continue;
		try {
			execFile(candidate, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 });
			cachedFd = candidate;
			return candidate;
		} catch {
			// 不可执行/不在 PATH，继续下一个候选
		}
	}
	return null;
}

interface RunResult {
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

function runFd(bin: string, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
	return new Promise((resolve) => {
		execFile(
			bin,
			args,
			{ cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: MAX_BUFFER, windowsHide: true, signal },
			(err, stdout, stderr) => {
				const e = err as (Error & { code?: number | string; killed?: boolean; signal?: string }) | null;
				resolve({
					// 超时/信号杀时 err.code 是字符串或 null，这里只当失败看
					code: typeof e?.code === "number" ? e.code : e ? 1 : 0,
					stdout: stdout ?? "",
					stderr: stderr ?? "",
					timedOut: Boolean(e?.killed) || e?.signal === "SIGTERM",
				});
			},
		);
	});
}

/** 模型侧参数 → fd 命令行。
 *
 *  踩过的坑（都实测过，改动前先看 .sc-test/probe-fd.mjs）：
 *   1. 省略 pattern 时必须显式传空串 `""`，否则唯一的 position 会被 fd 当成 pattern
 *      （`fd -t d .git` 返回空；`fd -t d "" .git` 才出结果）——「列出全部」是这个工具的主卖点，必须堵死。
 *   2. `--glob` 是「把 pattern 换成 glob」，不是额外过滤器；glob 模式下再给位置 pattern
 *      会被 fd 当成第二个搜索路径（报 `Search path 'capture' is not a directory`）。故 glob 与 pattern 互斥。
 *   3. 不用 `--` 分隔：`-e md -- "" .` 能过，但 `pattern -- "" path` 会让空串占掉 path 位、
 *      报 `a value is required for '[path]...'`。位置参数直接跟在 flag 后面即可（clap 允许穿插）。
 *   4. path 以 `-` 开头会被当 flag → 那种情况改传绝对路径。
 *   5. `--exclude` 只剪枝遍历、不剪搜索根：`--exclude dist . dist` 仍能搜到 `dist/` 里的
 *      内容，所以默认排除不会误伤「进 dist 里找文件」这种正当请求。
 */
function buildArgs(p: FdParams, searchPath: string): { args: string[] } | { error: string } {
	const args: string[] = [];
	if (p.hidden) args.push("--hidden");
	if (p.type && TYPE_FLAGS[p.type]) args.push("--type", TYPE_FLAGS[p.type]);
	// 自己按逗号拆成多个 -e：不依赖 fd 版本对 `-e a,b` 的支持差异
	for (const ext of (p.extension ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
		args.push("--extension", ext.replace(/^\./, ""));
	}
	if (p.changedWithin) args.push("--changed-within", p.changedWithin);
	if (typeof p.maxDepth === "number" && Number.isFinite(p.maxDepth)) args.push("--max-depth", String(Math.max(0, Math.trunc(p.maxDepth))));
	for (const dir of buildExcludes(p)) args.push("--exclude", dir);
	if (p.glob) {
		args.push("--glob", p.glob);
	} else if (p.pattern) {
		if (p.pattern.startsWith("-")) {
			return { error: `Pattern cannot start with '-' (fd would read it as a flag). Rewrite it, e.g. '-${p.pattern}' → '^(\\-${p.pattern.slice(1)})'.` };
		}
		args.push(p.pattern);
	} else {
		args.push(""); // fd 需要显式空 pattern，见坑 1
	}
	// 多要一条用来判断是否被截断
	args.push("--max-results", String(RESULT_LIMIT + 1), searchPath);
	return { args };
}

function text(body: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text: body }], details };
}

export default function piFd(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "fd",
		label: "fd",
		description:
			"Find files/directories by regex over the path (fd). Smart case; respects .gitignore, skips hidden. " +
			"Auto-skips build/dependency dirs (node_modules, dist, target, __pycache__, …) — pass noDefaultExcludes to disable. " +
			"Optional: type/extension/changedWithin/maxDepth/hidden/exclude; glob replaces pattern. Omit pattern to list all. " +
			"Always pass timeoutMs (wall-clock budget, default 30s, hard cap 120s) and narrow the path instead of searching wide. " +
			"Up to 200 results.",
		promptSnippet: "Find files/dirs by regex path match (type/extension/glob/age filters; pass timeoutMs)",
		promptGuidelines: [
			"查文件名/目录用 fd（可按 type/extension/glob/changedWithin 过滤），查文件内容用 grep。别用 bash 的 find：它不读 .gitignore、也不跳编译目录，慢一个量级。",
			"fd 已默认跳过 node_modules/dist/target 等编译目录，maxDepth 只是再压一层深度，不能替代这个——深层大目录照样慢，先缩 path。",
			"每次 fd 必须显式传 timeoutMs（毫秒，1s–120s，默认 30s）：搜索只会在超时那一刻停下并返回部分结果，别让它裸跑。",
		],
		parameters: Type.Object({
			pattern: Type.Optional(
				Type.String({ description: "Regex on the whole path; omit to list all. Uppercase letter ⇒ case-sensitive." }),
			),
			path: Type.Optional(
				Type.String({ description: "Directory to search (default cwd); pass a dot dir to reach inside it, e.g. '.github'." }),
			),
			type: Type.Optional(
				Type.Union(TYPE_VALUES.map((v) => Type.Literal(v)), {
					description: "Entry kind: file, directory, symlink, executable, empty.",
				}),
			),
			extension: Type.Optional(Type.String({ description: "Extensions to keep, 'ts,tsx' or '.json'." })),
			glob: Type.Optional(Type.String({ description: "Glob instead of pattern, e.g. '*.test.ts'." })),
			changedWithin: Type.Optional(Type.String({ description: "Only entries changed within, e.g. '1d', '2weeks'." })),
			maxDepth: Type.Optional(Type.Number({ description: "Descend at most N levels." })),
			hidden: Type.Optional(Type.Boolean({ description: "Include dot entries (skipped by default)." })),
			exclude: Type.Optional(
				Type.String({ description: "Extra glob dir names to skip, comma-separated, e.g. 'fixtures,snapshots'." }),
			),
			noDefaultExcludes: Type.Optional(
				Type.Boolean({ description: "Search build/dependency dirs too (node_modules, dist, target, …). Off by default." }),
			),
			timeoutMs: Type.Optional(
				Type.Number({
					description:
						"REQUIRED in practice: wall-clock budget in ms (1000–120000, default 30000). On expiry the call is killed and partial results are returned with a timeout note.",
					minimum: MIN_TIMEOUT_MS,
					maximum: MAX_TIMEOUT_MS,
				}),
			),
		}),

		async execute(_toolCallId, params: FdParams, signal, _onUpdate, ctx) {
			const bin = resolveFd();
			if (!bin) {
				return text(
					"fd executable not found (looked for pi's bundled copy and PATH). Use `bash ls`/`bash git ls-files` instead.",
					{ error: "fd_missing" },
				);
			}

			const searchPath = params.path ?? ".";
			const absolute = path.resolve(ctx.cwd, searchPath);
			if (!existsSync(absolute)) return text(`Search path does not exist: ${searchPath}`, { error: "path_missing" });
			if (!statSync(absolute).isDirectory()) return text(`Search path is not a directory: ${searchPath}`, { error: "path_not_dir" });

			const built = buildArgs(params, searchPath.startsWith("-") ? absolute : searchPath);
			if ("error" in built) return text(built.error, { error: "bad_pattern" });

			const timeoutMs = resolveTimeoutMs(params.timeoutMs);
			const run = await runFd(bin, built.args, ctx.cwd, timeoutMs, signal);
			const notes: string[] = [];
			if (run.timedOut) notes.push(`[Search timed out after ${timeoutMs / 1000}s; results are partial. Narrow path or raise timeoutMs (max ${MAX_TIMEOUT_MS / 1000}s).]`);
			// 正则写错（最常见是把 glob 写进 pattern）时给一句能直接用的建议，并吞掉底层 rust 报错
			const regexBroken = /regex parse error/i.test(run.stderr);
			if (regexBroken) {
				const bad = params.pattern ? `"${params.pattern}"` : "该 pattern";
				notes.push(
					`[${bad} 不是合法正则。含 * ? [] {} | 的写法请改用 glob 参数，例如 glob:"*.bak"；正则需转义，如 ".*\\.bak$" 或 "^src/.*\\.ts$"。]`,
				);
			} else if (run.stderr.trim()) {
				notes.push(`[${run.stderr.trim().split(/\r?\n/).slice(0, 3).join(" ")}]`);
			}

			// fd 给目录名补了尾斜杠、给默认搜索根补 "./" 前缀；两者都去掉，结果才能直接喂给 read/edit
			const lines = run.stdout
				.split(/\r?\n/)
				.map((l) => (l.length > 1 ? l.replace(/\/+$/, "") : l).replace(/^\.\//, ""))
				.filter(Boolean);
			const truncated = lines.length > RESULT_LIMIT;
			const shown = truncated ? lines.slice(0, RESULT_LIMIT) : lines;
			if (truncated) notes.push(`[Result limit reached at ${RESULT_LIMIT}; narrow pattern, path, or filters.]`);

			// 命令失败时不要说「无匹配」——那是另一回事，会把模型引到错误的排查方向
			// 超时同理：被 kill 的 exit code 会被归一成 1，报「failed」是误导，要说超时
			const timedOutEmpty = run.timedOut && shown.length === 0;
			const failed = run.code !== 0 && !timedOutEmpty;
			const header = timedOutEmpty
				? `Search timed out after ${timeoutMs / 1000}s (no results gathered).`
				: failed
					? `Search failed (fd exit ${run.code}${regexBroken ? ", invalid regex" : ""}).`
				: shown.length
					? `${shown.length} ${plural(TYPE_LABEL[params.type ?? "file"], shown.length)}${truncated || run.timedOut ? " (partial results)" : ""}`
					: "No matches found.";
			const hint =
				shown.length && !params.hidden
					? "[Hidden entries are skipped by default; pass hidden:true or path:'.github'.]"
					: "";
			if (hint) notes.push(hint);

			return text([header, ...shown, ...notes].join("\n"), {
				count: shown.length,
				truncated,
				timedOut: run.timedOut,
				exitCode: run.code,
				timeoutMs,
			});
		},
	});

	pi.registerCommand("fd-check", {
		description: "体检：fd 工具解析到的可执行文件与版本",
		handler: async (_args, ctx) => {
			const bin = resolveFd();
			const line = bin ? `fd → ${bin}` : "fd 未找到（pi 副本与 PATH 都没有）";
			ctx.ui.notify?.(line, bin ? "info" : "warning");
			process.stderr.write(`[pi-fd] ${line}\n`);
		},
	});
}

/** 结果计数用的类型名，避免 "3 directorys"。 */
const TYPE_LABEL: Record<string, string> = {
	file: "file",
	directory: "directory",
	symlink: "symlink",
	executable: "executable",
	empty: "empty entry",
};

function plural(word: string, n: number): string {
	if (n === 1) return word;
	return word === "directory" ? "directories" : word === "empty entry" ? "empty entries" : `${word}s`;
}
