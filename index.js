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

/** @type {{ vaultPath: string, writeMode: 'auto' | 'confirm', lastIndexAt: number, disabledFolders: string[], folderRoles: Record<string, string[]> | null } | null} */
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
      folderRoles: normalizeFolderRoles(parsed.folderRoles),
    }
  } catch {
    stateCache = { vaultPath: '', writeMode: 'auto', lastIndexAt: 0, disabledFolders: [], folderRoles: null }
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
// folder roles: the Q&A ranking used to hardcode 日记/复盘/项目/收藏; now the
// folder names behind each role are resolved from state.json overrides plus
// the vault's daily-notes config, so other vaults work out of the box.
// ---------------------------------------------------------------------------

const ROLE_DEFAULT_DIRS = {
  journal: ['日记', '日志', 'diary', 'journal', 'daily'],
  review: ['复盘', '回顾', '周报', '月报', 'review', 'retro', 'weekly'],
  project: ['项目', 'projects'],
  notes: ['笔记', 'notes'],
  clips: ['收藏', '剪藏', 'clips', 'clippings'],
}

/** @param {unknown} raw @returns {Record<string, string[]> | null} */
function normalizeFolderRoles(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  let used = 0
  for (const role of Object.keys(ROLE_DEFAULT_DIRS)) {
    const value = raw[role]
    if (!Array.isArray(value)) continue
    const dirs = value.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().replace(/^\/+|\/+$/g, ''))
    if (dirs.length === 0) continue
    out[role] = dirs
    used += 1
  }
  return used > 0 ? out : null
}

/** @param {string} folder @param {string[]} dirs */
function folderInRole(folder, dirs) {
  if (!Array.isArray(dirs) || dirs.length === 0) return false
  const value = String(folder ?? '')
  if (value === '') return false
  return dirs.some((name) => name !== '' && (value === name || value.startsWith(`${name}/`)))
}

/** @type {{ root: string, at: number, roles: Record<string, string[]> | null }} */
let rolesCache = { root: '', at: 0, roles: null }
const ROLES_TTL_MS = 60000

/** Resolve role → top-level folder names for one vault, with a short cache. */
async function getFolderRoles(root) {
  if (root === '') return { ...ROLE_DEFAULT_DIRS }
  if (rolesCache.root === root && rolesCache.roles !== null && now() - rolesCache.at < ROLES_TTL_MS) return rolesCache.roles
  const [state, daily] = await Promise.all([readState(), dailyFormat(root)])
  const override = state.folderRoles ?? {}
  const roles = {}
  for (const [role, defaults] of Object.entries(ROLE_DEFAULT_DIRS)) {
    roles[role] = Array.isArray(override[role]) && override[role].length > 0 ? [...override[role]] : [...defaults]
  }
  if (daily.folder !== '' && !roles.journal.includes(daily.folder)) roles.journal.unshift(daily.folder)
  rolesCache = { root, at: now(), roles }
  return roles
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

/** Monday of one ISO week (used by weekly reviews named `2026-W44`). */
function isoWeekMonday(year, week) {
  const jan4 = new Date(year, 0, 4, 12, 0, 0)
  const offset = (jan4.getDay() + 6) % 7
  const monday = new Date(jan4.getTime())
  monday.setDate(jan4.getDate() - offset + (week - 1) * 7)
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}

/** @param {string} rel @param {Record<string, unknown>} fm */
function dateOf(rel, fm) {
  const fromPath = /(\d{4})-(\d{2})-(\d{2})/.exec(rel)
  if (fromPath !== null) return `${fromPath[1]}-${fromPath[2]}-${fromPath[3]}`
  const monthOnly = /(?:^|\/)(\d{4})-(\d{2})\.md$/i.exec(rel)
  if (monthOnly !== null) return `${monthOnly[1]}-${monthOnly[2]}-01`
  for (const key of ['date', 'created', 'published', 'lastReadDate']) {
    const value = fm[key]
    if (typeof value === 'string') {
      const hit = /(\d{4})-(\d{2})-(\d{2})/.exec(value)
      if (hit !== null) return `${hit[1]}-${hit[2]}-${hit[3]}`
    }
  }
  const week = fm.week
  if (typeof week === 'string') {
    const hit = /(\d{4})-W(\d{1,2})/i.exec(week)
    if (hit !== null) {
      const weekNumber = Number(hit[2])
      if (weekNumber >= 1 && weekNumber <= 53) return isoWeekMonday(Number(hit[1]), weekNumber)
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
    /** @type {Map<string, string[]>} resolved link target → notes linking to it */
    this.backlinks = new Map()
    /** @type {Map<string, string[]>} note basename → rels, for `[[name]]` resolution */
    this._byBase = new Map()
    /** content version: bumped only when notes actually change, keys the IDF cache */
    this.version = 0
    this.scannedAt = 0
    this.scanning = null
    this.fileCount = 0
    this.skipped = 0
    /** @type {Map<string, number> | null} bigram → document frequency */
    this._gramDf = null
    this._gramDfVersion = -1
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
    let changed = false
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
        changed = true
      } catch {
        skipped += 1
      }
    }
    // drop cached notes whose file vanished; whatever stays in `seen` vanished
    for (const rel of [...this.notes.keys()]) {
      if (seen.has(rel)) {
        seen.delete(rel)
        continue
      }
      this.notes.delete(rel)
      changed = true
    }
    this.fileCount = this.notes.size
    this.skipped = skipped
    this.scannedAt = now()
    if (changed) {
      this.version += 1
      this.#rebuildLinks()
    }
    return this
  }

  /** Resolve one `[[target]]` to a vault-relative note path, or null. */
  resolveLinkTarget(target) {
    const clean = String(target ?? '').replace(/\.md$/i, '').trim()
    if (clean === '') return null
    if (this.notes.has(`${clean}.md`)) return `${clean}.md`
    if (this.notes.has(clean)) return clean
    const list = this._byBase.get(path.basename(clean))
    if (list === undefined || list.length === 0) return null
    return list.length === 1 ? list[0] : null // ambiguous name: refuse to guess
  }

  /** wiki-link graph: resolved target → notes that link to it */
  #rebuildLinks() {
    const byBase = new Map()
    for (const rel of this.notes.keys()) {
      const base = path.basename(rel, path.extname(rel))
      const list = byBase.get(base)
      if (list === undefined) byBase.set(base, [rel])
      else list.push(rel)
    }
    this._byBase = byBase
    const backlinks = new Map()
    for (const note of this.notes.values()) {
      for (const target of note.links) {
        const resolved = this.resolveLinkTarget(target)
        if (resolved === null || resolved === note.rel) continue
        const list = backlinks.get(resolved)
        if (list === undefined) backlinks.set(resolved, [note.rel])
        else if (!list.includes(note.rel)) list.push(note.rel)
      }
    }
    this.backlinks = backlinks
  }

  /**
   * Bigram document frequency, rebuilt lazily only after the notes actually
   * change. Rare bigrams score higher, which replaces hand-tuned stopword lists.
   */
  gramDocumentFrequency() {
    if (this._gramDf !== null && this._gramDfVersion === this.version) return this._gramDf
    const df = new Map()
    for (const note of this.notes.values()) {
      for (const gram of bigrams(note.search)) df.set(gram, (df.get(gram) ?? 0) + 1)
    }
    this._gramDf = df
    this._gramDfVersion = this.version
    return df
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
  const df = typeof index.gramDocumentFrequency === 'function' ? index.gramDocumentFrequency() : null
  const docCount = Math.max(1, index.notes.size)
  const idf = (gram) => Math.log(1 + docCount / (1 + (df?.get(gram) ?? 0)))
  // a term is as informative as its grams: 常用词 like 应用 score low, rare
  // phrases score high — one common-word hit must not read as a match
  const termWeight = (term) => {
    const gramsOf = bigrams(term)
    if (gramsOf.size === 0) return 1
    let sum = 0
    for (const g of gramsOf) sum += idf(g)
    return sum / gramsOf.size / Math.log(1 + docCount)
  }
  const termWeights = normTerms.map(termWeight)
  const termWeightTotal = termWeights.reduce((sum, w) => sum + w, 0)
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
    let termHitWeight = 0
    for (let ti = 0; ti < normTerms.length; ti += 1) {
      if (has(note.search, normTerms[ti])) {
        termHits += 1
        termHitWeight += termWeights[ti]
      }
    }
    if (termHits === normTerms.length && termHits > 1) score += 2
    else if (termHits > 0 && termWeightTotal > 0) score += (termHitWeight / termWeightTotal) * 2

    if (grams.size > 0 && !phraseHit) {
      let coveredWeight = 0
      let totalWeight = 0
      for (const g of grams) {
        const weight = idf(g)
        totalWeight += weight
        if (has(note.search, g)) coveredWeight += weight
      }
      const ratio = totalWeight > 0 ? coveredWeight / totalWeight : 0
      if (ratio >= 0.6) {
        score += ratio * 2.5
        phraseHit = true
      }
    }
    if (tag !== '' && note.tags.some((t) => norm(t) === norm(tag))) score += 4
    for (const noteTag of note.tags) if (normTerms.includes(norm(noteTag))) score += 2
    if (has(norm(note.rel), phrase)) score += 2
    if (score <= 0) continue
    // recency only amplifies notes that already matched meaningfully; a lone
    // common-word hit must not ride the freshness bonus into "检索命中"
    if (score >= 1) {
      const ageDays = note.date === null ? 180 : Math.max(0, (nowMs - Date.parse(`${note.date}T00:00:00`)) / 86400000)
      score += Math.max(0, 1.2 - ageDays / 240)
    }

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
// global Q&A: date ranges, vault retrieval, streamed model answers
// ---------------------------------------------------------------------------

const ASK_SYSTEM_PROMPT = [
  '你是「Obsidian 笔记库」的全局问答助手。你只能依据用户笔记库中提供的摘录回答，不能使用外部知识编造用户没有写过的内容。',
  '',
  '回答规则：',
  '1. 先用一两句话给出结论，再展开依据；用简洁的小标题或列表组织长回答。',
  '2. 引用笔记时在句末写 [[vault 相对路径]]，路径必须来自提供的摘录，不能编造。',
  '3. 如果摘录不足以回答，明确说“笔记里没有足够信息”，并说明还缺什么；不要猜测。',
  '4. 对“工作状态 / 最近一个月”这类问题：总结整体节奏、主要事项、反复出现的问题或情绪、待办与风险，尽量引用日期和原文细节。',
  '5. 对“待办”类问题：按笔记分组列出未完成事项，指出长期未完成或反复出现的事项。',
  '6. 不要提及“上下文”“摘录”“检索”这些实现词，直接像一位熟悉用户笔记的助理一样回答。',
  '7. 默认用中文回答；用户用其他语言提问时跟随用户语言。',
].join('\n')

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** Local YYYY-MM-DD, never UTC, so daily notes line up with the user's day. */
function dayString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function dayFromString(value) {
  const [year, month, day] = String(value).split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0)
}

