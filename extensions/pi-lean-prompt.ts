/**
 * pi-lean-prompt — 首请求静态前缀瘦身（system prompt + 工具 schema 样板）
 *
 * 实测基数（pi 0.85.1，本机）：每轮静态前缀 = system 3273B + tools 4610B = 7883B ≈ 2.3k tok。
 *   - system 里的 Guidelines 1400B、Pi documentation 1078B 是 pi 逐字注入的原文，冗余在全句解释上。
 *     pi-lazy-tools 的 RULES_NOTE/DOCS_NOTE 只在 0.86+ 的 BuildSystemPromptOptions.sections
 *     路径生效，0.85.1 上是死代码（只走剥 skills 的正则分支），故此处补齐。
 *   - tools 里 edit 的 description+schema 样板 1951B、read 653B，是纯样板文本。
 *
 * 做两件事：
 *   1. before_agent_start：把 Guidelines / Pi documentation 两段压成语义等价版。
 *      保留 edit 全部操作要点（精确唯一/尽量短/合并相邻/不重叠不嵌套/anchor/replaceAll）、
 *      omnify 两条例外、PI_* 环境变量、回答纪律；docs 的三条真实路径原样搬运（不硬编码）。
 *   2. before_provider_request：只裁 payload 里工具 definition 的样板描述，不动 pi 内部
 *      注册表 —— pi-edit-guard（fuzzy edit）、pi-one-ui（write diff）、pi-undo-redo 完全不受影响；
 *      改写是确定性的（逐轮字节一致，不散前缀缓存）。
 *
 * 让路规则：
 *   - system 压缩靠「原文判定句是否还在」识别，0.86+ 若 pi-lazy-tools 的 sections 压缩已生效
 *     （原句已消失），本扩展自动跳过，不重复改写；
 *   - payload 裁剪与 pi 版本无关，始终生效；删字段而非重排 tools 数组，字节确定利于缓存。
 *
 * 零工具注入（不 registerTool / 不 setActiveTools）。回退：删本文件 + /reload。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const B = (v: unknown): number =>
	Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v ?? ""), "utf8");

/** 原始段落判定句：压缩后必然消失，消失即视为「已被别处压缩」→ 跳过。 */
const RULES_ORIGINAL = "Use read to examine files instead of cat or sed.";
const DOCS_ORIGINAL = "Main documentation:";

/** 段止于下一个空行（pi 的系统提示词每段一个空行分隔，段内无空行）。 */
const RULES_RE = /\n\nGuidelines:[\s\S]*?(?=\n\n[^\n])/;
const DOCS_RE = /\n\nPi documentation \([^)]*\):[\s\S]*?(?=\n\n[^\n])/;
const PATH_BULLET_RE = /^- (?:Main documentation|Additional docs|Examples):[^\n]*$/;

const DOCS_TAIL = "- 相对路径按上表根目录解析（非当前工作目录）；读 pi 相关 md 须全文读完并循内部链接。";

/** 压缩版 Guidelines：语义与原文逐条对齐，只去解释性赘述。 */
function leanRules(shellWord: string): string {
	return [
		"Guidelines:",
		`- 文件操作与搜索用 ${shellWord}；读文件用 read。`,
		"- 精改用 edit：edits[].oldText 与原文精确匹配且唯一、尽量短；同文件多处及相邻改动合并为一次调用，edits 之间不重叠不嵌套；text 重复处加 anchor 定位；改名用 replaceAll:true。",
		"- 新文件或整体重写用 write。",
		"- 不知用何工具/技能时先 omnify（无 args 返候选参数要求，补 args 调用；失败按明细补参或退常规手段）。",
		"- PI_* 环境变量可查当前模型与会话信息。",
		"- 响应精简，路径/命令/报错原文保留；安全警告、不可逆操作、多步有序流程用完整清晰语气；按用户语言作答。",
	].join("\n");
}

/** 压缩版 Pi documentation：保留原头 + 三条真实路径，只压掉冗长索引说明。 */
function leanDocs(section: string): string | null {
	const lines = section.split("\n");
	// 段文本以 "\n\n" 开头，split 后首元素是空串
	const head = lines.findIndex((l) => l.startsWith("Pi documentation"));
	if (head < 0) return null;
	const header = lines[head];
	const paths = lines.slice(head + 1).filter((l) => PATH_BULLET_RE.test(l));
	if (paths.length === 0) return null;
	return ["", header, ...paths, DOCS_TAIL].join("\n");
}

interface Compression {
	text: string;
	rulesSaved: number;
	docsSaved: number;
}

function compressSystemPrompt(text: string, shellWord: string): Compression {
	let out = text;
	let rulesSaved = 0;
	let docsSaved = 0;

	if (out.includes(RULES_ORIGINAL)) {
		const hit = out.match(RULES_RE);
		const lean = `\n\n${leanRules(shellWord)}`;
		// 节省量按字节计（压缩版是中文，3B/字，按字符数会高估）
		if (hit && B(hit[0]) > B(lean)) {
			rulesSaved = B(hit[0]) - B(lean);
			out = out.replace(RULES_RE, () => `\n\n${lean}`);
		}
	}
	if (out.includes(DOCS_ORIGINAL)) {
		const hit = out.match(DOCS_RE);
		if (hit) {
			const lean = leanDocs(hit[0]);
			if (lean && B(lean) < B(hit[0])) {
				docsSaved = B(hit[0]) - B(lean);
				out = out.replace(DOCS_RE, () => lean);
			}
		}
	}
	return { text: out, rulesSaved, docsSaved };
}

