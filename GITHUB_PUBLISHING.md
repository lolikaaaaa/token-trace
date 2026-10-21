# GitHub 发布填写内容

## 仓库名称

`token-trace`

## Description

`Local-first Windows widget for monitoring Codex usage limits, reset times, tasks and token activity.`

## Topics

`codex`, `openai`, `tauri`, `react`, `rust`, `windows`, `desktop-widget`, `local-first`, `developer-tools`, `productivity`

## 首个 Release

- Tag：`v0.1.0-beta.5`
- 标题：`Token Trace v0.1.0 Beta 5`

## Release notes

Token Trace 的首个公开测试版本。

### 主要功能

- Windows 桌面 Mini Widget，可拖动、置顶、展开和收起
- 读取真实 Codex 5h / 7d 剩余额度与 Reset 时间
- 显示当天最近 10 个任务及对应 Token
- 每 5 分钟自动同步，休眠恢复后自动补刷
- 支持深青、浅紫和浅蓝主题
- Local-first，不接 Token Trace 自建服务器

### 使用方法

1. 安装并登录 Codex Windows 应用。
2. 下载并解压 `Token-Trace-Portable-v0.1.0-beta.5.zip`。
3. 双击 `Token Trace.exe`。

### 注意

- 这是未签名的早期测试版，SmartScreen 可能提示“未知发布者”。
- “本地记录”Token 是上下文 Token 总量，不代表 API 账单金额。
- 统计页仍包含原型数据。
