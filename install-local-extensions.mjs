#!/usr/bin/env node
/**
 * install-local-extensions.mjs — 把仓库 extensions/*.ts 同步到 ~/.pi/agent/extensions/（幂等）
 *
 * 仓库是这些扩展的 canonical 源（可 review、可 diff），pi 实际加载的是
 * ~/.pi/agent/extensions/ 下的副本。内容一致则不写盘（避免无谓 /reload 抖动）。
 * 同步后可用 `/reload` 让 pi 重新加载（不重启会话、不丢历史）。
 *
 * 用法：
 *   node install-local-extensions.mjs           # 同步
 *   node install-local-extensions.mjs --check   # 只体检，有漂移则 exit 1（CI/自查用）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(repo, "extensions");
const dest = path.join(os.homedir(), ".pi", "agent", "extensions");
const checkOnly = process.argv.includes("--check");

if (!fs.existsSync(src)) {
	console.error(`[install] 找不到 ${src}`);
	process.exit(1);
}
fs.mkdirSync(dest, { recursive: true });

const files = fs.readdirSync(src).filter((f) => f.endsWith(".ts")).sort();
let drift = 0;
for (const f of files) {
	const from = path.join(src, f);
	const to = path.join(dest, f);
	const a = fs.readFileSync(from);
	const same = fs.existsSync(to) && Buffer.compare(a, fs.readFileSync(to)) === 0;
	if (same) {
		console.log(`[ok  ] ${f}（一致，${a.length}B）`);
		continue;
	}
	drift++;
	if (checkOnly) {
		console.log(`[drift] ${f}（仓库 ${a.length}B / 已装 ${fs.existsSync(to) ? fs.statSync(to).size + "B" : "缺失"}）`);
		continue;
	}
	fs.writeFileSync(to, a);
	console.log(`[chg ] ${f} → ${to}（${a.length}B）`);
}

/** 三处配置一致性提醒：扩展同步了但工具集没跟上，shell 就不在 active 集里。 */
const resident = path.join(os.homedir(), ".pi", "lazy-tools.json");
try {
	const list = JSON.parse(fs.readFileSync(resident, "utf8")).resident ?? [];
	if (!list.includes("shell")) console.warn(`[hint] ${resident} 的 resident 里没有 "shell"，shell 会被 lazy 掉`);
	if (list.includes("bash") || list.includes("powershell")) console.warn(`[hint] ${resident} 的 resident 仍含 bash/powershell，会与 shell 同时常驻`);
} catch {
	console.warn(`[hint] 读不到 ${resident}，请确认 resident 含 shell`);
}

if (checkOnly && drift > 0) {
	console.error(`[install] ${drift} 个文件与已装副本不一致（跑一次不带 --check 的即可同步）`);
	process.exit(1);
}
if (drift > 0 && !checkOnly) console.log("[install] 完，执行 /reload 生效");
