# Cursor Usage

在 Cursor / VS Code 状态栏，以**文本进度条 + 精确数值**实时显示你的 Cursor plan 剩余用量，鼠标悬停查看详情。

```
状态栏:   $(pulse) ▰▰▱▱▱ 41%  $12.30/$30.00      ← 美元额度账号
          $(pulse) ▰▰▱▱▱ 43%  213/500            ← 请求次数账号
          $(pulse) 0 次 · 不限量                  ← 企业 / 不限量账号
```

悬停弹窗显示：套餐、账号、已用 / 剩余 / 额度、进度、重置日期、更新时间，并带「刷新 / Dashboard / 日志」快捷链接。

## 特性

- **零配置**：自动从本地 Cursor 数据库 (`state.vscdb`) 读取登录凭证，重新登录后自动生效。
- **双计费模型自适应**（`auto`）：
  - 美元额度（按量付费 / Pro 的 `$` 上限）——走 `get-hard-limit` + `get-monthly-invoice`
  - 请求次数（经典 fast/premium 请求额度）——走 `/api/usage`
  - 没有有限额度时显示「不限量」
- 用量超过阈值（默认 90%）状态栏黄色高亮告警。
- 定时自动刷新 + 手动刷新命令。
- 完整日志输出通道，便于排查。

## 安装 / 运行（开发模式）

1. 安装依赖并编译：
   ```bash
   npm install
   npm run compile
   ```
2. 在 **Cursor / VS Code** 中打开本项目文件夹。
3. 按 `F5`（运行「运行扩展」配置）启动「扩展开发宿主」窗口，新窗口右下角状态栏即会出现用量。

> 开发时可用 `npm run watch` 持续编译。

## 打包成 .vsix（长期安装）

```bash
npm install -g @vscode/vsce
vsce package
```
生成 `cursor-usage-0.1.0.vsix` 后，在 Cursor 中：命令面板 → `Extensions: Install from VSIX...` 选择该文件即可。

## 命令

| 命令 | 说明 |
|---|---|
| `Cursor Usage: 刷新用量` | 立即刷新（点击状态栏也会触发） |
| `Cursor Usage: 打开 Dashboard` | 浏览器打开 cursor.com 设置页 |
| `Cursor Usage: 查看日志` | 打开输出面板，查看请求与原始响应 |

## 设置项（`cursorUsage.*`）

| 设置 | 默认 | 说明 |
|---|---|---|
| `mode` | `auto` | 计量模型：`auto` / `dollars` / `requests` |
| `refreshInterval` | `60` | 自动刷新间隔（秒，最小 10） |
| `model` | `gpt-4` | 请求型套餐下跟踪的模型额度键名 |
| `barWidth` | `5` | 进度条字符宽度 |
| `warnThreshold` | `90` | 告警高亮阈值（%） |
| `alignment` | `right` | 状态栏对齐方向 |
| `priority` | `100` | 状态栏排序优先级（越大越靠左） |
| `token` | `""` | 可选，手动指定凭证（留空则自动读取） |
| `dbPath` | `""` | 可选，手动指定 `state.vscdb` 路径 |

## 工作原理

1. 从 `state.vscdb` 的 `ItemTable` 读取 `cursorAuth/accessToken`（JWT），解析出 `sub` / `userId`。
2. 用 `WorkosCursorSessionToken` Cookie 调用 `cursor.com` 接口（POST 自动带 `Origin` 头通过 CSRF 校验）。
3. 归一化为 `{已用, 额度, 单位}` 后渲染进度条。

`state.vscdb` 默认路径：

- macOS: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
- Windows: `%APPDATA%\Cursor\User\globalStorage\state.vscdb`
- Linux: `~/.config/Cursor/User/globalStorage/state.vscdb`

## 排错

- 状态栏显示「不可用」：点开**悬停 → 查看日志**，看 `/api/auth/me` 是否 200。
  - 403/401：凭证过期，请在 Cursor 中重新登录。
  - 读不到数据库：在设置里手动填 `dbPath` 或 `token`。
- 数值与 Dashboard 对不上（尤其美元模式）：把「查看日志」里的 `get-hard-limit` / `get-monthly-invoice` 原始响应贴出来，便于按你的账号结构微调解析字段。

> 注：本扩展依赖 Cursor 的非公开接口，官方接口变动时可能需要适配。
