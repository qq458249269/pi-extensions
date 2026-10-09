#!/usr/bin/env node
// proper-lockfile 4.1.2 在 jiti interop Proxy 下的崩溃补丁：幂等可重复执行。
// 症状：pi 整个进程崩（uncaught），控制台只留一行
//   TypeError: Proxy handler's 'get' result of a non-configurable and non-writable
//   property should be the same value as the target's property
//   at probe (...\.pi\agent\node_modules\proper-lockfile\lib\mtime-precision.js:6:29)
//   （pi 内嵌 Bun v1.3.14 打印的运行时横幅）
// 根因：lib/mtime-precision.js 把探测到的 mtime 精度用
//     Object.defineProperty(fs, cacheSymbol, { value: precision })
//   挂在 fs 模块对象（= graceful-fs 的 exports）上，之后每次 probe 都读 fs[cacheSymbol]。
//   pi 用 jiti 加载扩展（moduleCache:false + interopDefault:true），jiti 的 interop 会把
//   CJS exports 包成 Proxy：get 陷阱把所有取值缓存进 Map，对 target 上不存在的键
//   （含 Symbol）返回并缓存 undefined。于是——
//     ① 第 1 次 probe：fs[sym] → undefined（顺带被 trap 缓存）；
//        defineProperty 落到 Proxy 的 target 上 → 该属性 non-writable + non-configurable；
//     ② 第 2 次 probe：fs[sym] 命中 trap 缓存 → 仍返回 undefined，与 target 的 'ms' 不等
//        → JSC 抛 Proxy 不变量 TypeError → 未捕获 → pi 死。
//   触发时机 = 同进程内第二次及以后的加锁（settings.json / auth.json / trust.json 落盘、
//   子代理运行期写状态都走这条），所以表现为「subagent 跑着跑着把 pi 带崩」。
//   注意 fs 是不是 Proxy 与锁本身无关：jiti 只是让 proper-lockfile 内部
//   `require('graceful-fs')` 拿到了 interop Proxy 而已。
// 处理：把精度缓存从 fs 对象挪进模块级 WeakMap（以 fs 对象为键），完全不再改写 fs。
//   语义等价（仍是「每个 fs 对象只探测一次」），但对 Proxy 免疫。
// 复现（打补丁前会抛同一行 frame）：
//   node -e "const{createJiti}=require(process.env.USERPROFILE+'/.pi/agent/node_modules/jiti');
//   const j=createJiti(__filename,{moduleCache:false});
//   const g=j('graceful-fs'),m=j('proper-lockfile/lib/mtime-precision.js');
//   m.probe('a.json',g,()=>{}); m.probe('b.json',g,()=>{});"
// 注意：pi update / 重装会覆盖 node_modules，补丁丢失后重跑本脚本即可。
// 用法：node fix-proper-lockfile-proxy.mjs         # 打补丁
//       node fix-proper-lockfile-proxy.mjs --check # 只体检不写

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const agentDir = join(homedir(), ".pi", "agent");
const checkOnly = process.argv.includes("--check");

// 递归找所有已安装的 proper-lockfile 副本（~/.pi/agent 与 ~/.pi/agent/npm 下都可能有）。
function findPackages(dir, out = [], depth = 0) {
	if (!existsSync(dir) || depth > 6) return out;
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name === ".cache") continue;
		const full = join(dir, entry.name);
		if (entry.name === "proper-lockfile") {
			out.push(full);
			continue;
		}
		// 只钻进可能装包的目录，别扫 state/sessions 这类大目录
		if (entry.name === "node_modules" || entry.name.startsWith("@") || depth < 1) {
			findPackages(full, out, depth + 1);
		}
	}
	return out;
}

const PATCHED_MARK = "const precisionCache = new WeakMap();";

const OLD_HEAD = `const cacheSymbol = Symbol();

function probe(file, fs, callback) {
    const cachedPrecision = fs[cacheSymbol];
`;

