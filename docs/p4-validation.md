# P4 验收记录

日期：2026-09-15。由主智能体直接实施，未使用 DSH 或委派。数据库继续使用本机 PostgreSQL 5433，未创建容器/volume。项目非 Git repository，未初始化或提交。

## 数据和工作流

- 新增 AgentTask 与 AgentTaskType/AgentTaskStatus 枚举；分析前 type 可空。
- triggerMessageId 唯一外键；active 状态的 conversationId 部分唯一索引；Message.agentTaskId 关联讨论和 Agent 回复。
- 状态集中转换；revision 防并发覆盖，planVersion/planMessageAt/确认消息绑定当前展示方案，processedAt 防重复消费。
- A：只读分析 → 请求者或 Owner 确认 → 实施；拒绝取消，修改意见重新出方案。
- B：必须 Owner 确认；同事修改只产生待审草案，不会降低 Owner 审核要求。
- C：项目资料回答；没有足够证据则明确不确定并完成，不执行写入。
- 用户消息与任务创建/关联同事务；Agent 状态与 Agent 消息同事务，提交后复用 P3 广播。Agent 回复计入未读，不触发自身。
- IMPLEMENTING 前事务内再次检查当前用户、参与者、触发者、方案版本和消息时序，拒绝过期/越权确认。

## 已执行验证

| 项目                                       | 结果                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| pnpm install / frozen lockfile             | 通过，无新增运行时依赖                                                                  |
| Prisma migration                           | 202609150001_p4_agent 已实际应用；复跑无待迁移项                                        |
| Prisma generate / validate                 | 通过                                                                                    |
| TypeScript typecheck / lint / format:check | 通过                                                                                    |
| backend regression                         | P1 7 项、P2 7 组、P3 9 组通过                                                           |
| P4 tests                                   | 12 组工作流/DB/API + 3 组执行器测试，共 15 组通过                                       |
| pnpm build                                 | 后端和前端构建通过                                                                      |
| 本机 CLI 检查                              | codex-cli 0.152.0；检查 --help、exec --help 和 features list                            |
| 真实只读 Codex                             | 显式 EGENT_REAL_CODEX_TEST=1，测试目录 README 问答成功，文件内容及目录清单未变          |
| 浏览器                                     | Playwright + Edge，等待方案、刷新恢复、聊天确认和模拟执行完成通过，控制台 0 错误/0 警告 |

累计 38 项/组默认测试。真实 CLI 测试为额外 opt-in，不是默认测试依赖。

## 默认测试覆盖

工作流用 FakeCodexExecutor，执行器用 mock spawn；默认测试不要求安装或登录 Codex。

- SIMPLE / COMPLEX / QUESTION 分类，JSONL 最终结果提取、结构校验、非法/未知字段拒绝。
- 简单任务持久等待、拒绝、确认和一次实施。
- 复杂任务等待 Owner；同事确认无效，Owner 确认可实施。
- 修改方案生成新版本；旧版本确认仍等待，讨论不实施。
- 确认之后有新意见时不执行旧批准；取消后的迟到分析不能启动实施。
- 并发消息只有一个 active task；重复 clientMessageId/triggerMessageId 不产生重复任务。
- PENDING/ANALYZING 启动恢复、WAITING 保持、IMPLEMENTING 重启标 FAILED 且实施次数不增加。
- 非法状态转换、未携带当前确认的直接实施转换拒绝。
- AGENT Message 实际落库、未读统计、Socket 状态事件、非参与者查询 403。
- 工作区不存在、非目录、未登记路径拒绝。
- CLI 启动失败、非零退出、超时、取消、输出超限；mock 验证终止和固定 shell:false/windowsHide 参数。
- 分析/确认阶段只读，实施阶段 workspace-write；不包含 dangerous bypass。

## 真实 Codex 结果

