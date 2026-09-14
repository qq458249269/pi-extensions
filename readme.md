# Pi Extensions

本仓库提供 Pi 的扩展集合。当前推荐并维护的扩展为 `pi-tool-search`，用于按需搜索和激活工具，减少初始工具列表对上下文的占用。

> 注意：本仓库不包含 `lazy` 相关扩展。`lazy` 与 `pi-tool-search`（及 `pi-mcp-adapter` 的按需加载）在工具生命周期管理和激活时序上存在功能冲突，不建议同时使用。

## 扩展列表

### pi-tool-search

`pi-tool-search` 是一个工具代理扩展。它会将所有非核心工具隐藏，仅暴露一个 `tool_search` 工具。模型可以通过搜索来“解锁”所需工具，并在后续轮次中调用它们。

**特点**

- 减少初始工具列表，节省上下文窗口
- 按需搜索和激活工具
- 无需手动维护完整工具清单
- 与 Pi 原生工具系统兼容
- 独立运行，无需额外延迟加载管理器

## 安装

所有扩展统一通过 `pi install npm:<包名>` 安装，Pi 会安装到 `~/.pi/agent/npm/` 并注册到 `settings.json`。**不要**使用 `npm install -g`（不会注册到 Pi，启动时不会加载）。

## 1. 工具增强

- `pi install npm:@khanhicetea/pi-better-tool`
- **功能**：替换内置的 `edit` 工具。当编辑失败时，返回最接近的匹配项和消歧建议，而不是简单要求重读文件，有效减少上下文浪费。

- `pi install npm:@ff-labs/pi-fff`
- **功能**：用基于 Rust 的 SIMD 加速文件查找器替换内置的 `find` 和 `grep` 工具，提供模糊匹配、频率排名和 Git 感知能力，同时优化 `@` 文件提及的自动补全。

## 2. 网络与 MCP

- `pi install npm:pi-web-access`
- **功能**：为 Pi 提供全面的网络访问能力，包括网页搜索、URL 抓取、GitHub 仓库克隆、PDF 提取和 YouTube 视频理解。支持 OpenAI、Brave、Exa、Tavily 等多种搜索源。

- `pi install npm:pi-mcp-adapter`
- **功能**：以极低 token 消耗接入 MCP（模型上下文协议）服务器。用一个约 200 token 的代理工具替代数百个工具定义，仅在需要时按需加载 MCP 服务器。
- **按需加载**：该适配器的 `lifecycle` 字段默认值即为 `"lazy"`，服务器在首次工具调用前不会连接，无需额外配置。如需针对特定服务器调整，可在 `mcp.json` 中设置 `"lifecycle": "lazy"`。

## 3. 安全与质量

> **说明**：以下前三个扩展为社区维护的本地 `.ts` 扩展文件，而非 npm 包。需要手动将文件复制到 `~/.pi/agent/extensions/` 目录下，Pi 启动时会自动加载。

- **`react-lint-hook.ts`** / **`python-lint-hook.ts`** / **`rust-lint-hook.ts`**
- **功能**：在 `edit` 或 `write` 工具操作相关文件后自动运行 Lint 和类型检查。React/TS 文件执行 `lint && typecheck`，Python 文件执行 `ruff check && pyright`，Rust 文件执行 `cargo clippy`，并将错误反馈给 Agent 自动修复。
- **来源**：`https://github.com/kksimons/pi-config`

- **`filter-output.ts`**
- **功能**：在工具结果发送给模型前进行过滤和脱敏，可移除源代码注释、编译噪音和测试冗余信息，在保留关键信息的同时大幅减少 token 消耗，并自动脱敏 API 密钥、令牌等敏感信息。
- **来源**：`https://github.com/michalvavra/agents/blob/main/agents/pi/extensions/filter-output.ts`

- **`security.ts`**（即 `bash-guard` 类扩展）
- **功能**：拦截 `bash` 工具调用，执行确定性的安全策略检查，阻止危险的 bash 命令（如 `rm -rf`、`chmod 777` 等），保护系统安全。
- **来源**：`https://github.com/michalvavra/agents/blob/main/agents/pi/extensions/security.ts`

## 4. 效率与监控