function shiftDay(value, offset) {
  const date = dayFromString(value)
  date.setDate(date.getDate() + offset)
  return dayString(date)
}

function mondayOf(value) {
  const date = dayFromString(value)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return dayString(date)
}

function parseCnNumber(token) {
  if (/^\d+$/.test(token)) return Number(token)
  if (token === '十') return 10
  if (token.length === 1) return CN_DIGITS[token] ?? null
  if (token.startsWith('十')) return 10 + (CN_DIGITS[token[1]] ?? 0)
  if (token.endsWith('十')) return (CN_DIGITS[token[0]] ?? 0) * 10
  if (token.includes('十')) {
    const [tens, ones] = token.split('十')
    return (CN_DIGITS[tens] ?? 0) * 10 + (CN_DIGITS[ones] ?? 0)
  }
  return null
}

/**
 * Resolve the time range a question talks about. Returns null when the
 * question carries no explicit time expression.
 * @param {string} question
 * @param {Date} [now]
 */
function detectAskRange(question, now = new Date()) {
  const text = String(question ?? '')
  const today = dayString(now)
  let match

  const fixed = (start, end, label, matched) => ({ start, end, label, matched })
  if (/今天|今日/.test(text)) return fixed(today, today, '今天', text.match(/今天|今日/)[0])
  if (/昨天|昨日/.test(text)) {
    const day = shiftDay(today, -1)
    return fixed(day, day, '昨天', text.match(/昨天|昨日/)[0])
  }
  if (/前天/.test(text)) {
    const day = shiftDay(today, -2)
    return fixed(day, day, '前天', '前天')
  }
  if (/本周|这周|这一周|本星期/.test(text)) return fixed(mondayOf(today), today, '本周', text.match(/本周|这周|这一周|本星期/)[0])
  if (/上周|上个星期|上星期/.test(text)) {
    const monday = mondayOf(shiftDay(today, -7))
    return fixed(monday, shiftDay(monday, 6), '上周', text.match(/上周|上个星期|上星期/)[0])
  }
  if (/本月|这个月|当月/.test(text)) return fixed(`${today.slice(0, 8)}01`, today, '本月', text.match(/本月|这个月|当月/)[0])
  if (/上个月|上月/.test(text)) {
    const firstOfThisMonth = dayFromString(`${today.slice(0, 8)}01`)
    const end = new Date(firstOfThisMonth.getFullYear(), firstOfThisMonth.getMonth(), 0, 12, 0, 0)
    const start = new Date(end.getFullYear(), end.getMonth(), 1, 12, 0, 0)
    return fixed(dayString(start), dayString(end), '上个月', text.match(/上个月|上月/)[0])
  }
  if (/今年|年初至今|本年/.test(text)) return fixed(`${today.slice(0, 4)}-01-01`, today, '今年', text.match(/今年|年初至今|本年/)[0])
  if (/去年|上一年/.test(text)) {
    const year = Number(today.slice(0, 4)) - 1
    return fixed(`${year}-01-01`, `${year}-12-31`, '去年', text.match(/去年|上一年/)[0])
  }

  match = /(?:最近|近)\s*([0-9一二两三四五六七八九十]+)\s*(天|日|周|星期|个月|月|年)/.exec(text)
  if (match !== null) {
    const count = parseCnNumber(match[1])
    if (count !== null && count > 0) {
      const unit = match[2]
      const days = unit === '天' || unit === '日' ? count : unit === '周' || unit === '星期' ? count * 7 : unit === '年' ? count * 365 : count * 30
      return fixed(shiftDay(today, -(days - 1)), today, match[0].replace(/\s+/g, ''), match[0])
    }
  }
  if (/最近半年|近半年/.test(text)) return fixed(shiftDay(today, -179), today, '最近半年', text.match(/最近半年|近半年/)[0])
  if (/最近一年|近一年/.test(text)) return fixed(shiftDay(today, -364), today, '最近一年', text.match(/最近一年|近一年/)[0])

  match = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(text)
  if (match !== null) {
    const year = Number(match[1])
    const month = Number(match[2])
    if (month >= 1 && month <= 12) {
      const start = new Date(year, month - 1, 1, 12, 0, 0)
      const end = new Date(year, month, 0, 12, 0, 0)
      return fixed(dayString(start), dayString(end), `${year}年${month}月`, match[0])
    }
  }

  match = /(?:^|[^\d])(\d{1,2})\s*月/.exec(text)
  if (match !== null) {
    const month = Number(match[1])
    if (month >= 1 && month <= 12) {
      const year = Number(today.slice(0, 4))
      const start = new Date(year, month - 1, 1, 12, 0, 0)
      const end = new Date(year, month, 0, 12, 0, 0)
      return fixed(dayString(start), dayString(end), `${year}年${month}月`, match[0])
    }
  }
  if (/最近|近期/.test(text)) return fixed(shiftDay(today, -13), today, '最近两周', text.match(/最近|近期/)[0])
  return null
}

