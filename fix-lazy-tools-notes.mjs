#!/usr/bin/env node
/**
 * fix-lazy-tools-notes.mjs — 修补已安装的 pi-lazy-tools fork 文案（幂等）
 *
 * 两件事：
 *   1. 修 DOCS_NOTE 的路径 bug：fork 里写死 `D:\Agent\pi\README.md`，本机不存在
 *      （本机是 D:\agent\pi-windows-x64\）。pi 根导出有 getReadmePath()/getDocsPath()/
 *      getExamplesPath()，但 git 包不能蹭根 node_modules 的运行时 import（见 readme
 *      「git 包独立 module root」），所以改成由本脚本按 pi 安装目录实测后写死，
 *      并留一行注释说明来源。0.86+ 的 sections 路径才用到这个常量。
 *   2. 若本机装了 pi-shell（bash+powershell 合一），把 fork 文案里的「文件操作用 bash」
 *      与 omnify 兜底提示里的「bash/read/编辑」改成 shell，免得 0.86+ 让路后指错工具。
 *
 * 幂等：每条替换都写成「正则匹配当前内容 → 目标文本」，第二次跑无变化即不写盘。
 * 用法：node fix-lazy-tools-notes.mjs [--check]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const FORK = path.join(os.homedir(), ".pi", "agent", "git", "github.com", "qq458249269", "pi-lazy-tools", "lazy-tools.ts");
const SHELL_EXT = path.join(os.homedir(), ".pi", "agent", "extensions", "pi-shell.ts");
const checkOnly = process.argv.includes("--check");

/** 定位 pi 安装目录：pi.exe 所在目录（带 README.md + docs/ + examples/ 才认）。 */
function detectPiDocsRoot() {
	const candidates = [];
	if (process.env.PI_INSTALL_DIR) candidates.push(process.env.PI_INSTALL_DIR);
	try {
		for (const exe of execFileSync("where.exe", ["pi.exe"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean)) {
			candidates.push(path.dirname(exe.trim()));
		}
	} catch {}
	// 常见约定目录兜底
	const agentRoot = path.join(os.homedir(), ".pi", "agent");
	candidates.push(path.join(agentRoot, "node_modules", "@earendil-works", "pi-coding-agent"));
	for (const dir of candidates) {
		if (fs.existsSync(path.join(dir, "README.md")) && fs.existsSync(path.join(dir, "docs")) && fs.existsSync(path.join(dir, "examples"))) {
			return { root: dir, from: candidates.indexOf(dir) === 0 && process.env.PI_INSTALL_DIR ? "PI_INSTALL_DIR" : "where pi.exe / node_modules" };
		}
	}
	return null;
}

const docs = detectPiDocsRoot();
if (!docs) {
	console.error("[fix-lazy-tools-notes] 未能定位 pi 文档根目录（需 README.md + docs/ + examples/）；跳过路径修补。");
	process.exit(checkOnly ? 1 : 0);
}

const shell = fs.existsSync(SHELL_EXT);
const original = fs.readFileSync(FORK, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let text = original;
const applied = [];
const sub = (label, re, to) => {
	const next = text.replace(re, to);
	if (next !== text) {
		applied.push(label);
		text = next;
	}
};

const j = (p) => p.replace(/\\/g, "\\\\");

// 1) DOCS_NOTE 路径：整块替换（重跑时命中同一正则但文本相同 → 视为无变化）
sub(
	"docs 路径",
	/(?:\/\/ \[fix-lazy-tools-notes\][^\n]*\r?\n)?const DOCS_NOTE =\r?\n\t"[^"]*";/,
	`// [fix-lazy-tools-notes] 路径由 pi 安装目录实测填入（${docs.from}）：${docs.root}${eol}const DOCS_NOTE =${eol}\t"PI 文档（仅当用户问及 pi 自身/SDK/扩展/主题/技能/TUI 时读取）：${j(path.join(docs.root, "README.md"))}；副档 ${j(path.join(docs.root, "docs"))} 与 ${j(path.join(docs.root, "examples"))}（按 README 索引解析相对路径）。读 pi 相关 md 须全文读完并循内部链接。";`,
);

// 2) 装了 pi-shell 就把「bash」措辞换成「shell」
// 1b) 本机禁 find（见 ~/.pi/agent/extensions/no-find.ts；已卸载 pi-find，find 会假死/被拦）
sub("RULES_NOTE find→fd", /- 文件操作用 (?:bash|shell[^)]*) \(ls, rg, find\)/, (m) => m[0].replace("rg, find", "rg, fd"));

if (shell) {
	sub("RULES_NOTE 首行", /- 文件操作用 (?:bash|shell)[^\n]*\(ls, rg, (?:find|fd)\)/, "- 文件操作用 shell（bash/powershell 合一；(ls, rg, fd)）");
	sub("omnify 兜底 A", /以 bash\/read\/编辑 等常规手段完成/g, "以 shell/read/编辑 等常规手段完成");
	sub("omnify 兜底 B", /常规手段（bash\/read\/编辑）/g, "常规手段（shell/read/编辑）");
	sub("文件头注释", /并建议退回 bash\/read\/编辑 等常规手段。/, "并建议退回 shell/read/编辑 等常规手段。");
}

if (text === original) {
	console.log(`[fix-lazy-tools-notes] 无需改动（${FORK}）`);
} else if (checkOnly) {
	console.log(`[fix-lazy-tools-notes] --check 发现待修补：${applied.join("、")}`);
	process.exit(1);
} else {
	if (!fs.existsSync(`${FORK}.bak`)) fs.copyFileSync(FORK, `${FORK}.bak`);
	fs.writeFileSync(FORK, text);
	console.log(`[fix-lazy-tools-notes] 已修补：${applied.join("、")}（备份 ${FORK}.bak）`);
}
console.log(`[fix-lazy-tools-notes] pi 文档根：${docs.root} | pi-shell：${shell ? "在" : "无"}`);
