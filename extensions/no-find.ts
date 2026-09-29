/**
 * no-find — 全局禁用 `find`，逼模型改用 `fd`
 *
 * 为什么禁：
 *   本机（Windows + Git Bash）`find` 有两个雷：
 *     1. `C:\Windows\System32\find.exe`（cmd/PowerShell 里的那个 FIND.EXE）语法与 GNU find
 *        完全不兼容，`find . -name x` 会被当成 pattern 而**从 stdin 读**→ 表现为「卡死」；
 *     2. Git Bash 的 `/usr/bin/find` 是 GNU find，语法对，但没有 fd 的 ignore/类型/深度过滤，
 *        在大目录树里跑很久（`find .` 从家目录起步能跑几分钟）——同样表现为「卡死」。
 *   两边都被「卡住」这个症状掩盖，容易误判成工具坏了。
 *
 * 本扩展做三件事（都不花 wire token：只注册钩子，不注册工具）：
 *   1. `tool_call` 钩子：bash / powershell 的命令行里出现 `find` 当命令词 → 直接 block，
 *      并把 fd 的等价写法写在 reason 里（模型下一轮就会改）；
 *   2. 同理 block pi-find 注册的 `find` **工具**（它也被 omnify 搜得到）；
 *   3. 兜底扫描：命令里 `find` 只作为路径/参数出现（如 `./find`、`findings.md`）不拦，
 *      但 `xargs find`、`$(find ...)`、管道后的 `| find` 也会拦（分段判定）。
 *
 * 关掉 / 放行：`~/.pi/agent/extensions/no-find.json` 写 `{"enabled": false}` 即整体停用
 *   （默认启用；文件不存在也视为启用）。只想放行个别命令就写
 *   `{"allow": ["find -name *.go"]}`——按「命令词 + 第一个参数」的前缀匹配。
 *
 * pi 之外的全局层（对 cmd / PowerShell / 任何走 Windows PATH 的程序也生效）：
 *   见 readme §4.2 —— `~/bin/find.cmd` 拒答桩 + PATH 前置，`BASH_ENV` 指向 `~/bin/no-find.sh`。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONFIG_PATH = path.join(homedir(), ".pi", "agent", "extensions", "no-find.json");

const REASON = [
	"`find` 已被全局禁用（在本机会假死：cmd/PowerShell 里命中的是 C:\\Windows\\System32\\find.exe，它会从 stdin 读；Git Bash 的 GNU find 在大目录树上极慢）。",
	"改用 `fd`（同一底层、ignore 感知、更快）：",
	'  - fd {pattern:"RULES", extension:"md"}        # 正则匹配整条路径 + 限定扩展名',
	'  - fd {type:"directory", maxDepth:2}           # 只列目录、限深度',
	'  - fd {changedWithin:"1d"}                     # 最近改过的（find 做不到）',
	"  - bash 里直接写 fd / fdfind（等价于 find 的路径匹配，如 `fd -e ts`）",
	"  - 找文件内容用 grep 工具，别用 find。",
].join("\n");

interface NoFindConfig {
	enabled?: boolean;
	allow?: string[];
}

/** 读配置；坏文件按「启用」处理（宁可多拦也不要静默失效）。 */
function loadConfig(): NoFindConfig {
	try {
		return existsSync(CONFIG_PATH) ? (JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as NoFindConfig) : {};
	} catch {
		return {};
	}
}

/**
 * 把一条命令拆成「候选命令段」：按 `;` `|` `&&` `||` 换行切，并把 `$( )` / 反引号里的
 * 子 shell 内容**递归**摊出来（`echo $(find .)` 里的 find 也是 find）。
 */
function* commandSegments(command: string): Generator<string> {
	const inner: string[] = [];
	const outer = command
		.replace(/\$\(([^()]*)\)/g, (_m, body: string) => {
			inner.push(body);
			return " ";
		})
		.replace(/`([^`]*)`/g, (_m, body: string) => {
			inner.push(body);
			return " ";
		});
	for (const body of inner) yield* commandSegments(body);
	for (const part of outer.split(/[;\n|]|&&|\|\|/)) yield part;
}

/**
 * 判断命令行里有没有把 `find`（或 Windows 的 `find.exe`）当命令用。
 * 逐段看首个词（剥掉 sudo/env/xargs/重定向等包装）。命中返回该段的可读片段，没命中返回 null。
 *
 * 故意不拦：路径里的 find（`./find`、`findings.md`）、数据里的字面量
 * （`grep "find me"`、`echo find`）、以及 `fd` / `fdfind`（名字不同）。
 */
export function detectFindCommand(command: string): string | null {
	for (const raw of commandSegments(command)) {
		let segment = raw.trim();
		if (!segment) continue;
		// 跳过前导包装器与重定向：sudo / command / env VAR=1 / nohup / xargs / 2>/dev/null
		let guard = 0;
		while (guard++ < 6) {
			const before = segment;
			segment = segment.replace(/^(&|\(|)\s*/, "");
			segment = segment.replace(
				/^(?:sudo|command|env|nohup|time|xargs|exec|eval|then|do|else)\b\s*(\w+=\S+\s+)*/,
				"",
			);
			segment = segment.replace(/^\d*>>?\s*\S+\s*/, ""); // 重定向在前
			if (segment === before) break;
		}
		segment = segment.trim();
		if (!segment) continue;
		const first = /^("[^"]*"|'[^']*'|\S+)/.exec(segment)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
		const base = first.split(/[\\/]/).pop() ?? "";
		// basename 精确匹配：find / find.exe 命中；fdfind / find-utils / findings 都不命中
		if (base !== "find" && base.toLowerCase() !== "find.exe") continue;
		return segment.length > 120 ? `${segment.slice(0, 120)}…` : segment;
	}
	return null;
}

export default function noFind(pi: ExtensionAPI): void {
	const config = loadConfig();
	if (config.enabled === false) return;

	const allowed = (config.allow ?? []).map((rule) => rule.trim()).filter(Boolean);
	const isAllowed = (segment: string): boolean => {
		const key = segment.split(/\s+/).slice(0, 2).join(" ").replace(/^["']|["']$/g, "");
		return allowed.some((rule) => key === rule || key.startsWith(`${rule} `));
	};

	pi.on("tool_call", (event) => {
		// 1) pi-find 注册的 find 工具
		if (event.toolName === "find") {
			return { block: true, reason: REASON };
		}
		if (event.toolName !== "bash" && event.toolName !== "powershell") return;
		const command = String((event.input as { command?: unknown }).command ?? "");
		const hit = detectFindCommand(command);
		if (!hit || isAllowed(hit)) return;
		return { block: true, reason: `${REASON}\n\n被拦的命令：${hit}` };
	});
}