- `pi install npm:pi-tps`
- **功能**：在每次 Agent 回合后显示模型输出速度（TPS）、首 token 延迟（TTFT）、停顿检测、token 使用量和成本等信息，方便评估 Agent 的工作效率。
- **安装后必须配置主题**：pi-tps 刚装好时 `colorPreset` 默认为 `mono`，小部件颜色不跟随 pi 主题。需改为 `theme`（跟随 pi 主题），同时把 `settings.json` 的 `theme` 设为 `light/dark`（跟随系统亮暗），否则终端切换外观时小部件颜色错乱。

  一键自动化（幂等，可重复执行，同时改 `pi-tps.json` 的 `colorPreset` 和 `settings.json` 的 `theme`）：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File fix-tps-theme.ps1
  ```

  等效手动操作：`/pi-tps` 命令选 `theme (follow terminal theme)`，`/settings` 中把主题设为 `light/dark`。修改后重启 Pi 生效。

- `pi install npm:pi-cache-graph`
- **功能**：提供 `/cache graph` 和 `/cache stats` 等命令，可视化显示缓存命中率随时间的变化，以及每条消息的 token/缓存分解，可用于调试哪些扩展影响了上下文缓存效率。

## 5. 任务管理

- `pi install npm:@xzzpig/pi-goal-x`
- **功能**：为 Pi 增加持久化的长期目标模式。支持 `/goal-set` 起草目标、结构化任务列表与子任务、Sisyphus 步骤门控、`autoContinue` 自动继续，以及编辑器上方的状态覆盖层。
- **注意**：`pi-goal-x` 有多个社区分支（`@aalalice233/pi-goal-x`、`@fractaal/pi-goal-x` 等），`@xzzpig/pi-goal-x` 是维护较活跃且包含 TUI 覆盖层保护的版本，建议优先使用。

- `pi install npm:@juicesharp/rpiv-todo`
- **功能**：为模型提供可见的任务列表。新增 `todo` 工具和 `/todos` 命令，并在编辑器上方渲染实时面板，显示当前正在执行、已完成和排队中的任务，支持 `blockedBy` 依赖跟踪。
- **注意**：该包已从 monorepo 迁移，npm 包名保持不变，安装方式无需调整。

- `pi install npm:@cr1ms0n/pi-subagent`
- **功能**：独立子代理（subagent）扩展（Luke Parke 原版 `@parke.dev/pi-subagent` 的社区 fork，新增显式模型策略与 TUI 显示真实模型）。将调研、并行探索、审查等任务委派给隔离的 Pi 子进程，主上下文不被打扰。核心能力包括：
  - **工具**：`subagent`（单任务/并行任务、后台运行、`max_turns`/`max_cost` 预算、`output_schema` 结构化输出、`resume` 会话续跑、`context: "fork"` 上下文分支、`steer` 中途引导、`max_retries` 模型回退重试）。
  - **命令**：`/subagents`（TUI 检视器）、`/subagent-cost`（父子代理成本账本）、`/btw`（旁路提问，答案不进入 LLM 上下文）。
  - **Profile**：`explore`（只读，并行调研默认）、`review`（只读审查）、`general`（可写）；`isolation: "worktree"` 支持并行写任务 + diff/apply/discard 循环。
  - **配置**：spawn 路由仅由用户拥有 `~/.pi/subagent.json` 的 `modelPolicy` 决定，无该文件时新建任务会被拒绝。最小模板：
  ```json
  {
    "modelPolicy": {
      "default": {
        "model": "<provider/model-id>",
        "fallbackModels": [],
        "thinking": "medium"
      }
    }
  }
  ```
  每次任务必须显式传与策略严格匹配的 `model` 字段。
- **注意**：安装后需重启 Pi 加载新工具；`~/.pi/subagent.json` 在每次派发时重新读取。可选使用 `codex`/`claude` CLI 作为子代理后端（需在 PATH 中）。

## 6. 持久记忆

- `pi install npm:pi-hermes-memory`
- **功能**：为 Pi 提供跨会话的持久化记忆，解决 Agent 关闭会话后“失忆”的根本问题。核心能力包括：
  - **持久记忆**：将事实、偏好、修正保存到 Markdown 文件（`MEMORY.md`、`USER.md`），跨会话保留。
  - **会话搜索**：基于 SQLite FTS5 对所有过往对话进行亚毫秒级全文搜索，支持 `session_search` 工具。
  - **失败记忆**：分类存储“什么没有成功以及为什么”，避免重复犯错。
  - **过程技能**：将解决问题的方法保存为可复用的 `SKILL.md` 文档，由 Pi 原生技能系统管理。
  - **后台学习**：每 10 轮对话或 15 次工具调用自动审查并保存值得注意的事实。
  - **纠错检测**：当你纠正 Agent 时立即触发保存，防止同类错误再次发生。
  - **秘密扫描**：每次写入前扫描内容，阻止 API 密钥、令牌和提示词注入被持久化。
  - **双层记忆**：全局记忆（`~/.pi/agent/pi-hermes-memory/`）与项目级记忆（`~/.pi/agent/projects-memory/<project>/`）分离，均可独立搜索。
- **低 token 注入**：默认 `memoryMode: "policy-only"`，系统提示词仅注入记忆使用策略，具体内容由工具按需搜索，避免将全部历史塞入上下文。
- **首次配置（推荐）** ：安装后运行以下命令完成初始化：
  - `/memory-index-sessions` — 索引过往会话，使其可被搜索。
  - `/memory-sync-markdown` — 将旧的 Markdown 记忆回填到 SQLite 搜索库（可选）。
  - `/learn-memory-tool` — 了解记忆工具的使用方式。
- **注意**：该扩展在 `session_start` 时自动激活，无需额外的手动 Lazy Load 配置。

## 7. 代码智能

- `pi install npm:@qualisero/pi-agent-scip`
- **功能**：集成 SCIP（Sourcegraph 代码智能协议）索引器，为 Python 和 TypeScript/JavaScript 项目提供编译器级精确的代码导航。支持 `scip_find_definition`（定位符号定义）、`scip_find_references`（查找所有引用）、`scip_list_symbols`（列出文件中的符号）等工具。
- **注意**：不要手动 `npm install -g` 后创建符号链接（symlink 的相对导入会相对 symlink 所在目录解析，导致启动报 `Cannot find module './extension.js'`），直接 `pi install npm:@qualisero/pi-agent-scip` 即可。

- `pi install npm:@ian-pascoe/pi-lsp`
- **功能**：为 Pi 提供语言服务器协议（LSP）集成，暴露诊断、跳转定义、悬停、引用、符号等工具，并在 `edit`/`write` 后自动运行诊断反馈给 Agent。与 `toolSearch.alwaysEnabled` 中的 `"lsp"` 对应。
- **配置**：不捆绑任何语言服务器二进制，需在 `settings.json`（全局）或项目 `.pi/settings.json`（受信任）的 `lsp` 键下手动配置各语言 server，例如 TypeScript 用 `pnpm exec tsc --lsp --stdio`、Python 用 `pyright` 等，并指定 `languages.extensions` 与超时参数。
- **注意**：仅读取 `lsp` 键；未配置的快捷键静默失效。安装后重启 Pi 生效。

## 8. 电脑操作

- `pi install npm:@injaneity/pi-computer-use`
- **功能**：让 Agent 拥有“眼睛和手”，可以观察屏幕、查找 UI 元素，并通过原生鼠标/键盘事件与任何应用交互。适用于从 Pi 启动、测试和调试 GUI 应用程序。
- **安装后配置**：安装后需启动 Pi 并完成平台设置流程。在 macOS 上，需要手动授予**辅助功能（Accessibility）** 和**屏幕录制（Screen Recording）** 权限。默认的辅助应用位于 `~/Applications/pi-computer-use.app`。

## 9. 按需工具加载

- `pi install npm:pi-tool-search`
- **功能**：将所有工具隐藏在 `tool_search` 工具背后。Agent 在需要时按名称启用工具，避免为很少使用的工具加载完整的工具 schema，从而减少 prompt 上下文和 token 消耗。核心工具（`read`、`write`、`edit`、`bash`、`grep`、`find`）默认启用。
- **配置**：在 `settings.json` 中添加 `toolSearch` 配置块：

```json
{
  "toolSearch": {
    "alwaysEnabled": ["lsp", "grep", "find"],
    "showToolSearchFooterStatus": true
  }
}
```

`alwaysEnabled` 用于指定除默认核心工具外需要预先解锁的工具名称。未知名称会被静默忽略，直到该工具出现在 manifest 中。该配置在每个 `session_start` 时读取，修改后下次会话生效。

---

## 安装后操作

1. 完成上述所有安装和配置后，**重启 Pi** 以使所有更改生效。
2. 对于 `pi-computer-use`，首次启动时需完成平台权限授予流程。
3. 对于 `pi-hermes-memory`，首次使用建议依次运行 `/memory-index-sessions` 和 `/memory-interview`，前者索引历史会话，后者预填用户画像。
4. 本地 `.ts` 扩展文件放入 `~/.pi/agent/extensions/` 后，Pi 启动时会自动加载；如需热重载，可使用 `/reload` 命令。
