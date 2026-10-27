# Changelog

## 0.1.0 — 2026-10-27

- 首次以 **VellumPix** 名称发布项目源码。
- CLI 与 MCP 入口统一为 `vellumpix` 和 `vellumpix-mcp`。
- 配置、会话及浏览器 Profile 统一存储在 `~/.vellumpix`。
- 环境变量统一使用 `VELLUMPIX_*` 前缀。
- Windows 默认使用隔离的 Edge 自动化 Profile，并在不可用时回退到 Chrome；macOS 与 Linux 优先使用 Chrome。
- 适配 ChatGPT 新版生图 DOM，支持图片回复识别、下载，以及文稿会话续聊。
