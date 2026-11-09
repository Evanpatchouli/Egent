# 当前任务

## 多人会话与统一项目选择

状态：已完成。23 项/组测试、三端浏览器交互、发行 Electron 后台收信/窗口恢复/完整退出及图标检查通过。详见 docs/group-validation.md。

目标：侧栏汇总当前设备用户参与的全部会话，按项目所属设备与项目路径分组；两步新聊天支持多人邀请及成员开放项目选择；支持后续邀请、加入后历史边界、历史同事状态和修改 IP 重连。

方案：项目设备保存权威会话并运行 Agent，其他成员直接连接项目设备同步各自可见副本；不新增公共服务器。项目设备离线时只读缓存。发起人选择一个项目后永久绑定，成员含发起人、邀请的同事和项目所属人。新成员历史边界由权威端在加入事务内确定，不信任客户端时间。

实施分组：

1. packages/database/prisma/schema.prisma、prisma/sqlite 新增版本迁移、src/index.ts：成员可见边界及升级初始化；用户明确无需保留旧数据，以新库验收。
2. apps/server/src/services/conversations.ts、messages.ts、agent 相关查询及 routes：严格成员访问、不可变项目、成员邀请、分页/未读/任务可见性，防止旧标题与任务内容泄露。
3. apps/server/src/device/service.ts、peers.ts、socket-bridge.ts、packages/shared：多成员邀请与目标设备身份校验、项目聚合、全会话聚合、按权威设备路由、在线状态与副本同步。
4. apps/web/src/App.tsx、api/client.ts、chat/ChatShell.tsx、ConversationSidebar.tsx、ConnectDialog.tsx 及相关组件/hooks：统一工作区，两步邀请同事/所属人→项目选择，后续邀请入口，同事列表及右键重连；统一 Material Tailwind 与 ripple。
5. server 测试及桌面 UI 验证：至少三设备、后加入成员、加入前后分页/未读/Agent 信息、离线重连、变更 IP/错误身份、项目不可变；更新 README、架构决策、验收记录并构建新桌面包。

边界：每位被邀请人必须能连接项目设备；未连接的候选人不能完成邀请；首次身份采用现有 TOFU，历史联系人必须保持设备 ID/公钥匹配。沿用当前明确邀请即加入方式，不额外新增邀请审批流程。

约束：本会话不使用 DSH，由主智能体自主完成；保留现有图标和 Material Tailwind 补丁；UTF-8 无 BOM。

追加需求：关闭窗口隐藏到系统托盘并保持后端运行；托盘菜单“打开 Egent”/“退出”，退出停止后台。已完成主进程与生命周期验证，真实发行 EXE 隐藏后仍可接收同事消息。
