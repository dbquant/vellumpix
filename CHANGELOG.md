# Changelog

## 0.1.0 — 2026-10-27

- 首次以 **VellumPix** 名称发布项目源码。
- CLI 与 MCP 入口统一为 `vellumpix` 和 `vellumpix-mcp`。
- 配置、会话及浏览器 Profile 统一存储在 `~/.vellumpix`。
- 环境变量统一使用 `VELLUMPIX_*` 前缀。
- Windows 默认使用隔离的 Edge 自动化 Profile，并在不可用时回退到 Chrome；macOS 与 Linux 优先使用 Chrome。
- 适配 ChatGPT 新版生图 DOM，支持图片回复识别、下载，以及文稿会话续聊。
- 新增持久化 Thread 任务线：CLI 与 MCP 均可把多轮生图/文稿 Session 映射到同一 ChatGPT 会话，支持历史查询、跨调用恢复、标签检索及归档。
- 新增 Windows PowerShell 同会话多轮生图测试脚本，可脱离 Codex 直接验证会话复用、Session 父子链与图片产物完整性，并提供不联网、不提交请求的 `-PlanOnly` 模式。
- 持久化 Thread 现在优先复用仍指向同一 ChatGPT 会话的 Edge/Chrome 标签页，失效时安全新建；新增跨进程 Thread 独占锁，并支持在续聊时正确应用 `noFocus` 等当前浏览器设置。
- 同会话 PowerShell 测试脚本新增 target 复用及 `noFocus` 断言，可直接发现多轮任务意外新增标签页或抢占前台的回归。
