# Material Tailwind 组件统一验收

日期：2026-09-15。按用户明确要求，修正原生按钮混用造成 ripple 缺失的问题，不修改设备直连、会话或 Agent 业务。

## 修改范围

- ChatShell、ConversationSidebar、Composer、MessageList、ConversationView、AgentStatus、ConnectDialog：所有原生按钮改为库 Button，显式 ripple。
- Composer：库 Textarea，保留禁用、输入法、Enter/Shift+Enter 逻辑。
- ProjectPicker：库 Radio/Item/Indicator，name 分组、外部 label、键盘操作。
- ProjectPanel：库 Checkbox/Indicator，受控可见性、禁用、失败回滚逻辑保持。
- 消息及页头头像改为 Avatar；现有 Input 和 Dialog 继续使用。
- 浅底 outline 使用 secondary 配色以获得深色 ripple，ghost 使用库内默认深色效果。
- styles.css：焦点轮廓及少量布局校准。
- pnpm 补丁与锁文件：修复 beta.24 Checkbox/Radio，保留原有 Rating/Select 修复；未升级 React 或组件库版本。
- 桌面发行版本更新为 0.2.1；构建脚本从 desktop/package.json 读取版本。

## 实际验证

1. 修复前的浏览器快照：Checkbox/Radio 不出现在无障碍树，验证函数报错，问题可复现。
2. 修复后运行 `apps/web/test/verify-controls.js`：
   - Checkbox 受控 false、外部更新、indicator 状态、空格切换、native disabled 均通过。
   - Radio 方向键切换、互斥选择、禁用选项均通过。
   - 实心/ghost 按钮创建真实 `.ripple` 节点及 500ms Web Animation。
   - 实心色 rgba(255,255,255,0.3)，浅底色 rgba(0,0,0,0.2)。
   - 禁用按钮点击不生成 ripple；Textarea 多行保留。
   - 稳定页面控制台 0 errors / 0 warnings。
3. 实际 Electron + 隔离双后端流程：昵称、连接探测、项目单选、新建聊天、发送/接收、历史联系人、离线禁用、退出后端通过。重新打包后重复验证通过。
4. 在 Electron DOM 中监听到确认、连接会话人、检测连通性、连接、开始聊天、发送及历史联系人按钮的 ripple 节点，均存在运行中的库动画。
5. typecheck、lint、Web build 已执行通过；桌面包重新构建。
6. 源码扫描未发现应用自写的 `<button>`、`<input>`、`<textarea>` 或 `<select>` 替代控件。
7. 在打包桌面中打开真实项目设置，Material Tailwind Checkbox 勾选/取消并等待保存；input.checked 与 wrapper data-checked 均正确，SQLite 保存交互通过。

## 说明

验证用的控制页不进发行包。Material Tailwind 内部仍会渲染原生 HTML 元素，这是组件库的正常工作方式。

更新 patch 后 Vite 初次仍使用旧预构建产物，使用 --force 重启后验证通过。运行时 ripple 完全使用库已有实现，没有新建动画库。

Dialog 关闭/页面切换会卸载原按钮，因此这类按钮的动画可被正常操作提前结束；没有为了完整播放动画延迟操作。

既有 React 19 与 ranger 的传递 peer 警告保留，不声称库中所有未使用组件都已验证。

## 消息复制按钮布局修复（0.7.3）

组件库的 ripple 会在点击时将按钮的内联 `position` 改为 `relative`。复制按钮原先直接使用绝对定位，长消息点击复制后会因此出现不会自动消失的空白。现在由外层容器负责绝对定位，按钮仍使用原有 ripple。

`apps/web/test/verify-chat-display.js` 验证长消息、自己的消息、任务消息和失败状态下的复制位置，以及波纹结束、成功提示消失和重复复制后的布局。测试使用模拟剪贴板，不会改写系统剪贴板。
