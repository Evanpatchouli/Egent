# Egent Desktop

每台 Windows 设备独立运行的桌面协作工具。Electron 自动启动本机 Node/Koa 后端，并加载由该后端提供的本地 React 前端；不需要用户安装 Node、pnpm 或 PostgreSQL，也不需要公共中心服务器。

## 下载与使用

从 [GitHub Releases](https://github.com/Evanpatchouli/Egent/releases/latest) 下载 Windows x64 便携启动器。本地构建产物位于 `release/<版本>/Egent-<版本>-x64.exe`。

点击标题栏“协作空间”右侧的“更多”（···）→“关于”可查看当前版本。“检查更新”会查询 GitHub 上的最新正式发行版。Windows x64 便携版发现新版本后可点击“立即更新”，通过进度条和百分比查看下载进度。网络中断时会自动重试，每个阶段最多重试 3 次，并在服务器支持时从已下载的位置继续；否则重新下载。下载期间可取消，重试耗尽或校验失败时原启动器不受影响。校验成功后，Egent 退出、在原路径替换启动器并自动重启，原有快捷方式和本机数据可继续使用。启动器所在目录需要可写。源码或解包版可点击“查看发行版”手动下载。0.6.1 及更早版本首次升级到带此功能的版本仍需手动下载一次。

1. 每个人启动自己的 Egent。
2. 第一次输入“你是谁”——这只是昵称。身份由后端读取设备标识自动生成。
3. 在左下方“设置”→“项目设置”开放本机项目，可按项目名称或路径搜索；项目仍只从本机 `~/.codex/config.toml` 的 projects 表读取。
4. 点击“新聊天”。第一步“邀请同事”：输入 IP 查找并添加，或勾选历史同事，支持多人；也可以不选任何人，直接下一步创建个人会话。
5. 第二步“选择会话项目”：先选项目所属人，再选此人开放的项目。候选人包含自己和本次邀请的同事。创建后项目不可修改；若需要另一个项目，请新建会话。
6. 左侧按“项目所属人 + 项目”归纳当前用户参与的全部会话，包括本机项目及同事项目。离线历史直接从侧栏打开，无需先选择联系人。
   右键会话会在鼠标位置打开菜单。点击垃圾桶图标旁的“移除”并确认后，该会话不再出现在本机列表；会话和消息仍保留在项目设备，其他成员不受影响。当前没有恢复入口。
7. 会话右上角“用户＋”图标按钮可继续邀请同事，悬停显示“邀请同事”。新成员只看到加入后的消息；早期标题、未读和旧任务输出不会向新成员回放。重复邀请不会重置加入边界。每个会话最多 20 人。
8. 左侧“同事”标题显示在线数/总数（如 `2/5`），以设备连通性为准。最右侧 `+` 可单独添加同事：输入 IP 查找，核对昵称和地址后点击“添加同事”，不会自动创建或加入会话。右键同事→“重新连接”，可修改 IP；先检测成功，才能点击“连接”。默认端口 **43127**，其他端口使用 `IP:端口`。历史设备 ID 和公钥始终会重新核对。
9. 点击窗口右上角关闭，会隐藏到系统托盘，后台继续接收连接和消息。双击托盘图标或右键“打开 Egent”恢复窗口；右键“退出”才完全退出并停止后端。

聊天侧栏底部只保留“设置”入口。设置为独立页面，左侧菜单包含“全局设置”“修改昵称”“项目设置”“模型设置”和“连接与状态”，其中项目和模型设置仅 Owner 可用。在“全局设置”可切换“我的消息显示在右侧”和“允许系统通知”，两项默认开启，设置只保存在本机并应用于所有会话。关闭系统通知后仍保留托盘和侧栏提醒。点击“返回聊天”保留当前会话和草稿。刷新会话位于侧栏“项目”标题右侧的图标按钮，加载时禁用，错误仍显示在聊天区。查看设置时不会自动将后台聊天新消息标为已读。

Windows 防火墙需要允许 Egent 在使用的网络上接收入站 TCP 43127。没有公网穿透、中继或自动 NAT 配置；双方必须通过所填 IP 可达。关闭窗口不影响连接；从系统托盘退出后，对方无法连接该设备。只启动一份桌面应用，不要同时手动启动占用同端口的后端。

本版未配置代码签名，Windows 可能显示未知发布者提示。也可运行解包产物 `release/<版本>/win-unpacked/Egent.exe`，需保留整个 `win-unpacked` 目录。

## 身份、昵称和角色

### 外部 AI Agent 通过本机 MCP 聊天（0.5.0）

启动桌面应用、设置昵称，并在 Egent 创建或加入目标会话。在外置 Agent 的 MCP 客户端中添加名为 `egent` 的 **stdio** 服务。Windows 命令解释器 启动 Egent 随包提供的运行时。以下命令在 PowerShell 中运行，任选与你的客户端对应的一条：

```powershell
$launcher = Join-Path $env:APPDATA 'Egent\egent-mcp.cmd'
codex mcp add egent -- cmd.exe /d /c call "$launcher"
claude mcp add --transport stdio --scope user egent -- cmd.exe /d /c call "$launcher"
```

DSH、Pi 或其他宿主需具备 stdio MCP 客户端能力（可由插件提供）。使用同一可执行程序 `cmd.exe`，参数逐项填写为 `/d`、`/c`、`call`、启动脚本的绝对路径。设置了 `EGENT_DATA_DIR` 时，脚本位于该数据目录。首次启动新版本后才会生成脚本。

例如，告诉外部 Agent：“在 Egent 的示例项目会话里问一下测试怎么运行，等 Egent 回答后告诉我。”客户端调用 `list_conversations` 选择会话，调用 `send_message` 并设置 `askEgent: true`，然后用返回的 `agentTaskId` 和消息 `id`（作为 `after`）调用 `wait_for_reply`。返回 `pending` 时用返回的游标继续等待。每次追问使用同一个会话 ID 和新的消息 ID，可在提问时附上相关上文。重试同一次发送应复用相同的 `clientMessageId`。通过 `read_messages` 可分页读取历史，旧版项目设备上的消息也可这样读取；精确等待需要项目设备升级到 0.5.0。

消息显示为你的昵称，遵循已有成员可见范围。四个工具仅开放聊天，会话内容会交给你配置的外部客户端。启动器自动读取本机运行令牌，客户端配置无需填写令牌。Egent 隐藏到托盘时可继续使用，完全退出后需重新启动。

- 后端读取 Windows MachineGuid，对应用域前缀和标识做 SHA-256，得到设备 ID；原始系统标识不通过网络发送。
- 昵称可修改、可重名，不参与身份计算；IP 只作为连接地址。
- 本机用户是本机项目的 Owner；远程设备在该实例上始终是 Colleague。原“同 LAN 即 Owner”和姓名数字编码身份已移除。
- 联系人以设备 ID 和历史公钥绑定。相同设备换 IP 后恢复历史；旧 IP 指向另一设备或同 ID 密钥变化时拒绝直接关联。
- Windows 重装、镜像克隆及应用密钥丢失可能影响设备身份。设备 ID 不是生物身份/账号，不宣称跨系统重装永久唯一。
- 不再允许浏览器自行选择 Owner 或提交旧 identifier 冒用本机身份。本机管理接口需要 Electron 为该次启动生成的随机令牌。

## 每端数据

默认目录：`%APPDATA%/Egent`。

| 文件                       | 内容                                                          |
| -------------------------- | ------------------------------------------------------------- |
| egent.sqlite（及 WAL/SHM） | SQLite：本机会话、消息、AgentTask、项目设置、联系人和远端副本 |
| device.json                | 设备 ID 与 Ed25519 密钥，用于验证连接                         |
| runtime.json               | 本次运行地址与本机访问令牌，勿分享                            |
| server.log                 | 后端错误日志                                                  |
| deepseek-settings.json     | 本机 DeepSeek API 地址和 Key，勿分享                          |

数据保留在应用数据目录，不在便携 exe 解压临时目录。更新 exe 不清空数据。请只在托盘选择“退出”后备份整个数据目录，密钥与数据库一起保管。当前磁盘文件依赖 Windows 用户目录权限，不是加密备份；不要把 device.json 复制给其他设备。

SQLite 使用 Prisma 7.10.0 + libSQL 本地文件适配器，无独立数据库进程。首次启动自动执行内置 schema，保留单 Owner、同项目单实施任务、触发消息和重复消息唯一约束；单后端写入串行化替代旧数据库 advisory lock。

旧 PostgreSQL 的适配器、schema、迁移、配置和专用测试已删除。**没有卸载本机 PostgreSQL，也没有删除其中的数据**。新桌面数据库从空库开始，当前不自动导入原服务器数据。旧阶段验收文档保留作历史记录，不能当作当前部署要求。

## 直连与历史同步

两个后端直接握手，无中心账号服务：

- Ed25519 签名挑战验证双方持有设备私钥。
- 每次连接使用临时 X25519 密钥协商；业务 RPC 内容由 AES-256-GCM 加密并校验，包含防重放请求 ID。
- 首次连接采用 TOFU（首次信任），历史联系人后续严格校验设备 ID/公钥。首次填写 IP 时仍需确认是正确的人，不能把自签名自动视为经过第三方认证。
- hello 握手里的公开设备 ID/昵称并非机密；聊天业务数据在加密 RPC 内传输。没有引入 JWT/OAuth 或外部认证服务。

会话的权威数据保存在**项目所属设备**，并由该设备运行 Agent。发起人决定一个不可变项目，初始成员包含发起人和所选同事（项目所属人必须是其中一员）。项目设备逐一验证受邀设备后才提交成员关系；连接失败不会创建半份会话。邀请即加入，不增加邀请审批步骤。

每端统一汇总自己的权威会话和远端副本，并按会话 ID/项目设备路由 HTTP 与 Socket 操作。远端副本保存于 RemoteSnapshot，不会触发本机 Agent。没有按联系人切换整个工作区的模式。只有成员可访问会话，Owner 身份不再自动获得未参与会话的读取权限。

后续加入时，项目设备在串行写事务中记录最后一条已提交消息的时间边界。用户和 Agent 的消息时间在同一会话中单调递增；历史分页、游标、已读/未读、会话标题和任务查询共用可见性约束。新成员不能读取旧消息，也不显示加入前触发任务的后续 Agent 输出，以免带出旧任务内容。原成员可继续阅读自己的完整历史。

跨设备约每 1.5 秒进行加密增量同步，前端使用本机 Socket.IO 推送。已知设备在启动及断线后会按保存地址尝试恢复连接（离线重试间隔约 15 秒）；修改 IP 时仍需通过同事菜单更新地址。在线标记表示近期连接可用，不代表对方正在看窗口。关闭窗口到托盘后同步继续。

项目所属设备离线时，成员只能读取已同步记录，不能发送或邀请；其他成员在线不代替项目设备保存主数据。没有公共服务器、WebRTC、NAT 中继或跨设备 typing 转发。大规模历史尚未优化。当前版本以新数据库验证多人流程，不提供旧版本会话模型的数据转换承诺；本次未主动删除用户应用数据。

## Agent 与工作区

问答、智能参与、任务分析和确认后的实施，都使用**项目所属设备**选择的执行器。其他成员无需安装 CLI 或配置密钥。项目设备隐藏到托盘后仍继续服务，完全退出后暂不可用。

### 选择执行器

打开 **设置 → 模型设置**，即可选择本机承载会话默认使用的执行器、模型 ID 和思考强度。聊天右上角直接显示当前模型和思考强度（例如 `gpt-6.1-terra xhigh`），点击可查看配置来源并打开会话模型设置。项目所属人可将整组设置应用到此会话，或点击 **恢复跟随全局**。其他成员可查看项目设备同步的生效配置。保存后从下一次模型调用起生效，包括智能参与、问答、分析和已确认任务的实施。

模型设置保存在项目设备的 SQLite 数据库。会话优先使用自己的覆盖设置，然后使用设备全局设置。没有保存全局设置时使用下表的启动默认值。点击刻度、拖动滑块或用左右方向键调整思考强度，滑杆上方显示当前档位。Codex 的模型留空或强度选“CLI 默认”时，由该次调用的 Codex 配置决定；DeepSeek API 和 DSH 初始均为 `deepseek-flash` / `high`。DeepSeek API 接受 `none/low/high/max`，DSH 接受 `off/low/high/max`。具体模型的可用性取决于项目设备的账号和执行器版本。

在项目设备的 **设置 → 模型设置 → DeepSeek API** 中填写 HTTPS API 地址和 Key，点击“保存 API 连接设置”，再点击“保存全局设置”选择执行器。地址默认 `https://api.deepseek.com`，自定义地址必须兼容 Responses API；输入框留空会保留已保存的 Key，也可单独删除。地址和 Key 保存在本机数据目录的 `deepseek-settings.json`，不会同步给会话成员；Key 未加密，依赖 Windows 用户目录权限。已保存 Key 优先于启动环境变量 `DEEPSEEK_API_KEY`，删除后可回退到环境变量。保存后下次调用生效，无需重启；DSH 也使用该 Key，但使用其自身的官方 API 地址。

全局和每个会话分别记住各执行器最后保存的模型和强度。切回执行器即可继续使用原配置；首次在会话中选择某个执行器时，会带入该执行器的全局设置。编辑期间来回切换也会保留本次草稿，点击保存只提交当前执行器。恢复跟随全局会清除该会话保存的执行器设置；恢复启动默认值会清除全局保存的执行器设置。

在项目设备上设置启动环境变量 `EGENT_AGENT_PROVIDER` 也可选择启动默认值。从托盘退出 Egent，再从设置了变量的终端启动应用。

| 值              | 项目设备上的依赖和配置                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex`（默认） | 使用现有 Codex CLI、登录和默认模型。可用 `CODEX_COMMAND` 指定可执行文件或 Windows `.cmd` 启动脚本。                                                                       |
| `deepseek`      | 使用 Codex CLI 的工作区沙箱，通过 Responses API 请求设置的地址；在应用内设置 Key，或在启动环境设置 `DEEPSEEK_API_KEY`。可用 `DEEPSEEK_MODEL` 覆盖启动默认模型。           |
| `dsh`           | 独立调用 DeepSeek Harness 的 headless CLI，需要全局安装 `@deepseek-api/dsh`，并配置 Key。可用 `DSH_COMMAND` 指定可执行文件的绝对路径。已用 Windows 版 `0.2.2-rc.1` 验证。 |

例如，已在环境中配置密钥时，可在 PowerShell 中从源码启动 DeepSeek API 模式：

```powershell
$env:EGENT_AGENT_PROVIDER = 'deepseek'
pnpm dev
```

使用 DSH 时将值改为 `dsh`。DSH 每次调用使用独立的临时主目录和内置 headless 配置，结束后清理；个人 DSH 界面的登录和插件配置不参与调用。三种模式的项目列表均读取 `~/.codex/config.toml` 的 projects 表。项目设备会将该次任务上下文及 CLI 读取的相关项目内容交给所选模型服务。

Windows 上支持从 PATH 调用全局安装的 `codex.exe` 或 `codex.cmd`，也可将 `CODEX_COMMAND` 设为其中一个文件的完整路径。安装 CLI 或更改 PATH 后，请从系统托盘选择“退出”，再重新启动 Egent，使其读取新的环境。启动失败时会显示系统错误码及相应排查提示；检查的安装、路径和登录状态均位于项目所属设备。

### 智能参与与只读问答

- 每个会话默认开启“智能参与”，使用 Material Tailwind Switch 切换。只有项目所属人可以切换；其他成员可查看状态，Switch 禁用。开关按会话持久化并同步到所有成员，后端同样校验项目所属人权限。
- 普通消息在约 4 秒没有新输入后合并判断，由只读模型决定回复还是保持安静。自主回复间隔至少约 30 秒；没有新用户消息不会自我触发。决定不回复也可能消耗一次模型调用。
- 判断期间出现新消息、成员变化或开关变化时，丢弃旧回答；关闭后不再安排普通消息判断。正在进行的只读调用可能继续结束，但其回答不会发送。
- 自动上下文最多取 20 条非任务消息，并限制在全体现有成员共同可见的历史范围内，不引用加入前的私密讨论。新成员加入会使已有草稿失效。
- 输入 `@` 会在该字符旁打开成员菜单，默认首项为 Egent，其余为本会话成员昵称；继续输入可筛选，支持鼠标、上下方向键及 Enter/Tab 选择，Esc 关闭。左键点击消息中的成员头像也可在光标处插入提及，保留草稿并聚焦输入框，不自动发送。
- 收到其他成员发来的 `@昵称` 时，侧栏对应会话显示红色“发送者 @ 了你”，托盘图标显示红点并在悬停时显示未读提及数；系统通知开启时还会弹出 Windows 通知，点击通知可打开 Egent。会话阅读至该消息后清除提醒。关闭窗口至托盘时继续提醒；从托盘退出后需再次启动并同步。历史同步不会反复弹出已处理的提醒。
- 输入框顶部的透明 `@Egent` 按钮可插入提及；文本中已有 `@Egent` 时背景变灰并显示 X，点击 X 移除 Egent 提及，保留其他文字和成员提及。原“询问 Egent”按钮已移除。
- 关闭智能参与后仍可通过 `@Egent` 或 Egent 头像提问；消息开头或中间的独立 `@Egent` 均可触发只读回答，顶部按钮和头像不会重复插入。该入口始终只读，不能通过要求“直接改代码”获得写权限。成员提及仍以昵称文本发送，同一会话中重名成员会同时匹配；`@Egent` 保留给助手，不作为成员提醒。

### 开发任务

- 点击“创建任务”提交明确需求。创建时写入聊天的需求消息会以任务样式展示，并标记“创建了一项任务”；历史记录也会保留此标记。远程旧记录需要项目设备升级并在线同步一次，离线副本才能显示标记。普通聊天不会自动附加到开发任务；同一会话可以有多个独立任务。
- 任务卡片展示需求、状态、方案版本、步骤、影响范围、风险、结果及验证。点击“查看详情”审阅方案。
- Egent 任务面板默认以聊天消息区右上角的小浮窗展示，不占据消息布局。右上角可最小化为右侧应用 Logo 头像，点击头像恢复小浮窗；最大化后在消息区中央展开，点击“收起”恢复小浮窗。面板内部独立滚动，切换尺寸保留任务详情和后台同步；键盘 Esc 在最大化时收起、小浮窗时最小化。
- 最小化 Logo 距聊天区右边缘 28px，带悬浮阴影、悬停上浮和按压反馈。有排队、分析或执行中的任务时，左上角显示动态状态角标，悬停提示当前活动；任务结束、等待用户确认或设备离线时不显示。系统减少动态效果时保留静态角标。
- 任务状态以图标和描述展示；等待分析、分析中、排队和执行中的文字带 0.85 秒快速流光，确认、完成、失败、取消使用静态状态色。“已完成”使用嫩绿色实心圆、白色勾和同色嫩绿色文字。设备离线或系统开启减少动态效果时停止流光。
- 只有“确认并执行 vN”按钮能授权实施；发送“确认”等聊天文字不会执行。后端核对任务版本、方案版本和真实用户权限，不调用模型判断授权。
- 简单任务由该任务的需求发起者或项目所属人确认；复杂或低置信度任务必须由项目所属人确认。其他可见成员可以通过“补充需求”提出修改，新方案必须再次确认。
- 执行中不能扩大本次范围，新增需求另建任务。确认后的任务进入持久化执行队列；本版每设备保留一个工作线程，各项目的模型阶段暂时整体串行，保证同项目、不同会话的写入不会并行；数据库也限制同一路径的 IMPLEMENTING 任务。
- 请求者或项目所属人可取消任务。队列中取消不会启动 CLI；已执行的文件修改不自动回滚。实施中断标记失败，不自动重复实施。
- Agent 只操作会话绑定的项目设备和已登记工作区；分析、问答、自主参与均为 read-only，明确确认后的实施为 workspace-write。
- 任务上下文只包含该任务显式提交的需求和补充。新成员不能访问加入前触发的任务，也不能通过补充接口读取旧任务。

执行超时默认 600000 毫秒，`EGENT_AGENT_TIMEOUT_MS` 可设为 1000 至 3600000 毫秒，未设置时沿用 `CODEX_TIMEOUT_MS`。默认测试使用模拟模型响应。详细验收见 [智能参与和任务卡片](docs/agent-participation-validation.md)。

## 开发与构建

要求 Node 24.x、pnpm 10.x。Windows x64 桌面构建使用系统 .NET Framework 4.x 的 C# 编译器生成便携更新助手。首次安装会下载 Electron：

```powershell
pnpm install
pnpm dev
```

pnpm dev 会构建前后端、准备桌面目录，再启动 Electron。Electron 先显示白底居中 Logo 和带流光的“Egent 启动中”，然后启动后端；后端就绪后在同一窗口进入应用，前端身份初始化期间沿用该启动页。不会人为增加启动等待时间；便携启动器自身解压阶段发生在 Electron 窗口出现之前。前端发行版使用 Vite 构建的静态文件，不启动 Vite dev server。主进程通过 utilityProcess 管理 Node 后端，关闭窗口仅隐藏到托盘；托盘退出时通知后端退出。

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

在仓库根目录运行生产构建：

```powershell
pnpm build
```

`pnpm build` 会编译工作区、准备桌面应用、打包 Windows x64 产物，并校验两个 EXE 的图标。输出目录 `release/<版本>/` 和便携文件名都取自 `apps/desktop/package.json` 的 `version`。原命令 `pnpm desktop:package` 指向同一流程。只需编译工作区时使用 `pnpm build:packages`。

桌面应用、健康接口和本机 MCP 服务使用同一个桌面包版本。构建后可运行 `pnpm desktop:verify-mcp`，通过隔离数据目录和模拟 CLI 验证打包程序、健康接口、MCP 的版本及聊天流程；也可在命令后指定便携启动器或解包版 EXE 的路径。

- 打包包含 Electron 自带 Node 运行时、编译后的后端、前端、SQLite schema 及本地数据库依赖，不要求安装 PostgreSQL。
- SQLite schema 位于 packages/database/prisma/sqlite/001-initial.sql，新增升级时需扩展版本化初始化，不能直接重置用户库。
- 数据目录可用 EGENT_DATA_DIR 覆盖。SERVER_PORT 可调整监听端口；这些是运维/测试配置，正常用户无需设置。
- `pnpm db:migrate` / `pnpm db:check` 只操作项目内开发 SQLite（.local-data），不访问 PostgreSQL。
- standalone 后端仅用于开发排查；runtime.json 提供本机令牌，访问 UI 需通过带 token fragment 的 URL。正常用户直接使用桌面入口。

## API 边界

- 本机：/api/device、/api/device/nickname、/api/peers、/api/peers/probe、/api/peers/connect；POST /api/workspace/projects 聚合所选成员项目；/api/conversations 统一会话列表及创建；/:id/invite 添加成员。
- 所有本机管理 API 必须提供 X-Egent-Local-Token；旧 identifier header 不授予权限。
- UI 不再传递 X-Egent-Peer，后端根据会话记录决定项目设备。带本机令牌的 X-Egent-Peer 仍可用于开发排查指定设备 RPC，不会合并其他设备会话，也不携带远端 Owner 权限。
- 网络对外：/peer/hello、/peer/connect、/peer/rpc。RPC 只接受允许的成员会话、多人创建/邀请、消息、开放项目及任务创建/补充/确认/查询/取消、智能参与开关，不暴露文件读取和本机项目设置。
- renderer 禁用 Node integration，开启 contextIsolation/sandbox，拒绝外部窗口/导航和权限请求；只加载本地页面。

## 主要目录

```text
apps/desktop/main.cjs       Electron 生命周期
apps/server/src/device/    设备标识、握手、加密 RPC、同步与本机 Socket 桥接
apps/server/src/agent/     Agent 状态机、执行器选择与 CLI 适配
apps/web/src/components/ConnectDialog.tsx
packages/database/prisma/sqlite/
scripts/build-desktop.mjs
electron-builder.yml
release/
```

技术版本：Electron 44.3.0、electron-builder 26.15.3、React 19.3.0、Koa 3.2.1、Socket.IO 4.8.3、Prisma 7.10.0、@libsql/client 0.17.0。Material Tailwind beta 的既有 CSS 补丁保留。

## 应用图标

统一图标是透明背景、深色实心圆和白色简约机器人。源文件为 `apps/desktop/assets/icon.png`；多尺寸 Windows 图标为同目录 `icon.ico`（16/24/32/48/64/128/256px）。页面 favicon 使用同一 PNG。

`win.icon` 同时供应用 EXE 和 NSIS portable 启动器使用；`signAndEditExecutable: true` 启用图标资源写入，`signExecutable: false` 单独关闭代码签名。BrowserWindow 的 icon 和 AppUserModelId 也已配置。

重新生成 ICO 使用 PowerShell 7 执行 `./scripts/build-icon.ps1`；修改 PNG 后同步 `apps/web/public/icon.png`，再运行 `pnpm build`。也可单独运行 `pnpm desktop:verify-icons`，验证两个发行 EXE 的图标组逐帧匹配源 ICO。

生成方式、最终提示词和验收见 [应用图标记录](docs/app-icon.md)。

## Material Tailwind 组件

界面交互控件统一使用 `@material-tailwind/react`：Button、Input、Textarea、Radio、Checkbox、Switch、Dialog、Menu；用户和消息头像使用 Avatar。应用源码不再直接实现原生 button/input/textarea 作为替代控件，布局及语义标签仍使用正常 HTML。

所有 Button 显式开启 ripple。深色实心按钮使用浅色波纹，ghost 与浅底 outline 使用深色波纹；禁用按钮不响应点击。关闭弹窗的按钮会随弹窗卸载，波纹可能随之结束，不人为延迟业务操作。

固定 beta.24 的 Checkbox 存在受控 false/disabled 问题，Checkbox 和 Radio 还将 input 设为 display:none。现有 `patches/@material-tailwind__react@3.0.0-beta.24.patch` 已包含相应修复：同步受控值、透传 disabled、将 input 改为透明覆盖以保留键盘焦点和无障碍语义，同时保留先前 Rating/Select CSS 修复。不得遗漏补丁和锁文件。

组件浏览器验证页位于 `apps/web/test/controls.html`，不包含在桌面发行包中。开发检查时启动 `pnpm --filter @egent/web exec vite --force`，打开 `/test/controls.html`；`test/verify-controls.js` 可交给 Playwright CLI 的 run-code 执行。更换补丁后应重启 Vite 并清理其依赖优化缓存（`--force`），避免看到旧组件。

本次变更验收见 [组件与 ripple 验证](docs/material-components-validation.md)。

验收见 [桌面与设备直连验证](docs/desktop-validation.md)。

多人会话与托盘行为验收见 [0.3.0 验证记录](docs/group-validation.md)。

Codex 启动失败时显示系统错误码及排查提示；仅将错误码写入日志，不公开启动命令及参数。CLI 启动后调用失败时会显示退出码和脱敏后的具体原因，优先读取 JSONL 的 error/turn.failed，兼容嵌套错误 JSON；版本、认证和额度问题附中文说明。只读问答或分析失败时不会显示实施回滚提示。此更新不升级 CLI、不覆盖用户默认模型。早期错误解析修复见 [CLI 错误提示修复](docs/codex-errors-validation.md)。
