import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DSH_HOME = process.env.DSH_HOME ?? ''
const { __test } = await import('../index.js')

const NOW = new Date(2026, 10, 1, 12, 0, 0)

/** In-memory VaultIndex stand-in with the link/IDF surfaces retrieval uses. */
function fakeIndex(rows) {
  const notes = new Map(rows.map((row) => [row.rel, row]))
  const gramDf = () => {
    const df = new Map()
    for (const note of notes.values()) for (const gram of __test.bigrams(note.search)) df.set(gram, (df.get(gram) ?? 0) + 1)
    return df
  }
  return {
    root: '/tmp/vault',
    notes,
    get(rel) {
      return notes.get(String(rel).replaceAll('\\', '/')) ?? null
    },
    backlinks: new Map(),
    resolveLinkTarget: () => null,
    gramDocumentFrequency: gramDf,
  }
}

const note = (rel, body, extras = {}) => __test.parseNote(rel, body, body.length, extras.mtimeMs ?? 0)

test('parseNote extracts frontmatter, date, tasks and links', () => {
  const parsed = note('日记/2026-10-28.md', '---\ntags: [工作, 深思]\nmood: 平静\n---\n\n# 日记\n\n- [ ] 回复邮件\n- [x] 跑步\n\n看到 [[项目/计划]] 的进度。')
  assert.equal(parsed.date, '2026-10-28')
  assert.deepEqual(parsed.tags.sort(), ['工作', '深思'])
  assert.equal(parsed.tasksTotal, 2)
  assert.equal(parsed.tasksDone, 1)
  assert.deepEqual(parsed.links, ['项目/计划'])
  assert.equal(parsed.fm.mood, '平静')
  assert.ok(parsed.tags.includes('深思'))
})

test('parseYamlLite handles scalars and arrays', () => {
  const fm = __test.parseYamlLite('title: 想法\ntags:\n  - a\n  - b\nweight: 72.5')
  assert.equal(fm.title, '想法')
  assert.deepEqual(fm.tags, ['a', 'b'])
  assert.equal(fm.weight, '72.5')
})

test('searchNotes ranks phrase hits first and drops unrelated notes', () => {
  const index = fakeIndex([
    note('笔记/工作法.md', '我采用深度工作法，每天上午两小时不被打扰。'),
    note('笔记/浅度.md', '浅度的工作状态容易被打断。'),
    note('收藏/跑步.md', '本周开始跑步健身，配速五分半。'),
  ])
  const hits = __test.searchNotes(index, { query: '深度工作', limit: 5 })
  assert.equal(hits.length, 1, 'partial overlap below the bigram threshold must not surface noise')
  assert.equal(hits[0].path, '笔记/工作法.md')
  assert.equal(__test.searchNotes(index, { query: '深度工作', folder: '收藏' }).length, 0)
  assert.equal(__test.searchNotes(index, { query: '跑步' })[0].path, '收藏/跑步.md')
})

test('searchNotes matches through bigram coverage without a literal phrase', () => {
  const index = fakeIndex([note('笔记/节奏.md', '工作节拍很稳，节奏感强。')])
  const hits = __test.searchNotes(index, { query: '工作节奏' })
  assert.equal(hits.length, 1)
  assert.ok(hits[0].score > 0)
})

test('searchNotes keeps common-word grazes below the recency threshold', () => {
  const index = fakeIndex([note('收藏/新.md', '这个方法的应用场景很多。', { mtimeMs: Date.now() })])
  const hits = __test.searchNotes(index, { query: '量子纠缠 厨房里 应用' })
  if (hits.length > 0) {
    assert.ok(hits[0].score < 1, 'a lone common-word hit must not ride the freshness bonus')
  }
})

test('searchNotes stays useful without a document-frequency provider', () => {
  const index = fakeIndex([note('笔记/a.md', '关键词出现在这里。')])
  delete index.gramDocumentFrequency
  assert.equal(__test.searchNotes(index, { query: '关键词' }).length, 1)
})

test('folderInRole matches the folder and its subfolders only', () => {
  assert.equal(__test.folderInRole('日记', ['日记']), true)
  assert.equal(__test.folderInRole('日记/2026/2026-10-28.md', ['日记']), true)
  assert.equal(__test.folderInRole('收藏/文章', ['日记']), false)
  assert.equal(__test.folderInRole('', ['日记']), false)
  assert.equal(__test.folderInRole('复盘', []), false)
})

test('normalizeFolderRoles accepts only known roles with usable values', () => {
  assert.equal(__test.normalizeFolderRoles(null), null)
  assert.equal(__test.normalizeFolderRoles({ unknown: ['x'] }), null)
  assert.deepEqual(__test.normalizeFolderRoles({ journal: [' 日记 ', ''] }), { journal: ['日记'] })
  assert.deepEqual(__test.normalizeFolderRoles({ journal: ['日记'], clips: ['收藏'] }), { journal: ['日记'], clips: ['收藏'] })
})

