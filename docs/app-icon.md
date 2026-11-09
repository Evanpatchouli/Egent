# Egent 应用图标

生成方式：内置 image_gen（非 API/CLI fallback）。

用户要求：透明背景、dark 实心圆、中间白色简约 robot。

## 资源

- `apps/desktop/assets/icon.png`：1254×1254 RGBA 生成原图，圆外透明，角点 alpha=0。
- `apps/desktop/assets/icon.ico`：保留透明度，包含 16、24、32、48、64、128、256 像素 PNG 帧。
- `apps/web/public/icon.png`：页面 favicon，与源 PNG 字节一致。

ICO 由 Windows System.Drawing 做尺寸转换并封装，未重新绘制、抠图或修改生成图案；无需新增 Python/Pillow 依赖。生成原始文件保留于 image_gen 默认目录，应用只引用已复制到工程内的资源。

## 最终生成提示词

> Create one production-ready desktop application icon for Egent. Square 1024x1024 PNG with genuine transparent alpha background outside the mark (not a checkerboard pattern). A perfectly round, flat solid very dark charcoal circle (#202321), centered with a modest even transparent margin (about 5% on all sides). Centered within the circle is a white minimalist robot head: simple bold geometric silhouette, rounded rectangular head, two clean dark eye cutouts, small symmetrical side ears and a short simple antenna. Restrained, friendly, highly readable at 16px and 32px. Pure white robot and solid dark circle only. Flat 2D logo, sharp antialiased edges, balanced proportions, generous negative space. No text, letters, watermark, gradients, shadows, bevel, glow, texture, outlines around circle, extra objects or background. This image will become an actual Windows .ico and application window icon.

工具实际返回尺寸为 1254×1254，以实际输出为准；已检查透明 alpha 并转换为 Windows 需要的尺寸。

## 配置

- electron-builder `win.icon` 指向源 ICO，portable 目标自动使用相同的 application icon；未误用只针对 installer 的配置项。
- `signAndEditExecutable: true`、`signExecutable: false`：写图标/版本资源，但不做代码签名。
- BrowserWindow.icon 指向打包目录内 icon.ico；AppUserModelId 为 local.egent.desktop。
- 构建脚本复制 PNG/ICO，Web index 引用 /icon.png。
- 桌面版本提升至 0.2.2，避免与旧图标版本混淆。

## 验证

- `pnpm desktop:package` 成功，构建日志不再提示默认应用图标，明确跳过代码签名。
- `pnpm desktop:verify-icons` 成功：解包 EXE 的图标组 1、portable EXE 的图标组 103 均包含源 ICO 的全部七种尺寸，各帧 SHA-256 完全一致。
- Windows ExtractAssociatedIcon 提取出的两个文件图标均为新机器人。
- 正常启动实际打包 EXE，读取窗口 WM_GETICON：32×32 图标与源 ICO 对应尺寸逐像素一致。
- 实际启动后的 /icon.png 返回内容与源 PNG 字节一致。
- Playwright 最初一次附着失败，因此窗口验收使用正常启动和 Win32 句柄检查，未伪称该次自动化启动成功。
- 图标组中的尺寸字段 0 表示 256px；校验脚本对此按 ICO/Windows 格式处理。
- 测试窗口已关闭；PNG/ICO 和代码保存在工程中，Windows 测试提取图位于忽略的 output/icons。

此包仍未签名。资源管理器可能缓存旧路径图标，优先使用新文件名的 0.2.2；不能用缓存现象代替 PE 资源检查。