仅调用 analyze，未运行真实 implementation。测试项目位于 Egent/.tmp，使用执行器测试注入的固定 reader，不修改真实 Codex projects；生产路径校验仍要求真实注册。

测试 README 记录 GET /answer 返回整数 42。Codex 返回 QUESTION、confidence=1、答案 42、README.md:2 证据。读取后 README 字节内容和目录清单一致。

第一次真实运行因本机 gitlab MCP transport 配置不兼容失败；只覆盖子进程 `mcp_servers={}` 后通过，同时关闭 apps/plugins/hooks/multi_agent/browser/computer/image 能力。未修改用户 config.toml、认证或模型配置。

CLI stdout/stderr 总量限制 2 MiB，最终 JSON 64 KiB，校验失败进入 FAILED。没有把 stdout 整段写入 Message 或 metadata。真实测试没有测试代码写入能力，不将 Fake 成功当作业务工作区实施成功。

## 浏览器结果

在隔离数据库和 FakeExecutor 下：

1. 在已有会话发送开发请求，出现 Agent 计划与“等待需求发起者确认”。
2. 刷新页面并重新进入会话，等待状态及计划仍存在。
3. 回复“同意当前方案，可以开始”，状态转执行完成，新增普通 AGENT 消息汇报模拟结果。
4. 明确显示模拟执行、未修改真实代码；界面保留 P3 布局，没有新 dashboard。
5. 截图保存在 `output/playwright/p4-waiting.png` 和 `p4-completed.png`，均为本地忽略的验收产物。

## 修复与边界

- 取消与 PENDING→ANALYZING 同时发生时，最初出现 revision 冲突；补充测试复现后，取消会重新读取当前版本并有限重试。最终取消测试通过。
- 若 DB 写失败导致活动状态未收敛，worker 停止推进并在 DB 恢复后写 FAILED，不重复实施。DB 本身不可用期间不能保证立刻写入 FAILED，启动恢复会再次处理。
- 方案或上下文过长直接失败，不截断展示后执行未展示部分。
- 任务状态推送含 revision，前端不会以旧状态覆盖新版本。
- Windows 进程树取消使用 taskkill /T /F；默认验证为 mock，未用真实 Codex 写入进程做中途杀进程实验。
- 单实例单 CLI，不支持多进程共同消费。实施中消息保留但不自动扩展当前方案，不形成复杂后续队列。
- 没有自动回滚、真实业务 implementation 验收、强认证、RAG、多 Agent 或外部消息队列。P2 identifier 仍可复制冒用。
- 自然语言意图依赖模型判断；身份、版本和参与权限由后端确定，模型不能授予权限。

## 清理

所有测试 schema 已清理，public.AgentTask 和 public.Message 验证为 0 行，未留下演示任务或消息。没有修改真实业务 workspace。

自动审批拦截了合并执行数据库清理与临时目录递归删除的命令，未给出细分原因。已独立完成数据库清理；被拦截的临时目录保留在忽略的 .tmp 中，未绕过删除限制。

## 修改文件

- database：prisma/schema.prisma、新 migration、src/index.ts 的生成类型导出。
- shared：src/agent.ts、src/index.ts 的任务 DTO 与 Socket 事件。
- server 新增：agent/contracts.ts、state-machine.ts、task-store.ts、workspace.ts、prompts.ts、codex-executor.ts、service.ts；routes/agent-tasks.ts。
- server 接入：app.ts、config.ts、server.ts、services/messages.ts、conversations.ts、chat-events.ts、socket/chat.ts。
- web：hooks/useAgentTask.ts、components/chat/AgentStatus.tsx、ConversationView.tsx、Composer.tsx、styles.css。
- tests：p4.test.ts、codex-executor.test.ts、codex-real.ts、p4-browser.ts。
- 根/server package.json 测试脚本、.env.example、忽略的 .env、.gitignore、README、本文及 .agents 记录。

确认方式、CLI 参数和恢复规则详见 README 的 P4 Agent 章节。