test('excerptAround prefers the densest window over the first mention', () => {
  const body = `${'填充内容。'.repeat(500)}这里展开深度工作的细节与心得。${'记录。'.repeat(500)}`
  // production excerpt limits are 1600–2400 chars; the window must contain the match
  const excerpt = __test.excerptAround(body, ['深度工作'], 1600)
  assert.ok(excerpt.includes('深度工作'), 'the chosen window must contain the match')
  assert.ok(excerpt.startsWith('…'))
})

test('excerptAround falls back to the document head without matches', () => {
  const excerpt = __test.excerptAround('开头的内容', ['不存在的词'], 100)
  assert.ok(excerpt.startsWith('开头的内容'))
})

test('collectOpenTasks lists unchecked tasks and honors the date range', () => {
  const index = fakeIndex([
    note('日记/2026-10-20.md', '- [ ] 任务甲\n- [x] 已完成'),
    note('日记/2026-10-28.md', '- [ ] 任务乙'),
    note('收藏/2026-09-01.md', '- [ ] 任务丙'),
  ])
  const all = __test.collectOpenTasks(index, null)
  assert.equal(all.length, 3)
  const week = __test.collectOpenTasks(index, { start: '2026-10-19', end: '2026-10-25' })
  assert.deepEqual(week.map((task) => task.text), ['任务甲'])
})

test('computeStats aggregates counts and completion', () => {
  const index = fakeIndex([
    note('日记/2026-10-20.md', '- [ ] a\n- [x] b'),
    note('项目/计划.md', '# 计划'),
  ])
  const stats = __test.computeStats(index, { groupBy: 'folder' })
  assert.equal(stats.noteCount, 2)
  assert.equal(stats.tasksTotal, 2)
  assert.equal(stats.tasksDone, 1)
  assert.equal(stats.completion, 50)
  assert.ok(stats.rows.some((row) => row.key === '日记' && row.count === 1))
})

test('buildAskBundle keeps journal questions inside the journal role', () => {
  const index = fakeIndex([
    note('日记/2026-10-22.md', '今天状态不错，完成了深度工作两小时。', { mtimeMs: 1 }),
    note('收藏/读书.md', '深度工作这本书的摘录。', { mtimeMs: 1 }),
  ])
  const bundle = __test.buildAskBundle(index, '总结上周的日记', NOW, null, { ...__test.ROLE_DEFAULT_DIRS })
  assert.equal(bundle.range.start, '2026-10-19')
  for (const source of bundle.sources) {
    assert.ok(__test.folderInRole(source.folder, __test.ROLE_DEFAULT_DIRS.journal), `clips must stay out: ${source.path}`)
  }
})

test('buildAskBundle reuses the previous turn as a retrieval prior', () => {
  const index = fakeIndex([
    note('日记/2026-10-22.md', '项目讨论与卡点记录。', { mtimeMs: 1 }),
    note('收藏/无关.md', '完全无关的剪藏内容。', { mtimeMs: 2 }),
  ])
  const prior = {
    question: '上周的项目进展',
    sources: [{ path: '日记/2026-10-22.md' }],
    range: { label: '上周', start: '2026-10-19', end: '2026-10-25' },
  }
  const bundle = __test.buildAskBundle(index, '再展开讲讲第二点', NOW, prior, { ...__test.ROLE_DEFAULT_DIRS })
  assert.deepEqual(bundle.range, prior.range)
  assert.ok(bundle.sources.some((source) => source.path === '日记/2026-10-22.md' && source.reason.includes('承接上文')))
})

test('buildAskBundle flags weak retrieval instead of answering blindly', () => {
  const index = fakeIndex([
    note('收藏/无关甲.md', '剪藏内容甲。', { mtimeMs: 1 }),
    note('收藏/无关乙.md', '剪藏内容乙。', { mtimeMs: 2 }),
  ])
  const bundle = __test.buildAskBundle(index, '量子纠缠在厨房里的应用', NOW, null, { ...__test.ROLE_DEFAULT_DIRS })
  assert.equal(bundle.strongMatches, 0)
  assert.ok(bundle.user.includes('检索说明'))
})

test('buildAskBundle counts strong matches when retrieval is confident', () => {
  const index = fakeIndex([
    note('日记/2026-10-22.md', '深度工作的记录与思考。', { mtimeMs: 1 }),
  ])
  const bundle = __test.buildAskBundle(index, '最近关于深度工作写了什么', NOW, null, { ...__test.ROLE_DEFAULT_DIRS })
  assert.ok(bundle.strongMatches > 0)
})

test('buildAskBundle expands one link-graph hop around strong seeds', () => {
  const journal = note('日记/2026-10-22.md', '项目推进记录，见 [[项目/计划]]。', { mtimeMs: 1 })
  const plan = note('项目/计划.md', '里程碑与下一步安排。', { mtimeMs: 1 })
  const index = fakeIndex([journal, plan])
  index.resolveLinkTarget = (target) => (target === '项目/计划' ? '项目/计划.md' : null)
  index.backlinks = new Map([['项目/计划.md', ['日记/2026-10-22.md']]])
  // no "日记" in the question, so the journal-role scope filter stays open
  const bundle = __test.buildAskBundle(index, '上周的项目进展', NOW, null, { ...__test.ROLE_DEFAULT_DIRS })
  assert.ok(bundle.sources.some((source) => source.path === '项目/计划.md' && source.reason.includes('链接关联')))
})
