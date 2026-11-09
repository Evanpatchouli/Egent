# Codex 非零退出但 stderr 为空

现象：Egent 只显示退出码 1。

根因：CLI 在 JSON 模式把 error/turn.failed 发到 stdout，message 还可能是包含 HTTP 错误的 JSON 字符串。

处理：codex-errors.ts 解析终止事件优先、限制递归、只提取 error/message、stderr 回退、脱敏及长度限制；codex-executor.ts 非零退出和失败事件共用此提示。

覆盖：codex-executor.test.ts 的 7 项/组；具体记录 docs/codex-errors-validation.md。
