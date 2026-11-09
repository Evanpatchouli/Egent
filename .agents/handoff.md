# Egent 交接

## 已完成

0.4.1 错误提示修复已完成：Codex 非零退出解析 stdout 的 error/turn.failed/item.error 和嵌套 JSON，stderr 回退；中文说明、脱敏、长度限制，避免整份 stdout 回显。7 项/组执行器测试、真实已捕获错误回放、构建/lint/format/图标检查通过。未执行 CLI 升级或模型修改；外部 CLI 在任务期间变为 0.154.0。包 release/Egent-0.4.1-x64.exe，见 docs/codex-errors-validation.md。

0.4.0 智能参与与显式任务已完成：默认开启只读自主判断，4 秒去抖/30 秒回复冷却，消息/成员/开关变化丢弃草稿；Switch 仅项目所属人可操作。同事本机 Owner 不授予远端配置权限。@Egent 和点击 Egent 头像只读提问，头像保留草稿防重复并聚焦。任务卡片创建/补充/版本确认/取消，普通文字确认不实施，QUEUED 持久化串行执行。31 项/组测试、权限针对性回归、双端浏览器和发行 Electron 验收通过；见 docs/agent-participation-validation.md。当前包 release/Egent-0.4.0-x64.exe。

0.3.0 多人工作区及托盘已完成：统一所有参与会话按项目设备/路径归组；可选多人邀请与所属人→项目两步创建，支持个人会话；项目不可变、后续邀请 historyAfter 限制，分页/游标/未读/标题/Agent 一致过滤。新增 Material Tailwind Menu 同事列表重连。关闭窗口隐藏到统一图标托盘，打开/双击恢复，退出停止后端。用户明确无需保留旧数据，未主动清空用户目录。23 项/组测试、真实三端 UI 及发行 Electron 后台收信/恢复/退出、图标资源校验通过。当前包 release/Egent-0.3.0-x64.exe；详见 docs/group-validation.md。当前 UI 不再有联系人上下文切换，旧 ProjectPicker 已删除；默认个人会话可直接从第一步跳下一步。

应用图标统一已完成，桌面版本 0.2.2。内置 image_gen 生成深色圆/白色机器人，工程 assets 保存透明 PNG 和多尺寸 ICO。便携 EXE/应用 EXE/窗口/favicon 已统一，PE 资源逐帧及窗口像素验证通过。详情 docs/app-icon.md。

Material Tailwind 控件统一已完成，桌面包升级 0.2.1。Button 显式 ripple，Textarea/Radio/Checkbox/Avatar 统一库组件；Checkbox/Radio 的 beta 问题纳入 pnpm 补丁。实际 ripple 动画、键盘、disabled、双端桌面聊天验证通过，详见 docs/material-components-validation.md。

Electron/SQLite/设备直连改造已完成。当前入口 release/Egent-0.2.0-x64.exe；每设备启动自己的后端与静态前端，本机数据在 %APPDATA%/Egent。17 项/组新体系测试及真实打包 Electron 昵称、连接、消息往返、离线禁用、退出清理通过。详见 docs/desktop-validation.md。

用户已授权删除旧 PostgreSQL 工程文件，相关依赖/schema/迁移/专用测试已移除；历史 P1–P4 记录仅作历史参考，不能按其 PostgreSQL 命令启动当前版本。没有卸载系统 PostgreSQL 或删除其数据。

重要边界：当前 Windows x64、TOFU 密钥信任、约 1.5 秒加密增量同步；未跨设备转发 typing，不做公网穿透。Agent 始终在项目所属设备运行。

P4 已完成：事务 AgentTask、集中状态机、Codex 两阶段执行器、A/B/C、自然语言方案版本确认、取消、恢复和轻量前端状态。默认 38 项/组回归及额外真实只读 analyze 通过。真实 implementation 未在业务目录验收，未改业务工作区。详情 docs/p4-validation.md。

CODEX_COMMAND=codex、CODEX_TIMEOUT_MS=600000 已配置。只运行一个 Server；CLI 继承自己的认证模型，禁用此次调用的 MCP/apps/hooks 等外部能力。开始实施必须匹配数据库身份及当前方案版本。

测试 schema 已清理。自动审批阻止临时目录递归删除，相关文件保留于忽略的 .tmp；没有绕过删除限制。

P3 已完成：会话、参与者、纯文本消息、分页、未读、typing、身份绑定 Socket room 与简化 ChatGPT 客户端。P1/P2/P3 共 23 项/组测试通过，双浏览器验证完成。见 docs/p3-validation.md。

迁移 202609140002_p3_chat 已应用；测试 schema 已清理，public 会话/消息为 0，未塞演示数据。正常端口仍为 3000/5173。P4 尚未开始，先明确 Agent 的消息写入、审批和 workspace 执行规则，保持现有 participant 权限与提交后广播语义。

P2 已完成。新增身份、网络初始化、Codex projects 读取和项目可见性管理。迁移已应用至本机 egent/public，真实 User 为 0 行，首次 Owner 留给用户输入。详见 docs/p2-validation.md；P1 下述 Compose/无表描述是历史记录，当前已删除 Compose 并新增两张表。

默认 localhost API 首次访问是 Colleague。Owner 可按 README 改用 LAN API 地址及 CORS，或明确 NODE_ENV=development + DEV_OWNER=true 进行 loopback 开发初始化。默认 .env 的 DEV_OWNER/TRUST_PROXY 均 false。

P1 基础工程已实现；依赖安装、类型/Lint/构建、Prisma 连接、7 项 HTTP/Socket 测试、真实浏览器开发/生产验证通过。详见 `docs/p1-validation.md` 和根 README。

## 本机配置

- Server 3000、Web 5173。
- 复用 PostgreSQL 5433，数据库 egent，角色 root；凭据在被忽略的根 .env，不复制到记录。
- 未初始化 Git，无提交。
- 可选 Compose 只校验配置，未启动。

## 延续约束

- 本会话禁止 DSH，由主智能体自主完成。
- 只修改 Egent 目录；UTF-8 无 BOM。
- 后续 P2 必须先讨论身份、项目配置读取和可见性需求；不要把 Agent/Codex CLI 执行提前到 P2。

## 已知限制

- Material Tailwind beta.24 有 ranger 的 React 19 peer 警告，所需 Button 已实测；新组件需单独核验。
- 保留 `patches` 中 CSS 修复和锁文件，上游修复后再评估移除。
- P1 无业务表、认证、会话、消息、Agent 或静态站点生产托管。
