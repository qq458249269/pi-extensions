#!/usr/bin/env node
/**
 * 子代理体检：查「subagent 能不能真的跑起来」，并在缺配置时补一个最小 agent 定义。
 *
 * 为什么要这个：子代理坏掉时**不报错、不崩**，只是安静地调用失败或什么都不返回，
 * 排查成本很高。本脚本把当初手写复现、试错 6 次才定位的两个坑固化下来：
 *
 *   坑 1：agent 定义目录全都不存在 → `agent` 参数无值可填
 *     @arhen/pi-core-subagent 的 agentfile.ts 里写死：
 *       const AGENT_DIRS = [".agents/agents", ".claude/agents", ".pi/agents"]
 *     只从这三个目录读 .md（frontmatter 的 description 参与按描述匹配）。
 *     三个都缺 → 没有 agent → 调用报：
 *       "Provide one subagent mode: agent+task (single), tasks: [...]..."
 *     症状极具迷惑性：看着像插件坏了，其实是**一个配置文件都没有**。
 *
 *   坑 2：~/.pi/subagent.json 只有 modelPolicy，不锁 model 时会先要求选 model
 *     "2 model(s) available — this session has no model scoping..." 然后卡住。
 *
 * ⚠️ 一条已被实测推翻、不要照抄的旧诊断（2026-10-10 核实）：
 *   「pi.exe 是 bun build --compile 单文件，子代理从 ~/.pi/agent/node_modules 加载
 *     pi-ai 0.87.1，其 dist/utils/json-parse.js 首行是 bare specifier
 *     `import ... from "partial-json"`，而 Bun 编译版不回落到 importer 的
 *     node_modules → 报找不到 partial-json。」
 *   三条前提实测全部不成立：
 *     1. `pi.exe --version` 是 **1.1.0**，而 ~/.pi/agent/node_modules 里是 0.87.1；
 *        且 D:\Agent\pi\dist\ **不存在** → exe 是自包含 bundle，根本不读磁盘那份 0.87.1。
 *     2. 磁盘 0.87.1 那份 json-parse.js 首行是**相对路径**
 *        `"../../../../partial-json/dist/index.js"`，不是 bare specifier。
 *        且 `fd -t f json-parse D:\Agent\pi` **零结果**——该文件不在 1.1.0 里。
 **     3. 实测在 pi.exe 下跑 subagent：**1/1 succeeded**，无任何 partial-json 报错。
 *   结论：子代理此前的故障是坑 1，与 bun/bare specifier 无关。
 *
 * 用法：
 *   node fix-subagent-check.mjs           # 静态体检 + 缺 agent 定义时自动补（幂等、快、不花 token）
 *   node fix-subagent-check.mjs --check   # 只体检，不写盘，有问题 exit 1（CI/自查用）
 *   node fix-subagent-check.mjs --smoke   # 额外真调一次 subagent（~90s + token，依赖模型行为，会偶发假失败）
 *
 * 为什么要分两档：静态检查能**确定性地**抓到真凶（agent 定义目录缺失），且秒出、不花 token。
 * 而冒烟测试必须让模型发一次 tool call（rpc 没有「直接调工具」的命令），受模型行为影响——
 * 实测模型会偶发把 omnify 参数写错（漏 goal），那属于本检测器的噪声而非子代理故障。
 * 故默认不跑；需要确认「此刻真的能调」时显式加 --smoke。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const checkOnly = process.argv.includes("--check");
const wantSmoke = process.argv.includes("--smoke");

/** @arhen/pi-core-subagent/src/agentfile.ts 的 AGENT_DIRS，改上游就会失配。 */
const AGENT_DIRS = [".agents/agents", ".claude/agents", ".pi/agents"];
const PKG_REL = join("npm", "node_modules", "@arhen", "pi-core-subagent");

const results = [];
const pass = (m) => results.push({ ok: true, msg: m });
const fail = (m) => results.push({ ok: false, msg: m });

