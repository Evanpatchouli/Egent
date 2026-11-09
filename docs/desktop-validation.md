# Electron 与设备直连验收

本次从单中心 PostgreSQL 服务改为每设备 Electron + SQLite。用户已明确批准 SQLite，并授权删除不需要的 PostgreSQL 工程文件。未使用 DSH 或子智能体。

## 已实现

- Windows x64 Electron 44.3.0：自带 Node，启动 utilityProcess 后端，后端就绪后加载本地静态 React 页面；退出时通知后端停止。
- 每台设备独立 SQLite 和密钥文件；首次启动自动初始化，无需安装数据库。
- Windows MachineGuid 的应用域哈希作为设备 ID，昵称独立、可重复、可修改；设备公钥校验用于后续身份确认。
- 双栏弹窗：左侧输入 IP，右侧历史联系人；探测成功才可连接，地址修改会清除旧探测结果；离线/改 IP 提示及按钮禁用。
- 握手 Ed25519 + X25519，业务请求 AES-GCM 校验/加密和请求 ID 防重放；历史 ID/密钥不匹配时拒绝关联。
- 每设备都是本机 Owner，远端只以 Colleague 身份调用受限 peer RPC。远端不能通过旧 identifier header 获取本机管理权限。
- 会话由项目设备持久化，访问端保存 RemoteSnapshot；同一联系人可以聚合双方各自作为项目主机的历史。IP 改变不改变历史归属。
- 保留聊天幂等与 Agent 简单/复杂确认；远端副本不进入本机 Agent 执行器。

## 测试结果

`pnpm test` 共 17 项/组通过：

- 7 项基础 HTTP / Socket 测试。
- 3 组 CodexExecutor mock（stdin、JSON、只读/写入参数、启动/退出/超时/取消/限额）。
- 3 组 SQLite / Agent / 加密校验：单 Owner、重复消息并发幂等、持久等待恢复、简单确认、同事不能批准复杂任务、Owner 确认、加密篡改检测。
- 4 组双后端测试：同名不同设备、昵称修改身份不变、本机 API 令牌、探测/握手/开放项目、越权设置拒绝、双向聊天、消息去重、离线副本、目标换端口仍恢复历史、反向连接可找到本机托管的历史。

双后端是本机两个独立进程、独立 SQLite 目录、模拟不同设备标识，测试端口 44101/44102/44103。没有声称从第二台物理电脑完成验证。

## 打包应用实测

使用 Playwright 驱动打包后的 `release/win-unpacked/Egent.exe`，不是仅浏览器打开网页：

- 启动独立后端、显示昵称初始化。
- 输入目标 IP 并探测设备，连接按钮启用。
- 连接后打开项目选择。
- 在打包桌面中选择对方项目、发送消息，对方后端持久化并回复，桌面实际收到同步消息。
- 重新打开历史联系人并探测。
- 停止对方后，提示“对方可能不在线或 IP 已更改”，连接按钮禁用。
- 关闭 Electron 后，本机后端健康接口不可达，退出清理通过。
- 便携自解压启动器用正常启动另行验证：真实 MachineGuid 读取成功、64 位哈希身份、本机 UI HTTP 200。Playwright 直接附着自解压启动器超时，因此不将其当作同一项自动化测试成功。

截图：`output/playwright/desktop-connect.png`、`desktop-offline.png`、`desktop-chat.png`。均为本地忽略的 QA 文件。

## 构建与文件

- 安装、Prisma generate、SQLite 初始化、typecheck、lint、format、前后端 build 已执行。
- electron-builder 已生成 Windows x64 portable exe 和解包目录。
- `release/Egent-0.2.0-x64.exe` 为便携启动器；无发布者代码签名，不要求用户安装 Node/SQLite/PostgreSQL。
- PostgreSQL 运行依赖、旧 schema/migration、配置和专用测试已删除；本机 PostgreSQL 服务及数据未操作。
- 旧阶段文档保留为历史记录，当前使用方式以 README 为准。

## 实际修复

- Prisma 生成的 SQLite 初始 SQL 将 JSON 默认值写为裸 `{}`，实际初始化报错；已改为合法字符串默认值，并实际创建 SQLite 验证。
- PostgreSQL advisory lock 替换为本机 SQLite 写队列；旧 skipDuplicates 用当前 SQLite 支持的 upsert 替代。
- 测试进程被信号终止时 exitCode 仍为 null，清理重复等待造成未完成 await；检查 signalCode 后修复，测试正常退出。
- Electron main 的根目录按打包/开发两种布局解析；本机数据写入 userData，不写进临时解包目录。
- utilityProcess 的父消息端口会保活进程，后端 HTTP/DB 清理完成后主动退出，避免每次都等待主进程超时兜底。
- 反向连接最初只显示对方主机会话，已合并本机托管且对方参与的会话，测试验证通过。

## 边界

- 首先只支持 Windows x64，不提供 macOS/Linux 安装包。
- 首次公钥信任为 TOFU，用户需要核对填写的设备。没有中心身份认证或自动公钥重置。
- 系统重装、克隆系统、不同 Windows 用户下的同设备密钥和数据目录丢失需要人工处理身份恢复。
- 跨设备采用约 1.5 秒的加密增量同步；前端使用本机 Socket.IO。暂未跨设备转发 typing；没有公网穿透/中继/WebRTC。
- 离线只能读已经同步的本地记录；应用退出后对方无法连接。
- 没有导入旧 PostgreSQL 数据，桌面版新建本地库；没有删除旧数据库数据。
- 真实 Codex implementation 未在本次桌面验收中调用，Agent 回归采用 fake；提供 Agent 的设备需自行安装认证 Codex。
- 测试数据保留在工作区忽略的 .tmp 中，没有在正式用户数据中塞入演示联系人。