/** Strip time phrases and conversational filler to get searchable terms. */
function cleanAskQuery(question, range) {
  let text = String(question ?? '')
  if (range !== null && range.matched) text = text.replace(range.matched, ' ')
  return text
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()【】\[\]]/g, ' ')
    .replace(/请问|帮我|帮忙|看看|看一下|告诉我|说一说|说说|总结一下|总结|整理一下|整理|概括|梳理|分析一下|分析|最近|近期|一下|我的|我|有哪些|有什么|怎么样|如何|多少|状态|情况|相关|现在|目前|的|了|在|是|什么|事项/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Note's best known day: frontmatter/date from path, else file mtime. */
function noteDay(note) {
  return note.date !== null && note.date !== undefined ? note.date : dayString(new Date(note.mtimeMs))
}

/** Collect unchecked `- [ ]` tasks, optionally limited to a date range. */
function collectOpenTasks(index, range) {
  const rows = []
  for (const note of index.notes.values()) {
    const day = noteDay(note)
    if (range !== null && (day < range.start || day > range.end)) continue
    let heading = ''
    for (const line of note.text.split(/\r?\n/)) {
      const headingMatch = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line)
      if (headingMatch !== null) {
        heading = headingMatch[2]
        continue
      }
      const taskMatch = /^[ \t]*[-*+][ \t]+\[[ ]\][ \t]+(.+)$/.exec(line)
      if (taskMatch !== null) {
        rows.push({ path: note.rel, title: note.title, date: note.date, heading, text: taskMatch[1].trim().slice(0, 200) })
        if (rows.length >= 160) return rows
      }
    }
  }
  return rows
}

const EXCERPT_WINDOW_LIMIT = 9

/**
 * Pick the excerpt window with the densest term hits instead of always
 * starting at the first match: a note may mention the topic once early on and
 * elaborate much later.
 * @param {string} body @param {string[]} terms @param {number} limit
 */
function excerptAround(body, terms, limit) {
  const text = String(body ?? '').trim()
  if (text === '') return ''
  const lowered = text.toLowerCase()
  const needles = [...new Set(terms.map((term) => String(term ?? '').trim().toLowerCase()).filter((n) => n.length >= 2))]
  /** @type {number[]} */
  const starts = [0]
  for (const needle of needles) {
    let from = 0
    for (let k = 0; k < 3 && starts.length < EXCERPT_WINDOW_LIMIT; k += 1) {
      const index = lowered.indexOf(needle, from)
      if (index === -1) break
      starts.push(Math.max(0, index - 320))
      from = index + needle.length
    }
    if (starts.length >= EXCERPT_WINDOW_LIMIT) break
  }
  const hitsIn = (start) => {
    const slice = lowered.slice(start, Math.min(text.length, start + limit))
    let count = 0
    for (const needle of needles) {
      let from = 0
      for (;;) {
        const found = slice.indexOf(needle, from)
        if (found === -1) break
        count += 1
        from = found + needle.length
      }
    }
    return count
  }
  let best = 0
  let bestHits = -1
  const seenKeys = new Set()
  for (const rawStart of starts) {
    const key = Math.round(rawStart / 240)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    const hits = hitsIn(rawStart)
    if (hits > bestHits || (hits === bestHits && rawStart < best)) {
      bestHits = hits
      best = rawStart
    }
  }
  let out = text.slice(best, best + limit)
  if (best > 0) out = `…${out}`
  if (best + limit < text.length) out = `${out}…`
  return out
}

/** Compact scalar frontmatter for the model (weight, uric acid, glucose, mood…). */
function frontmatterLine(fm) {
  if (fm === null || typeof fm !== 'object') return ''
  const skip = new Set(['tags', 'title', 'date', 'created', 'published', 'lastReadDate', 'aliases', 'cssclasses', 'week'])
  const parts = []
  for (const [key, value] of Object.entries(fm)) {
    if (skip.has(key) || value === null || value === undefined) continue
    let text
    if (Array.isArray(value)) text = value.map(String).join(', ')
    else if (typeof value === 'object') continue
    else text = String(value)
    if (text === '' || text.length > 160) continue
    parts.push(`${key}: ${text}`)
    if (parts.length >= 8) break
  }
  return parts.join(' · ')
}

