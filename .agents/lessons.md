# 技术经验

- 应用图标：electron-builder portable 默认从 application icon 取图标；win.icon 和 BrowserWindow.icon 都需配置。
- 不签名不等于禁止资源编辑：signExecutable=false 保留图标编辑，signAndEditExecutable=false 则连图标也跳过。
- Windows ICO group 用 0 表示 256px；验证嵌入资源时需规范化该字段，再逐帧比较内容。
- 通过 PE 资源和 WM_GETICON 验证图标，比仅看资源管理器缓存可靠。

- Material Tailwind 统一：安装库不会让原生 button 自动具有 ripple，应直接使用组件；浅色 outline 的 ripple 颜色也需核对。
- beta.24 Checkbox 的 checked 不能用逻辑 OR 合并，必须用 nullish 合并以支持受控 false；disabled 需要传给实际 input。
- Radio/Checkbox 的 display:none 会消除键盘焦点和无障碍语义，透明覆盖 input 可保留原生行为。通过 pnpm patch 固定修复，不能手改 node_modules 后遗漏发布。
- 更换依赖 patch 后 Vite 可能保留旧优化缓存，浏览器验证前用 --force 重启。

- Electron 改造：库依赖选择 libSQL 本地适配器，避免原生模块与 Electron ABI 重编译耦合；实际打包进程验证后再交付。
- SQLite：生成 SQL 的 JSON 默认值需检查，裸 {} 会导致初始化失败；真正创建本地库进行验证。
- 设备直连：同一联系人历史可能分布在两方主机，不能只查询当前连接目标的会话。
- 设备标识不是认证秘密，必须绑定历史密钥；IP 复用和昵称修改不能改变历史归属。
- 测试进程 signalCode 非空时也表示已退出，不能只看 exitCode，避免清理重复等待。

- P4：确认内容必须携带明确方案版本，后台权限与版本检查不能交给分类模型。
- P4：取消请求可与阶段更新竞争，应读最新版本并有限重试，迟到结果受 revision 保护。
- P4：Codex JSONL 包含工具事件，必须提取完成的最终 assistant JSON 并再次校验，不能解析整段 stdout 为分析结果。
- P4：本机 MCP 配置不兼容会在分析前失败；整表子进程覆盖可隔离外部工具而不改认证模型配置。
- P4：所有确认意见需要完整有界上下文，包括 Agent 上次提问；超限失败优于静默遗漏或截断方案。

- P3：空 update 的 Prisma upsert 不应当作无条件原生 ON CONFLICT；并发幂等加入使用 createMany(skipDuplicates) 并验证每个请求成功。
- P3：Socket 的事件到达顺序不等于异步数据库操作完成顺序，join/leave 需序列化；前端过期 ack 不能再退出新订阅。
- P3：实时事件和补历史并行时，应在入房前冻结断线前游标，不能使用已被新事件推进的列表末尾。
- P3：UUID 文本需统一大小写，数据库相等不代表字符串房间/锁键相等。
- P3：HTTP LAN 页面使用 getRandomValues 生成 UUID，不能假设 randomUUID 可用。
- P3：数据库故障注入应断言零广播；浏览器发送超时测试应观察相同重试标识与单条结果。

- P2：数据库生成类型跨 workspace 导出时显式使用共享 DTO，避免 TS2742。
- P2：UI beta 的 Button 可用不代表 Checkbox 可用；应检查真实 DOM、键盘焦点、受控 false 和保存失败恢复。
- P2：并发唯一性必须在数据库仲裁，实际 8 请求竞争验证了部分唯一索引。
- P2：浏览器测试与 public 数据分离；Windows 强制终止进程后核对并仅清理该次隔离 schema。

- npm 的 latest 标签未必是稳定版；本次 Prisma latest 指向 8.0.0 RC，应核对并固定稳定版本。
- React 主版本兼容性需要同时核对直接和传递 peer，并实际运行页面。Material Tailwind beta.24 的 ranger peer 仍落后于 React 19。
- Tailwind 扫描整个组件库时，即使应用没有使用出错组件，其错误 arbitrary variant 仍可能导致 CSS 压缩失败。本次两种 selector 均已通过构建复现和补丁修复。
- 不用关闭 minify 来掩盖 CSS 语法错误。使用 pnpm patchedDependencies，让重装与 CI 可重现。
- 空 Prisma schema 在 7.10.0 可正常生成；无需增加占位业务模型。
- Windows 下多个 tsc watch 初次输出会触发 tsx 连续重启；内部包的开发条件导出可减少进程数量并统一监听源代码。
- 本机已有 PostgreSQL 时先用 pg_isready 和目标数据库查询区分端口、认证、库不存在问题，不直接启动同端口 Compose。
- 浏览器故障注入后再进行稳定页面控制台检查，分别记录预期连接错误和最终健康结果。

## 2026-09-15：多人会话与托盘

- 邀请历史隔离不能只过滤消息列表；旧游标、未读、首条消息标题、Agent 任务错误与旧任务后续输出都是旁路。边界取权威端串行提交的最后消息，不取客户端时间。
- 多设备工作区必须以每个会话的权威端路由，不能沿用全局 peerId；远端权限失败也不能退回旧缓存并伪装成功。
- Material Tailwind Checkbox 的异步连接选择需要等待成功后检查 checked，CLI 即时 check 会误判；外层不要嵌套 label。新右键菜单使用 Menu 管理焦点与弹出定位。
- Electron close 到托盘需保留 Tray 引用、阻止 close 并 hide；显式退出复用 before-quit shutdown。EGENT_DATA_DIR 同时隔离 userData/单实例锁，防止测试唤起用户已运行实例。
- 小窗口验收要量底部操作按钮而不仅是 dialog 外框；可滚动中部与不收缩的页脚保持主要操作始终可见。

## 2026-09-15：智能参与、授权和头像入口

- 自主发言和代码写权限必须有独立路径：participate 只读返回 shouldReply，confirm API 才持久化 QUEUED 与授权。普通聊天不能成为任务确认或自动扩充范围。
- 自动回复面向整个会话，输入要用全体现有成员的历史可见交集；在途结果还需对消息/成员/开关修订再次比较，避免生成期间加人泄露旧讨论。
- 项目端计算 UI 权限字段，特别是远程访问方也有本机 Owner 身份时。禁用 Switch 之外仍需 RPC 服务校验。
- 头像入口使用显式 composer imperative handle，统一鼠标、键盘和工具按钮的插入逻辑，保留草稿并防重复。

## 2026-09-15：Codex JSON 错误

- codex exec --json 的失败详情可能位于 stdout，stderr 可能为空；非零退出不能只打印 stderr。解析 turn.failed/error 及其嵌套 JSON，优先终止原因而不是元数据 warning。
- 错误日志只输出提取并脱敏的原因，不打印整份 JSONL，避免回显工具内容或提示词。脱敏先于截断；ANSI 清理使用 Node stripVTControlCharacters。
- 默认模型来自用户 Codex 配置，应用不应为绕过版本错误固定或静默切换模型；此次用户只授权错误提示，没有授权升级 CLI。
