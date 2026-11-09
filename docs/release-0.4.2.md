# 0.4.2 打包记录

- 日期：2026-09-16。
- 桌面版本：0.4.2。
- 包含会话成员提及、顶部 @Egent 开关、状态图标与快速文字流光，以及嫩绿色实心圆勾完成状态。
- 完整前后端构建通过。原 release/win-unpacked 被占用，使用 electron-builder 的 directories.output 参数切换至 release/0.4.2 后成功打包，未停止用户进程。
- 便携包：release/Egent-0.4.2-x64.exe，105,481,221 字节。另保留 release/0.4.2/Egent-0.4.2-x64.exe。
- 本次解包程序：release/0.4.2/win-unpacked/Egent.exe。使用时需要保留整个 win-unpacked 目录。
- 便携包和解包 EXE 的产品版本均已核对为 0.4.2，七种尺寸图标全部匹配源 ICO。
- 未启动应用进行真实模型或跨设备联调。
