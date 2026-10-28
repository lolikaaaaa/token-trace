# Token Trace macOS 继续开发交接

这是 Token Trace 的 macOS 预览版源码包。请在 Mac 上解压整个文件夹后，用 Codex 打开解压后的项目根目录。

## 当前完成状态

- React / TypeScript 界面与 Windows 版本共用。
- Rust 后端已经按平台区分 Codex 可执行文件和 Codex Home 的发现逻辑。
- macOS 会尝试发现 `$HOME/.codex`、Homebrew、常见 CLI 安装目录，以及 `/Applications/Codex.app` 内部的 Codex CLI。
- 已配置透明、无边框、置顶窗口。
- 已通过 GitHub 的 Intel macOS Runner 构建 Universal `.app` 和 `.dmg`，兼容 Apple Silicon 与 Intel。
- Windows 回归构建通过。

## 在 Mac 上先做什么

1. 安装 Xcode Command Line Tools、Node.js 22+ 和 Rust stable。
2. 安装并登录 Codex，确认 Codex 本身可正常使用。
3. 在项目根目录运行：

   ```bash
   npm install
   npm run tauri dev
   ```

4. 重点验证：
   - Mini Widget 是否透明、置顶、可拖动；
   - 展开与收起尺寸是否正常；
   - 5h / 7d、Reset 是否读取真实账户数据；
   - 今天 / 本周任务及 Token 是否可读取；
   - 关闭、重复启动、睡眠唤醒和多显示器行为。

5. 如果显示“未连接”，不要先改登录目录。请记录：
   - 实际找到的 Codex 可执行文件；
   - `codex app-server --stdio` 的 stderr；
   - `initialize`、`account/read`、`account/rateLimits/read` 的第一个失败节点；
   - 严禁输出 `auth.json` 内容、access token、refresh token 或 API Key。

## 构建安装包

```bash
npm run tauri build -- --target universal-apple-darwin --bundles app,dmg
```

未签名构建仅用于内部测试。正式发布前需要 Apple Developer ID 签名和 Notarization。

GitHub 仓库：https://github.com/lolikaaaaa/token-trace

