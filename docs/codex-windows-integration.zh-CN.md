---
title: Windows 上将 VellumPix 接入另一个 Codex 会话
description: "供另一 Codex 会话直接执行的本机 VellumPix MCP 注册、配置复用和验收说明。"
---

# Windows 本机 VellumPix → Codex 接入说明

> 把本文直接交给同一台 Windows 电脑上的另一个 Codex 会话执行。当前项目已经安装、
> 构建并完成 ChatGPT 登录；目标是复用现有仓库、专用 Edge Profile、Thread/Session
> 数据和浏览器进程，把 `vellumpix-mcp` 注册到 Codex。不要重新部署，不要重新复制
> Cookie，也不要修改用户日常 Chrome Profile。

## 一、当前已验证状态

以下信息于 2026-10-27 在本机验证：

| 项目               | 当前值                                                           |
| ------------------ | ---------------------------------------------------------------- |
| 源码仓库           | `D:\CODEX\2026-10-26_VellumPix`                                  |
| GitHub             | `https://github.com/dbquant/vellumpix`                           |
| Node               | `C:\Program Files\nodejs\node.exe`，版本 `24.19.0`               |
| pnpm               | 版本 `11.25.0`                                                   |
| VellumPix          | 版本 `0.1.0`                                                     |
| 全局 npm 包        | Junction，指向上述源码仓库                                       |
| CLI                | `C:\Users\db\AppData\Roaming\npm\vellumpix.ps1`                  |
| MCP 命令           | `C:\Users\db\AppData\Roaming\npm\vellumpix-mcp.ps1`              |
| VellumPix 数据目录 | `C:\Users\db\.vellumpix`                                         |
| 专用 Edge Profile  | `C:\Users\db\.vellumpix\browser-profiles\edge`                   |
| 浏览器策略         | Edge 优先、Chrome 后备、manual login、no-focus                   |
| Thread 热标签缓存  | 最多 3 个，空闲 20 分钟回收                                      |
| Codex CLI MCP 状态 | `codex mcp get vellumpix` 当前返回未注册，需要执行本文的注册步骤 |

Edge DevTools 使用随机端口，端口会随浏览器重启变化。不要把当前端口写入配置；VellumPix
会从专用 Profile 和 Session 元数据发现当前端点。

## 二、执行边界

- 默认使用简体中文报告结果。
- 不删除、重建或清空 `C:\Users\db\.vellumpix`。
- 不读取、输出或复制密码、验证码、Cookie、认证文件和完整连接令牌。
- 不访问用户日常 Chrome Profile；只使用上述 VellumPix 专用 Edge Profile。
- 不关闭当前 Edge，除非用户明确要求或确认没有正在执行的任务。
- 不覆盖仓库中的用户改动；先检查 `git status --short`。
- 不运行 `npm install -g @dbquant/vellumpix`；当前已经通过本地 Junction 安装。
- 不在 Codex MCP 配置中固定 DevTools 端口。
- 登录已经完成；只有实际认证失效时才暂停并让用户本人在专用 Edge 中重新登录。

## 三、只读环境检查

在 PowerShell 中执行：

```powershell
$repo = "D:\CODEX\2026-10-26_VellumPix"

git -C $repo status --short
git -C $repo rev-parse HEAD
node --version
pnpm --version
vellumpix --version
codex --version

Get-Command node, vellumpix, vellumpix-mcp, codex |
    Select-Object Name, Source
```

确认构建入口存在：

```powershell
$nodePath = (Get-Command node.exe).Source
$mcpEntry = "D:\CODEX\2026-10-26_VellumPix\dist\bin\vellumpix-mcp.js"

Test-Path -LiteralPath $nodePath -PathType Leaf
Test-Path -LiteralPath $mcpEntry -PathType Leaf
```

两个结果必须都是 `True`。如果 `dist` 缺失或明显落后于源码，才执行：

```powershell
Set-Location -LiteralPath "D:\CODEX\2026-10-26_VellumPix"
pnpm install --frozen-lockfile
pnpm build
```

不要仅为注册 MCP 重复构建。

## 四、现有 VellumPix 配置

配置文件位于 `C:\Users\db\.vellumpix\config.json`。当前关键值为：

```json5
{
  engine: "browser",
  browser: {
    provider: "edge",
    fallbackProvider: "chrome",
    manualLogin: true,
    noFocus: true,
    maxRetainedThreadTabs: 3,
    threadTabIdleTimeoutMs: 1200000,
  },
}
```

不要覆盖整个文件。若任务需要跨调用保留浏览器和网页会话，优先在 MCP 调用中明确传入：

```json
{
  "browserKeepBrowser": true,
  "browserArchive": "never"
}
```

