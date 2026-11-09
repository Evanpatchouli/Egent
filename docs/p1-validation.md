# P1 验证记录

验证日期：2026-09-14；位置：`C:\App\Egent`。实际运行本机命令和 Microsoft Edge 浏览器，未使用 DSH 执行实施任务。

## 环境

- 初始目录为空，非 Git repository；未初始化 Git、未提交。
- Node 24.21.0 / pnpm 10.33.4 / npm 11.19.0。
- PostgreSQL 18.3：`127.0.0.1:5433`，数据库 `egent`，用户 `root`；密码仅存于根 `.env`。
- Docker 26.0.0 引擎可连接，Compose 2.26.1 可用。

## 已执行结果

| 验证                                | 结果                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm install`                      | 通过；保留已记录的 Material Tailwind 传递 peer 警告                                  |
| `pnpm install --frozen-lockfile`    | 通过；依赖与补丁锁定一致                                                             |
| `pnpm typecheck`                    | 四个 workspace 通过，包括 Prisma 配置类型检查                                        |
| `pnpm lint`                         | 通过                                                                                 |
| `pnpm format` / `pnpm format:check` | 已统一格式并通过检查                                                                 |
| `pnpm build`                        | 四个 workspace 通过，包含 Vite CSS 压缩                                              |
| `pnpm db:generate`                  | 通过；Prisma 7.10.0 在无 model schema 下生成客户端                                   |
| `pnpm db:validate`                  | schema valid                                                                         |
| `pg_isready -h 127.0.0.1 -p 5433`   | accepting connections                                                                |
| `pnpm db:check`                     | Prisma 实际查询：`SELECT 1 = 1`                                                      |
| 数据库业务表                        | `public` schema 表数量为 0                                                           |
| `docker compose config --quiet`     | 通过；不输出包含密码的展开配置                                                       |
| `pnpm dev`                          | 同时启动 server 3000 / web 5173                                                      |
| shared 开发监听                     | 触发 shared 源文件变更事件后，tsx 重启 server，Socket 自动重连                       |
| HTTP 手动请求                       | PowerShell `Invoke-RestMethod` 与 `curl.exe` 均得到 `ok: true`、服务名、版本和时间戳 |
| `pnpm test:smoke`                   | 7 项通过，0 失败                                                                     |
| `pnpm start:server`                 | 编译后的 Node 服务启动成功，健康请求通过                                             |
| Vite preview                        | 构建产物在 5173 预览成功                                                             |
| 文本编码                            | 项目文本文件检查为合法 UTF-8，无 BOM                                                 |

## 浏览器实测

使用 Playwright CLI 驱动本机 Microsoft Edge，验证开发页面及生产构建页面：

- 页面标题和页头 Egent 正常，Material Tailwind Button 可见且可点击。
- 点击 Ping Server 显示 Healthy 和完整 JSON。
- Socket 状态 Connected，点击 Ping Socket 显示 `pong received`。
- 停止后端后，页面显示连接错误，Ping Socket 按钮禁用；HTTP 按钮显示 `Failed to fetch`，没有显示虚假成功。
- 恢复后端后 Socket 自动重连。
- 最终生产页面检查：控制台 **0 errors / 0 warnings**。

截图：`output/playwright/p1-production.png`。交互快照和控制台记录保存在同一目录，作为本次本地验收产物，不入库。停服及热重载期间观察到的连接失败属于故障验证的预期结果，不能与稳定运行时的控制台结果混淆。

## 自动化集成测试覆盖

1. 健康响应结构、版本、有效时间戳、no-store、允许的 CORS origin。
2. 未列入白名单的 HTTP Origin 不获 CORS 授权。
3. 404、405、无效 JSON 的 400 响应，以及错误响应 CORS。
4. Socket.IO polling ping/pong。
5. Socket.IO polling 拒绝非白名单浏览器 Origin。
6. Socket.IO WebSocket ping/pong。
7. Socket.IO WebSocket 拒绝非白名单浏览器 Origin。

## 问题和解决

- **数据库尚不存在**：凭据验证有效后，创建用户指定的 `egent` 空数据库，随后 Prisma 查询通过。没有添加业务表或更改现有服务。
- **Material Tailwind 稳定版不声明 React 19 支持**：采用用户批准的固定 beta.24，并保留 ranger 的传递 peer 警告；只验证 P1 使用的组件，不声称全库兼容。
- **上游非法 CSS**：构建实际复现 Rating 和 Select 主题的错误选择器；pnpm 补丁修正源码与打包产物，默认 CSS 压缩保持开启，重建通过。
- **多个编译监听器导致启动重启竞争**：改用内部包的 development 条件导出，由 tsx 直接监听源文件；实测启动和 shared 变更后的重启通过。
- **浏览器 favicon 404**：添加空 data favicon；最终页面控制台没有错误。
- **ESLint 9 停止维护**：初次安装反馈后切换到与现有 Node 兼容的 ESLint 10.10.0；未升级全局工具。

## 验证边界

- 本机 PostgreSQL 已运行，因此复用现有服务；**没有启动可选 Compose PostgreSQL 容器**，避免争用 5433。其 YAML 已校验，容器镜像启动和数据卷初始化未在本次验证。
- 局域网部署配置方式已文档化；未从另一台局域网设备执行访问验证。
- 本次通过页面点击验证了正常往返、断线、失败提示和重连；未模拟服务器故意不回 pong 的 5 秒超时场景。
- 没有测试 Material Tailwind 的 Slider、Rating、Select 等业务未使用组件。
- 未实现 P2/P3/P4、数据库 migration、用户认证或生产静态站点托管。