/**
 * 记一条可被后续修复推翻的失败。
 * 自动修好之后必须用它把旧记录抹掉，否则结尾统计会把「已修好的问题」仍算作失败。
 */
const failFixable = (id, m) => results.push({ ok: false, id, msg: m });
const supersede = (id, m) => {
	const i = results.findIndex((r) => r.id === id && !r.ok);
	if (i >= 0) results[i] = { ok: true, msg: m };
	else pass(m);
};

// ── 1. 插件装没装 ──────────────────────────────────────────────────────────
const pkgDir = join(homedir(), ".pi", "agent", PKG_REL);
const agentfileSrc = join(pkgDir, "src", "agentfile.ts");

if (!existsSync(agentfileSrc)) {
	fail(`@arhen/pi-core-subagent 未安装或路径变了（缺 src/agentfile.ts）: ${pkgDir}`);
} else {
	// 上游若改了 AGENT_DIRS，提醒同步本脚本的常量
	const src = readFileSync(agentfileSrc, "utf8");
	const m = src.match(/const AGENT_DIRS = \[([^\]]*)\]/);
	if (m) {
		const upstream = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
		const same = upstream.length === AGENT_DIRS.length && upstream.every((d) => AGENT_DIRS.includes(d));
		if (same) pass(`AGENT_DIRS 与本脚本一致: ${upstream.join(", ")}`);
		else fail(`上游 AGENT_DIRS 变了 → ${JSON.stringify(upstream)}；本脚本写死的是 ${JSON.stringify(AGENT_DIRS)}，需同步`);
	} else {
		fail("未能从 agentfile.ts 解析出 AGENT_DIRS，上游结构可能已变，请手工核对");
	}
	pass(`插件已安装: ${pkgDir}`);
}

// ── 2. agent 定义目录（坑 1，真凶）─────────────────────────────────────────
// 家目录优先：agentfile.ts 同时扫 cwd 与 home 下的三个子目录
const homes = [process.cwd(), homedir()];
const existingAgentFiles = [];
for (const base of homes) {
	for (const sub of AGENT_DIRS) {
		const dir = join(base, ...sub.split("/"));
		if (!existsSync(dir)) continue;
		let md = [];
		try {
			md = readdirSync(dir).filter((f) => f.endsWith(".md"));
		} catch {
			continue;
		}
		for (const f of md) existingAgentFiles.push(join(dir, f));
	}
}

if (existingAgentFiles.length > 0) {
	pass(`找到 ${existingAgentFiles.length} 个 agent 定义: ${existingAgentFiles.map((f) => f.replace(homedir(), "~")).join(", ")}`);
} else {
	failFixable(
		"no-agent-files",
		`一个 agent 定义都没有 —— 这就是子代理调不起来的真因（不是插件坏了）。\n` +
			`       ${homes.map((b) => join(b, ...AGENT_DIRS[0].split("/"))).join("  或  ")} 都不存在`,
	);
}

// ── 3. subagent.json 的 modelPolicy（坑 2）─────────────────────────────────
const cfg = join(homedir(), ".pi", "subagent.json");
if (!existsSync(cfg)) {
	fail(`缺 ${cfg}：不锁 model 时调用会先要你选 model（"N model(s) available"）然后卡住`);
} else {
	try {
		const j = JSON.parse(readFileSync(cfg, "utf8"));
		const pol = j.modelPolicy ?? {};
		const defaults = Object.entries(pol).filter(([, v]) => v && typeof v === "object" && v.model);
		if (defaults.length === 0) {
			fail(`${cfg} 的 modelPolicy 里没有 default.model —— 子代理无法自动选模型`);
		} else {
			pass(`modelPolicy 已锁定: ${defaults.map(([k, v]) => `${k}→${v.model}`).join(", ")}`);
		}
	} catch (e) {
		fail(`${cfg} 解析失败: ${e.message}`);
	}
}

// ── 4. 真跑一次（唯一能证明「能调用」的一步）──────────────────────────────
// 冒烟任务必须极短，且不依赖任何工具权限；失败只报告，不修。
const SMOKE = "回答：1+1等于几？只回数字，不要调用任何工具。";

