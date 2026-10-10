#!/usr/bin/env node
/**
 * install-project-config.mjs — 把仓库 `config/` 下的配置/小脚本同步到 pi 真正读取的位置（幂等）
 *
 * 为什么要有这一层：pi 的项目级配置**只认** `<cwd>/.pi/settings.json`（`docs/configuration.md`
 * 「Project `.pi` directory」，目录名写死在 `dist/config.js:403`），而 `<项目>/.pi/` 目录
 * 本身是运行时目录（索引/阶段数据会 churn），所以在仓库里被 `.gitignore` 整体忽略。
 * 于是 canonical 源改放 `config/`（不被忽略、可 review、可 diff），由本脚本拷进 `.pi/`。
 *
 * 同步面（两个 scope，固定不动）：
 *   config/pi-project/*  →  <仓库根>/.pi/         项目级（本仓库被 pi 使用时生效）
 *   config/agent/*       →  ~/.pi/agent/          用户级（shellCommandPrefix 等跨项目配置）
 *
 * 安全约定：
 *   - `config/agent/settings.json` **不搬**（那份是用户级总配置，必须手改；误覆盖会把
 *     packages/defaultTools 等整段冲掉）。要留底请另起文件名（如 `settings.snapshot.json`）。
 *   - 逐字节比对，一致就不写盘（避免无谓的 /reload 抖动）。
 *
 * 用法：
 *   node install-project-config.mjs           # 同步
 *   node install-project-config.mjs --check   # 只体检，有漂移则 exit 1
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.dirname(fileURLToPath(import.meta.url));
const checkOnly = process.argv.includes("--check");
const NEVER_COPY = new Set(["settings.json"]); // config/agent 下禁止自动覆盖的名字
/** `pi-project/` 下的留档件：放仓库只为「重装时手动拷」，不参与同步。
 *  zvec.json —— `pi-zvec` 已于 2026-10-08 卸载（readme §7.11 要求项目索引与配置全删），
 *  留着这份是为了哪天重装 zvec 时不用凭记忆重写 auto 模式。
 *  另：`settings.snapshot-*.json` 一律视为历史快照留档，不往 ~/.pi/agent/ 里拷。 */
const ARCHIVED = { "pi-project": new Set(["zvec.json"]) };
const isArchived = (dir, f) => ARCHIVED[dir]?.has(f) === true || f.startsWith("settings.snapshot-");

const scopes = [
	{ label: "项目级", src: path.join(repo, "config", "pi-project"), dest: path.join(repo, ".pi") },
	{ label: "用户级", src: path.join(repo, "config", "agent"), dest: path.join(os.homedir(), ".pi", "agent") },
];

let drift = 0;
for (const { label, src, dest } of scopes) {
	if (!fs.existsSync(src)) {
		console.log(`[skip] ${label}：无 ${src}`);
		continue;
	}
	fs.mkdirSync(dest, { recursive: true });
	for (const f of fs.readdirSync(src).sort()) {
		const from = path.join(src, f);
		if (!fs.statSync(from).isFile()) continue;
		if (path.basename(src) === "agent" && NEVER_COPY.has(f)) {
			console.log(`[skip] ${label} ${f}（禁止自动覆盖用户级总配置）`);
			continue;
		}
		if (isArchived(path.basename(src), f)) {
			console.log(`[skip] ${label} ${f}（留档件，不参与同步）`);
			continue;
		}
		const to = path.join(dest, f);
		const a = fs.readFileSync(from);
		const same = fs.existsSync(to) && Buffer.compare(a, fs.readFileSync(to)) === 0;
		if (same) {
			console.log(`[ok  ] ${label} ${f}（一致，${a.length}B）`);
			continue;
		}
		drift++;
		if (checkOnly) {
			console.log(`[drift] ${label} ${f}（仓库 ${a.length}B / 已装 ${fs.existsSync(to) ? fs.statSync(to).size + "B" : "缺失"}）`);
			continue;
		}
		fs.writeFileSync(to, a);
		console.log(`[chg ] ${label} ${f} → ${to}（${a.length}B）`);
	}
}

if (checkOnly && drift > 0) {
	console.error(`[install] ${drift} 项与已装副本不一致（跑一次不带 --check 的即可同步）`);
	process.exit(1);
}
if (drift > 0 && !checkOnly) console.log("[install] 完，执行 /reload 生效");
