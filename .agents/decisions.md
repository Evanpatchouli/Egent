# 架构决策

## 2026-09-15：Electron 设备直连

- 用户批准用 SQLite 替代 PostgreSQL，随后授权删除旧 PostgreSQL 工程文件；未卸载本机服务或删除旧数据库数据。
- Electron utilityProcess 自动启动每设备后端，静态前端由本机服务提供，同一发行包不要求 Node/数据库安装。
- MachineGuid 应用域 hash 作为设备 ID，Ed25519 密钥验证联系人；昵称/IP 不作为身份。本机 Owner 与远端 Colleague 分开。
- 后端直连以签名挑战、临时 X25519 和 AES-GCM RPC 保护业务数据；首次信任 TOFU，历史密钥不匹配不自动接受。
- 项目设备是会话/Agent 权威；本地 RemoteSnapshot 只作副本。约 1.5 秒增量同步，前端沿用本机 Socket.IO。
- 同一联系人聚合双方项目主机上的历史。对方项目路径不成为本机 Codex workspace。
- 发布 Windows x64 portable，暂无签名/公网穿透；使用原生本地 SQLite，无独立数据库服务。

## 2026-09-15：P4

- AgentTask 与 USER 消息同事务创建/关联；触发唯一和 active 部分唯一索引由 PostgreSQL 保证。
- AgentService 在后端进程内单 CLI 执行，等待状态和消息游标全部在 DB，不用内存等待确认。
- 模型只判断语义；事务内校验当前方案版本、确认消息、请求者/Owner 和参与权限后才可进入 IMPLEMENTING。
- 自然语言确认复用聊天，不新增 confirm API；查询和 cancel API 保持最小。
- 真实 executor 使用 exec/stdin/JSON schema/read-only 或 workspace-write，禁用外部工具和 bypass；继承本机认证模型，不持有 API key。
- 用 mcp_servers={} 临时覆盖本机不兼容 MCP 配置，不改用户文件。
- ANALYZING 重启回 PENDING，IMPLEMENTING 中断标失败，不自动重复写代码。
- 元数据只保存有界结构化方案/确认/结果；AGENT 消息同事务提交后复用 P3 广播和未读。

## 2026-09-14：P3

- 三张会话表，不另建 Project 或已读表；保留 Owner 部分唯一索引。
- 同事权限基于 participant，Owner 查看所有并在进入时加入；项目可见性/配置删除只控制新建。
- HTTP/Socket 共用事务消息服务；advisory lock 串行同会话写入，幂等键去重，提交后进程内通知。
- createdAt + UUID 稳定分页，写入时间单调递增；已读边界必须来自该会话实际消息，不信任客户端时间。
- Socket 身份绑定，匿名仅保留 P1 ping；会话房间按每 socket 顺序处理 join/leave。用户房间只发侧栏刷新提示。
- 历史视图按会话重挂载，outbox 位于上层以支持切换后重试，重连冻结旧游标补齐。
- P3 只产生 USER/SYSTEM，Egent 不自动回复，AGENT 仅类型预留。未增加运行时依赖。

## 2026-09-14：P2

- 按批准方案实施 User 和 ProjectSetting，Owner 部分唯一索引放版本化 migration。
- 不另建项目注册表，smol-toml 只读 Codex projects；设置只控制可见性。
- IP 初始化按私有实体网卡实际子网判断；默认不信任代理，loopback 默认 Colleague；后续角色来自 identifier 对应数据库行。
- API 保持一个小型 P2 router 和两个服务文件，未为了原计划文件列表拆出空的 middleware/repository 层。
- 前端以 IdentityDialog 和 ProjectPanel 组织界面；beta Checkbox 采用原生可访问替代，未引入新框架。
- 按本阶段要求删除可选 Compose 数据库配置，复用裸 PostgreSQL。
- P2 测试和浏览器验证使用独立 schema，真实 Owner 姓名不替用户决定。

## 2026-09-14：Egent P1

