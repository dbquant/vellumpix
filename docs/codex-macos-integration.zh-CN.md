---
title: macOS 上接入 Codex
description: "交给另一个 Codex 执行的 VellumPix 源码安装、专用 Chrome 登录、MCP 注册与验收说明。"
---

# VellumPix macOS → Codex 接入说明

> 本文可直接交给另一个 Codex 执行。目标是在同一台 macOS 机器上运行
> VellumPix，通过独立的 Chrome 自动化 Profile 使用已经登录的 ChatGPT
> 网页版，并以本地 stdio MCP 的方式接入 Codex CLI/桌面端。

## 一、目标与边界

- 项目仓库：`https://github.com/dbquant/vellumpix.git`
- 要求 Node.js 24 或更高版本，使用项目锁定的 pnpm 安装依赖。
- 使用 `browser` 引擎，不需要 OpenAI API Key。
- 使用 VellumPix 独立 Chrome Profile，默认位于
  `~/.vellumpix/browser-profiles/chrome`；不要读取、复制或修改用户日常 Chrome
  Profile。
- Chrome 保持 headful，通过 `noFocus` 在后台工作；不要把 headless 作为默认生产模式。
- 密码、验证码、Cookie 和令牌必须由用户自己处理，不得写入日志、文档或 Codex
  提示词。
- 登录 ChatGPT 是唯一必须由用户在浏览器中亲自完成的步骤。到达该步骤时暂停并提示用户，
  用户确认登录完成后再继续。

## 二、执行前检查

先确认系统和现有安装，不覆盖已有配置：

```bash
uname -m
sw_vers
command -v brew || true
command -v git || true
command -v node || true
command -v pnpm || true
command -v codex || true
node --version 2>/dev/null || true
codex --version 2>/dev/null || true
```

若缺少 Homebrew，请让用户按 Homebrew 官方方式安装。若 Node 主版本低于 24：

```bash
brew install node@24 git
export PATH="$(brew --prefix node@24)/bin:$PATH"
corepack enable
corepack prepare pnpm@11.28.2 --activate
```

把 Node 24 路径持久加入 `~/.zshrc` 前，先检查是否已有等价配置，避免重复写入。
Google Chrome 未安装时执行：

```bash
brew install --cask google-chrome
```

## 三、获取并构建 VellumPix

npm 包若尚未发布，直接使用 GitHub 源码。默认安装目录可用
`~/Projects/vellumpix`；若目录已存在，先确认它就是本仓库并保留其中的用户改动。

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone https://github.com/dbquant/vellumpix.git
cd vellumpix
corepack enable
pnpm install --frozen-lockfile
pnpm build
npm link
```

已有仓库则改为：

```bash
cd ~/Projects/vellumpix
git status --short
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
npm link
```

验证入口：

```bash
vellumpix --version
command -v vellumpix
command -v vellumpix-mcp
test -f ~/Projects/vellumpix/dist/bin/vellumpix-mcp.js
```

若全局链接在图形版 Codex 的 PATH 中不可见，后续 MCP 配置直接使用 `node` 和
`dist/bin/vellumpix-mcp.js` 的绝对路径，不依赖 `vellumpix-mcp` 命令名。

## 四、VellumPix 用户配置

创建或合并 `~/.vellumpix/config.json`。文件是 JSON5；已有配置时只合并下列字段，
不要覆盖其他用户配置：

```json5
{
  engine: "browser",
  browser: {
    provider: "chrome",
    fallbackProvider: null,
    manualLogin: true,
    noFocus: true,
    keepBrowser: true,
    archiveConversations: "never",
    maxConcurrentTabs: 3,
    maxRetainedThreadTabs: 3,
    threadTabIdleTimeoutMs: 1200000,
  },
}
```

含义：

- `manualLogin`：使用可持久化的专用 Chrome Profile，只需登录一次。
- `noFocus`：普通运行不主动抢占前台；首次启动、登录或风控验证仍可能切到前台。
- `keepBrowser`：一次 MCP 调用结束后保留浏览器，便于复用进程、窗口和标签页。
- `archiveConversations: "never"`：保留网页会话，方便后续按 Thread 继续处理。
- `maxRetainedThreadTabs`：仅保留少量热会话标签；历史映射仍保存在本地 Thread/Session
  元数据中。

## 五、首次 ChatGPT 登录

执行：

```bash
vellumpix \
  --engine browser \
  --browser-provider chrome \
  --browser-manual-login \
  --browser-keep-browser \
  --browser-no-focus \
  --browser-input-timeout 5m \
  -p "只回复：VellumPix 登录测试成功"
