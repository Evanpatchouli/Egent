# 统一 Material Tailwind 组件

状态：已完成。所有按钮/表单控件及头像已使用 Material Tailwind；实际 ripple、键盘/禁用状态和桌面聊天/项目设置验证通过；发行版本 0.2.1。未使用 DSH/子智能体。

## 文件和任务

- chat/ChatShell、ConversationSidebar、Composer、MessageList、ConversationView、AgentStatus、ConnectDialog：所有原生按钮替换为库 Button，启用 ripple，浅底 ghost/outline 使用深色效果，保持布局。
- Composer：Textarea 替换原生 textarea，保持输入法/换行/发送行为。
- ProjectPicker：Radio/Radio.Item/Radio.Indicator 替换原生 radio，避免 label 嵌套。
- ProjectPanel：Checkbox/Indicator 替换原生 checkbox。
- 现有 Material Tailwind pnpm 补丁：修复 Checkbox 受控 false、disabled；Checkbox/Radio 输入隐藏方式改为透明覆盖，保留键盘/无障碍树；保留既有 CSS 修复。
- 样式仅补 focus 与必要的布局校准，不改聊天、设备身份、连接或 Agent 业务。
- 加浏览器可重复验证：ripple DOM/动画、禁用按钮不触发、Checkbox 键盘/受控状态、Radio 键盘及 Textarea；运行 typecheck/lint/build 并重新打包桌面端。
- README/验收与交接更新；无 BOM 检查后归档。
