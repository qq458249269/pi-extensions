/**
 * pi-lean-sections — 系统提示词 sections 压缩（在 wire 上做，与扩展加载顺序无关）
 *
 * 背景（2026-09-28 在 pi 0.87.1 上实测得出，readme「首字 token」节同款结论）：
 *
 * 1. `before_agent_start` 的 `systemPromptOptions.sections` **只有第一个注册的 handler 改得动**。
 *    实测：同一轮里 `_probe-a`（先注册）看到空对象且它的赋值进了 wire；后注册的探针与本扩展
 *    都拿到一份**已填充的独立副本**，改它无效、`return { systemPrompt }` 也无效。
 *    fork（pi-lazy-tools，来自 packages 源）正占着「第一个」的位置，所以它写在 sections 里的
 *    RULES_NOTE/DOCS_NOTE/SKILLS_NOTE 从未生效——本机 system 提示词一直是 ~6.7KB / ≈1.75k tok。
 * 2. `before_provider_request` 的 `payload` 是**共享可变**的（`payload.tools` 就地改能进 wire），
 *    且 system 消息就在 `payload.messages` 里（`{role:"system", content:"<整串提示词>"}`）。
 *    → 在这里替换已拼好的 system 文本，与谁先谁后无关，稳。
 *
 * 因此本扩展只做一件事：把 wire 上 system 里的 `<docs>` 与 `<skills>` 两块换成紧凑版。
 *   - docs   → 从 system 原文正则抽 pi 安装根后重排成两行；抽不到就原样保留（fail-safe）
 *   - skills → 单行「清单不列于此，用 omnify 检索」，技能仍能被 omnify / skill_search 命中
 *
 * ⚠ **不压 `<rules>`**（实测过，别加）：单改 rules 块时 6897→5536B 且落位正确，但一旦与
 * docs/skills 同时改，pi 0.87.1 会把 rules 正文挪进 agent 文件段（"## Markdown File Editing"）、
 * 把工具一行式塞进 `<rules>`，条目与续行错配。基线本身也存在同样的块间重排（`<tools>`/`<rules>`
 * 内容逐轮互换、工具一行式本来就混在 agent 段里），属 pi 侧的不确定性，本扩展不去碰它。
 * 只留 docs+skills：6897B → 3556B（−3341B / −48%），连续 3 轮字节完全一致。
 *
 * 不动 `<tools>`（pi 按当前 active 工具动态生成，压缩就得自己重建工具表）、不动注册表、
 * 不注入工具、不改 payload.tools（那是 pi-lean-prompt 的活）。
 *
 * 轮间字节稳定：压缩结果是常量（docs 的路径也来自同一份原文），前缀缓存不散。
 * 零工具注入。回退：删本文件 + /reload。  看节省量：/lean-sections-stats（只记首请求）。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const B = (s: string): number => Buffer.byteLength(s, "utf8");

/** skills 段：技能清单改由 omnify 检索，与本仓库 lazy-tools 策略一致。 */
const SKILLS_NOTE =
	"<skills>\n技能清单不列于此。需用时以 omnify 检索，按其命中结果 read 对应 SKILL.md。\n</skills>";

/** pi 0.87.1 的 system 拼装不稳定，改块会带动块间重排（见头注）。只动 docs / skills。 */
const SQUEZE: Record<string, (body: string, whole: string) => string | null> = {
	docs: (_body, whole) => leanDocs(whole),
	skills: () => SKILLS_NOTE,
};

/** 从整串提示词里抽 pi 安装根 + 确认 docs/examples 索引存在；抽不全返回 null（保留原文）。 */
function leanDocs(original: string): string | null {
	const roots = new Set<string>();
	for (const m of original.matchAll(/([A-Za-z]:\\[^\s,;:）)]*?pi)(?=[\\/]|\s|$|,|;|:)/g)) roots.add(m[1].replace(/[\\/]+$/, ""));
	for (const m of original.matchAll(/(\/(?:[^\s,;:）)]+\/)+pi)(?=[\\/]|\s|$|,|;|:)/g)) roots.add(m[1].replace(/\/+$/, ""));
	if (!/(^|[^\w/])docs\/[a-z0-9-]+\.md/i.test(original)) return null;
	if (!/(^|[^\w/])examples\/[a-z0-9-]+/i.test(original)) return null;
	const root = [...roots].sort((a, b) => b.length - a.length)[0];
	if (!root) return null;
	const sep = root.includes("\\") ? "\\" : "/";
	return [
		"<docs>",
		`PI 文档（仅当用户问及 pi 自身/SDK/扩展/主题/技能/TUI 时读取）：${root}${sep}README.md；副档 ${root}${sep}docs 与 ${root}${sep}examples（按 README 索引解析相对路径）。`,
		"读 pi 相关 md 须全文读完并循文内链接。",
		"</docs>",
	].join("\n");
}

/** 替换某个 section 块；块不存在、已是自己写的、或替换后不更小就原样返回。 */
function squeeze(text: string, tag: string, build: (body: string, whole: string) => string | null): { text: string; saved: number } {
	const re = new RegExp(`<${tag}>\\n?([\\s\\S]*?)<\\/${tag}>`);
	const m = re.exec(text);
	if (!m) return { text, saved: 0 };
	const body = m[1];
	// 已是自己写的紧凑版 → 不动（保持轮间字节绝对稳定）
	if (body.startsWith("技能清单不列于此") || body.startsWith("PI 文档（仅当用户问及")) return { text, saved: 0 };
	const next = build(body, text);
	if (!next) return { text, saved: 0 };
	const before = B(m[0]);
	const after = B(next);
	if (after >= before) return { text, saved: 0 };
	return { text: text.slice(0, m.index) + next + text.slice(m.index + m[0].length), saved: before - after };
}

type Stats = { systemBefore: number; systemAfter: number; docs: number; skills: number };

export default function piLeanSections(pi: ExtensionAPI) {
	let last: Stats | null = null;

	pi.on("before_provider_request", (event) => {
		const payload = event?.payload as { messages?: { role?: string; content?: unknown }[] } | undefined;
		const messages = payload?.messages;
		if (!Array.isArray(messages)) return;
		const sys = messages.find((m) => m?.role === "system" && typeof m.content === "string");
		if (!sys) return;
		const original = sys.content as string;

		let text = original;
		let docs = 0;
		let skills = 0;
		for (const tag of ["docs", "skills"] as const) {
			const r = squeeze(text, tag, SQUEZE[tag]);
			text = r.text;
			if (tag === "docs") docs = r.saved;
			else skills = r.saved;
		}
		if (!docs && !skills) return;
		sys.content = text;

		// payload.messages 每轮重建，本进程内第一份 system 才代表首字成本；后续轮 delta 为 0 属正常
		if (last?.systemBefore === B(original)) return;
		last = { systemBefore: B(original), systemAfter: B(text), docs, skills };
	});

	pi.registerCommand("lean-sections-stats", {
		description: "wire 上 system 提示词压缩前后字节对比（只记首请求）",
		handler: async (_args, ctx) => {
			const s = last;
			const line = s
				? `system ${s.systemBefore}→${s.systemAfter}B（docs -${s.docs} / skills -${s.skills}）`
				: "尚无采样：先发一轮对话再执行 /lean-sections-stats";
			ctx.ui.notify?.(line, "info");
			process.stderr.write(`[pi-lean-sections] ${line}\n`);
		},
	});
}