- 仅保留 apps/server、apps/web、packages/database、packages/shared 四个 workspace。根脚本使用 pnpm + concurrently。
- 使用现有 Node 24 与 pnpm 10，不升级全局环境。TypeScript 5.9.3 满足 typescript-eslint 的版本范围；ESLint 采用受支持的 10.10.0。
- 复用用户指定的本机 PostgreSQL 5433，数据库 egent、用户 root。Compose 仅为可选路径，不与本机已有服务争用端口。
- 根 .env 集中配置；dotenv 按模块路径加载，Vite envDir 指根目录，客户端只暴露 VITE_ 变量。
- Prisma 固定稳定 7.10.0 + pg adapter，无业务 model、migration 或 db push；SELECT 1 验证实际连接。
- HTTP 健康接口只表示进程运行，数据库连接使用独立 db:check，避免混淆。
- Socket.IO 复用 Koa HTTP server，HTTP CORS 和 Socket 握手使用同一显式 Origin 白名单，无认证/room。
- React 19 不降级；经用户批准使用 Material Tailwind beta.24。已复现的 CSS 语法错误使用 pnpm 版本补丁修复，不禁用压缩或全局 peer 检查。
- 内部包 production 导出 dist，development 条件导出 src；tsx 统一监听后端依赖，避免多编译器初次输出导致的重启竞争。
- 用户明确要求本会话不使用 DSH、自主完成后，停止进一步委派，剩余实施与验证由主智能体直接执行。

## 2026-09-15：多人工作区与托盘

- 用户批准统一会话、多人邀请、不可变项目与二级项目选择；追加允许个人会话，旧数据不需保留，关闭窗口改为托盘常驻。
- 延续项目设备为权威端，不建设公共中心服务器。各端按每个会话的 hostId 路由，所有已参与会话在统一侧栏呈现，按设备 ID + 项目路径归组。
- GroupService 在项目端验证受邀设备 ID/公钥及连通性，创建时自动包含项目所属人，后续仅成员可邀请。全部候选验证后再事务提交成员，限制 20 人。
- historyAfter 为邀请事务内最后已提交消息时间；写入同会话消息继续单调递增。查询/游标/未读/标题/Agent任务一致过滤，旧任务后续输出对晚加入成员不可见。Owner 不再旁观未参与会话。
- 设备在已知地址上自动建立反向连接以发现被邀请的会话，断线重试约 15 秒；业务 RPC 仍加密签名校验。只有真正离线错误允许缓存回退，权限失败不被掩盖。
- 关闭窗口 preventDefault + hide，Tray 持有统一 ICO；托盘菜单退出调用 app.quit，复用 backend shutdown 和 12 秒兜底。自定义数据目录同时用于 Electron userData，以隔离测试实例及单实例锁。
- 未实施旧数据转换产品流程，也未主动清空用户目录；当前验收使用独立新库。

## 2026-09-15：智能参与与显式任务

- 用户最终确认默认智能参与，按会话持久化 Switch；仅项目所属人可切换，其余成员查看禁用状态。canConfigureAgent 必须由项目端角色计算，不能依据访问设备的本机 Owner。
- 普通消息用 4 秒去抖及 30 秒回复冷却安排只读参与判断；可沉默，无任务行；消息、成员和开关修订使在途结果失效。上下文取当前全体成员可见交集的非任务消息。
- @Egent 为独立只读任务，开发通过明确创建任务入口。确认/补充接口校验状态、方案版本、修订号和用户权限，去掉模型解释自然语言授权。
- 允许同会话多个任务，QUEUED 持久化已确认工作；设备单 worker 串行模型阶段，数据库限制同项目同时实施。实施中断不重做，排队取消不启动 CLI。
- 点击 Egent 头像通过 ComposerHandle 插入前缀并聚焦，保留草稿、不重复、不自动发送；Button/Avatar 和 Switch 均使用 Material Tailwind。
- 不新增自主实施、真实模型默认测试、完整 diff 浏览器或逐字流式输出。