```

Chrome 打开后暂停自动化，让用户在该专用窗口中完成 ChatGPT 登录。不要索取密码、验证码
或 Cookie。用户确认已登录后，等待命令完成，并检查：

```bash
vellumpix status --hours 1
```

专用 Chrome 在 MCP 调用期间必须保持运行。用户可以切换到其他应用；不应刷新、关闭或手动
操作正在被自动化的 ChatGPT 标签页。关闭整个 Chrome 后，VellumPix 可再次启动同一
Profile，通常仍会保留登录状态。

## 六、注册本地 MCP 到 Codex

OpenAI 官方支持用 `codex mcp add` 注册 stdio MCP。为避免图形应用 PATH 不一致，解析并
使用绝对路径：

```bash
NODE_BIN="$(command -v node)"
MCP_ENTRY="$HOME/Projects/vellumpix/dist/bin/vellumpix-mcp.js"
test -x "$NODE_BIN"
test -f "$MCP_ENTRY"
```

如果已有同名 MCP，先读取而不是盲目重复添加：

```bash
codex mcp get vellumpix || true
```

确定旧配置需要替换时：

```bash
codex mcp remove vellumpix 2>/dev/null || true
codex mcp add vellumpix \
  --env VELLUMPIX_ENGINE=browser \
  --env VELLUMPIX_MCP_ALLOW_EXTERNAL_OUTPUT=1 \
  -- "$NODE_BIN" "$MCP_ENTRY"