这比为所有其他用途强制修改全局默认值更安全。带 `threadId` 的 VellumPix 浏览器任务还会
保留可恢复的 Thread/Session 映射。

## 五、注册 VellumPix MCP

OpenAI 官方支持用 `codex mcp add` 注册 stdio MCP。这里使用 Node 和 MCP 文件的绝对
路径，避免 Codex 桌面端与 PowerShell 的 PATH 不一致。

先检查是否已经注册：

```powershell
codex mcp get vellumpix
```

只有在返回“未找到”时才添加：

```powershell
$nodePath = (Get-Command node.exe).Source
$mcpEntry = "D:\CODEX\2026-10-26_VellumPix\dist\bin\vellumpix-mcp.js"

codex mcp add vellumpix `
  --env VELLUMPIX_ENGINE=browser `
  --env VELLUMPIX_MCP_ALLOW_EXTERNAL_OUTPUT=1 `
  -- $nodePath $mcpEntry
```

说明：

- `VELLUMPIX_ENGINE=browser` 确保调用 ChatGPT 网页版，不会因为机器上存在 API Key
  而切换到 API 模式。
- `VELLUMPIX_MCP_ALLOW_EXTERNAL_OUTPUT=1` 允许用户指定任意图片下载目录。若只希望使用
  `C:\Users\db\.vellumpix\generated`，可以省略该变量。
- MCP 使用 stdio，不需要另开 HTTP 端口或后台常驻服务；Codex 按需启动 Node 进程。

验证注册：

```powershell
codex mcp list
codex mcp get vellumpix
```

然后重启 Codex 桌面端或新开一个 Codex 会话，用 `/mcp` 确认 `vellumpix` 已启用。

预期工具：

- `threads`：管理持久任务线和 ChatGPT conversation 映射。
- `chatgpt_image`：网页生图、参考图上传、图片下载。
- `consult`：网页文稿生成、修改和其他文字任务。
- `sessions`：查看运行历史、状态和产物。
- `wait`：等待分离运行的长任务。
- `project_sources`：管理 ChatGPT Project Sources，属于持久外部变更，使用前需单独确认。

## 六、无副作用验收

新 Codex 会话接入后，先执行以下检查，不向 ChatGPT 提交提示词：

1. 调用 `threads`：

   ```json
   { "action": "list", "includeArchived": false }
   ```

2. 调用 `sessions`：

   ```json
   { "hours": 24, "limit": 10 }
   ```

3. 调用 `consult` dry-run：

   ```json
   {
     "engine": "browser",
     "prompt": "只验证 VellumPix 配置，不要提交到网页。",
     "dryRun": true
   }
   ```

确认结果使用 browser 引擎、Edge 和 VellumPix 专用 Profile。dry-run 不应创建真实
ChatGPT 消息。

## 七、真实生图与文稿验收

只有在用户要求完成真实测试时才执行本节。

### 1. 新建测试 Thread

调用 `threads`：

```json
{
  "action": "create",
  "id": "windows-vellumpix-smoke",
  "title": "Windows VellumPix 接入测试",
  "tags": ["image", "writing", "smoke-test"]
}
```

如果该 ID 已存在，先 `get`，不要覆盖；改用带日期时间的唯一 ID。

### 2. 用户指定下载目录

先让用户指定目录；若用户未指定，可使用：

```powershell
$outputDir = "D:\CODEX\VellumPix-output\windows-smoke"
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
(Resolve-Path -LiteralPath $outputDir).Path
```

调用 `chatgpt_image` 时使用绝对路径：

```json
{
  "threadId": "windows-vellumpix-smoke",
  "prompt": "生成一张极简蓝色圆形图标，白色背景，无文字，无水印。",
  "aspectRatio": "1:1",
  "outputPath": "D:\\CODEX\\VellumPix-output\\windows-smoke\\round-01.png",
  "browserKeepBrowser": true,
  "browserArchive": "never"
}
```

确认返回 `structuredContent.images[]`，文件存在、大小合理、能够正常打开。

### 3. 在同一网页会话中生成文稿

调用 `consult`，继续使用同一 `threadId`：

```json
{
  "threadId": "windows-vellumpix-smoke",
  "engine": "browser",
  "prompt": "根据刚才的图标，写三条简短中文设计说明。",
  "browserKeepBrowser": true,
  "browserArchive": "never"
}
```

### 4. 在同一网页会话中调整图片

再次调用 `chatgpt_image`，仍传相同 `threadId`：

```json
{
  "threadId": "windows-vellumpix-smoke",
  "prompt": "继续修改刚才的图标：只把蓝色改成墨绿色，其他构图保持不变。",
  "aspectRatio": "1:1",
  "outputPath": "D:\\CODEX\\VellumPix-output\\windows-smoke\\round-02.png",
  "browserKeepBrowser": true,
  "browserArchive": "never"
}
```

检查三次调用的 ChatGPT `conversationId` 一致，Session 父链连续，后两轮优先复用同一个
Edge target 和 window。

## 八、日常会话管理约定

- 新任务线：先 `threads(action="create")`，然后为所有调用传固定 `threadId`。
- 继续历史任务：`threads(action="list")` → `threads(action="get")` → 继续使用原
  `threadId`。
- 精确继续某次 Session：使用 `resumeSessionId`；常规业务优先使用 `threadId`。
- 同一个 Thread 有跨进程锁，避免两个并发任务同时操作同一个网页标签。
- 不同 Thread 可以并发，但受浏览器标签上限和系统资源限制。
- 已完成 Thread 的热标签可能被 LRU 回收；Thread/Session、conversation URL、文稿和
  图片映射仍保存在磁盘，之后可以重新打开。
- VellumPix 只能可靠列出自己管理的 Thread，不承诺枚举 ChatGPT 侧边栏的全部历史会话。

## 九、浏览器使用约定

- 使用的是专用 Edge，不是用户日常 Chrome。
- MCP 活跃期间不要关闭整个 Edge，也不要刷新、关闭或手动操作被自动化的 ChatGPT
  标签页。
- 用户可以操作其他应用；Edge 使用 no-focus，普通调用不应主动抢前台。
- 登录、Cloudflare 验证或 no-focus 回退时，Edge 仍可能短暂切到前台。
- 不推荐默认 headless；ChatGPT 网页渲染、可信点击和图片下载在 headful 模式更稳定。
- 不要在每次调用前结束 Edge。VellumPix 会优先复用同一浏览器实例、窗口和 Thread 标签。

## 十、故障排查

### Codex 看不到 MCP

```powershell
codex mcp list
codex mcp get vellumpix
```

确认注册内容使用：

- `C:\Program Files\nodejs\node.exe`
- `D:\CODEX\2026-10-26_VellumPix\dist\bin\vellumpix-mcp.js`

随后重启 Codex 应用或新开会话。

### MCP 启动即退出

在 PowerShell 手动运行：

```powershell
& "C:\Program Files\nodejs\node.exe" `
  "D:\CODEX\2026-10-26_VellumPix\dist\bin\vellumpix-mcp.js"
```

