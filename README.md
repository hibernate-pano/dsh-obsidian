# Obsidian 笔记（DSH 插件）

把本地 Obsidian 笔记库挂进 DeepSeek Harness：左侧栏一个图标进全局面板，同时给 Agent 一组读写笔记的工具。

## 它做什么

- **自动挂载**：启动时读 Obsidian 的 `obsidian.json`，挂载你当前打开的那个 vault；找不到时按常见目录探测，也可在面板里手动选目录。
- **面板**（左侧栏 → 紫色宝石图标）：目录浏览、笔记列表、全文搜索、Markdown 预览、文件夹统计、新建笔记。
- **Agent 工具**：`obsidian_status / search / read / list / daily / stats / write / append / reindex`。
- **写入**：默认拥有写权限，无需逐次确认；`create` 永不覆盖，写入原子化，旧内容自动备份到 `$DSH_HOME/dsh-obsidian/backup/`。

## 用起来

1. 刷新 DSH 页面（新装插件需要重新加载客户端模块）。
2. 对话里直接说：「总结我上周的日记」「我今年写了多少篇日记」「把这个想法记到收件箱」。
3. 或点侧栏图标 → 搜/选一篇 → 面板底部「在对话中提问」。

## 数据与边界

- 只读你自己选的 vault；忽略 `.obsidian`、`.trash`、`.git`、附件目录与 `系统/备份`。
- 索引全在内存，1000 篇约 0.4s 冷扫、之后按 mtime+size 增量。
- 中文检索按双字 bigram，不依赖分词。
- 状态文件：`$DSH_HOME/dsh-obsidian/state.json`。
- 不联网，不接 git 自动提交。

## 目录

```
package.json      # dsh.bundle.patch + dsh.client
cordis.patch.yml  # 插入一行 Host 插件
index.js          # Host：索引、工具、/obsidian/api/* 路由
client.js         # Client：侧栏图标 + main 面板（无构建、无依赖）
locale/*.json     # 插件列表页文案
icon.svg          # 插件列表图标
```
