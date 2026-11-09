# P3 房间订阅顺序

症状：双浏览器消息已落库，侧栏未读更新，但聊天区未实时收到对方回复。

原因：React StrictMode 清理触发 leave，服务端异步 join/leave 数据库检查完成顺序可能不同；过期 join ack 再发一次 leave 也可能退出新的订阅。

修复：服务端按 socket 接收顺序串行 membership 操作，客户端取消过期 ack 的额外 leave。并发 Owner participant 创建同时改为数据库 skipDuplicates。

验证：快速 leave/join 集成测试、双浏览器实时往返、切换项目不串消息、重连补齐均通过。不要用定时轮询消息来掩盖房间丢订阅。