正常 stdio MCP 会等待输入；用 `Ctrl+C` 退出。若报告缺少模块，再回仓库执行
`pnpm install --frozen-lockfile` 和 `pnpm build`。

### Edge 登录失效

不要复制 Chrome Cookie。使用原专用 Profile 重新启动登录流程，并由用户本人完成：

```powershell
vellumpix --engine browser `
  --browser-provider edge `
  --browser-manual-login `
  --browser-keep-browser `
  --browser-no-focus `
  --browser-input-timeout 5m `
  -p "只回复：VellumPix 登录恢复成功"
```

### 生图成功但没有保存到指定位置

- 检查 `structuredContent.images[].path`。
- 必须使用绝对 Windows 路径。
- 确认 MCP 环境包含 `VELLUMPIX_MCP_ALLOW_EXTERNAL_OUTPUT=1`。
- 检查目标目录权限、剩余磁盘空间和是否存在 Chrome 临时下载文件。

### 同一 Thread 却新开窗口或标签

- 检查调用是否始终传入相同 `threadId`。
- 检查父 Session 是否记录有效 `chromeTargetId` 和 `conversationId`。
- target 已关闭或浏览器已重启时，新建标签属于正常恢复；但应保持同一 conversation。
- 可使用仓库中的 `scripts/test-chatgpt-image-thread.ps1 -ChooseThread` 做交互式多轮验证。

## 十一、交付报告模板

执行完成后，只报告以下信息，不输出认证数据：

```text
VellumPix Windows Codex 接入结果
- 仓库路径与 commit：
- Node / pnpm / Codex / VellumPix 版本：
- Codex MCP 注册：通过/失败
- MCP 工具发现：
- 专用 Edge Profile：已复用/需要用户重新登录
- threads/sessions 只读检查：通过/失败
- consult dry-run：通过/失败
- 真实文字测试：未执行/通过/失败
- 真实生图测试与输出路径：未执行/通过/失败
- 同一 Thread 续接：未执行/通过/失败
- 未解决问题：
```

参考：[OpenAI Codex MCP 官方说明](https://developers.openai.com/codex/mcp/)；仓库中的
`docs/mcp.md`、`docs/browser-mode.md`、`docs/configuration.md` 和
`docs/manual-tests.md`。