/** Notes in journal/review folders answer "how am I doing" better than clips. */
function askFolderWeight(note, question, roles) {
  const folder = String(note.folder ?? '')
  let weight = 0
  if (folderInRole(folder, roles.journal)) weight += 4.5
  if (folderInRole(folder, roles.review)) weight += 4
  if (folderInRole(folder, roles.project)) weight += 2
  if (folderInRole(folder, roles.notes)) weight += 1
  if (folderInRole(folder, roles.clips)) weight -= question.includes('收藏') ? 0 : 6
  return weight
}

/** Keep "journal" and "review" questions inside their own folders, and keep clippings out unless asked for. */
function askNoteAllowed(note, question, roles) {
  const folder = String(note.folder ?? '')
  const isJournal = folderInRole(folder, roles.journal)
  const isReview = folderInRole(folder, roles.review)
  const isClip = folderInRole(folder, roles.clips)
  if (/日记|日志|journal/i.test(question) && !isJournal) return false
  if (/复盘|周报|月报|review/i.test(question) && !isReview) return false
  if (isClip && !/收藏|剪藏|文章|书|摘录|引用|clip/i.test(question)) return false
  return true
}

/**
 * Build the model-facing context for one question from the in-memory index.
 * @param {VaultIndex} index
 * @param {string} question
 * @param {Date} [now]
 * @param {{ question?: string, sources?: Array<{path: string}>, range?: {label?: string, start: string, end: string} | null }} [prior]
 *   retrieval prior from the previous turn, so follow-ups stay in scope
 * @param {Record<string, string[]>} [roles] resolved folder roles
 */
