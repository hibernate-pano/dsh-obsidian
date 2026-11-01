import assert from 'node:assert/strict'
import test from 'node:test'

process.env.DSH_HOME = process.env.DSH_HOME ?? ''
const { __test } = await import('../index.js')

// A fixed "now" so every assertion is deterministic. 2026-11-01 is a Sunday.
const NOW = new Date(2026, 10, 1, 12, 0, 0)

test('detectAskRange resolves day-level expressions', () => {
  assert.deepEqual(__test.detectAskRange('今天写了什么', NOW), { start: '2026-11-01', end: '2026-11-01', label: '今天', matched: '今天' })
  assert.equal(__test.detectAskRange('昨天做了什么', NOW).start, '2026-10-31')
  assert.equal(__test.detectAskRange('前天的日记', NOW).start, '2026-10-30')
})

test('detectAskRange resolves week, month and year ranges', () => {
  assert.equal(__test.detectAskRange('总结上周', NOW).start, '2026-10-19')
  assert.equal(__test.detectAskRange('总结上周', NOW).end, '2026-10-25')
  assert.equal(__test.detectAskRange('本周待办', NOW).start, '2026-10-26')
  assert.equal(__test.detectAskRange('本月统计', NOW).start, '2026-11-01')
  assert.equal(__test.detectAskRange('上个月写了多少', NOW).start, '2026-10-01')
  assert.equal(__test.detectAskRange('上个月写了多少', NOW).end, '2026-10-31')
  assert.equal(__test.detectAskRange('今年写了多少篇日记', NOW).start, '2026-01-01')
  assert.equal(__test.detectAskRange('去年', NOW).start, '2025-01-01')
  assert.equal(__test.detectAskRange('去年', NOW).end, '2025-12-31')
})

test('detectAskRange resolves relative spans and explicit months', () => {
  const thirty = __test.detectAskRange('最近一个月的工作状态', NOW)
  assert.equal(thirty.start, '2026-10-03')
  assert.equal(thirty.end, '2026-11-01')
  assert.equal(thirty.matched, '最近一个月')
  assert.equal(__test.detectAskRange('最近三周', NOW).start, '2026-10-12')
  assert.equal(__test.detectAskRange('最近在忙什么', NOW).label, '最近两周')
  assert.equal(__test.detectAskRange('2025年3月的心得', NOW).start, '2025-03-01')
  assert.equal(__test.detectAskRange('2025年3月的心得', NOW).end, '2025-03-31')
  assert.equal(__test.detectAskRange('3月的复盘', NOW).start, '2026-03-01')
  assert.equal(__test.detectAskRange('我在推进什么项目', NOW), null)
})

test('parseCnNumber reads digits and compound Chinese numerals', () => {
  assert.equal(__test.parseCnNumber('10'), 10)
  assert.equal(__test.parseCnNumber('十'), 10)
  assert.equal(__test.parseCnNumber('二十'), 20)
  assert.equal(__test.parseCnNumber('二十三'), 23)
  assert.equal(__test.parseCnNumber('两'), 2)
  assert.equal(__test.parseCnNumber('未知'), null)
})

test('shiftDay crosses month and year boundaries', () => {
  assert.equal(__test.shiftDay('2026-03-01', -1), '2026-02-28')
  assert.equal(__test.shiftDay('2025-01-01', -1), '2024-12-31')
  assert.equal(__test.shiftDay('2026-02-28', 1), '2026-03-01')
})

test('isoWeekMonday maps ISO weeks to Mondays', () => {
  assert.equal(__test.isoWeekMonday(2026, 44), '2026-10-26')
  assert.equal(__test.isoWeekMonday(2026, 1), '2025-12-29')
})

test('applyDateFormat renders daily-note filename patterns', () => {
  const date = new Date(2026, 1, 5, 12, 0, 0)
  assert.equal(__test.applyDateFormat('YYYY-MM-DD', date), '2026-02-05')
  assert.equal(__test.applyDateFormat('YYYY/MM/DD ddd', date), '2026/02/05 ddd')
  assert.equal(__test.applyDateFormat('M月D日', date), '2月5日')
})

test('cleanAskQuery strips the matched range and filler words', () => {
  const range = __test.detectAskRange('总结一下最近一个月的工作状态', NOW)
  assert.equal(__test.cleanAskQuery('总结一下最近一个月的工作状态', range), '工作')
})
