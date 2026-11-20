# Changelog

- ChatGPT 网页文本回复按已提交的用户消息 ID 匹配，避免 UUID 会话轮次被虚拟化后因 DOM 下标变化而等待超时。

- 修复 GPT-5.6 模型与推理强度选择误用隐藏按钮的问题，并识别新版模型属性；普通文本发送使用精确按钮的键盘激活。
- 修复长会话虚拟化导致最新回复轮次下标归零、完整回答被过滤并一直等待的问题；保留逻辑轮次并定期显示最新回复后验证完成状态。

- 混合显式文件与通配符时，显式附件现在保留，即使位于被 .gitignore 排除的目录；显式排除参数仍然生效。
- 当前模型识别过滤隐藏文字及“Thinking effort”标题，并优先读取已选模型单选项。

- MCP 初始化说明将文本任务指向 `consult`，将生图与改图指向 `chatgpt_image`，并要求失败时报告问题，禁止自动回退到 computer use。
- MCP 续接网页会话时可显式切换模型，并可逐次设置推理强度。

- ChatGPT 登录探测遇到短暂的网络或 `AbortError` 时会先自动重试，避免并发生图误报需要重新登录；明确的登录页、登录按钮和已解析登出状态仍会立即提示登录。
- Linux 附件上下文 CI proof 改用预留的显式 DevTools 端口启动 Chrome，避免繁忙 runner 上动态端口日志发现超时。
- 强化本地同一 Thread 多轮生图脚本的 CDP 窗口身份检查，另开 Edge/Chrome 窗口不再被误判为成功复用标签页。
- 本地多轮生图脚本新增 `-ChooseThread` 交互菜单，可按标题选择并续接已有会话，或创建新的会话任务线。

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
- 新增 Thread 浏览器标签 LRU 缓存：默认仅保留最近 3 个会话 target，空闲 20 分钟自动回收，并保护所有运行中或持锁任务；历史会话仍可通过持久化 URL 恢复。
- `noFocus` 下的新 Thread 现在复用现有自动化浏览器窗口并创建后台标签页，不再为每条任务线请求独立 Edge/Chrome 窗口。
