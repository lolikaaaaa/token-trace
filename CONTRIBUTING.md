# Contributing

感谢你对 Token Trace 的关注。

## 提交问题

- 使用最新版本并确认问题可以稳定复现。
- 截图和日志必须删除用户名、完整路径、任务内容及任何凭证。
- 请说明 Windows、Codex 和 Token Trace 版本以及复现步骤。

## 开发检查

```bash
npm install
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

提交 Pull Request 时，请保持 Local-first、No Server 原则，不要添加遥测、广告 SDK 或未经明确同意的网络请求。涉及 Codex 连接逻辑时，必须验证真实 Tauri EXE，不能只验证浏览器预览。

## 产品原则

- 任务名称保留原始语言，不自动翻译。
- 不使用假数据冒充真实账户数据。
- 无法读取的数据明确显示为不可用。
- 不读取、记录或上传用户凭证。
- 保持桌面组件轻量、克制、可读。
