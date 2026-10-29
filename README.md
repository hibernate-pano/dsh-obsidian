# Obsidian 笔记 · DSH 插件

把本地 Obsidian 笔记库接进 **DeepSeek Harness**：左侧栏一个图标进全局面板，同时给 Agent 一组读写笔记的工具。

[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE) ![version](https://img.shields.io/badge/version-v0.0.1-informational)

> **EN** — An Obsidian vault bridge for DeepSeek Harness. One sidebar panel (browse / search / preview / stats / create) plus nine agent tools to search, summarize, count and write notes. Zero build step, no runtime dependencies, purely local.

## 界面

```
┌──────────────────────────────────────────────────────────────┐
│ ◆ Obsidian   资料/笔记/obsidian-notes        ●1006 篇  切换库 刷新 统计 新建 │
├───────────────┬──────────────────────────────────────────────┤
│ 🔍 搜索笔记…    │ 2026-10-28                                    │
│ ▸ 日记  780    │ ───────────────────────────────────────────   │
│ ▸ 笔记   61    │ ## 待办                                       │
│ ▸ 收藏   77    │ - [x] …                                       │
│ ▸ 复盘   54    │ ## 记录                                       │
├───────────────┴──────────────────────────────────────────────┤
│ [在对话中提问]  [总结这篇]                                     │
└──────────────────────────────────────────────────────────────┘
```

<!-- 截图位：把真机截图放到 docs/panel.png，然后把上一段代码块替换为 ![面板](docs/panel.png) -->

## 功能

| 能力 | 说明 |
|---|---|
| **自动挂载** | 读 Obsidian 自己的 `obsidian.json`，挂载你当前打开的那个 vault；找不到时按常见目录探测，也可在面板里手动选目录 |
| **面板** | 目录树 / 笔记列表 / 全文搜索 / Markdown 预览 / 文件夹统计 / 新建笔记 |
| **Agent 工具** | `obsidian_status` `obsidian_search` `obsidian_read` `obsidian_list` `obsidian_daily` `obsidian_stats` `obsidian_write` `obsidian_append` `obsidian_reindex` |
| **中文检索** | 双字 bigram + 标题/标签/路径加权，不依赖分词模型 |
| **日记感知** | 自动读取 vault 的 `daily-notes.json`，按你的 `folder` + `format` 解析日期（如 `日记/2026/2026-10-28.md`） |
| **写入** | 默认拥有写权限、无需逐次确认；`create` 永不覆盖，写入原子化，旧内容自动备份 |

实测（1006 篇笔记、1.36 MB 正文）：冷扫描 ≈ 0.4s，检索 ≈ 16ms，索引常驻内存并按时按 `mtime + size` 增量刷新。

## 安装

**前置**：能打开 Web UI 的 DSH（桌面版或 `dsh web`）。面板属于 Web 端插件，纯 CLI profile 只会得到工具、没有面板。

### 方式 A：直接从 GitHub 安装

在 DSH 里安装 bundle，spec 用 GitHub 地址：

```
github:hibernate-pano/dsh-obsidian
```

或在 Plugins 页面粘贴同一个 spec。安装完成后**刷新页面**（或重启 App），左侧栏出现紫色宝石图标。

### 方式 B：本地源码（开发/调试用）

```bash
git clone https://github.com/hibernate-pano/dsh-obsidian.git
```

然后把 `install_bundle` 的 target 指向**克隆后的绝对路径**。这条路径用 `link:` 记录，改完代码刷新页面即可生效（Host 半边改动需重装或重启）。

## 使用

1. 先打开 Obsidian（让 `obsidian.json` 记住当前库），再刷新 DSH — 面板会自动挂到那个库。
2. 对话里直接说：
   - 「总结我上周的日记」
   - 「我今年写了多少篇日记？待办完成率多少？」
   - 「把这条想法记到收件箱」
3. 或者点侧栏图标 → 搜到笔记 → 底部「在对话中提问」。

Agent 回答时会被要求带上笔记的 vault 相对路径，方便你回查。

## 数据、安全与边界

- **只读你自己的库**：忽略 `.obsidian`、`.trash`、`.git`、附件目录与 `系统/备份`。
- **路径不越界**：所有读写都限制在 vault 根目录内，`../` 直接拒绝。
- **写前有备份**：旧内容复制到 `$DSH_HOME/dsh-obsidian/backup/<时间戳>/<相对路径>`。
- **状态文件**：`$DSH_HOME/dsh-obsidian/state.json`（记录选中的库）。
- **不联网**，**不接 git 自动提交**，不上传任何笔记内容。
- 与 Obsidian 同时编辑同一篇时以写入方为准；写入前不做二次确认，所以请确保 `obsidian_create` 类模板不误覆盖（`create` 模式本身不会覆盖已有文件）。

## 兼容性

- 在 **macOS + DSH Desktop** 上开发与实测。
- vault 探测覆盖 macOS / Windows / Linux 的 `obsidian.json` 位置，但目前只在 macOS 实测过；其它平台失败时用面板的「切换库」手动选目录。

## 文件结构

```
package.json      # dsh.bundle.patch + dsh.client
cordis.patch.yml  # 插入一行 Host 插件
index.js          # Host：vault 探测、索引、9 个工具、/obsidian/api/* 路由
client.js         # Client：侧栏图标 + main 面板（无构建、无依赖）
locale/*.json     # 插件列表页文案（中/英）
icon.svg          # 插件列表图标
```

这是纯 ESM、零构建、零运行时依赖的实现：`client.js` 直接通过 `window.__ModuleLoader__.load` 注册，`index.js` 只用 `node:fs` / `node:path` / `node:os`。

## 版本

- `v0.0.1` — 首个公开版本：面板、9 个工具、自动挂载、写入与备份。

## License

[MIT](./LICENSE) © 2026 panbo