/**
 * 起一个 pi rpc 进程，让模型用 omnify 调 subagent（autoAwait 同步等结果）。
 * 返回 { ok, detail }。
 */
/**
 * 起一个 pi rpc 进程，让模型用 omnify 调 subagent（autoAwait 同步等结果）。
 *
 * rpc 没有「直接调工具」的命令（只有 prompt/steer 等），所以必须让模型发一次 tool call。
 * 代价：模型偶发把 omnify 的参数写错（如漏 goal）——那是**本检测器自己**的噪声，
 * 不是子代理的故障。故返回里带 retryable 标记，由调用方重试，不直接判失败。
 */
function smokeTestOnce() {
	return new Promise((resolve) => {
		const exe = process.platform === "win32" ? "pi.exe" : "pi";
		const child = spawn(exe, ["--mode", "rpc", "--no-session"], {
			cwd: process.cwd(),
			stdio: ["pipe", "pipe", "pipe"],
			shell: process.platform === "win32",
			windowsHide: true,
		});
		let buf = "";
		let id = 0;
		const waiters = new Map();
		const sawPartialJsonError = [];
		const rpc = (msg, ms = 120_000) =>
			new Promise((res) => {
				const i = ++id;
				waiters.set(i, (r) => res(r));
				child.stdin.write(`${JSON.stringify({ ...msg, id: i })}\n`);
				setTimeout(() => {
					if (waiters.has(i)) {
						waiters.delete(i);
						res({ __timeout: true });
					}
				}, ms);
			});

		const finish = (v) => {
			try {
				child.kill();
			} catch {
				/* 已退出 */
			}
			resolve(v);
		};

		child.stdout.on("data", (d) => {
			buf += d.toString();
			let i;
			while ((i = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, i).replace(/\r$/, "");
				buf = buf.slice(i + 1);
				if (!line.trim()) continue;
				let rec;
				try {
					rec = JSON.parse(line);
				} catch {
					continue;
				}
				if (rec.id && waiters.has(rec.id)) {
					waiters.get(rec.id)(rec);
					waiters.delete(rec.id);
				} else if (rec.type === "tool_execution_end" && rec.result) {
					const text = JSON.stringify(rec.result.content?.[0]?.text ?? rec.result);
					if (/succeeded/i.test(text)) return finish({ ok: true, detail: text.slice(0, 200) });
					// 明确的子代理配置类报错（非本检测器噪声）
					if (/Provide one subagent mode|model\(s\) available/i.test(text)) {
						return finish({ ok: false, retryable: false, detail: text.slice(0, 200) });
					}
					// 模型把 omnify 参数写错
					// （实测两类：漏 goal、布尔值被写成字符串 "true"）
					if (/must have required properties|Validation failed for tool|expected boolean|参数不符/i.test(text)) {
						return finish({ ok: false, retryable: true, detail: `模型把 omnify 参数写错（非子代理问题），重试: ${text.slice(0, 120)}` });
					}
				}
			}
		});
		child.stderr.on("data", (d) => {
			for (const l of d.toString().split(/\r?\n/)) {
				if (/partial-json|ERR_MODULE_NOT_FOUND|bare specifier/i.test(l)) sawPartialJsonError.push(l.trim());
			}
		});

		(async () => {
			try {
				const st = await rpc({ type: "get_state" }, 30_000);
				if (st.__timeout || !st?.success) {
					return finish({ ok: false, retryable: false, detail: "pi rpc 起不来（get_state 无响应）" });
				}
				await rpc(
					{
						type: "prompt",
						// 不传 autoAwait：模型会把内嵌 JSON 里的 true 改成字符串 "true"，
						// 触发 autoAwait: expected boolean（实测踩过）。改为 subagent 起来后
						// 再调 await_subagent 等结果，或 autoAwait 由模型自己补。
						// goal 也必须显式给：用 tool+args 形式调 lazy 工具时 omnify schema 仍要求 goal。
						message:
							`用 omnify 调 subagent：goal 写「调用 subagent」，tool 写 "subagent"，` +
							`args 里 agent 写 "default"、task 写「回答：1+1等于几？只回数字，不要调用任何工具。」` +
							`（autoAwait 若要传必须是布尔 true，不能加引号）。调完等结果。`,
					},
					120_000,
				);
				await new Promise((r) => setTimeout(r, 60_000));
				return finish({
					ok: false,
					retryable: false,
					detail: sawPartialJsonError.length
						? `出现 partial-json 报错: ${sawPartialJsonError[0].slice(0, 160)}`
						: "90s 内没等到 subagent 成功结果（超时）",
				});
			} catch (e) {
				return finish({ ok: false, retryable: false, detail: `冒烟异常: ${e.message}` });
			}
		})();
	});
}

