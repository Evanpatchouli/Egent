# P3 验证记录

日期：2026-09-14。主智能体直接完成，未使用 DSH、子智能体或 Git 提交。项目保持裸 PostgreSQL 5433，不启动数据库容器。

## 实现与迁移

新增 Conversation、ConversationParticipant、Message，保留 P2 User、ProjectSetting 和单一 Owner 的部分唯一索引。migration `202609140002_p3_chat` 已实际应用；重复 deploy 无待迁移项。

创建者与 participant 同时建立，Owner 进入时幂等加入，同事不能加入陌生会话。USER 消息有发送者和 clientMessageId 的 CHECK 及幂等唯一索引；消息索引覆盖 conversationId/createdAt/id。外键 NoAction 与版本化 SQL 保持一致，无删除接口或软删除字段。

HTTP 和 Socket 使用相同权限/写入服务，事务内序列化同一会话的写入，提交后才广播。项目可见性和当前 Codex 列表只限制新建；历史读取和发送依据会话参与权限。

## 命令结果

| 检查                           | 实际结果                                                 |
| ------------------------------ | -------------------------------------------------------- |
| pnpm install --frozen-lockfile | 通过，未增加运行时依赖                                   |
| pnpm db:migrate                | 新迁移应用成功，复跑无待迁移项                           |
| pnpm db:generate / db:validate | Client 生成成功、schema valid                            |
| pnpm db:check                  | Prisma SELECT 1 成功                                     |
| pnpm typecheck / lint          | 通过                                                     |
| pnpm format:check              | 通过                                                     |
| pnpm build                     | 四个 workspace 构建成功，Vite 默认 CSS 压缩开启          |
| pnpm test:smoke                | P1 7 项通过                                              |
| pnpm test:p2                   | P2 7 组通过，真实 Codex 项目读取为 54 条                 |
| pnpm test:p3                   | P3 9 组通过                                              |
| 编译后后端启动                 | 临时 3105 启动成功，health 返回 ok，匿名会话查询返回 401 |
| UTF-8 无 BOM                   | 本次项目文本文件检查通过                                 |

P1/P2 回归保留原 HTTP、身份、项目可见性和 Socket ping/pong 行为。最终临时编译服务已停止，正常开发服务仍使用 3000/5173。

## P3 九组集成测试

测试创建独立 schema 并依序执行全部 migration，不向 public 写测试身份或会话。

1. 创建权限、项目不存在/隐藏拒绝、创建者 participant、Owner 全部列表、无关同事空列表，以及未参与 Owner 发送被拒。
2. 同事详情/历史/join/send 越权拒绝，匿名 Socket 事件拒绝；8 个并发进入全部成功且只保留一个 Owner participant；大写 UUID 规范化房间；不存在会话 404。
3. 快速 leave/join 最终保持最后请求的房间状态。
4. HTTP 与 Socket 并发重试同一 clientMessageId，只生成一条 USER 消息、广播一次；完整 sender 不含 identifier；首条 USER 自动标题；同键不同内容 409；伪造 AGENT 和空/超长消息被拒。
5. 在隔离表添加临时拒绝 CHECK，实际数据库插入失败：返回错误，零消息广播、零持久化行。该测试产生的数据库错误日志属于预期故障注入。
6. Owner 未读与读取确认，旧游标不能回退读取边界，无效消息 ID 被拒。
7. 112 条含同时间戳数据的稳定分页，跨页无重复/遗漏；limit 越界、其他会话游标拒绝；断线后 after 游标取得遗漏消息。
8. typing 开始/停止只在房间内可见，无关同事失败，leave 后不再收到房间消息。
9. 项目隐藏/删除配置后不能新建，但历史列表、查看和发送继续正常；甚至配置文件缺失也不阻断已有会话详情。

## 双浏览器实测

使用 Playwright CLI + Microsoft Edge 的两个独立身份环境、同一个聊天服务。临时后端 3101/3102、前端 5181，数据放独立 schema，项目列表为中文/空格路径夹具。

