#!/usr/bin/env node
// pi-agent-browser-native 在 pi 0.85.x 上的兼容补丁：幂等可重复执行。
// 症状：/reload 时报
//   Extension "...\pi-agent-browser-native\dist\extensions\agent-browser\index.js" error:
//   ctx.sessionManager.buildSessionProjection is not a function.
// 根因：0.7.1 的 dist/extensions/agent-browser/lib/tool-surface.js 在 session_start 里调用
//   ctx.sessionManager.buildSessionProjection().messages
//   —— 该 API 属于 pi >= 0.86；本机 pi 0.85.1 的等价物是 buildSessionContext()
//      （docs/session-format.md「Instance Methods - Context & Info」→ 返回 { messages, thinkingLevel, model }）。
// 处理：改为「新版优先 / 旧版回退」双路取 messages，整体 try/catch 兜底——取不到就原样 return
//      （advanced 工具不自动恢复、active 集不动），绝不让扩展在加载期抛错。
// 注意：pi update / 重装该包会覆盖 dist，补丁丢失后重跑本脚本即可。
// 用法：node fix-browser-native-compat.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const file = join(
	homedir(),
	".pi",
	"agent",
	"npm",
	"node_modules",
	"pi-agent-browser-native",
	"dist",
	"extensions",
	"agent-browser",
	"lib",
	"tool-surface.js",
);

if (!existsSync(file)) {
	console.error(`[fail] 目标文件不存在（pi-agent-browser-native 未安装？）: ${file}`);
	process.exit(1);
}

const src = readFileSync(file, "utf8");

if (src.includes("buildSessionContext?.().messages")) {
	console.log("[skip] 兼容补丁已生效（buildSessionProjection / buildSessionContext 双路回退）");
	process.exit(0);
}
if (!src.includes("buildSessionProjection")) {
	console.log("[skip] 目标代码特征已变（未找到 buildSessionProjection），无需补丁或请手工核对");
	process.exit(0);
}

const OLD = `        const { getCurrentSystemMessage } = await import("@earendil-works/pi-ai");
        const current = getCurrentSystemMessage(ctx.sessionManager.buildSessionProjection().messages);
        const restored = new Set(current?.toolsAdded?.map(({ name }) => name));
`;

const NEW = `        let restored = new Set();
        try {
            const { getCurrentSystemMessage } = await import("@earendil-works/pi-ai");
            // pi >=0.86: buildSessionProjection(); pi 0.85.x: buildSessionContext(). Guarded so a
            // host API gap degrades to "no advanced tools restored" instead of failing the load.
            const sm = ctx.sessionManager;
            const messages = typeof sm?.buildSessionProjection === "function"
                ? sm.buildSessionProjection().messages
                : (sm?.buildSessionContext?.().messages ?? []);
            const current = getCurrentSystemMessage(messages);
            restored = new Set(current?.toolsAdded?.map(({ name }) => name));
        }
        catch (error) {
            return;
        }
`;

if (!src.includes(OLD)) {
	console.error("[fail] 未找到待替换代码块（包版本可能已变），请手工核对");
	process.exit(1);
}

writeFileSync(file, src.replace(OLD, NEW), "utf8");
console.log("[done] pi-agent-browser-native 兼容补丁已应用（buildSessionProjection -> 双路回退）");
