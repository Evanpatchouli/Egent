# Material Tailwind beta.24 构建失败

触发：React 19 + Material Tailwind 3.0.0-beta.24 + Tailwind 3.4.19 + Vite 8.3.0 执行 build。

症状：Lightning CSS 报 `Unexpected token Delim('=')`，来自组件库的 Rating / Select 主题。

根因：`[&_data-slot=icon]` 与 `[&_data-slot=placeholder]` 漏掉 CSS 属性选择器的内层方括号，输出了 `data-slot=icon` 等非法选择器。

修复：pnpm patch 将其替换为 `[&_[data-slot=icon]]` 与 `[&_[data-slot=placeholder]]`，同步修正发布包的源码和 ESM/CJS 产物，使用 patchedDependencies 与锁文件持久化。

验证：默认 CSS minify 开启，pnpm build 通过；真实 Edge 浏览器的 P1 按钮和 HTTP/Socket 交互通过，稳定生产页面控制台 0 errors / 0 warnings。
