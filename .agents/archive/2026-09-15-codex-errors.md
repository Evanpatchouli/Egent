# Codex 错误提示（已完成）

用户只授权补齐错误，不升级 CLI，不固定模型。

新增 codex-errors.ts，提取终止事件/嵌套 JSON，脱敏后限制长度；codex-executor.ts 的失败分支共用提示。回归先失败再修复，最终 7 项/组通过；真实捕获输出回放包含具体版本问题和默认模型名称。

版本 0.4.1；详情 docs/codex-errors-validation.md。
