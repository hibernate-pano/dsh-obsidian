/**
 * Host half of the `dsh-obsidian` bundle.
 *
 * Owns everything that needs a filesystem: vault discovery, the note index, the
 * agent tools, and the same-origin HTTP routes the Web panel calls.
 *
 * @module @local/dsh-obsidian
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PLUGIN_ID = 'dsh-obsidian'
const HOME = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(os.homedir(), '.dsh')
const DATA_DIR = path.join(HOME, PLUGIN_ID)
const STATE_FILE = path.join(DATA_DIR, 'state.json')
const BACKUP_DIR = path.join(DATA_DIR, 'backup')

/** Directories never indexed, never searched, never written. */
const SKIP_DIRS = new Set([
  '.obsidian', '.trash', '.git', 'node_modules', '.weread-cache', '.agents',
  '.laputa', '.dsh-backup', '.cache', 'attachments', '附件',
])
/** Vault-relative folder prefixes that hold copies rather than notes. */
const SKIP_REL_PREFIXES = ['系统/备份']
const MAX_FILES = 30000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const INDEX_TTL_MS = 5000
const ROUTE_PREFIX = '/obsidian/api'

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

const now = () => Date.now()

/** @param {string} s */
const norm = (s) => s.normalize('NFKC').toLowerCase()

/** Case-insensitive substring test on already-normalized text. @param {string} hay @param {string} needle */
const has = (hay, needle) => hay.indexOf(needle) !== -1

function unquote(value) {
  const v = value.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1)
  return v
}

/** `[a, b]` or a quoted scalar. @param {string} raw */
function parseScalarOrArray(raw) {
  const v = raw.trim()
  if (v.startsWith('[') && v.endsWith(']')) {
    return v
      .slice(1, -1)
      .split(',')
      .map((x) => unquote(x))
      .filter((x) => x !== '')
  }
  return unquote(v)
}

/**
 * Deliberately small YAML reader: scalars, inline arrays, block arrays and one
 * level of nesting. Anything it does not understand is skipped rather than
 * guessed, so a malformed note never breaks the index.
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
function parseYamlLite(text) {
  const out = Object.create(null)
  let key = null
  let nested = null
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '' || rawLine.trimStart().startsWith('#')) continue
    const item = /^\s*-\s+(.*)$/.exec(rawLine)
    if (item !== null && key !== null) {
      if (Array.isArray(out[key])) out[key].push(parseScalarOrArray(item[1]))
      else if (nested !== null && typeof out[key] === 'object') (out[key][nested] ??= []).push(parseScalarOrArray(item[1]))
      else (out[key] = [parseScalarOrArray(item[1])])
      continue
    }
    const kv = /^([A-Za-z0-9_\u4e00-\u9fff-]+)\s*:\s*(.*)$/.exec(rawLine)
    if (kv === null) continue
    const indent = rawLine.length - rawLine.trimStart().length
    if (indent > 0) {
      if (key !== null && typeof out[key] === 'object' && !Array.isArray(out[key]) && out[key] !== null) {
        out[key][kv[1]] = parseScalarOrArray(kv[2])
        nested = kv[1]
      }
      continue
    }
    nested = null
    key = kv[1]
    out[key] = kv[2].trim() === '' ? [] : parseScalarOrArray(kv[2])
  }
  return out
}

// ---------------------------------------------------------------------------
// persisted state (settings the user changes from the panel)
// ---------------------------------------------------------------------------

/** @type {{ vaultPath: string, writeMode: 'auto' | 'confirm', lastIndexAt: number, disabledFolders: string[] } | null} */
let stateCache = null