function buildAskBundle(index, question, now = new Date(), prior = null, roles = { ...ROLE_DEFAULT_DIRS }) {
  const detectedRange = detectAskRange(question, now)
  const range = detectedRange !== null ? detectedRange : prior?.range ?? null
  const cleaned = cleanAskQuery(question, detectedRange)
  const wantsTodo = /待办|todo|任务|清单|未完成|checklist/i.test(question)
  const wantsCount = /多少|几篇|几则|几个|数量|统计/.test(question)
  const stats = computeStats(index, { groupBy: 'folder' })
  const notes = [...index.notes.values()]

  const candidates = new Map()
  const bump = (note, score, reason) => {
    if (note === null || note === undefined) return
    if (!askNoteAllowed(note, question, roles)) return
    const weighted = score + askFolderWeight(note, question, roles)
    const previous = candidates.get(note.rel)
    if (previous === undefined) candidates.set(note.rel, { note, score: weighted, reasons: [reason] })
    else {
      previous.score = Math.max(previous.score, weighted)
      if (!previous.reasons.includes(reason)) previous.reasons.push(reason)
    }
  }

  const hitByPath = new Map()
  let searchQuery = cleaned !== '' ? cleaned : question
  if (prior !== null && typeof prior.question === 'string') {
    const priorCleaned = cleanAskQuery(prior.question, detectAskRange(prior.question, now))
    const ownWords = cleaned.split(/\s+/).filter((word) => word !== '')
    if (priorCleaned !== '' && ownWords.length <= 2) searchQuery = `${cleaned} ${priorCleaned}`.trim()
  }
  let hits = []
  try {
    hits = searchNotes(index, {
      query: searchQuery,
      limit: 32,
      since: range === null ? undefined : range.start,
      until: range === null ? undefined : range.end,
    })
  } catch {
    hits = []
  }
  for (const hit of hits) hitByPath.set(hit.path, hit)
  if (hitByPath.size < 6 && cleaned !== '' && cleaned !== question) {
    try {
      for (const hit of searchNotes(index, { query: question, limit: 24, since: range === null ? undefined : range.start, until: range === null ? undefined : range.end })) {
        if (!hitByPath.has(hit.path)) hitByPath.set(hit.path, hit)
      }
    } catch {
      /* search is best-effort; dated notes still answer range questions */
    }
  }
  // a hit below 1 is a common-word graze, not evidence — it must not become a
  // strong "检索命中" or defeat the honest weak-retrieval signal
  for (const hit of hitByPath.values()) {
    if ((Number(hit.score) || 0) < 1) continue
    bump(index.get(hit.path), 12 + Math.min(8, Number(hit.score) || 0), '检索命中')
  }

  // carry the previous answer's notes over so "展开第二点" keeps its scope
  if (prior !== null && Array.isArray(prior.sources)) {
    for (const source of prior.sources.slice(0, 30)) {
      if (source === null || typeof source !== 'object') continue
      const rel = String(source.path ?? '').trim()
      if (rel === '') continue
      bump(index.get(rel), 7, '承接上文')
    }
  }

  if (range !== null) {
    for (const note of notes) {
      if (note.date === null || note.date === undefined) continue
      if (note.date < range.start || note.date > range.end) continue
      const ageDays = Math.max(0, (dayFromString(range.end).getTime() - dayFromString(note.date).getTime()) / 86400000)
      let score = 8 + Math.max(0, 3 - ageDays / 12)
      if (folderInRole(note.folder, roles.journal) || folderInRole(note.folder, roles.review) || folderInRole(note.folder, roles.project) || /工作/.test(note.folder) || note.tags.some((tag) => /工作|复盘|项目/.test(tag))) score += 1.5
      bump(note, score, '时间范围内')
    }
  }

  const openTasks = wantsTodo ? collectOpenTasks(index, range) : []
  openTasks.sort((a, b) => {
    const left = a.date ?? ''
    const right = b.date ?? ''
    return right.localeCompare(left) || a.path.localeCompare(b.path, 'zh')
  })
  for (const task of openTasks) {
    const ageDays = task.date === null ? 365 : Math.max(0, (dayFromString(dayString(now)).getTime() - dayFromString(task.date).getTime()) / 86400000)
    bump(index.get(task.path), 10.5 + Math.max(0, 4 - ageDays / 30), '未完成待办')
  }

  // one link-graph hop around the strongest candidates: notes that cite them
  // (or that they cite) often answer the question without sharing keywords.
  // Fallback seeds (最近更新) stay out, so padding never breeds "strong" hits.
  if (candidates.size > 0 && index.backlinks instanceof Map) {
    const strongSeedReasons = new Set(['检索命中', '时间范围内', '未完成待办', '承接上文'])
    const seeds = [...candidates.values()]
      .sort((a, b) => b.score - a.score)
      .filter((seed) => seed.reasons.some((reason) => strongSeedReasons.has(reason)))
      .slice(0, 10)
    for (const seed of seeds) {
      const linked = new Set()
      for (const target of seed.note.links) {
        const resolved = index.resolveLinkTarget(target)
        if (resolved !== null) linked.add(resolved)
      }
      for (const source of index.backlinks.get(seed.note.rel) ?? []) linked.add(source)
      for (const rel of linked) bump(index.get(rel), Math.max(2.5, seed.score * 0.35), '链接关联')
    }
  }

  if (candidates.size < 6 && range === null) {
    const recent = notes.slice().sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 12)
    for (const note of recent) bump(note, 2, '最近更新')
  }

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score)
  const excerptTerms = [cleaned, question]
  if (prior !== null && typeof prior.question === 'string' && prior.question.trim() !== '') excerptTerms.push(prior.question)
  const selected = []
  let used = 0
  const budget = 56000
  for (const row of ranked) {
    if (selected.length >= 18) break
    const note = row.note
    const inRange = range !== null && note.date !== null && note.date !== undefined && note.date >= range.start && note.date <= range.end
    const limit = inRange ? 2400 : 1600
    const excerpt = excerptAround(note.text, excerptTerms, limit)
    if (excerpt === '') continue
    if (selected.length >= 6 && used + excerpt.length > budget) break
    used += excerpt.length
    selected.push({
      path: note.rel,
      title: note.title,
      date: note.date,
      folder: note.folder,
      meta: frontmatterLine(note.fm),
      excerpt,
      reasons: row.reasons,
    })
  }

  const strongReasons = new Set(['检索命中', '时间范围内', '未完成待办', '链接关联'])
  const strongMatches = selected.filter((row) => row.reasons.some((reason) => strongReasons.has(reason))).length

  const folderLine = stats.rows.slice(0, 8).map((row) => `${row.key}（${row.count}）`).join('；')
  const tasksOpen = Math.max(0, stats.tasksTotal - stats.tasksDone)
  const blocks = [
    `【库概览】\n- 笔记 ${stats.noteCount} 篇；目录 ${stats.rows.length} 个\n- 待办 ${stats.tasksDone}/${stats.tasksTotal} 已完成${stats.completion === null ? '' : `（${stats.completion}%）`}，未完成 ${tasksOpen} 条\n- 目录分布：${folderLine || '—'}`,
  ]
  if (range !== null) {
    const inRange = notes.filter((note) => note.date !== null && note.date !== undefined && note.date >= range.start && note.date <= range.end)
    const daily = inRange.filter((note) => folderInRole(note.folder, roles.journal)).length
    const reviews = inRange.filter((note) => folderInRole(note.folder, roles.review)).length
    const rangeTasksTotal = inRange.reduce((sum, note) => sum + (Number(note.tasksTotal) || 0), 0)
    const rangeTasksDone = inRange.reduce((sum, note) => sum + (Number(note.tasksDone) || 0), 0)
    const rangeTasksOpen = Math.max(0, rangeTasksTotal - rangeTasksDone)
    const rangeCompletion = rangeTasksTotal === 0 ? null : Math.round((rangeTasksDone / rangeTasksTotal) * 100)
    blocks.push(`【时间范围】${range.label}（${range.start} 至 ${range.end}）\n- 范围内有日期的笔记 ${inRange.length} 篇，其中日记 ${daily} 篇、复盘 ${reviews} 篇\n- 范围内待办 ${rangeTasksDone}/${rangeTasksTotal} 已完成${rangeCompletion === null ? '' : `（${rangeCompletion}%）`}，未完成 ${rangeTasksOpen} 条。回答该范围完成占比时以这组数字为准。`)
  }
  if (wantsCount) {
    let subset = notes
    if (range !== null) subset = subset.filter((note) => note.date !== null && note.date !== undefined && note.date >= range.start && note.date <= range.end)
    if (/日记/.test(question)) subset = subset.filter((note) => folderInRole(note.folder, roles.journal))
    else if (/复盘/.test(question)) subset = subset.filter((note) => folderInRole(note.folder, roles.review))
    else if (/笔记/.test(question)) subset = subset.filter((note) => !folderInRole(note.folder, roles.clips))
    blocks.push(`【精确统计】\n- 符合问题条件的笔记共 ${subset.length} 篇${range === null ? '' : `（${range.label}）`}。回答数量题时以这个数字为准，不要重新估算。`)
  }
  if (wantsTodo && openTasks.length > 0) {
    const shown = openTasks.slice(0, 80)
    blocks.push(`【未完成待办】共 ${openTasks.length} 条${openTasks.length > shown.length ? `（显示前 ${shown.length} 条）` : ''}\n${shown.map((task) => `- [[${task.path}]]${task.heading !== '' ? ` · ${task.heading}` : ''}：${task.text}`).join('\n')}`)
  }
  blocks.push(`【相关笔记】\n${selected.map((row, index) => `### ${index + 1}. ${row.path}${row.date === null ? '' : `（${row.date}）`}\n${row.meta === '' ? '' : `元数据：${row.meta}\n`}${row.excerpt}`).join('\n\n')}`)
  if (strongMatches === 0) {
    blocks.push('【检索说明】本次没有检索到与问题强相关的笔记（下面的摘录只是近期内容兜底）。如果笔记里确实没有相关记录，请在回答开头明确说明，不要依据这些兜底内容硬答。')
  }

  const user = `当前日期：${dayString(now)}\n问题：${question}\n\n${blocks.join('\n\n')}`
  return {
    system: ASK_SYSTEM_PROMPT,
    user,
    range,
    sources: selected.map((row) => ({ path: row.path, title: row.title, date: row.date, folder: row.folder, reason: row.reasons.join('、') })),
    matched: selected.length,
    strongMatches,
    openTasks: openTasks.length,
    stats: { noteCount: stats.noteCount, folderCount: stats.rows.length, tasksTotal: stats.tasksTotal, tasksDone: stats.tasksDone },
  }
}

/** Tolerant provider entry: adapter registrations use several shapes. */
function providerEntryOf(entry) {
  if (entry === null || typeof entry !== 'object') return null
  const candidates = [entry.provider, entry.route, entry.id]
  const provider = candidates.find((value) => typeof value === 'string' && value.trim() !== '')
  if (provider === undefined) return null
  const label = [entry.name, entry.displayName, entry.label, entry.title].find((value) => typeof value === 'string' && value.trim() !== '') ?? provider
  return { provider: provider.trim(), label: label.trim() }
}

/** Tolerant model entry. */
function modelEntryOf(entry) {
  if (entry === null || typeof entry !== 'object') return null
  const candidates = [entry.id, entry.model, entry.name]
  const id = candidates.find((value) => typeof value === 'string' && value.trim() !== '')
  if (id === undefined) return null
  const label = [entry.name, entry.displayName, entry.label, entry.title].find((value) => typeof value === 'string' && value.trim() !== '') ?? id
  return { id: id.trim(), name: label.trim() }
}

/** The route new DSH chats are currently using, if exposed. */
function currentDefaultRoute(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
    if (selection !== null && selection !== undefined && typeof selection.provider === 'string' && selection.provider !== '' && typeof selection.model === 'string' && selection.model !== '') {
      return { provider: selection.provider, model: selection.model }
    }
  } catch {
    /* the default model service is optional */
  }
  return null
}