/* ---------- payload 级工具 definition 瘦身（只改样板文本，不改字段结构） ---------- */

const LEAN_DESC: Record<string, string> = {
	edit:
		'Edit a file by exact text replacement. "edits" is always an array; every edits[].oldText must match a unique region of the original file.',
	read: "Read a file (text, or jpg/png/gif/webp/bmp sent back as an image). Text is truncated to 2000 lines or 50KB; use offset/limit to continue.",
};

const LEAN_FIELD_DESC: Record<string, string | undefined> = {
	// edit：样板解释已由 system prompt 的 Guidelines 承载，schema 里只留判据
	"properties.edits.items.properties.oldText.description": "Exact text to replace; must be unique in the file.",
	"properties.edits.items.properties.newText.description": undefined,
	"properties.edits.items.properties.anchor.description": undefined,
	"properties.edits.items.properties.replaceAll.description": undefined,
	"properties.edits.description": undefined,
};

function setPath(root: any, path: string, value: string | undefined): number {
	const keys = path.split(".");
	let node: any = root;
	for (let i = 0; i < keys.length - 1; i++) {
		node = node?.[keys[i]];
		if (!node || typeof node !== "object") return 0;
	}
	const last = keys[keys.length - 1];
	if (!node || !(last in node)) return 0;
	const before = B(node[last]);
	if (value === undefined) {
		delete node[last];
	} else {
		node[last] = value;
	}
	return Math.max(0, before - B(node[last]));
}

type Stats = {
	systemBefore: number;
	systemAfter: number;
	rulesSaved: number;
	docsSaved: number;
	toolsBefore: number;
	toolsAfter: number;
	tools: { name: string; before: number; after: number }[];
};

export default function piLeanPrompt(pi: ExtensionAPI) {
	let last: Stats | null = null;

	pi.on("before_agent_start", (event) => {
		// 0.86+ 若 sections 路径已由 pi-lazy-tools 压缩，让路（判定句会先拦住，这里是双保险）
		if ((event.systemPromptOptions as { sections?: unknown })?.sections) return;
		const shellWord = pi.getActiveTools().includes("shell") ? "shell" : "bash";
		const { text, rulesSaved, docsSaved } = compressSystemPrompt(event.systemPrompt, shellWord);
		if (text === event.systemPrompt) return;
		const stats = (last ??= {
			systemBefore: 0,
			systemAfter: 0,
			rulesSaved: 0,
			docsSaved: 0,
			toolsBefore: 0,
			toolsAfter: 0,
			tools: [],
		});
		stats.systemBefore = B(event.systemPrompt);
		stats.systemAfter = B(text);
		stats.rulesSaved = rulesSaved;
		stats.docsSaved = docsSaved;
		return { systemPrompt: text };
	});

	pi.on("before_provider_request", (event) => {
		const payload = event?.payload as any;
		if (!payload || !Array.isArray(payload.tools)) return;
		const rows: Stats["tools"] = [];
		for (const def of payload.tools) {
			const fn = def?.function ?? def;
			const name: string = fn?.name ?? "";
			const before = B(def);
			let changed = 0;
			const leanDesc = LEAN_DESC[name];
			if (leanDesc !== undefined && typeof fn?.description === "string") changed += setPath(fn, "description", leanDesc);
			if (name === "edit" && fn?.parameters) {
				for (const [path, value] of Object.entries(LEAN_FIELD_DESC)) changed += setPath(fn.parameters, path, value);
			}
			if (changed > 0) rows.push({ name, before, after: B(def) });
		}
		if (rows.length === 0) return;
		const stats = (last ??= {
			systemBefore: 0,
			systemAfter: 0,
			rulesSaved: 0,
			docsSaved: 0,
			toolsBefore: 0,
			toolsAfter: 0,
			tools: [],
		});
		// 同一会话内 payload.tools 的 parameters 对象是共享的（definition 的同一引用），
		// 第二轮起 delta 已为 0 —— 统计只记首请求，/lean-stats 才反映真实首字成本。
		if (stats.tools.length > 0) return;
		if (process.env.PI_LEAN_DEBUG) {
			process.stderr.write(`[pi-lean-prompt] tools: ${JSON.stringify(payload.tools)}\n`);
		}
		stats.tools = rows;
		stats.toolsBefore = rows.reduce((a, r) => a + r.before, 0);
		stats.toolsAfter = rows.reduce((a, r) => a + r.after, 0);
		return payload;
	});

	pi.registerCommand("lean-stats", {
		description: "首请求前缀字节：system / tools 压缩前后对比",
		handler: async (_args, ctx) => {
			const s = last;
			const line = s
				? `system ${s.systemBefore}→${s.systemAfter}B (rules -${s.rulesSaved} / docs -${s.docsSaved}) | tools ${s.toolsBefore}→${s.toolsAfter}B (${s.tools.map((t) => `${t.name} -${t.before - t.after}`).join(", ")})`
				: "尚无采样：先发一轮对话再执行 /lean-stats";
			ctx.ui.notify?.(line, "info");
			process.stderr.write(`[pi-lean-prompt] ${line}\n`);
		},
	});
}
