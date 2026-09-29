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
/** 墙钟预算：fd 走 ignore 匹配，正常远快于此；超时按部分结果处理。 */
const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 4 * 1024 * 1024;

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

function runFd(bin: string, args: string[], cwd: string, signal?: AbortSignal): Promise<RunResult> {
	return new Promise((resolve) => {
		execFile(
			bin,
			args,
			{ cwd, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true, signal },
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
			"Optional: type/extension/changedWithin/maxDepth/hidden; glob replaces pattern. Omit pattern to list all. Up to 200 results.",
		promptSnippet: "Find files/dirs by regex path match (type/extension/glob/age filters)",
		promptGuidelines: ["查文件名/目录用 fd（可按 type/extension/glob/changedWithin 过滤），查文件内容用 grep。"],
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

			const run = await runFd(bin, built.args, ctx.cwd, signal);
			const notes: string[] = [];
			if (run.timedOut) notes.push(`[Search timed out after ${TIMEOUT_MS / 1000}s; results are partial.]`);
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
			const failed = run.code !== 0;
			const header = failed
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
