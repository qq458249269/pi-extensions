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

/** 配置一致性提醒：内建 shell 在两道闸里缺位时，agent 就没有可用的 shell。
 *  （extensions/pi-shell.ts 已删，故只认内建 bash/powershell；bash 需同时在 defaultTools 与 resident） */
const residentPath = path.join(os.homedir(), ".pi", "lazy-tools.json");
const userSettings = path.join(os.homedir(), ".pi", "agent", "settings.json");
const projSettings = path.join(process.cwd(), ".pi", "settings.json");
const readList = (p) => {
	try {
		return JSON.parse(fs.readFileSync(p, "utf8"));
	} catch {
		return null;
	}
};
try {
	const list = readList(residentPath)?.resident ?? [];
	// 项目级 .pi/settings.json 整体覆盖用户级，两边都要查
	const layers = [
		["用户级", readList(userSettings)?.defaultTools],
		["项目级", readList(projSettings)?.defaultTools],
	];
	const hasShell = layers.some(([, t]) => Array.isArray(t) && ["bash", "powershell"].some((s) => list.includes(s) && t.includes(s)));
	if (!hasShell) {
		console.warn(`[hint] 没有可用的 shell：resident=${JSON.stringify(list)} × defaultTools=${JSON.stringify(layers)}`);
		console.warn(`[hint]   → "bash" 需同时写进 ~/.pi/lazy-tools.json 的 resident 与 settings.json 的 defaultTools（项目级会整体覆盖用户级）`);
	}
	for (const [name, t] of layers) {
		if (!Array.isArray(t)) continue;
		if (t.includes("bash") && !list.includes("bash")) console.warn(`[hint] ${name} defaultTools 有 bash 但 resident 没有 → bash 会注册却被 lazy 掉`);
		if (list.includes("bash") && !t.includes("bash")) console.warn(`[hint] ${name} defaultTools 没有 bash 但 resident 有 → bash 根本不会注册`);
	}
} catch {
	console.warn(`[hint] 读不到 ${residentPath}，请确认 resident 含 "bash"`);
}

if (checkOnly && drift > 0) {
	console.error(`[install] ${drift} 个文件与已装副本不一致（跑一次不带 --check 的即可同步）`);
	process.exit(1);
}
if (drift > 0 && !checkOnly) console.log("[install] 完，执行 /reload 生效");