/** Full provider/model catalog for the panel's custom selector. */
async function listModelCatalog(ctx, llm) {
  const current = currentDefaultRoute(ctx)
  const providers = []
  if (typeof llm.listProviders === 'function') {
    let listed = []
    try {
      listed = await llm.listProviders()
    } catch {
      listed = []
    }
    for (const entry of Array.isArray(listed) ? listed : []) {
      const provider = providerEntryOf(entry)
      if (provider === null) continue
      let models = []
      if (typeof llm.listModels === 'function') {
        try {
          const rows = await llm.listModels(provider.provider)
          models = (Array.isArray(rows) ? rows : []).flatMap((row) => {
            const model = modelEntryOf(row)
            return model === null ? [] : [model]
          }).slice(0, 40)
        } catch {
          models = []
        }
      }
      if (models.length > 0) providers.push({ provider: provider.provider, name: provider.label, models })
    }
  }
  return { current, providers }
}

/** Resolve a custom route when it is usable, else fall back to DSH's current route. */
async function resolveAskRoute(ctx, llm, requested) {
  const provider = typeof requested?.provider === 'string' ? requested.provider.trim() : ''
  const model = typeof requested?.model === 'string' ? requested.model.trim() : ''
  if (provider !== '' && model !== '') {
    let usable = true
    if (typeof llm.resolveModelInfo === 'function') {
      try {
        await llm.resolveModelInfo(provider, model)
      } catch {
        usable = false
      }
    }
    if (usable) return { provider, model, source: 'custom' }
  }
  const fallback = currentDefaultRoute(ctx)
  if (fallback !== null) {
    return {
      ...fallback,
      source: 'default',
      ...(provider !== '' && model !== '' ? { fallbackFrom: `${provider}/${model}` } : {}),
    }
  }
  if (typeof llm.listProviders === 'function') {
    const providers = await llm.listProviders()
    for (const entry of Array.isArray(providers) ? providers : []) {
      const route = providerEntryOf(entry)
      if (route === null) continue
      const models = await llm.listModels(route.provider)
      const first = Array.isArray(models) ? models.find((item) => modelEntryOf(item) !== null) : undefined
      if (first !== undefined) {
        const modelEntry = modelEntryOf(first)
        return {
          provider: route.provider,
          model: modelEntry.id,
          source: 'default',
          ...(provider !== '' && model !== '' ? { fallbackFrom: `${provider}/${model}` } : {}),
        }
      }
    }
  }
  throw new Error('当前环境没有可用的模型服务')
}

/** Pick a reasoning effort: fast by default, stronger when the user asks. */
async function chooseAskEffort(llm, provider, model, deep) {
  if (typeof llm.resolveModelInfo !== 'function') return undefined
  try {
    const info = await llm.resolveModelInfo(provider, model)
    const efforts = info?.reasoning?.efforts
    if (!Array.isArray(efforts) || efforts.length === 0) return undefined
    const ids = efforts.map((effort) => String(effort.id))
    const order = deep ? ['high', 'max', 'medium', 'low'] : ['low', 'medium', 'high', 'max']
    for (const candidate of order) if (ids.includes(candidate)) return candidate
    return ids[0]
  } catch {
    return undefined
  }
}

/**
 * Stream one answer into the caller's event sink.
 * @param {any} ctx
 * @param {VaultIndex} index
 * @param {{ question: string, history?: unknown, deep?: boolean, provider?: string, model?: string }} request
 * @param {(event: Record<string, unknown>) => void} emit
 * @param {AbortSignal} signal
 */
/** Validate the client-sent previous-turn prior before it touches retrieval. */
function sanitizeAskPrior(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const prior = {}
  if (typeof raw.question === 'string' && raw.question.trim() !== '') prior.question = raw.question.trim().slice(0, 2000)
  if (Array.isArray(raw.sources)) {
    const sources = []
    for (const item of raw.sources.slice(0, 30)) {
      if (item === null || typeof item !== 'object') continue
      const rel = String(item.path ?? '').trim()
      if (rel !== '' && rel.length <= 400) sources.push({ path: rel })
    }
    if (sources.length > 0) prior.sources = sources
  }
  if (raw.range !== null && typeof raw.range === 'object') {
    const start = String(raw.range.start ?? '')
    const end = String(raw.range.end ?? '')
    if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end) {
      prior.range = { label: typeof raw.range.label === 'string' ? raw.range.label.slice(0, 60) : '', start, end }
    }
  }
  return Object.keys(prior).length > 0 ? prior : null
}

