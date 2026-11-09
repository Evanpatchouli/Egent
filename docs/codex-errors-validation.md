# Codex 错误提示修复（0.4.1）

用户授权范围：仅补齐错误提示，不升级 Codex CLI，不设置或更改模型。

## 原因与修改

本机只读复现中，CLI 0.152.0 以退出码 1 结束，stdout 的 `error` / `turn.failed` 内包含 HTTP 400 和“gpt-6-astra requires a newer version of Codex”。旧代码只打印 stderr，界面因此只看到退出码。

现在优先提取终止事件，再回退到 error、item.error 和 stderr。支持 message 内再次嵌套 JSON；只读取 error/message 字段，不输出整份事件、工具结果或普通模型输出。JSON 模式输出格式参考 [OpenAI 官方文档](https://learn.chatgpt.com/docs/non-interactive-mode)。

具体原因会附在日志和界面错误中；版本、认证、额度/速率和模型不可用提供中文说明。移除终端控制序列，对常见 API key、Bearer、token/password 和 URL 用户密码进行脱敏后再截断，最终错误不超过 380 字符。

这次问题显示为：

> Codex 调用失败（退出码 1）：本机 Codex CLI 版本过旧，无法使用当前默认模型，请升级 CLI 后重试。

后续附原始原因，包含用户默认模型名称。现有智能参与提示保留前 200 字符，该例的升级提示和模型名称均可见。

## 验证

- 先增加回归测试：原实现出现 3 项新增测试失败，确认能复现缺少具体原因和回退信息。
- 修复后 Codex 执行器 7 项/组测试通过：嵌套 stdout 错误、空 stderr、失败 JSON 事件、错误优先级、item.error、stderr 回退、空输出、脱敏和长度限制。
- 原有成功响应、进程启动失败、非零退出、超时、取消、输出大小和沙箱参数测试保留。
- 新增断言不传 `--model`、`-m` 或 `model=`，保持跟随用户 Codex 默认配置。
- 用 `.tmp/codex-diagnostic/result.json` 中先前捕获的真实 CLI 输出回放，得到具体升级提示；不需要再次调用模型。
- 构建、类型编译、ESLint 和格式检查通过。界面组件未变，本次没有声称完成新的真实模型成功问答。

本次修复让失败原因可见，并不解决旧 CLI 与默认模型的兼容问题。本次没有执行 CLI 升级或修改模型配置。打包期间外部 CLI 版本已变为 0.154.0，未针对这个新版本再次发起模型请求。

## 发行包

`release/Egent-0.4.1-x64.exe`，SHA-256：`67e4dcf06f8d4da429cd189245a99f29ee05b86e9f856eead6b7d822a42a70dd`。便携和解包 EXE 图标逐帧校验通过。