/** 带重试的冒烟：retryable（模型噪声）最多重试 2 次。 */
async function smokeTest(tries = 3) {
	let last = { ok: false, detail: "未执行" };
	for (let i = 1; i <= tries; i++) {
		last = await smokeTestOnce();
		if (last.ok || !last.retryable) break;
		console.log(`[info] 第 ${i} 次因模型写错 omnify 参数失败，重试…`);
	}
	return last;
}

// ── 5. 修复：补一个最小 agent 定义 ────────────────────────────────────────
const DEFAULT_AGENT_MD = `---
description: 通用子代理。默认继承 leader 的模型与会话配置，适合一次性独立任务。
---

你是一个通用子代理。收到任务后直接完成，用简洁的最终回答汇报结论与关键证据（file:line）。
`;

function writeDefaultAgent() {
	// 放家目录：三处任一都能被扫到，且不污染具体项目仓库
	const dir = join(homedir(), ".pi", "agents");
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "default.md");
	if (existsSync(file)) return file;
	writeFileSync(file, DEFAULT_AGENT_MD, "utf8");
	return file;
}

// ── 输出 ──────────────────────────────────────────────────────────────────
console.log("子代理体检\n" + "─".repeat(60));
let bad = 0;
for (const r of results) {
	if (!r.ok) bad++;
	console.log(`${r.ok ? "[ok  ]" : "[FAIL]"} ${r.msg}`);
}

// --check：只体检；有缺 agent 定义就 exit 1，不写盘
if (checkOnly) {
	console.log("─".repeat(60));
	if (bad > 0) {
		console.error(`[check] ${bad} 项不达标。跑 \`node fix-subagent-check.mjs\` 可自动补 agent 定义。`);
		process.exit(1);
	}
	console.log("[check] 全部达标（未写盘）");
	process.exit(0);
}

// 有缺 agent 定义 → 补（补完要把上面那条 FAIL 抹掉，否则结尾仍会判失败）
if (existingAgentFiles.length === 0) {
	const f = writeDefaultAgent();
	supersede("no-agent-files", `已创建最小 agent 定义: ${f.replace(homedir(), "~")}`);
} else {
	pass("agent 定义已存在，未改动");
}

// 默认不跑冒烟：静态检查已能确定性抓到真因，且快/不花 token。
// --smoke 才额外真调一次（依赖模型行为，会偶发假失败，见文件头说明）。
if (wantSmoke) {
	console.log("─".repeat(60));
	console.log("[info] 冒烟测试：起一个 pi rpc 真调一次 subagent（约 60–90s，要花 token）…");
	const smoke = await smokeTest();
	if (smoke.ok) pass(`冒烟通过（子代理真的跑起来了）: ${smoke.detail}`);
	else fail(`冒烟失败: ${smoke.detail}`);
}

console.log("─".repeat(60));
for (const r of results) {
	if (!r.ok) console.log(`${r.ok ? "[ok  ]" : "[FAIL]"} ${r.msg}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? "\n子代理可用。" : `\n${failed} 项失败，按上面提示处理。`);
process.exit(failed === 0 ? 0 : 1);