async function readState() {
  if (stateCache !== null) return stateCache
  try {
    const raw = await fsp.readFile(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    stateCache = {
      vaultPath: typeof parsed.vaultPath === 'string' ? parsed.vaultPath : '',
      writeMode: parsed.writeMode === 'confirm' ? 'confirm' : 'auto',
      lastIndexAt: Number(parsed.lastIndexAt) || 0,
      disabledFolders: Array.isArray(parsed.disabledFolders) ? parsed.disabledFolders.filter((x) => typeof x === 'string') : [],
    }
  } catch {
    stateCache = { vaultPath: '', writeMode: 'auto', lastIndexAt: 0, disabledFolders: [] }
  }
  return stateCache
}

/** @param {Partial<typeof stateCache>} patch */
async function writeState(patch) {
  const current = await readState()
  stateCache = { ...current, ...patch }
  await fsp.mkdir(DATA_DIR, { recursive: true })
  const tmp = `${STATE_FILE}.${process.pid}.tmp`
  await fsp.writeFile(tmp, `${JSON.stringify(stateCache, null, 2)}\n`, 'utf8')
  await fsp.rename(tmp, STATE_FILE)
  return stateCache
}

// ---------------------------------------------------------------------------
// vault discovery
// ---------------------------------------------------------------------------

function obsidianRegistryCandidates() {
  const home = os.homedir()
  const list = [path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json')]
  if (process.env.APPDATA) list.push(path.join(process.env.APPDATA, 'obsidian', 'obsidian.json'))
  list.push(path.join(home, '.config', 'obsidian', 'obsidian.json'))
  list.push(path.join(home, '.var', 'app', 'obsidian', 'obsidian.json'))
  return list
}

/** Vaults Obsidian itself knows about, newest-used first. */
async function registryVaults() {
  for (const file of obsidianRegistryCandidates()) {
    let raw
    try {
      raw = await fsp.readFile(file, 'utf8')
    } catch {
      continue
    }
    let doc
    try {
      doc = JSON.parse(raw)
    } catch {
      continue
    }
    const vaults = doc && typeof doc.vaults === 'object' && doc.vaults !== null ? doc.vaults : {}
    const rows = []
    for (const value of Object.values(vaults)) {
      if (value === null || typeof value !== 'object') continue
      const p = value.path
      if (typeof p !== 'string' || p === '') continue
      rows.push({ path: path.resolve(p), open: value.open === true, ts: Number(value.ts) || 0 })
    }
    rows.sort((a, b) => Number(b.open) - Number(a.open) || b.ts - a.ts)
    return rows
  }
  return []
}

/** A folder counts as a vault when it still carries `.obsidian`. @param {string} dir */
async function looksLikeVault(dir) {
  try {
    const st = await fsp.stat(path.join(dir, '.obsidian'))
    return st.isDirectory()
  } catch {
    return false
  }
}

/** Common places a vault lives when the registry is unavailable. */
function fallbackVaultCandidates() {
  const home = os.homedir()
  return [
    path.join(home, 'Documents', 'obsidian-notes'),
    path.join(home, 'Obsidian'),
    path.join(home, 'Documents', 'Obsidian'),
    path.join(home, 'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents'),
    path.join(home, 'notes'),
  ]
}

/** Every plausible vault, deduplicated, with availability resolved. */
async function discoverVaults() {
  const seen = new Set()
  const out = []
  const add = async (p, source) => {
    const resolved = path.resolve(p)
    if (seen.has(resolved)) return
    seen.add(resolved)
    if (await looksLikeVault(resolved)) out.push({ path: resolved, source })
  }
  for (const row of await registryVaults()) await add(row.path, 'obsidian')
  for (const p of fallbackVaultCandidates()) await add(p, 'guess')
  return out
}

/**
 * The vault this plugin should mount: the explicit choice, else the vault
 * Obsidian currently has open, else the first discoverable one.
 * @returns {Promise<{ path: string, source: string } | null>}
 */
async function resolveVault() {
  const state = await readState()
  if (state.vaultPath !== '' && (await looksLikeVault(state.vaultPath))) {
    return { path: state.vaultPath, source: 'configured' }
  }
  const registry = await registryVaults()
  const open = registry.find((r) => r.open)
  if (open && (await looksLikeVault(open.path))) return { path: open.path, source: 'obsidian-open' }
  for (const row of registry) if (await looksLikeVault(row.path)) return { path: row.path, source: 'obsidian' }
  for (const candidate of fallbackVaultCandidates()) {
    if (await looksLikeVault(candidate)) return { path: path.resolve(candidate), source: 'guess' }
  }
  return null
}

// ---------------------------------------------------------------------------
// note parsing
// ---------------------------------------------------------------------------

const RE_WIKI = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g
// A tag starts at a non-word boundary. The body excludes Latin and CJK
// punctuation so `。#工作` yields `工作` rather than swallowing the period.
const RE_TAG = /(^|[^\p{L}\p{N}_/])#([^\s#'"`,.;:!?()[\]{}<>（）【】「」『』《》。，、；：！？…·]+)/gu
const RE_HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm
const RE_TASK = /^[ \t]*[-*+][ \t]+\[([ xX])\]/gm

/** @param {string} body */
function collect(body) {
  const headings = []
  RE_HEADING.lastIndex = 0
  let m
  while ((m = RE_HEADING.exec(body)) !== null) headings.push({ level: m[1].length, text: m[2], line: body.slice(0, m.index).split('\n').length })

  const links = []
  RE_WIKI.lastIndex = 0
  while ((m = RE_WIKI.exec(body)) !== null) {
    const target = m[1].trim()
    if (target !== '' && !links.includes(target)) links.push(target)
  }
  let tasksTotal = 0
  let tasksDone = 0
  RE_TASK.lastIndex = 0
  while ((m = RE_TASK.exec(body)) !== null) {
    tasksTotal += 1
    if (m[1] !== ' ') tasksDone += 1
  }
  const tags = []
  RE_TAG.lastIndex = 0
  while ((m = RE_TAG.exec(body)) !== null) {
    const tag = m[2]
    if (tag === '' || tag.length > 48 || /^\d+$/.test(tag)) continue
    if (!tags.includes(tag)) tags.push(tag)
  }
  const cjkChars = (body.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const latinWords = (body.match(/[A-Za-z][A-Za-z0-9'-]{0,}/g) ?? []).length
  return { headings, links, tags, tasksTotal, tasksDone, cjkChars, latinWords }
}

/** @param {string} rel */
function folderOf(rel) {
  const dir = path.dirname(rel)
  return dir === '.' ? '' : dir.split(path.sep).join('/')
}

/** @param {string} rel @param {Record<string, unknown>} fm */
function dateOf(rel, fm) {
  const fromPath = /(\d{4})-(\d{2})-(\d{2})/.exec(rel)
  if (fromPath !== null) return `${fromPath[1]}-${fromPath[2]}-${fromPath[3]}`
  for (const key of ['date', 'created', 'published', 'lastReadDate']) {
    const value = fm[key]
    if (typeof value === 'string') {
      const hit = /(\d{4})-(\d{2})-(\d{2})/.exec(value)
      if (hit !== null) return `${hit[1]}-${hit[2]}-${hit[3]}`
    }
  }
  return null
}

/**
 * @param {string} rel vault-relative path
 * @param {string} raw file text
 * @param {number} size
 * @param {number} mtimeMs
 */
function parseNote(rel, raw, size, mtimeMs) {
  let fm = Object.create(null)
  let body = raw
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
  if (fmMatch !== null) {
    fm = parseYamlLite(fmMatch[1])
    body = raw.slice(fmMatch[0].length)
  }
  const fmTags = []
  const rawTags = fm.tags
  if (typeof rawTags === 'string') fmTags.push(rawTags.replace(/^#/, ''))
  else if (Array.isArray(rawTags)) for (const t of rawTags) if (typeof t === 'string') fmTags.push(t.replace(/^#/, ''))
  const info = collect(body)
  const tags = []
  for (const t of [...fmTags, ...info.tags]) if (t !== '' && !tags.includes(t)) tags.push(t)
  const titleRaw = typeof fm.title === 'string' ? fm.title : null
  const base = path.basename(rel, path.extname(rel))
  return {
    rel,
    folder: folderOf(rel),
    title: titleRaw !== null && titleRaw !== '' ? titleRaw : base,
    date: dateOf(rel, fm),
    size,
    mtimeMs,
    fm,
    tags,
    links: info.links,
    headings: info.headings,
    tasksTotal: info.tasksTotal,
    tasksDone: info.tasksDone,
    cjkChars: info.cjkChars,
    latinWords: info.latinWords,
    text: body,
    search: norm(`${base}\n${titleRaw ?? ''}\n${body}`),
  }
}

// ---------------------------------------------------------------------------
// index
// ---------------------------------------------------------------------------

/** @param {string} root @param {string} rel */
function absOf(root, rel) {
  const abs = path.resolve(root, rel)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  if (abs !== root && !abs.startsWith(prefix)) throw new Error(`路径越界：${rel}`)
  return abs
}

class VaultIndex {
  constructor() {
    /** @type {string} */ this.root = ''
    /** @type {Map<string, ReturnType<typeof parseNote>>} */ this.notes = new Map()
    this.scannedAt = 0
    this.scanning = null
    this.fileCount = 0
    this.skipped = 0
  }

  /** @param {string} [root] */
  async open(root) {
    if (root !== undefined && root !== this.root) {
      this.root = root
      this.notes.clear()
      this.scannedAt = 0
    }
    await this.refresh()
    return this
  }

  get ageMs() {
    return this.scannedAt === 0 ? Number.POSITIVE_INFINITY : now() - this.scannedAt
  }

  /** @param {{ force?: boolean }} [options] */
  async ensure(options = {}) {
    if (options.force === true || this.ageMs > INDEX_TTL_MS) await this.refresh()
    if (this.notes.size === 0 && options.force !== true) await this.refresh()
    return this
  }

  /** Walk the vault and merge changed files, dropping vanished ones. */
  async refresh() {
    if (this.scanning !== null) return this.scanning
    this.scanning = this.#scan()
    try {
      await this.scanning
    } finally {
      this.scanning = null
    }
    return this
  }

  async #scan() {
    const root = this.root
    if (root === '') return this
    /** @type {string[]} */
    const files = []
    let skipped = 0
    const walk = async (dir, depth, relDir) => {
      if (depth > 12 || files.length >= MAX_FILES) return
      let entries
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (files.length >= MAX_FILES) return
        const full = path.join(dir, entry.name)
        const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
            skipped += 1
            continue
          }
          if (SKIP_REL_PREFIXES.includes(rel)) {
            skipped += 1
            continue
          }
          await walk(full, depth + 1, rel)
          continue
        }
        if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue
        files.push(full)
      }
    }
    await walk(root, 0, '')

    const seen = new Set()
    for (const abs of files) {
      let st
      try {
        st = await fsp.stat(abs)
      } catch {
        continue
      }
      if (!st.isFile() || st.size > MAX_FILE_BYTES) {
        skipped += 1
        continue
      }
      const rel = path.relative(root, abs)
      seen.add(rel)
      const cached = this.notes.get(rel)
      if (cached !== undefined && cached.mtimeMs === st.mtimeMs && cached.size === st.size) continue
      try {
        const raw = await fsp.readFile(abs, 'utf8')
        this.notes.set(rel, parseNote(rel, raw, st.size, st.mtimeMs))
      } catch {
        skipped += 1
      }
    }
    for (const rel of [...this.notes.keys()]) if (!seen.has(rel)) this.notes.delete(rel)
    this.fileCount = this.notes.size
    this.skipped = skipped
    this.scannedAt = now()
    return this
  }

  /** @param {string} rel */
  get(rel) {
    return this.notes.get(rel.replaceAll('\\', '/')) ?? this.notes.get(rel) ?? null
  }

  /** @param {string} rel */
  async readRaw(rel) {
    if (this.root === '') throw new Error('尚未挂载 Obsidian 库')
    return fsp.readFile(absOf(this.root, rel), 'utf8')
  }

  list(folder) {
    const prefix = folder ? `${folder.replace(/\/+$/, '')}/` : ''
    const out = []
    for (const note of this.notes.values()) {
      if (prefix !== '' && !note.rel.startsWith(prefix) && note.rel !== folder) continue
      out.push({ path: note.rel, title: note.title, date: note.date, folder: note.folder, size: note.size, mtimeMs: note.mtimeMs })
    }
    out.sort((a, b) => a.path.localeCompare(b.path, 'zh'))
    return out
  }

  tree() {
    /** @type {Map<string, { path: string, files: number, total: number, children: Set<string> }>} */
    const folders = new Map()
    for (const note of this.notes.values()) {
      const parts = note.folder === '' ? [] : note.folder.split('/')
      for (let i = 0; i <= parts.length; i += 1) {
        const key = parts.slice(0, i).join('/')
        if (!folders.has(key)) folders.set(key, { path: key, files: 0, total: 0, children: new Set() })
      }
      const own = folders.get(note.folder === '' ? '' : note.folder)
      if (own !== undefined) own.files += 1
      for (let i = 0; i < parts.length; i += 1) {
        const parent = folders.get(parts.slice(0, i).join('/'))
        if (parent !== undefined) parent.total += 1
      }
    }
    const rows = [...folders.values()].map((f) => ({ path: f.path, files: f.files, total: f.files + f.total }))
    rows.sort((a, b) => a.path.localeCompare(b.path, 'zh'))
    return rows
  }
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

/** @param {string} text */
function bigrams(text) {
  const out = new Set()
  for (let i = 0; i < text.length - 1; i += 1) out.add(text.slice(i, i + 2))
  return out
}

/**
 * Score every note against a query. CJK text has no spaces, so a query is also
 * matched by character-bigram coverage, not only by whole-phrase substring.
 * @param {VaultIndex} index
 * @param {{ query: string, limit?: number, folder?: string, tag?: string, since?: string, until?: string }} options
 */
function searchNotes(index, options) {
  const query = String(options.query ?? '').trim()
  const limit = Math.min(Math.max(Number(options.limit) || 8, 1), 40)
  if (query === '') return []
  const terms = query.split(/\s+/).filter((t) => t !== '')
  const normTerms = terms.map(norm)
  const phrase = norm(query)
  const grams = phrase.length >= 2 ? bigrams(phrase) : new Set()
  const folder = options.folder ? String(options.folder).replace(/\/+$/, '') : ''
  const tag = options.tag ? String(options.tag).replace(/^#/, '') : ''
  const since = options.since ? String(options.since) : ''
  const until = options.until ? String(options.until) : ''
  const nowMs = now()
  /** @type {Array<{ path: string, title: string, date: string | null, score: number, hits: Array<{ line: number, text: string }> }>} */
  const hits = []

  for (const note of index.notes.values()) {
    if (folder !== '' && note.rel !== folder && !note.rel.startsWith(`${folder}/`)) continue
    if (tag !== '' && !note.tags.some((t) => norm(t) === norm(tag))) continue
    if (since !== '' && (note.date === null || note.date < since)) continue
    if (until !== '' && (note.date === null || note.date > until)) continue

    const titleNorm = norm(note.title)
    let score = 0
    if (has(titleNorm, phrase)) score += 9
    else for (const t of normTerms) if (has(titleNorm, t)) score += 3

    let phraseHit = has(note.search, phrase)
    if (phraseHit) score += 3
    let termHits = 0
    for (const t of normTerms) if (has(note.search, t)) termHits += 1
    if (termHits === normTerms.length && termHits > 1) score += 2
    else if (termHits > 0) score += termHits / normTerms.length

    if (grams.size > 0 && !phraseHit) {
      let covered = 0
      for (const g of grams) if (has(note.search, g)) covered += 1
      const ratio = covered / grams.size
      if (ratio >= 0.6) {
        score += ratio * 2.5
        phraseHit = true
      }
    }
    if (tag !== '' && note.tags.some((t) => norm(t) === norm(tag))) score += 4
    for (const noteTag of note.tags) if (normTerms.includes(norm(noteTag))) score += 2
    if (has(norm(note.rel), phrase)) score += 2
    if (score <= 0) continue
    const ageDays = note.date === null ? 180 : Math.max(0, (nowMs - Date.parse(`${note.date}T00:00:00`)) / 86400000)
    score += Math.max(0, 1.2 - ageDays / 240)

    /** @type {Array<{ line: number, text: string }>} */
    const lineHits = []
    if (phraseHit) {
      const lines = note.text.split(/\r?\n/)
      for (let i = 0; i < lines.length && lineHits.length < 3; i += 1) {
        const lineNorm = norm(lines[i])
        if (has(lineNorm, phrase) || normTerms.some((t) => has(lineNorm, t))) {
          const trimmed = lines[i].trim()
          if (trimmed !== '') lineHits.push({ line: i + 1, text: trimmed.slice(0, 200) })
        }
      }
    }
    if (lineHits.length === 0) {
      const where = note.tags.length > 0 ? `标签：${note.tags.map((x) => `#${x}`).join(' ')}` : note.headings[0]?.text ?? note.folder
      lineHits.push({ line: 1, text: `${note.title}${where ? ` · ${where}` : ''}` })
    }
    hits.push({ path: note.rel, title: note.title, date: note.date, score, hits: lineHits })
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, 'zh'))
  return hits.slice(0, limit)
}

/** @param {VaultIndex} index @param {{ groupBy?: string, scope?: string, since?: string }} options */
function computeStats(index, options) {
  const groupBy = String(options.groupBy ?? 'folder')
  const scope = options.scope ? String(options.scope).replace(/\/+$/, '') : ''
  const since = options.since ? String(options.since) : ''
  const notes = [...index.notes.values()].filter((note) => {
    if (scope !== '' && note.rel !== scope && !note.rel.startsWith(`${scope}/`)) return false
    if (since !== '' && (note.date === null || note.date < since)) return false
    return true
  })
  /** @type {Map<string, number>} */
  const buckets = new Map()
  const bump = (key) => buckets.set(key, (buckets.get(key) ?? 0) + 1)
  let cjkChars = 0
  let latinWords = 0
  let tasksTotal = 0
  let tasksDone = 0
  const tagCount = new Map()
  const linkCount = new Map()

  for (const note of notes) {
    cjkChars += note.cjkChars
    latinWords += note.latinWords
    tasksTotal += note.tasksTotal
    tasksDone += note.tasksDone
    for (const t of note.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1)
    for (const l of note.links) linkCount.set(l, (linkCount.get(l) ?? 0) + 1)
    if (groupBy === 'folder') bump(note.folder === '' ? '(根目录)' : note.folder)
    else if (groupBy === 'tag') for (const t of note.tags) bump(`#${t}`)
    else if (groupBy === 'month') bump(note.date === null ? '(无日期)' : note.date.slice(0, 7))
    else if (groupBy === 'weekday') {
      if (note.date === null) bump('(无日期)')
      else {
        const day = new Date(`${note.date}T00:00:00`).getDay()
        bump(['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day])
      }
    } else if (groupBy === 'link') for (const l of note.links) bump(l)
    else bump(note.folder === '' ? '(根目录)' : note.folder)
  }

  const rows = [...buckets.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh'))
  return {
    groupBy,
    scope: scope === '' ? '/' : scope,
    noteCount: notes.length,
    cjkChars,
    latinWords,
    tasksTotal,
    tasksDone,
    completion: tasksTotal === 0 ? null : Math.round((tasksDone / tasksTotal) * 100),
    rows: rows.slice(0, 40),
    topTags: [...tagCount.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    topLinks: [...linkCount.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 15),
  }
}

// ---------------------------------------------------------------------------
// daily notes
// ---------------------------------------------------------------------------

/** @param {string} y @param {string} m @param {string} d */
function dailyFormat(root) {
  return fsp
    .readFile(path.join(root, '.obsidian', 'daily-notes.json'), 'utf8')
    .then((raw) => {
      const doc = JSON.parse(raw)
      return {
        folder: typeof doc.folder === 'string' ? doc.folder.replace(/^\/+|\/+$/g, '') : '',
        format: typeof doc.format === 'string' && doc.format !== '' ? doc.format : 'YYYY-MM-DD',
        template: typeof doc.template === 'string' ? doc.template : '',
      }
    })
    .catch(() => ({ folder: '', format: 'YYYY-MM-DD', template: '' }))
}

/** @param {string} format @param {Date} date */
function applyDateFormat(format, date) {
  const pad = (n) => String(n).padStart(2, '0')
  return format
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()))
    .replace(/\bM\b/g, String(date.getMonth() + 1))
    .replace(/\bD\b/g, String(date.getDate()))
}

/** @param {string} root @param {string} yyyymmdd */
async function dailyRelPath(root, yyyymmdd) {
  const config = await dailyFormat(root)
  const [y, m, d] = yyyymmdd.split('-')
  const date = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0)
  let rel = applyDateFormat(config.format, date)
  if (!/\.md$/i.test(rel)) rel += '.md'
  return config.folder === '' ? rel : `${config.folder}/${rel}`
}

/** @param {number} offsetDays @param {Date} [base] */
function isoDay(offsetDays = 0, base = new Date()) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays, 12, 0, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

async function backupFile(root, rel) {
  const abs = absOf(root, rel)
  try {
    await fsp.stat(abs)
  } catch {
    return null
  }
  const target = path.join(BACKUP_DIR, String(now()), rel)
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.copyFile(abs, target)
  return target
}

/** @param {string} abs @param {string} content */
async function atomicWrite(abs, content) {
  await fsp.mkdir(path.dirname(abs), { recursive: true })
  const tmp = `${abs}.${process.pid}.dsh-tmp`
  await fsp.writeFile(tmp, content, 'utf8')
  await fsp.rename(tmp, abs)
}

/**
 * @param {string} root
 * @param {{ path: string, content: string, mode?: 'create' | 'replace', expectedMtimeMs?: number }} request
 */
async function writeNote(root, request) {
  const rel = String(request.path).replaceAll('\\', '/').replace(/^\/+/, '')
  if (rel === '' || rel.endsWith('/')) throw new Error('需要文件路径，例如 收件箱/想法.md')
  const finalRel = /\.md$/i.test(rel) ? rel : `${rel}.md`
  const abs = absOf(root, finalRel)
  const mode = request.mode === 'replace' ? 'replace' : 'create'
  let before = null
  try {
    before = await fsp.stat(abs)
  } catch {
    before = null
  }
  if (mode === 'create' && before !== null) {
    throw new Error(`文件已存在：${finalRel}。请在 mode 里指定 replace 才会覆盖。`)
  }
  if (mode === 'replace' && before === null) {
    throw new Error(`文件不存在：${finalRel}。新建请用 mode: create。`)
  }
  if (before !== null && request.expectedMtimeMs !== undefined && Math.abs(before.mtimeMs - Number(request.expectedMtimeMs)) > 1) {
    throw new Error(`文件已被 Obsidian 修改（mtime 不一致），拒绝写入：${finalRel}`)
  }
  const backup = before === null ? null : await backupFile(root, finalRel)
  const previous = before === null ? '' : await fsp.readFile(abs, 'utf8')
  await atomicWrite(abs, request.content)
  return { path: finalRel, mode, bytes: Buffer.byteLength(request.content, 'utf8'), backup, previousLength: previous.length }
}

/** @param {string} root @param {{ path: string, text: string, section?: string }} request */
async function appendNote(root, request) {
  const rel = String(request.path).replaceAll('\\', '/').replace(/^\/+/, '')
  const abs = absOf(root, rel)
  let current
  try {
    current = await fsp.readFile(abs, 'utf8')
  } catch {
    throw new Error(`文件不存在：${rel}`)
  }
  const text = String(request.text ?? '')
  const section = request.section
  let next
  if (typeof section === 'string' && section.trim() !== '') {
    const wanted = section.trim().replace(/^#+\s*/, '')
    const lines = current.split(/\r?\n/)
    let start = -1
    let level = 0
    for (let i = 0; i < lines.length; i += 1) {
      const m = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(lines[i])
      if (m !== null && m[2].trim() === wanted) {
        start = i
        level = m[1].length
        break
      }
    }
    if (start === -1) {
      const eol = current.endsWith('\n') ? '' : '\n'
      next = `${current}${eol}\n## ${wanted}\n\n${text}\n`
    } else {
      let end = lines.length
      for (let i = start + 1; i < lines.length; i += 1) {
        const m = /^(#{1,6})[ \t]+/.exec(lines[i])
        if (m !== null && m[1].length <= level) {
          end = i
          break
        }
      }
      let insertAt = end
      while (insertAt > start + 1 && lines[insertAt - 1].trim() === '') insertAt -= 1
      const head = lines.slice(0, insertAt)
      const tail = lines.slice(insertAt)
      const block = text.endsWith('\n') ? text.slice(0, -1) : text
      next = [...head, block, '', ...tail].join('\n')
      if (!next.endsWith('\n')) next += '\n'
    }
  } else {
    next = current.endsWith('\n') ? `${current}${text}\n` : `${current}\n${text}\n`
  }
  const backup = await backupFile(root, rel)
  await atomicWrite(abs, next)
  return { path: rel, bytes: Buffer.byteLength(next, 'utf8'), backup, appended: text.length }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', String(body.byteLength))
  res.end(body)
}

/** @param {import('node:http').IncomingMessage} req */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 4 * 1024 * 1024) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  return JSON.parse(text)
}

/** @param {VaultIndex} index */
function statusPayload(index) {
  const notes = [...index.notes.values()]
  const folders = new Set()
  const tags = new Set()
  for (const note of notes) {
    if (note.folder !== '') folders.add(note.folder.split('/')[0])
    for (const tag of note.tags) tags.add(tag)
  }
  return {
    mounted: index.root !== '',
    vault: index.root,
    noteCount: notes.length,
    folderCount: folders.size,
    tagCount: tags.size,
    scannedAt: index.scannedAt,
    ageMs: index.ageMs === Number.POSITIVE_INFINITY ? null : Math.round(index.ageMs),
    skipped: index.skipped,
  }
}

// ---------------------------------------------------------------------------
// plugin
// ---------------------------------------------------------------------------

export const inject = ['tools', 'systemPrompt']

/**
 * @param {any} ctx
 */
export function apply(ctx) {
  const index = new VaultIndex()

  // Mount the vault as early as possible so the first tool call is warm.
  const mounted = (async () => {
    const vault = await resolveVault()
    if (vault !== null) await index.open(vault.path)
    return vault
  })().catch(() => null)

  /** @param {AbortSignal} [signal] */
  const ready = async (signal) => {
    if (index.root === '') {
      const vault = await resolveVault()
      if (vault === null) {
        throw new Error('没有找到 Obsidian 库。请打开 Obsidian，或在面板里手动选择目录。')
      }
      await index.open(vault.path)
    }
    await index.ensure()
    if (signal?.aborted === true) throw new Error('已取消')
    return index
  }

  ctx.effect(() => () => {
    index.notes.clear()
  }, 'obsidian: index lifetime')

  // ---- tools -------------------------------------------------------------
  /** @type {Array<Record<string, unknown>>} */
  const tools = [
    {
      name: 'obsidian_status',
      description:
        'Report the mounted Obsidian vault: path, note count, folder/tag counts, index age. Use it first when the user asks anything about "my notes" and you are unsure the vault is mounted.',
      parameters: {},
      output: {
        schema: { type: 'object', properties: { mounted: { type: 'boolean' }, vault: { type: 'string' }, noteCount: { type: 'integer' }, tagCount: { type: 'integer' }, ageMs: { type: 'integer' } } },
        render: (_a, v) => [{ type: 'text', text: `库：${v.vault || '(未挂载)'}\n笔记 ${v.noteCount} 篇，标签 ${v.tagCount} 个` }],
      },
      async execute() {
        const mountedVault = await mounted
        if (index.root === '') {
          return { mounted: false, vault: '', noteCount: 0, tagCount: 0, ageMs: null, candidates: (await discoverVaults()).map((v) => v.path), hint: mountedVault === null ? '没有找到库，请在面板里选择目录' : '' }
        }
        await index.ensure()
        const payload = statusPayload(index)
        return { ...payload, candidates: (await discoverVaults()).map((v) => v.path) }
      },
    },
    {
      name: 'obsidian_search',
      description:
        'Full-text search across the Obsidian vault. Works with Chinese text (bigram matching) and returns the path plus matching line numbers. Prefer this over reading files blindly, then use obsidian_read on the paths it returns.',
      parameters: {
        query: { type: 'string', required: true, description: '关键词、短语或中文句子片段' },
        limit: { type: 'integer', description: '返回条数，默认 8，最大 40' },
        folder: { type: 'string', description: '限定目录，如 日记 或 收藏/书籍' },
        tag: { type: 'string', description: '限定标签，可带 #，如 工作' },
        since: { type: 'string', description: '起始日期 YYYY-MM-DD（只匹配能识别出日期的笔记）' },
        until: { type: 'string', description: '截止日期 YYYY-MM-DD' },
      },
      output: {
        schema: { type: 'object', properties: { hits: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string' }, date: { type: 'string' }, score: { type: 'number' } } } } } },
        render: (_a, v) => (v.hits.length === 0 ? [{ type: 'text', text: '没有匹配的笔记。' }] : [{ type: 'text', text: v.hits.map((h) => `${h.path}:${h.hits[0]?.line ?? 1} — ${h.title}${h.hits[0] ? `\n    ${h.hits[0].text}` : ''}`).join('\n') }]),
      },
      async execute(args, exec) {
        const vault = await ready(exec.signal)
        const hits = searchNotes(vault, {
          query: String(args.query ?? ''),
          limit: args.limit,
          folder: args.folder,
          tag: args.tag,
          since: args.since,
          until: args.until,
        })
        return { hits, vault: vault.root }
      },
      presentCall: (args) => ({ card: 'generic', title: `检索笔记：${args.query}`, kind: 'other', rawInput: args }),
    },
    {
      name: 'obsidian_read',
      description: 'Read one note by vault-relative path. Returns its text plus frontmatter, tags, links and headings. Use obsidian_search first to find the path.',
      parameters: {
        path: { type: 'string', required: true, description: 'vault 相对路径，如 日记/2026/2026-10-28.md' },
        mode: { type: 'string', description: 'full（默认）| head（前 120 行）| range', enum: ['full', 'head', 'range'] },
        startLine: { type: 'integer', description: 'mode=range 时的起始行（1 起）' },
        endLine: { type: 'integer', description: 'mode=range 时的结束行（含）' },
      },
      output: {
        schema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' }, totalLines: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } }, links: { type: 'array', items: { type: 'string' } } } },
        render: (_a, v) => [{ type: 'text', text: `# ${v.path}\n\n${v.text}` }],
      },
      async execute(args, exec) {
        const vault = await ready(exec.signal)
        const rel = String(args.path ?? '').replaceAll('\\', '/').replace(/^\/+/, '')
        const raw = await vault.readRaw(rel)
        const lines = raw.split(/\r?\n/)
        const mode = args.mode === 'head' || args.mode === 'range' ? args.mode : 'full'
        let start = 1
        let end = lines.length
        if (mode === 'head') end = Math.min(lines.length, 120)
        if (mode === 'range') {
          start = Math.min(Math.max(Number(args.startLine) || 1, 1), Math.max(lines.length, 1))
          end = Math.min(Math.max(Number(args.endLine) || start + 199, start), lines.length)
        }
        const note = vault.get(rel)
        return {
          path: rel,
          text: lines.slice(start - 1, end).join('\n'),
          totalLines: lines.length,
          range: { start, end },
          tags: note?.tags ?? [],
          links: note?.links ?? [],
          headings: note?.headings.map((h) => `${'#'.repeat(h.level)} ${h.text} (行 ${h.line})`) ?? [],
        }
      },
    },
    {
      name: 'obsidian_list',
      description: 'List notes under a folder (default: whole vault, capped). Use it to see what exists before searching.',
      parameters: {
        folder: { type: 'string', description: '目录，如 项目/计划；留空为全部' },
        limit: { type: 'integer', description: '默认 200，最大 1000' },
      },
      output: {
        schema: { type: 'object', properties: { notes: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string' } } } }, total: { type: 'integer' } } },
        render: (_a, v) => [{ type: 'text', text: `共 ${v.total} 篇（显示 ${v.notes.length}）\n${v.notes.map((n) => `- ${n.path}`).join('\n')}` }],
      },
      async execute(args, exec) {
        const vault = await ready(exec.signal)
        const all = vault.list(args.folder ? String(args.folder) : undefined)
        const limit = Math.min(Math.max(Number(args.limit) || 200, 1), 1000)
        return { notes: all.slice(0, limit).map((n) => ({ path: n.path, title: n.title, date: n.date })), total: all.length }
      },
    },
    {
      name: 'obsidian_daily',
      description: 'Read daily notes by date. Uses the vault daily-notes settings (folder + format), so it works even if the user changed their date pattern.',
      parameters: {
        date: { type: 'string', description: 'YYYY-MM-DD，默认今天' },
        days: { type: 'integer', description: '从 date 往前读几天，默认 1' },
        maxLinesPerNote: { type: 'integer', description: '每篇最多行数，默认 200' },
      },
      output: {
        schema: { type: 'object', properties: { notes: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, path: { type: 'string' }, found: { type: 'boolean' }, text: { type: 'string' } } } } } },
        render: (_a, v) => [{ type: 'text', text: v.notes.map((n) => `## ${n.date} ${n.path}${n.found ? '' : '（不存在）'}\n${n.text ?? ''}`).join('\n\n') }],
      },
      async execute(args, exec) {
        const vault = await ready(exec.signal)
        const base = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : isoDay()
        const count = Math.min(Math.max(Number(args.days) || 1, 1), 31)
        const maxLines = Math.min(Math.max(Number(args.maxLinesPerNote) || 200, 10), 2000)
        const out = []
        const startDate = new Date(`${base}T12:00:00`)
        for (let i = 0; i < count; i += 1) {
          const date = isoDay(-i, startDate)
          const rel = await dailyRelPath(vault.root, date)
          try {
            const raw = await vault.readRaw(rel)
            out.push({ date, path: rel, found: true, text: raw.split(/\r?\n/).slice(0, maxLines).join('\n') })
          } catch {
            out.push({ date, path: rel, found: false, text: '' })
          }
        }
        return { notes: out }
      },
    },
    {
      name: 'obsidian_stats',
      description: 'Aggregate statistics over the vault: note counts by folder/tag/month/weekday/link, plus character and task-completion totals. Use it for "how many", "which month", "completion rate" questions instead of counting by hand.',
      parameters: {
        groupBy: { type: 'string', description: 'folder（默认）| tag | month | weekday | link', enum: ['folder', 'tag', 'month', 'weekday', 'link'] },
        scope: { type: 'string', description: '限定目录，如 日记' },
        since: { type: 'string', description: '起始日期 YYYY-MM-DD' },
      },
      output: {
        schema: { type: 'object', properties: { noteCount: { type: 'integer' }, rows: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, count: { type: 'integer' } } } } } },
        render: (_a, v) => [{ type: 'text', text: `${v.noteCount} 篇 · ${v.cjkChars} 汉字 · 待办完成率 ${v.completion === null ? 'n/a' : `${v.completion}%`}\n${v.rows.map((r) => `${r.key}: ${r.count}`).join('\n')}` }],
      },
      async execute(args, exec) {
        const vault = await ready(exec.signal)
        return computeStats(vault, { groupBy: args.groupBy, scope: args.scope, since: args.since })
      },
    },
    {
      name: 'obsidian_write',
      description: 'Create a note, or replace one when mode=replace. Writes are atomic and the previous content is backed up. mode=create refuses to overwrite an existing file. Write permissions are enabled for this vault by user choice, so do not ask for confirmation — but never delete content you were not asked to change.',
      parameters: {
        path: { type: 'string', required: true, description: 'vault 相对路径，如 收件箱/想法.md' },
        content: { type: 'string', required: true, description: '完整文件内容（含 frontmatter 时可自带 --- 块）' },
        mode: { type: 'string', description: 'create（默认，拒绝覆盖）| replace', enum: ['create', 'replace'] },
      },
      output: {
        schema: { type: 'object', properties: { path: { type: 'string' }, mode: { type: 'string' }, bytes: { type: 'integer' }, backup: { type: 'string' } } },
        render: (_a, v) => [{ type: 'text', text: `${v.mode === 'create' ? '已新建' : '已覆盖'} ${v.path}（${v.bytes} 字节）${v.backup ? `\n备份：${v.backup}` : ''}` }],
      },
      async execute(args, exec) {
        const vault = await ready(exec.signal)
        return writeNote(vault.root, { path: String(args.path ?? ''), content: String(args.content ?? ''), mode: args.mode })
      },
      presentCall: (args) => ({ card: 'generic', title: `写入笔记：${args.path}`, kind: 'other', rawInput: args }),
    },
    {
      name: 'obsidian_append',
      description: 'Append text to a note, optionally at the end of a named section (e.g. section="待办"). The section is created when it does not exist. Prefer this over obsidian_write for adding diary entries, logs and checklist items.',
      parameters: {
        path: { type: 'string', required: true, description: 'vault 相对路径' },
        text: { type: 'string', required: true, description: '要追加的内容，可含多行 markdown' },
        section: { type: 'string', description: '追加到该标题段落末尾，如 待办 或 记录' },
      },
      output: {
        schema: { type: 'object', properties: { path: { type: 'string' }, bytes: { type: 'integer' }, backup: { type: 'string' } } },
        render: (_a, v) => [{ type: 'text', text: `已追加到 ${v.path}（文件现 ${v.bytes} 字节）` }],
      },
      async execute(args, exec) {
        const vault = await ready(exec.signal)
        return appendNote(vault.root, { path: String(args.path ?? ''), text: String(args.text ?? ''), section: args.section })
      },
    },
    {
      name: 'obsidian_reindex',
      description: 'Force a full rescan of the vault. Use it after the user edits notes outside the harness (in Obsidian) and expects the change to be visible immediately.',
      parameters: { full: { type: 'boolean', description: '默认 true' } },
      output: {
        schema: { type: 'object', properties: { noteCount: { type: 'integer' }, scannedAt: { type: 'integer' } } },
        render: (_a, v) => [{ type: 'text', text: `已重新扫描：${v.noteCount} 篇` }],
      },
      async execute(_args, exec) {
        const vault = await ready(exec.signal)
        await vault.refresh()
        return { noteCount: vault.notes.size, scannedAt: vault.scannedAt }
      },
    },
  ]

  for (const tool of tools) {
    ctx.effect(() => ctx.tools.register(tool), `obsidian: tool ${String(tool.name)}`)
  }

  // ---- prompt ------------------------------------------------------------
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'obsidian:vault',
        order: 52,
        text: () =>
          index.root === ''
            ? '## Obsidian vault\nNo vault is mounted yet. If the user asks about "my notes" and no vault is mounted, tell them to open the Obsidian panel (left sidebar) and pick a directory; do not guess note contents.'
            : `## Obsidian vault (mounted)\nVault root: ${index.root}\nNotes indexed: ${index.notes.size}\nUse obsidian_search to locate notes (it matches Chinese by character bigrams), obsidian_read to read one, obsidian_daily for diary entries, obsidian_stats for counting questions, and obsidian_append/obsidian_write to add content. Writing is permitted without asking for confirmation; create-mode never overwrites. Cite the vault-relative path of any note you rely on.`,
      }),
    'obsidian: prompt section',
  )

  // ---- HTTP routes for the panel ----------------------------------------
  ctx.inject(['webServer', 'connection'], (web) => {
    const guard = (req, res) => {
      const rejection = web.connection.requestRejection(req)
      if (rejection === undefined) return false
      res.statusCode = rejection
      res.end()
      return true
    }
    /** @param {import('node:http').IncomingMessage} req */
    const urlOf = (req) => new URL(String(req.url ?? '/'), 'http://localhost')

    /** @param {string} name @param {(req:any, res:any, url: URL) => Promise<void> | void} handler */
    const route = (name, handler) => {
      ctx.effect(
        () =>
          web.webServer.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/${name}`,
            handler: async (req, res) => {
              if (guard(req, res)) return
              try {
                await handler(req, res, urlOf(req))
              } catch (error) {
                sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
              }
            },
          }),
        `obsidian: route ${name}`,
      )
    }

    const mountedVault = () => ready()

    route('status', async (_req, res) => {
      const vaults = await discoverVaults()
      const state = await readState()
      if (index.root !== '' && index.ageMs > 30000) await index.ensure()
      sendJson(res, 200, {
        ...(index.root === '' ? { mounted: false, vault: '', noteCount: 0, tagCount: 0, folderCount: 0, ageMs: null, skipped: 0, scannedAt: 0 } : statusPayload(index)),
        configured: state.vaultPath,
        writeMode: state.writeMode,
        candidates: vaults,
      })
    })

    route('vault', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const body = await readJson(req)
      const target = String(body.path ?? '').trim()
      if (target === '') return sendJson(res, 400, { error: '缺少 path' })
      const resolved = path.resolve(target)
      if (!(await looksLikeVault(resolved))) return sendJson(res, 400, { error: `不是 Obsidian 库（缺 .obsidian 目录）：${resolved}` })
      await writeState({ vaultPath: resolved })
      await index.open(resolved)
      await index.refresh()
      return sendJson(res, 200, statusPayload(index))
    })

    route('tree', async (_req, res) => {
      const vault = await mountedVault()
      sendJson(res, 200, { root: vault.root, folders: vault.tree(), noteCount: vault.notes.size })
    })

    route('list', async (_req, res, url) => {
      const vault = await mountedVault()
      const folder = url.searchParams.get('folder') ?? undefined
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 300) || 300, 1), 2000)
      const notes = vault.list(folder)
      sendJson(res, 200, { notes: notes.slice(0, limit), total: notes.length, folder: folder ?? '' })
    })

    route('search', async (_req, res, url) => {
      const vault = await mountedVault()
      const hits = searchNotes(vault, {
        query: url.searchParams.get('q') ?? '',
        limit: Number(url.searchParams.get('limit') ?? 20),
        folder: url.searchParams.get('folder') ?? undefined,
        tag: url.searchParams.get('tag') ?? undefined,
        since: url.searchParams.get('since') ?? undefined,
        until: url.searchParams.get('until') ?? undefined,
      })
      sendJson(res, 200, { hits })
    })

    route('note', async (_req, res, url) => {
      const vault = await mountedVault()
      const rel = (url.searchParams.get('path') ?? '').replaceAll('\\', '/').replace(/^\/+/, '')
      if (rel === '') return sendJson(res, 400, { error: '缺少 path' })
      const raw = await vault.readRaw(rel)
      const note = vault.get(rel)
      return sendJson(res, 200, {
        path: rel,
        text: raw,
        title: note?.title ?? path.basename(rel, '.md'),
        tags: note?.tags ?? [],
        links: note?.links ?? [],
        headings: note?.headings ?? [],
        date: note?.date ?? null,
        mtimeMs: note?.mtimeMs ?? null,
      })
    })

    route('stats', async (_req, res, url) => {
      const vault = await mountedVault()
      sendJson(res, 200, computeStats(vault, {
        groupBy: url.searchParams.get('groupBy') ?? 'folder',
        scope: url.searchParams.get('scope') ?? undefined,
        since: url.searchParams.get('since') ?? undefined,
      }))
    })

    route('write', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const body = await readJson(req)
      const vault = await mountedVault()
      const result = await writeNote(vault.root, {
        path: String(body.path ?? ''),
        content: String(body.content ?? ''),
        mode: body.mode === 'replace' ? 'replace' : 'create',
        expectedMtimeMs: body.expectedMtimeMs === undefined ? undefined : Number(body.expectedMtimeMs),
      })
      await index.refresh()
      return sendJson(res, 200, result)
    })

    route('append', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const body = await readJson(req)
      const vault = await mountedVault()
      const result = await appendNote(vault.root, { path: String(body.path ?? ''), text: String(body.text ?? ''), section: body.section })
      await index.refresh()
      return sendJson(res, 200, result)
    })

    route('reindex', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const vault = await mountedVault()
      await vault.refresh()
      return sendJson(res, 200, statusPayload(vault))
    })
  }, 'obsidian: http routes')
}