- 同事“新聊天 → 选择项目 → 开始聊天”实际完成，项目选择仅显示开放项目；Owner 无需打开会话就收到侧栏新会话及未读更新。
- 同事第一条需求自动成为标题。Owner 打开后未读清除，参与者只增加一次。
- 双方实际 Enter 发送，另一端无需刷新即可看到完整消息。界面显示 Egent 系统、同事、Owner 三种头像，不生成 Agent 回复。
- 切换到另一个项目会话时，原会话新消息不进入当前聊天区，仅更新侧栏未读；切回后加载消息。最近活跃项目组移至顶部。
- Shift+Enter 保留换行；模拟 compositionstart/Enter/compositionend 时输入法组合不会误发。
- `<b>按纯文本展示</b>` 保持文本，没有创建 b 元素。
- 关闭浏览器当前 Socket 传输并将该页面离线，在另一端通过实际消息 API 写入，再恢复网络：重连自动补齐，目标消息只出现一次。
- 丢弃首次 message:send 网络帧，等待 8 秒确认超时后点击“重试发送”：捕获的两次尝试使用相同 clientMessageId，最终仅显示一条消息。
- 最近历史首次严格 50 条，点击“加载更早消息”扩展至 70 条；原滚动锚点偏移约 -0.28px，没有跳回底部。
- 验证 390×844 窄屏，输入区可见、无横向溢出的视觉问题，页头提供侧栏开关。
- 稳定页面检查：Owner 和同事均为 0 errors / 0 warnings。离线/故障测试期间出现过预期网络错误，恢复并刷新后的检查与之分开记录。

截图保存在本机忽略目录：`output/playwright/p3-chat-desktop.png`、`output/playwright/p3-chat-mobile.png`。交互快照同目录保留；高级故障注入脚本在 `.tmp/p3-*-check.js`，均不编入生产代码。

## 发现并修复

- Prisma 空 update 的 upsert 在并发 Owner 进入时出现 P2002：先增强测试复现失败，再改为 createMany(skipDuplicates)，由数据库 ON CONFLICT DO NOTHING 仲裁。
- 双浏览器发现消息落库且未读更新，但聊天区未收到广播：房间 join/leave 的异步校验与 StrictMode 清理发生顺序竞争。按 socket 串行执行 membership 操作，取消过期回调的二次 leave；双浏览器重新验证往返成功。
- 重连时先冻结离线前游标，再进入房间并补历史，防止新到的实时消息提前推进补齐起点。
- UUID 统一小写，防止同一数据库 UUID 的不同文本大小写形成不同房间或 advisory lock 键。
- 客户端 UUID 使用 getRandomValues，避免 HTTP LAN 上 randomUUID 不可用。没有引入 UUID 依赖。
- 加载更早消息使用高度差保留滚动锚点；消息切换重新挂载历史视图，待发送记录由上层 outbox 保留。

## 数据与验证边界

- 两个浏览器夹具 schema 已明确清理；正式 public.Conversation 与 public.Message 均为 0 行，未留下演示数据。没有删除或覆盖真实 P2 身份/设置。
- 当前是单 Node 进程、进程内通知；不含分布式事件投递。提交后进程退出而未广播的消息靠重连历史恢复。
- 消息重试在页面存活期间保留；刷新或关闭页面不会保留未确认 outbox/输入草稿，已落库消息仍在数据库。
- 本次浏览器是同机两个独立身份环境，并非两台物理 LAN 设备；窄屏为浏览器视口模拟，未实测手机软键盘。
- 输入法验证为组合事件模拟，不声称覆盖所有操作系统输入法。后台可见性判断已有代码，未单独模拟所有浏览器后台节流行为。
- 项目来源/可见性按创建请求检查时的状态判断，未将文件与数据库变更做跨资源事务。
- 未测大规模长年会话列表性能；消息历史已分页，侧栏会话列表尚未分页。
- P2 可逆 identifier 仍不是防冒用认证令牌。P3 不引入密码/JWT/OAuth。
- P4、Codex CLI、AgentTask、A/B/C、附件、Markdown、删除和邀请同事接口均未提前实施。

## 修改文件

- 根 package.json：test:p3；README.md：P3 使用、权限、事件和边界。
- packages/database/prisma/schema.prisma；新增 migrations/202609140002_p3_chat/migration.sql。
- packages/shared/src/index.ts；新增 src/chat.ts。
- apps/server/package.json、src/app.ts、src/socket/index.ts；新增 src/socket/chat.ts、src/routes/conversations.ts、src/services/conversations.ts、messages.ts、chat-events.ts。
- apps/server/test/browser-fixture.ts：应用全部 migrations；新增 test/p3.test.ts。
- apps/web/src/App.tsx、styles.css、components/ProjectPanel.tsx：接入聊天并复用设置。
- 新增 apps/web/src/api/chat.ts；hooks/useChatConnection.ts、useConversationMessages.ts、useOutbox.ts。
- 新增 apps/web/src/components/chat/ChatShell.tsx、ConversationSidebar.tsx、ConversationView.tsx、ProjectPicker.tsx、MessageList.tsx、Composer.tsx。
- docs/p3-validation.md 及 .agents 计划、归档、交接、决策、经验/修复记录。

未改变技术栈或运行时依赖，未重写 P1/P2。启动与 API 详情见根 README。