async function streamAskAnswer(ctx, index, request, emit, signal) {
  const llm = ctx.get('llm')
  if (llm === undefined || llm === null || typeof llm.stream !== 'function') throw new Error('当前环境没有可用的模型服务')
  const route = await resolveAskRoute(ctx, llm, { provider: request.provider, model: request.model })
  const roles = await getFolderRoles(index.root)
  const bundle = buildAskBundle(index, request.question, new Date(), sanitizeAskPrior(request.prior), roles)
  const effort = await chooseAskEffort(llm, route.provider, route.model, request.deep === true)
  emit({
    type: 'meta',
    provider: route.provider,
    model: route.model,
    modelSource: route.source ?? 'default',
    fallbackFrom: route.fallbackFrom ?? null,
    effort: effort ?? null,
    sources: bundle.sources,
    range: bundle.range,
    matched: bundle.matched,
    strongMatches: bundle.strongMatches,
    openTasks: bundle.openTasks,
    noteCount: bundle.stats.noteCount,
  })

  const history = Array.isArray(request.history) ? request.history.slice(-6) : []
  let historyText = ''
  for (const item of history) {
    if (item === null || typeof item !== 'object') continue
    const role = item.role === 'assistant' ? '助手' : '用户'
    const text = String(item.text ?? '').trim().slice(0, 1800)
    if (text !== '') historyText += `${role}：${text}\n`
  }
  const userText = historyText === '' ? bundle.user : `【最近对话】\n${historyText}\n${bundle.user}`
  const messages = [{ role: 'user', content: [{ type: 'text', text: userText }] }]

  let characters = 0
  let finishKind = 'stop'
  let usage = null
  let noticedReasoning = false
  const stream = llm.stream({
    provider: route.provider,
    model: route.model,
    messages,
    system: bundle.system,
    maxTokens: request.deep === true ? 4200 : 3000,
    temperature: 0.35,
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
    signal,
  })

  for await (const chunk of stream) {
    if (signal.aborted) {
      finishKind = 'aborted'
      break
    }
    if (chunk === null || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta') {
      const text = String(chunk.text ?? '')
      if (text === '') continue
      characters += text.length
      emit({ type: 'delta', text })
      continue
    }
    if (chunk.type === 'reasoning-delta') {
      if (!noticedReasoning) {
        noticedReasoning = true
        emit({ type: 'phase', phase: 'thinking' })
      }
      continue
    }
    if (chunk.type === 'usage') {
      usage = chunk.usage ?? null
      continue
    }
    if (chunk.type === 'finish') {
      finishKind = chunk.reason?.kind ?? 'stop'
      if (finishKind === 'error') throw new Error(chunk.reason?.failure?.message ?? '模型调用失败')
    }
  }
  emit({ type: 'done', characters, finish: finishKind, usage })
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

/**
 * Literal search/replace inside one note, always backed up first. Refuses
 * ambiguous matches so an agent never rewrites the wrong passage.
 * @param {string} root
 * @param {{ path: string, find: string, replace: string, replaceAll?: boolean }} request
 */
async function editNote(root, request) {
  const rel = String(request.path).replaceAll('\\', '/').replace(/^\/+/, '')
  if (rel === '' || rel.endsWith('/')) throw new Error('需要文件路径，例如 项目/计划.md')
  const find = String(request.find ?? '')
  if (find === '') throw new Error('find 不能为空')
  const replace = String(request.replace ?? '')
  const abs = absOf(root, rel)
  let current
  try {
    current = await fsp.readFile(abs, 'utf8')
  } catch {
    throw new Error(`文件不存在：${rel}`)
  }
  let count = 0
  let from = 0
  for (;;) {
    const index = current.indexOf(find, from)
    if (index === -1) break
    count += 1
    from = index + find.length
    if (count > 500) break
  }
  if (count === 0) throw new Error(`没有找到要替换的文本：${find.slice(0, 60)}${find.length > 60 ? '…' : ''}`)
  if (count > 1 && request.replaceAll !== true) {
    throw new Error(`该文本出现 ${count} 次。请让 find 更长更具体，或明确 replaceAll: true。`)
  }
  const next = request.replaceAll === true ? current.split(find).join(replace) : current.replace(find, replace)
  const backup = await backupFile(root, rel)
  await atomicWrite(abs, next)
  return { path: rel, changes: request.replaceAll === true ? count : 1, bytes: Buffer.byteLength(next, 'utf8'), backup }
}

/** Sanitize a question into a safe note filename segment. */
function askSaveSlug(question) {
  const cleaned = String(question ?? '')
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
  return cleaned === '' ? '问答' : cleaned
}

/** Render one Q&A turn as a note body the vault can keep. */
function askSaveMarkdown(question, answer, sources) {
  const list = Array.isArray(sources)
    ? sources
        .filter((source) => source !== null && typeof source === 'object' && String(source.path ?? '').trim() !== '')
        .map((source) => `- [[${String(source.path).trim()}]]${typeof source.title === 'string' && source.title !== '' ? `（${source.title}）` : ''}`)
    : []
  return [
    '---',
    'tags:',
    '  - 问答',
    `created: ${dayString()}`,
    '---',
    '',
    `# ${askSaveSlug(question)}`,
    '',
    `> ${String(question ?? '').trim()}`,
    '',
    String(answer ?? '').trim(),
    '',
    list.length > 0 ? ['## 来源', '', ...list].join('\n') : '',
  ]
    .filter((section) => section !== '')
    .join('\n')
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
      name: 'obsidian_tasks',
      description: 'List unchecked tasks (- [ ]) across the vault, newest note first, optionally scoped to a date range or folder, with the note path and heading for each. Use it for "open todos / 未完成待办" questions.',
      parameters: {
        folder: { type: 'string', description: '限定目录，如 项目' },
        since: { type: 'string', description: '起始日期 YYYY-MM-DD（按笔记日期过滤）' },
        until: { type: 'string', description: '截止日期 YYYY-MM-DD' },
        limit: { type: 'integer', description: '返回条数，默认 80，最大 160' },
      },
      output: {
        schema: { type: 'object', properties: { total: { type: 'integer' }, tasks: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' }, date: { type: 'string' } } } } } },
        render: (_a, v) => (v.total === 0 ? [{ type: 'text', text: '没有未完成的待办。' }] : [{ type: 'text', text: `共 ${v.total} 条未完成（显示 ${v.tasks.length}）\n${v.tasks.map((task) => `- [[${task.path}]]${task.heading !== '' ? ` · ${task.heading}` : ''}：${task.text}`).join('\n')}` }]),
      },
      async execute(args, exec) {
        const vault = await ready(exec.signal)
        const since = typeof args.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.since) ? args.since : '0000-01-01'
        const until = typeof args.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.until) ? args.until : '9999-12-31'
        const scope = typeof args.folder === 'string' && args.folder.trim() !== '' ? args.folder.trim().replace(/\/+$/, '') : null
        const rows = collectOpenTasks(vault, { start: since, end: until })
          .filter((task) => scope === null || task.path === scope || task.path.startsWith(`${scope}/`))
        rows.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.path.localeCompare(b.path, 'zh'))
        const limit = Math.min(Math.max(Number(args.limit) || 80, 1), 160)
        return { total: rows.length, tasks: rows.slice(0, limit) }
      },
      presentCall: (args) => ({ card: 'generic', title: `列出待办${args.folder ? `：${args.folder}` : ''}`, kind: 'other', rawInput: args }),
    },
    {
      name: 'obsidian_edit',
      description: 'Precise literal search/replace inside one existing note. Refuses when the find text matches more than once unless replaceAll is true, and always backs up the previous content. Prefer this over rewriting a whole note with obsidian_write when only a passage changes.',
      parameters: {
        path: { type: 'string', required: true, description: 'vault 相对路径' },
        find: { type: 'string', required: true, description: '要替换的原文，必须与文件内容逐字一致' },
        replace: { type: 'string', required: true, description: '替换后的文本（可为空串表示删除）' },
        replaceAll: { type: 'boolean', description: '替换全部匹配，默认只允许唯一匹配' },
      },
      output: {
        schema: { type: 'object', properties: { path: { type: 'string' }, changes: { type: 'integer' }, bytes: { type: 'integer' }, backup: { type: 'string' } } },
        render: (_a, v) => [{ type: 'text', text: `已编辑 ${v.path}（替换 ${v.changes} 处，现 ${v.bytes} 字节）${v.backup ? `\n备份：${v.backup}` : ''}` }],
      },
      async execute(args, exec) {
        const vault = await ready(exec.signal)
        return editNote(vault.root, {
          path: String(args.path ?? ''),
          find: String(args.find ?? ''),
          replace: String(args.replace ?? ''),
          replaceAll: args.replaceAll === true,
        })
      },
      presentCall: (args) => ({ card: 'generic', title: `编辑笔记：${args.path}`, kind: 'other', rawInput: args }),
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
            : `## Obsidian vault (mounted)\nVault root: ${index.root}\nNotes indexed: ${index.notes.size}\nUse obsidian_search to locate notes (it matches Chinese by character bigrams), obsidian_read to read one, obsidian_daily for diary entries, obsidian_tasks for open todos, obsidian_stats for counting questions, obsidian_edit for precise in-place edits, and obsidian_append/obsidian_write to add content. Writing is permitted without asking for confirmation; create-mode never overwrites and edits are backed up. Cite the vault-relative path of any note you rely on.`,
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
        folderRoles: index.root === '' ? null : await getFolderRoles(index.root),
        candidates: vaults,
      })
    })

    route('models', async (_req, res) => {
      const llm = ctx.get('llm')
      if (llm === undefined || llm === null) return sendJson(res, 503, { error: '当前环境没有可用的模型服务' })
      sendJson(res, 200, await listModelCatalog(ctx, llm))
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

    route('overview', async (_req, res) => {
      const vault = await mountedVault()
      const stats = computeStats(vault, { groupBy: 'folder' })
      const notes = [...vault.notes.values()]
      const today = dayString()
      const weekStart = shiftDay(today, -6)
      const monthStart = `${today.slice(0, 8)}01`
      let weekNotes = 0
      let monthNotes = 0
      const folders = new Set()
      const tags = new Set()
      for (const note of notes) {
        if (note.folder !== '') folders.add(note.folder.split('/')[0])
        for (const tag of note.tags) tags.add(tag)
        if (note.date !== null && note.date >= weekStart && note.date <= today) weekNotes += 1
        if (note.date !== null && note.date >= monthStart && note.date <= today) monthNotes += 1
      }
      const recentNotes = notes
        .slice()
        .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || b.mtimeMs - a.mtimeMs)
        .slice(0, 6)
        .map((note) => ({ path: note.rel, title: note.title, date: note.date, folder: note.folder, mtimeMs: note.mtimeMs }))
      sendJson(res, 200, {
        noteCount: stats.noteCount,
        folderCount: folders.size,
        tagCount: tags.size,
        cjkChars: stats.cjkChars,
        weekNotes,
        monthNotes,
        tasksTotal: stats.tasksTotal,
        tasksDone: stats.tasksDone,
        tasksOpen: Math.max(0, stats.tasksTotal - stats.tasksDone),
        completion: stats.completion,
        topFolders: stats.rows.slice(0, 6),
        recentNotes,
        updatedAt: vault.scannedAt,
      })
    })

    // Server-sent events: retrieval metadata first, then token deltas from the
    // same model route new chats use. The panel owns rendering; this route only
    // streams plain text and source paths.
    route('ask', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const body = await readJson(req)
      const question = String(body.question ?? '').trim()
      if (question === '') return sendJson(res, 400, { error: '缺少 question' })
      if (question.length > 4000) return sendJson(res, 400, { error: '问题太长（最多 4000 字）' })
      const provider = String(body.provider ?? '').trim()
      const model = String(body.model ?? '').trim()
      if (provider.length > 200 || model.length > 200) return sendJson(res, 400, { error: '模型标识过长' })
      const llm = ctx.get('llm')
      if (llm === undefined || llm === null) return sendJson(res, 503, { error: '当前环境没有可用的模型服务' })
      const vault = await mountedVault()

      res.statusCode = 200
      res.setHeader('content-type', 'text/event-stream; charset=utf-8')
      res.setHeader('cache-control', 'no-cache, no-transform')
      res.setHeader('connection', 'keep-alive')
      res.setHeader('x-accel-buffering', 'no')
      if (typeof res.flushHeaders === 'function') res.flushHeaders()
      const controller = new AbortController()
      const close = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.on('aborted', close)
      res.on('close', close)
      const emit = (event) => {
        if (res.writableEnded === true) return
        try {
          res.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
        } catch {
          /* the peer may have gone away mid-token */
        }
      }
      try {
        await streamAskAnswer(ctx, vault, { question, history: body.history, prior: body.prior, deep: body.deep === true, provider, model }, emit, controller.signal)
      } catch (error) {
        emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      } finally {
        try {
          res.end()
        } catch {
          /* already closed */
        }
      }
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

    route('ask-save', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const body = await readJson(req)
      const question = String(body.question ?? '').trim()
      const answer = String(body.answer ?? '').trim()
      if (question === '' || answer === '') return sendJson(res, 400, { error: '需要 question 与 answer' })
      if (question.length > 4000 || answer.length > 60000) return sendJson(res, 400, { error: '内容过长' })
      const vault = await mountedVault()
      const content = askSaveMarkdown(question, answer, Array.isArray(body.sources) ? body.sources : [])
      const base = `问答/${dayString()} ${askSaveSlug(question)}`
      const candidates = [`${base}.md`, ...[2, 3, 4, 5].map((n) => `${base} ${n}.md`), `${base} ${Date.now()}.md`]
      let lastError = null
      for (const candidate of candidates) {
        try {
          const result = await writeNote(vault.root, { path: candidate, content, mode: 'create' })
          await index.refresh()
          return sendJson(res, 200, result)
        } catch (error) {
          lastError = error
        }
      }
      throw lastError instanceof Error ? lastError : new Error('保存失败')
    })

    route('feedback', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const body = await readJson(req)
      const rating = body.rating === 'up' || body.rating === 'down' ? body.rating : null
      if (rating === null) return sendJson(res, 400, { error: 'rating 需要 up 或 down' })
      const row = {
        ts: new Date().toISOString(),
        rating,
        question: String(body.question ?? '').slice(0, 2000),
        model: typeof body.model === 'string' ? body.model.slice(0, 200) : '',
        matched: Number(body.matched) || 0,
        strongMatches: Number(body.strongMatches) || 0,
        characters: Number(body.characters) || 0,
      }
      await fsp.mkdir(DATA_DIR, { recursive: true })
      await fsp.appendFile(path.join(DATA_DIR, 'feedback.jsonl'), `${JSON.stringify(row)}\n`, 'utf8')
      return sendJson(res, 200, { ok: true })
    })

    route('reindex', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })
      const vault = await mountedVault()
      await vault.refresh()
      return sendJson(res, 200, statusPayload(vault))
    })
  }, 'obsidian: http routes')
}

// Pure helpers exposed for the zero-dependency `node --test` suite in test/.
export const __test = {
  ROLE_DEFAULT_DIRS,
  normalizeFolderRoles,
  folderInRole,
  bigrams,
  searchNotes,
  computeStats,
  collectOpenTasks,
  excerptAround,
  detectAskRange,
  cleanAskQuery,
  parseCnNumber,
  dayFromString,
  shiftDay,
  dayString,
  isoWeekMonday,
  applyDateFormat,
  parseYamlLite,
  parseNote,
  absOf,
  buildAskBundle,
  writeNote,
  editNote,
}
