# P2 验证记录

日期：2026-09-14。主智能体直接实施，未使用 DSH 或委派；当前目录非 Git repository，未初始化或提交。

## 已通过

- `pnpm install --frozen-lockfile`：通过，仅保留既有 Material Tailwind/ranger peer 限制。
- `pnpm db:migrate`：实际向现有 PostgreSQL 5433 / egent 应用 migration；重复执行提示无待迁移项。
- `pnpm db:generate`、`pnpm db:check`：生成成功、SELECT 1 成功。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm format:check`：通过。
- `pnpm test:smoke`：P1 七项通过，包含双 transport Socket ping/pong、Origin 拒绝、health、400/404/405。
- `pnpm test:p2`：七组测试通过，覆盖下列行为。

## P2 自动化覆盖

1. Unicode 编码/反解：中文、emoji、补充平面、长字符串、无效长度/数字/码点；identifier 不转整体 Number。
2. LAN：真实 netmask 的 /23 跨第三字节匹配、同/异子网、mapped IPv6、loopback、虚拟接口排除。
3. 实际请求 localhost 返回 COLLEAGUE；本机 LAN 192.168.10.218 返回 OWNER。TRUST_PROXY 关闭时伪造 header 无效；开启后验证 X-Forwarded-For、链尾地址和 X-Real-IP。
4. 8 个并发 Owner 请求：仅 1 个 201，另外 7 个 409 OWNER_ALREADY_EXISTS；数据库仅 1 个 Owner。同事关联 Owner 返回 403，Owner 网络关联成功。
5. 同事创建、同名冲突、空/超长/控制字符输入、/api/me、无效身份 401、IP 不覆盖已选身份角色、公开列表不含 Owner。
6. 空格/中文/# 路径解析；Owner 全列表、默认隐藏、同事过滤和 403、布尔校验、设置更新、配置删除后消失、旧设置保留、新项目默认隐藏。无效/缺失配置返回 503，服务继续提供 health，响应不泄露配置片段。
7. 真实 Codex config 只读成功：当时共 54 个 projects 条目。

自动化在当前数据库内创建随机命名的隔离 schema，执行相同 migration SQL；完成后清理该 schema，未污染 public。

## 浏览器

Playwright CLI + 本机 Microsoft Edge，DEV ONLY 夹具在 3101/3102 提供隔离身份模式，5181/5182 提供前端，使用两条合成项目路径；真实 Codex 文件未修改。

- Owner 无身份出现“你是谁”，Escape 无法关闭；输入姓名创建，出现全部项目和设置入口。
- 点击设置，列表显示项目名/路径。可见性 checkbox 最终勾选/取消实测通过，同事页面只出现开放项目。
- Owner 清空存储后出现“关联 Owner”，关联成功，不再创建新 Owner。
- 同事首次列表不含 Owner；创建带中文/emoji 姓名成功，页面无设置按钮。
- 清空同事存储再刷新，出现已有同事单选列表；选择确认成功。
- 刷新仍保留身份；localStorage 仅有 egent.userIdentifier。无效 identifier 自动清空并重新初始化。
- HTTP Ping、Socket Ping 实际点击成功。稳定页面控制台 0 errors / 0 warnings；无效身份测试期间的 401 属于预期错误。
- 截图在 `output/playwright/p2-colleague.png`、`output/playwright/p2-owner-settings.png`，不入库。

浏览器夹具与临时 Web 已停止，夹具 schema 已清理；public.User 确认为 0 行，真实 Owner 留待用户输入姓名。

## 已解决的问题

- Prisma 推断枚举声明导致 TS2742：公共用户服务显式返回 shared.UserInfo，避免泄露生成文件内部类型。
- 编码测试中“王”的人工预期数值录入错误：改正为 Unicode U+738B（29579），编码实现本身未改动。
- Material Tailwind beta Checkbox 隐藏 input 导致无障碍/键盘不可达，且受控 false 受其内部状态影响：改用原生 checkbox；Dialog、Input、Button 继续使用 Material Tailwind。
- 可见性等待网络时原生受控 checkbox 会立刻复原：改为即时更新，保存失败回滚。最终 check/uncheck 实测通过；未额外故障注入验证网络失败回滚。
- 两个测试 Vite 同时初始化同一优化缓存出现 EPERM：按顺序重启第二个测试进程后通过。正常单个 pnpm dev 不存在此测试启动冲突。
- API 405 统一错误体：router allowedMethods 使用 throw 进入统一错误处理，P1 回归通过。

## 明确边界

- 真实 LAN 测试来自服务器本机绑定到实体 LAN 地址的请求；没有从第二台物理设备测试。其他子网和代理链使用模拟数据/header，未声称真实跨设备验证。
- DEV_OWNER=true 在 NODE_ENV=production 的启动拒绝已实际验证；生产无公开测试入口。
- identifier 是按用户指定的可逆姓名编码，不是防冒用令牌；数据库决定角色，但知道其他用户 identifier 可以冒用。
- 同一 LAN 内其他客户端按当前规则可初始化/关联 Owner。IPv6-only 来源默认同事。
- 项目查询按请求时配置快照工作，不监控文件；设置后若配置删除项目，下次查询就不显示。未实现跨配置文件与数据库的事务锁。
- 测试 schema 清理需要正常结束；若强制结束验证进程，需仅清理该次记录的隔离 schema，不能重置 public。
- 未实现 P3/P4、密码/JWT、项目文件读取或 Codex 执行。
- 最后 PowerShell LAN 请求被本机系统代理转发而返回 502；使用 -NoProxy 后实际返回 OWNER，localhost 返回 COLLEAGUE，Web 返回 200。该代理影响已记录在 README。

## 修改文件列表

- 根：README.md、package.json、pnpm-lock.yaml、.env.example、被忽略的 .env；删除 docker-compose.yml。
- database：package.json、src/index.ts、prisma/schema.prisma；新增 prisma/migrations/migration_lock.toml 和 202609140001_p2_identity/migration.sql。
- shared：src/index.ts；新增 src/identity.ts、src/api.ts。
- server：package.json、src/app.ts、src/config.ts、src/server.ts、test/smoke.test.ts；新增 src/errors.ts、src/network.ts、src/routes/identity-projects.ts、src/services/users.ts、src/services/codex-projects.ts、test/p2.test.ts、test/browser-fixture.ts。
- web：src/App.tsx；新增 src/api/client.ts、src/hooks/useIdentity.ts、src/components/IdentityDialog.tsx、src/components/ProjectPanel.tsx。
- 文档记录：本文件及 .agents/current-task.md、handoff.md、decisions.md、lessons.md、archive/2026-09-14-p2.md。

接口/schema/配置和 P3 建议详见 README。
