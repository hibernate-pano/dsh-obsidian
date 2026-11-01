# Obsidian 笔记 · DSH 插件

把本地 Obsidian 笔记库接进 **DeepSeek Harness**：打开侧栏图标，先看到的是一个**全局问答框**——不用逐篇打开，直接问「最近一个月的工作状态」「我现在有哪些待办」，答案流式出现，并附上可点击的来源笔记。

[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE) ![version](https://img.shields.io/badge/version-v0.3.0-informational)

> **EN** — An Obsidian vault bridge for DeepSeek Harness. The sidebar opens on a streaming, citation-backed global Q&A surface with local retrieval, follow-up priors, save-as-note and quality feedback, alongside note browsing, search, stats, per-note Q&A and eleven agent tools. Zero build step, no runtime dependencies.

## 界面

```
┌────────────────────────────────────────────────────────────────────┐
│ ◆ Obsidian   ~/资料/笔记/obsidian-notes    1009 篇  切换库 刷新 新建 │
│                      [ 问答 ] [ 笔记 ] [ 统计 ]                    │
├────────────────────────────────────────────────────────────────────┤
│                          ◇  YOUR SECOND BRAIN                      │
│                    今天想从笔记里 知道些什么？                       │
│        不用打开每一篇。全局问答会检索整个笔记库，回答带来源。         │
│      ┌──────────────────────────────────────────────────────┐      │
│      │ 问任何关于你笔记的问题，例如：最近一个月的工作状态…    │      │
│      │ ✦ 深度思考                          Enter 发送   ↑   │      │
│      └──────────────────────────────────────────────────────┘      │
│      ┌───────────────────────┐  ┌───────────────────────┐          │
│      │ 最近一个月的工作状态   │  │ 我现在有哪些待办？     │          │
│      │ 从日记与复盘里提炼…    │  │ 汇总所有未完成事项…    │          │
│      └───────────────────────┘  └───────────────────────┘          │
│      1009 篇 · 7 本周记录 · 29 本月记录 · 62 未完成待办 · 95% 完成率 │
└────────────────────────────────────────────────────────────────────┘
```

问答开始后，同一个面板变成对话流：用户气泡、带光标的流式答案、`来源 · N 篇笔记` 芯片、复制/重试，以及底部常驻输入框。

## 功能

| 能力 | 说明 |
|---|---|
| **全局问答** | 一个输入框问整个库；本地检索 + 当前模型流式生成，答案逐字出现，不用跳进每篇笔记 |
| **来源可回查** | 每条回答带 `来源 · N 篇笔记`，芯片上会标出入选原因（检索命中 / 时间范围内 / 链接关联…），点一下在面板里打开，旁边的 ↗ 直接跳进 Obsidian 本体（`obsidian://` 深链） |
| **追问承接** | 追问会自动沿用上一轮的回答范围与来源作为检索先验，「再展开第二点」不用重复交代上下文 |
| **保存为笔记** | 每条回答可一键写回库里（默认 `问答/日期 问题.md`，永不覆盖、自动编号、原子写入），问答结论沉淀进 PKM |
| **质量反馈** | 回答下方 👍/👎，反馈落到 `$DSH_HOME/dsh-obsidian/feedback.jsonl`，作为后续检索调优的数据 |
| **时间感知** | 自动识别 今天 / 昨天 / 本周 / 上周 / 本月 / 上个月 / 今年 / 去年 / 最近 N 天、周、月、年 / `2025年3月` 等范围 |
| **任务汇总** | 问「待办」时扫描全库未完成 `- [ ]`，按笔记与日期排序，指出长期未完成项 |
| **精确计数** | 问「今年写了多少篇日记」时先算精确数字，再交给模型组织答案，不靠估算 |
| **检索升级** | bigram 覆盖按文档频率加权（常用字自动降权，不靠手写停用词表）；`[[链接]]` 图谱一跳扩展，相关但不共享关键词的笔记也能召回；每篇摘录按命中密度选窗，不再只取第一处 |
| **目录角色** | 日记 / 复盘 / 项目 / 收藏 的目录名不再写死：从 daily-notes 配置和常见命名自动推断，可在 `state.json` 的 `folderRoles` 里覆盖（见下文） |
| **三种视图** | `问答` / `笔记` / `统计`；笔记视图保留目录、搜索、Markdown 预览、新建与每篇笔记的问答入口 |
| **阅读预设** | 顶栏 `Aa` 可调回答宽度（窄/标准/宽/超宽）与字号（小/标准/大/特大），并可切换衬线/界面字体；默认衬线栈参考 Claude 风格插件 |
| **模型选择** | 默认跟随 DSH 当前会话模型；也可以在 `Aa` 里为 Obsidian 面板单独选择 provider/model，选择会持久化 |
| **斜杠模板** | 输入 `/` 或点输入框下方 `/ 常用模板`，内置 8 个常用 Prompt：月度工作、本周思考、本周待办占比、重要事项、健康趋势、情绪精力、项目卡点、阅读收获 |
| **流式交互** | SSE 逐 token 推送；思考态、闪烁光标、自动跟随、停止生成、复制、重试、新对话、最近提问 |
| **Agent 工具** | `obsidian_status` `obsidian_search` `obsidian_read` `obsidian_list` `obsidian_daily` `obsidian_tasks` `obsidian_stats` `obsidian_write` `obsidian_append` `obsidian_edit` `obsidian_reindex` |
| **自动挂载** | 读 Obsidian 自己的 `obsidian.json` 挂载当前 vault；也可在面板里手动选目录 |
| **中文检索** | 双字 bigram + IDF 加权 + 标题/标签/路径加权，不依赖分词模型 |
| **日记感知** | 读取 vault 的 `daily-notes.json`，解析 `folder` + `format`；周复盘 `2026-W44` 也能换算成日期 |
| **写入** | `create` 永不覆盖，写入原子化，旧内容自动备份；`obsidian_edit` 精准替换前也先备份 |

实测（1009 篇笔记、1.36 MB 正文）：冷扫描 ≈ 0.4s，检索 ≈ 16ms，索引常驻内存并按时按 `mtime + size` 增量刷新。一次问答通常取 10–18 篇相关笔记、约 5–20k 字上下文，首 token 取决于模型服务。

## 问答是怎么工作的

1. **本地检索**：Host 半边在内存索引里做四件事——按问题里的时间范围取对应日期的笔记；用清洗后的关键词做 IDF 加权的 bigram 检索；问待办时扫描未完成项；对最强的候选做一跳 `[[链接]]` 图谱扩展。追问时还会把上一轮回答的范围与来源作为先验一并纳入。
2. **拼上下文**：库概览、时间范围统计、未完成待办、相关笔记摘录（单篇约 1.6–2.4k 字，总预算约 56k 字）一起交给模型。检索不到强相关笔记时，会显式告诉模型「本次没有强相关摘录」，回答会承认信息不足而不是硬答。
3. **流式回答**：`POST /obsidian/api/ask` 返回 `text/event-stream`，事件为 `meta`（来源/范围/模型）、`phase`（检索/思考/写作）、`delta`（文本）、`done`、`error`。Client 用 `ReadableStream` 读 SSE，约 32ms 合并一次 delta，避免逐字重渲染。
4. **来源回查**：`meta.sources` 里的 vault 相对路径渲染成芯片（附入选原因），点击走 `/obsidian/api/note`；芯片旁的 ↗ 通过 `obsidian://open` 跳进 Obsidian 本体；「保存为笔记」走 `/obsidian/api/ask-save`。

「深度思考」开关会把 `reasoningEffort` 从 `low` 提到 `high/max`（模型支持时），适合复杂总结；普通提问默认走快速档。

### 阅读与模型设置

顶栏 `Aa` 打开「问答设置」：

- **回答宽度**：窄 760 / 标准 900 / 宽 1040 / 超宽 1200 px。
- **正文字号**：小 14 / 标准 15.5 / 大 17 / 特大 18.5 px。
- **字体风格**：`衬线 · Claude`（默认）使用 `"Anthropic Serif Web Text", "Claude Style Noto Serif", Georgia, "Songti SC", "Noto Serif SC"` 等字体栈；`跟随界面` 则用 DSH 自己的无衬线字体。
- **回答模型**：默认「跟随 DSH 当前模型」，即调用 `agentDefaultModel.currentSelection()`；也可以展开按 provider 分组的模型列表单独选择。自定义只影响 Obsidian 面板，选择保存在 `localStorage`。如果自定义模型已下线，Host 会回退到 DSH 当前模型，并在面板提示。

### 斜杠模板

在输入框输入 `/` 会弹出模板菜单，支持 `↑↓` 选择、`Enter` 填入、`Esc` 关闭；也可以直接点输入框底部的 `/ 常用模板`。内置：

| 模板 | 用途 |
|---|---|
| 最近一个月的工作情况 | 进展、卡点、节奏与精力变化 |
| 本周思考回顾 | 反复出现的主题、判断变化、未想清楚的问题 |
| 本周待办完成情况 | 完成数 / 总数 / 完成占比 + 延期最久项；Host 先算该范围的精确 `已完成/总数/占比`，不靠模型估算 |
| 重要事项总结 | 真正改变方向的事 vs. 只是忙碌的事 |
| 本月健康与体重趋势 | 体重、尿酸、血糖、睡眠、运动 |
| 最近一周的情绪与精力 | 状态高点、低谷与触发因素 |
| 我在推进的项目与卡点 | 每个项目的进展、下一步、阻塞 |
| 本周阅读与收藏收获 | 值得记住的观点与可行动启发 |

### 目录角色

问答的权重与过滤（日记优先、收藏降权、问「日记」只看日记目录…）以前把 `日记/复盘/项目/收藏` 写死，现在改为**角色 → 目录名**的映射，按顺序解析：

1. `$DSH_HOME/dsh-obsidian/state.json` 里的 `folderRoles` 覆盖（如 `{"journal": ["我的日记"], "clips": ["收藏", "剪藏"]}`，只写要改的角色）；
2. vault 的 `daily-notes.json` 里配置的日记目录，自动并入 `journal`；
3. 常见命名的默认值：`日记/日志/daily/journal`、`复盘/回顾/周报/月报/review`、`项目/projects`、`笔记/notes`、`收藏/剪藏/clips`。

`status` 接口会返回解析结果，方便排查「为什么这篇没被选中」。

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

把 `install_bundle` 的 target 指向**克隆后的绝对路径**。这条路径用 `link:` 记录；Client 改动刷新页面即可，Host 改动需重装或重启。

## 使用

1. 打开 Obsidian（让 `obsidian.json` 记住当前库），再刷新 DSH。
2. 点侧栏「Obsidian 笔记」，在首页直接问：
   - 「最近一个月的工作状态」
   - 「我现在有哪些待办？」
   - 「总结上周的日记」
   - 「今年写了多少篇日记？待办完成率多少？」
3. 回答下方点来源芯片回查原文（↗ 直接跳进 Obsidian）；继续在底部输入框追问。
4. 想沉淀结论：点回答下方的「保存为笔记」，问答会写回 `问答/日期 问题.md`；觉得答得好/不好也可以点 👍/👎 留下反馈。
5. 想针对单篇提问：`笔记` 视图打开一篇 → 右上「问这篇」，会带着这篇的标题回到问答框；也可以点「在对话中提问」把提示词复制到主对话。

## 数据、安全与边界

- **只读你自己的库**：忽略 `.obsidian`、`.trash`、`.git`、附件目录与 `系统/备份`。
- **路径不越界**：所有读写都限制在 vault 根目录内，`../` 直接拒绝。
- **写前有备份**：旧内容复制到 `$DSH_HOME/dsh-obsidian/backup/<时间戳>/<相对路径>`。
- **状态文件**：`$DSH_HOME/dsh-obsidian/state.json`（记录选中的库与 `folderRoles` 覆盖）、`feedback.jsonl`（问答质量反馈，仅评分与问题文本）。
- **保存为笔记**：默认写入 vault 的 `问答/` 目录，走与面板新建笔记相同的原子写 + 备份路径。
- **问答会把摘录发给模型**：检索在本地完成，但生成答案时，相关笔记摘录会发送给当前配置的模型服务（Magpie / DeepSeek 等）；插件本身不额外上传、不建向量库、不自动提交 git。
- **上下文有上限**：最多约 18 篇笔记 / 56k 字摘录；问题超出笔记内容时，回答会明确说「笔记里没有足够信息」，不编造。

## 兼容性

- 在 **macOS + DSH Desktop** 上开发与实测（深色主题 + 中文界面）。
- 面板只用 `--dsw-alias-*` 主题 token 与 `color-mix`，浅色/深色都走同一套变量；未单独跑浅色截图。
- vault 探测覆盖 macOS / Windows / Linux 的 `obsidian.json` 位置，目前只在 macOS 实测；其它平台失败时用「切换库」手动选目录。

## 文件结构

```
package.json      # dsh.bundle.patch + dsh.client + npm test
cordis.patch.yml  # 插入一行 Host 插件
index.js          # Host：vault 探测、索引、检索、SSE 问答、11 个工具、/obsidian/api/*
client.js         # Client：侧栏图标 + main 面板（问答首页/对话流/笔记/统计）
locale/*.json     # 插件列表页文案（中/英）
test/*.test.mjs   # 零依赖 node:test 单测（时间解析/检索/写入）
icon.svg          # 插件列表图标
```

纯 ESM、零构建、零运行时依赖：`client.js` 通过 `window.__ModuleLoader__.load` 注册，`index.js` 只用 `node:fs` / `node:path` / `node:os`。跑测试：`npm test`（需要 Node 18+ 的 `node:test`）。

## 版本

- `v0.3.0` — 追问承接上一轮范围与来源、回答保存为笔记、👍/👎 质量反馈、来源芯片展示入选原因、`obsidian://` 跳转 Obsidian、目录角色配置化（不写死目录名）、bigram IDF 加权、`[[链接]]` 图谱一跳扩展、多窗口摘录、空结果诚实声明；新增 `obsidian_tasks` / `obsidian_edit` 工具与 27 个零依赖单测。保留全局问答、流式来源、时间检索、阅读预设与原有 9 个 Agent 工具。
- `v0.2.0` — 阅读宽度/字号/衬线预设、按面板选择模型（默认跟随 DSH）、8 个斜杠模板；保留全局问答、流式来源、时间检索与 9 个 Agent 工具。
- `v0.1.0` — 全局问答首页、流式回答与来源回查、时间范围检索、待办汇总、精确计数、问答/笔记/统计三视图；保留 9 个 Agent 工具。
- `v0.0.1` — 首个公开版本：面板、9 个工具、自动挂载、写入与备份。

## License

[MIT](./LICENSE) © 2026 panbo
