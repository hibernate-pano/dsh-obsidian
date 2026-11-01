import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// isolate backup/state side effects in a throwaway DSH_HOME before index.js loads
process.env.DSH_HOME = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-obs-test-'))
const { __test } = await import('../index.js')

test('absOf refuses paths that escape the vault root', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-obs-vault-'))
  assert.equal(__test.absOf(root, '日记/a.md'), path.join(root, '日记/a.md'))
  assert.throws(() => __test.absOf(root, '../escape.md'))
  assert.throws(() => __test.absOf(root, '日记/../../escape.md'))
})

test('writeNote creates atomically, refuses overwrites and replaces with backup', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-obs-vault-'))
  const created = await __test.writeNote(root, { path: '收件箱/想法.md', content: '# 想法\n\n第一版\n', mode: 'create' })
  assert.equal(created.path, '收件箱/想法.md')
  assert.equal(created.backup, null)

  await assert.rejects(
    () => __test.writeNote(root, { path: '收件箱/想法.md', content: '覆盖', mode: 'create' }),
    /文件已存在/,
  )

  const replaced = await __test.writeNote(root, { path: '收件箱/想法.md', content: '# 想法\n\n第二版\n', mode: 'replace' })
  assert.equal(replaced.mode, 'replace')
  assert.ok(typeof replaced.backup === 'string' && replaced.backup.includes('backup'))
  const text = await fsp.readFile(path.join(root, '收件箱/想法.md'), 'utf8')
  assert.ok(text.includes('第二版'))
})

test('editNote does a literal replace and refuses ambiguous matches', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-obs-vault-'))
  await __test.writeNote(root, { path: '项目/计划.md', content: '第一步：调研\n第二步：调研\n第三步：实施\n', mode: 'create' })

  const edited = await __test.editNote(root, { path: '项目/计划.md', find: '实施', replace: '落地' })
  assert.equal(edited.changes, 1)
  let text = await fsp.readFile(path.join(root, '项目/计划.md'), 'utf8')
  assert.ok(text.includes('第三步：落地'))

  await assert.rejects(
    () => __test.editNote(root, { path: '项目/计划.md', find: '调研', replace: '访谈' }),
    /出现 2 次/,
  )

  const all = await __test.editNote(root, { path: '项目/计划.md', find: '调研', replace: '访谈', replaceAll: true })
  assert.equal(all.changes, 2)
  text = await fsp.readFile(path.join(root, '项目/计划.md'), 'utf8')
  assert.ok(text.includes('第一步：访谈') && text.includes('第二步：访谈'))

  await assert.rejects(() => __test.editNote(root, { path: '项目/计划.md', find: '不存在的原文', replace: 'x' }), /没有找到/)
  await assert.rejects(() => __test.editNote(root, { path: '不存在.md', find: 'a', replace: 'b' }), /文件不存在/)
})