const NEW_HEAD = `// Cache of the probed mtime precision, keyed by the fs object.
// Upstream stashes this on the fs object itself:
//     Object.defineProperty(fs, cacheSymbol, { value: precision })
// and reads it back with \`fs[cacheSymbol]\`. When \`fs\` is a Proxy whose \`get\`
// trap caches lookups and returns undefined for symbol keys (e.g. jiti's interop
// proxy, which pi uses to load extensions), the property lands on the proxy
// target as non-configurable + non-writable while the trap keeps returning the
// stale undefined. The next read then trips JSC's proxy invariant:
//     TypeError: Proxy handler's 'get' result of a non-configurable and
//     non-writable property should be the same value as the target's property
// Keeping the cache in a WeakMap avoids mutating \`fs\` entirely.
const precisionCache = new WeakMap();

function probe(file, fs, callback) {
    const cachedPrecision = precisionCache.get(fs);
`;

const OLD_SET = `            // Cache the precision in a non-enumerable way
            Object.defineProperty(fs, cacheSymbol, { value: precision });
`;

const NEW_SET = `            // Cache the precision without touching the fs object
            precisionCache.set(fs, precision);
`;

const packages = findPackages(agentDir);
if (packages.length === 0) {
	console.error(`[fail] 没找到任何 proper-lockfile 副本（pi 未安装？）: ${agentDir}`);
	process.exit(1);
}

let patched = 0;
let skipped = 0;
let failed = 0;

for (const pkg of packages) {
	const file = join(pkg, "lib", "mtime-precision.js");
	if (!existsSync(file)) {
		console.error(`[fail] 缺少 lib/mtime-precision.js: ${file}`);
		failed++;
		continue;
	}

	const src = readFileSync(file, "utf8");

	if (src.includes(PATCHED_MARK)) {
		console.log(`[skip] 已打补丁: ${file}`);
		skipped++;
		continue;
	}

	// 上游改了实现（不再往 fs 上挂 Symbol 缓存）→ 本 bug 不存在，无需补丁
	if (!src.includes("cacheSymbol")) {
		console.log(`[skip] 目标代码特征已变（不再用 cacheSymbol 缓存到 fs），无需补丁: ${file}`);
		skipped++;
		continue;
	}

	if (!src.includes(OLD_HEAD) || !src.includes(OLD_SET)) {
		console.error(`[fail] 未找到待替换代码块（包版本可能已变），请手工核对: ${file}`);
		failed++;
		continue;
	}

	if (checkOnly) {
		console.log(`[need] 待打补丁: ${file}`);
		patched++;
		continue;
	}

	const out = src.replace(OLD_HEAD, NEW_HEAD).replace(OLD_SET, NEW_SET);
	writeFileSync(file, out, "utf8");

// 回读校验：既要有补丁特征，也不能残留「把缓存挂到 fs 上」的可执行代码
	//（注释里为了说明根因保留了 Object.defineProperty(fs, cacheSymbol…) 字样，故按行剔除注释再查）
	const verify = readFileSync(file, "utf8");
	const verifyCode = verify
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("//"))
		.join("\n");
	const broken =
		!verify.includes(PATCHED_MARK) ||
		!verify.includes("precisionCache.set(fs, precision)") ||
		verifyCode.includes("fs[cacheSymbol]") ||
		verifyCode.includes("Object.defineProperty(fs, cacheSymbol");
	if (broken) {
		console.error(`[fail] 补丁写入后校验不通过，请手工核对: ${file}`);
		failed++;
		continue;
	}

	console.log(`[done] 已改 WeakMap 缓存（不再往 fs 对象上挂 Symbol）: ${file}`);
	patched++;
}

if (failed > 0) {
	console.error(`[fail] 共 ${failed} 处失败，${patched} 处${checkOnly ? "待打" : "已打"}补丁，${skipped} 处跳过`);
	process.exit(1);
}
console.log(`[ok] 共 ${packages.length} 个副本：${checkOnly ? "待打" : "已打"}补丁 ${patched}，跳过 ${skipped}`);