```

`VELLUMPIX_MCP_ALLOW_EXTERNAL_OUTPUT=1` 允许用户把生成图片保存到
`~/Pictures`、项目素材目录等自定义位置。如果只需要安全默认目录
`~/.vellumpix/generated`，应省略该环境变量。

检查注册结果：

```bash
codex mcp list
codex mcp get vellumpix
```

然后重新启动 Codex CLI/桌面端，或至少开启一个新的 Codex 会话。在 Codex 中用 `/mcp`
确认 `vellumpix` 已启用。预期工具包括：

- `threads`：创建、列出、读取、归档和重新激活持久任务线。
- `chatgpt_image`：使用 ChatGPT 网页生图并下载图片。
- `consult`：使用 ChatGPT 网页生成、修改文稿或执行其他文字任务。
- `sessions`：查看运行记录和产物。
- `wait`：等待已分离的长任务完成。

## 七、验收顺序

### 1. 无副作用检查

先调用 `threads` 的 `list`，再调用 `sessions` 列出最近记录。然后调用一次：

```json
{
  "prompt": "只做配置检查，不要提交到网页。",
  "engine": "browser",
  "dryRun": true
}
```

确认返回的计划使用本地 browser 引擎和专用 Chrome Profile。

### 2. 新任务线与真实生图

先调用 `threads`：

```json
{
  "action": "create",
  "id": "mac-vellumpix-smoke",
  "title": "macOS VellumPix 接入测试",
  "tags": ["image", "smoke-test"]
}
```

建立输出目录并解析绝对路径：

```bash
mkdir -p "$HOME/Pictures/VellumPix"
cd "$HOME/Pictures/VellumPix" && pwd
```

调用 `chatgpt_image`，其中 `outputPath` 必须使用上一步得到的绝对路径，不要传带 `~`
的字符串：

```json
{
  "threadId": "mac-vellumpix-smoke",
  "prompt": "生成一张极简蓝色圆形图标，白色背景，无文字，无水印。",
  "aspectRatio": "1:1",
  "outputPath": "/Users/<用户名>/Pictures/VellumPix/smoke.png",
  "browserKeepBrowser": true,
  "browserArchive": "never"
}
```

确认返回 `structuredContent.images[]`，且图片文件存在、大小合理并可正常打开。

### 3. 同一 Thread 的文稿与二次生图

调用 `consult`，继续传相同 `threadId`：

```json
{
  "threadId": "mac-vellumpix-smoke",
  "engine": "browser",
  "prompt": "根据刚才的图标，为它写三条简短中文设计说明。",
  "browserArchive": "never"
}
```

随后再次调用 `chatgpt_image`，仍传 `threadId: "mac-vellumpix-smoke"`，要求只修改颜色。
验证三次调用保持同一个 ChatGPT conversation，并且 Thread 的 Session 父链连续。

## 八、会话管理约定

- 新项目：先 `threads(action="create")`，再把固定 `threadId` 传给每次
  `consult`/`chatgpt_image`。
- 继续旧项目：先 `threads(action="list")` 或 `threads(action="get")`，选中后继续传原
  `threadId`。
- 精确继续某一次运行：使用 `resumeSessionId`；一般业务任务优先使用 `threadId`。
- 同一 Thread 的任务会串行化，防止两个并发请求争抢同一个网页标签。
- 不同 Thread 可以并行，但会受到 `maxConcurrentTabs` 限制。
- VellumPix 管理的是自己的 Thread/Session 索引，不承诺枚举 ChatGPT 侧边栏里所有历史
  会话。

## 九、常见问题

### Codex 看不到 MCP

1. 执行 `codex mcp list`。
2. 确认配置中的 Node 和 MCP 入口都是绝对路径。
3. 执行 `node ~/Projects/vellumpix/dist/bin/vellumpix-mcp.js`，确认没有模块缺失错误；该
   stdio 进程正常情况下会等待 MCP 输入，可用 `Ctrl+C` 退出。
4. 重启 Codex 应用或开启新会话。

### Chrome 没有登录或重复弹登录

- 确认运行的是专用 Profile，而不是日常 Chrome。
- 检查 `~/.vellumpix/browser-profiles/chrome` 是否存在。
- 再执行一次第五节的首次登录命令，让用户亲自完成验证。
- 不要通过复制日常 Chrome Cookie 来规避登录。

### 生图成功但找不到文件

- 检查 MCP 返回的 `structuredContent.images[].path`。
- 自定义目录必须传绝对路径。
- 写到 `~/.vellumpix/generated` 以外时，确认 MCP 注册包含
  `VELLUMPIX_MCP_ALLOW_EXTERNAL_OUTPUT=1`。
- 检查目录权限和剩余磁盘空间。

### 浏览器抢前台或影响鼠标操作

- 确认 `browser.noFocus=true`。
- 保持 headful；不要默认改为 headless。
- 登录、Cloudflare 验证或 no-focus 回退时，Chrome 仍可能短暂切到前台。
- 自动化运行中不要操作其 ChatGPT 标签页；日常 Chrome 的其他 Profile/窗口可正常使用。

## 十、交付报告模板

完成后向用户报告以下内容，不展示凭据：

```text
VellumPix macOS 接入结果
- 仓库路径：
- Git commit：
- Node / pnpm / Codex 版本：
- VellumPix 构建：通过/失败
- 专用 Chrome Profile：
- ChatGPT 登录：已由用户完成/待用户完成
- Codex MCP：已注册/失败
- MCP 工具发现：
- dryRun：通过/失败
- 真实文字测试：通过/失败
- 真实生图测试及输出路径：
- 同一 Thread 续接：通过/失败
- 尚未解决的问题：
```

参考：[OpenAI Codex MCP 官方说明](https://developers.openai.com/codex/mcp/)；VellumPix
仓库内的 `docs/mcp.md`、`docs/browser-mode.md` 和 `docs/configuration.md`。
