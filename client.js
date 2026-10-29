/**
 * Client half of the `dsh-obsidian` bundle.
 *
 * Registers one left-sidebar panel row and the `main` panel it opens. All data
 * comes from the Host half's same-origin `/obsidian/api/*` routes, so this file
 * imports no Harness Client package and needs no build step.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-obsidian',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'obsidian'
    const API = 'obsidian/api/'

    // ------------------------------------------------------------------
    // i18n: the Client locale service when it accepts our namespace, else a
    // built-in dictionary chosen from the browser language.
    // ------------------------------------------------------------------
    const DICT = {
      zh: {
        panel: 'Obsidian 笔记',
        title: 'Obsidian',
        subtitle: '笔记库',
        search: '搜索笔记…',
        refresh: '重新扫描',
        switchVault: '切换库',
        stats: '统计',
        back: '返回',
        newNote: '新建',
        ask: '在对话中提问',
        summarize: '总结这篇',
        openNote: '打开',
        noVault: '还没有挂载笔记库',
        noVaultHint: '点“切换库”选择 Obsidian 目录（包含 .obsidian 的那个文件夹）。',
        pickDir: '选择目录',
        empty: '没有结果',
        notes: '篇',
        tags: '个标签',
        folders: '目录',
        scanning: '索引中…',
        promptName: '新笔记的路径（vault 相对），例如 收件箱/想法.md',
        promptBody: '起始内容（可留空）',
        askPrefix: '请基于我的 Obsidian 笔记回答：',
        notePath: '路径',
        lines: '行',
        words: '汉字',
        tasks: '待办',
        done: '完成率',
        index: '索引',
        noSelection: '从左侧选择一篇笔记',
        created: '已创建',
        copied: '已复制提问，并打开了新会话',
      },
      en: {
        panel: 'Obsidian notes',
        title: 'Obsidian',
        subtitle: 'vault',
        search: 'Search notes…',
        refresh: 'Rescan',
        switchVault: 'Switch vault',
        stats: 'Stats',
        back: 'Back',
        newNote: 'New',
        ask: 'Ask in chat',
        summarize: 'Summarize',
        openNote: 'Open',
        noVault: 'No vault mounted',
        noVaultHint: 'Use “Switch vault” and pick the folder that contains .obsidian.',
        pickDir: 'Pick folder',
        empty: 'No results',
        notes: 'notes',
        tags: 'tags',
        folders: 'folders',
        scanning: 'Indexing…',
        promptName: 'Vault-relative path, e.g. inbox/idea.md',
        promptBody: 'Initial content (optional)',
        askPrefix: 'Answer using my Obsidian notes: ',
        notePath: 'path',
        lines: 'lines',
        words: 'chars',
        tasks: 'tasks',
        done: 'done',
        index: 'index',
        noSelection: 'Pick a note on the left',
        created: 'created',
        copied: 'Prompt copied to clipboard and a new chat was opened',
      },
    }

    function makeTranslator(ctx) {
      const ns = 'obsidian'
      const lang = (typeof navigator !== 'undefined' && /^en/i.test(navigator.language ?? '') ? 'en' : 'zh')
      try {
        const locale = ctx.locale
        if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
          locale.register(ns, 'zh', DICT.zh)
          locale.register(ns, 'en', DICT.en)
          const bound = locale.bind(ns)
          return (key) => {
            try {
              const value = bound(key)
              if (typeof value === 'string' && value !== '' && value !== key) return value
            } catch {
              /* a locale service that rejects this namespace falls back below */
            }
            return DICT[lang][key] ?? key
          }
        }
      } catch {
        /* fall through to the built-in dictionary */
      }
      return (key) => DICT[lang][key] ?? key
    }

    // ------------------------------------------------------------------
    // HTTP
    // ------------------------------------------------------------------
    function apiUrl(path) {
      const base = typeof document === 'undefined' ? '/' : document.baseURI
      return new URL(API + path, base).toString()
    }

    async function call(path, init) {
      const response = await fetch(apiUrl(path), {
        cache: 'no-store',
        credentials: 'same-origin',
        ...init,
      })
      if (!response.ok) {
        let message = `HTTP ${response.status}`
        try {
          const body = await response.json()
          if (body && typeof body.error === 'string') message = body.error
        } catch {
          /* keep the status text */
        }
        throw new Error(message)
      }
      return response.json()
    }

    const postJson = (path, body) =>
      call(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })

    // ------------------------------------------------------------------
    // A deliberately small Markdown renderer: headings, lists, quotes,
    // fences, rules, paragraphs, plus inline code/bold/italic/wiki/tags.
    // ------------------------------------------------------------------
    const RE_INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[\[[^\]\n]+\]\])|(^|[^\w\u4e00-\u9fff])#[^\s#'"`]+|(\[[^\]\n]+\]\([^)\s]+\))/u

    function renderInline(text, prefix) {
      const out = []
      let rest = text
      let guard = 0
      while (rest.length > 0 && guard < 400) {
        guard += 1
        const m = RE_INLINE.exec(rest)
        if (m === null) {
          out.push(rest)
          break
        }
        const index = m.index + (m[4] !== undefined && m[0].startsWith(m[4]) ? m[4].length : 0)
        if (index > 0) out.push(rest.slice(0, index))
        const token = rest.slice(index, index + m[0].length - (m[4] !== undefined ? m[4].length : 0))
        const key = `${prefix}-${out.length}`
        if (m[1] !== undefined) out.push(h('code', { key, className: 'dso-code' }, token.slice(1, -1)))
        else if (m[2] !== undefined) out.push(h('strong', { key }, token.slice(2, -2)))
        else if (m[3] !== undefined) out.push(h('span', { key, className: 'dso-wiki', title: 'wikilink' }, token.slice(2, -2)))
        else if (m[5] !== undefined) {
          const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
          out.push(
            link === null
              ? token
              : h('a', { key, className: 'dso-a', href: link[2], target: '_blank', rel: 'noreferrer' }, link[1]),
          )
        } else out.push(h('span', { key, className: 'dso-tag' }, token))
        rest = rest.slice(index + token.length)
      }
      return out
    }

    function renderMarkdown(text, prefix) {
      const lines = String(text ?? '').split(/\r?\n/)
      const blocks = []
      let i = 0
      let key = 0
      let paragraph = []
      let list = []
      let ordered = false

      const flushParagraph = () => {
        if (paragraph.length === 0) return
        blocks.push(h('p', { key: `p${key++}`, className: 'dso-p' }, renderInline(paragraph.join(' '), `${prefix}${key}`)))
        paragraph = []
      }
      const flushList = () => {
        if (list.length === 0) return
        blocks.push(
          h(
            ordered ? 'ol' : 'ul',
            { key: `l${key++}`, className: ordered ? 'dso-ol' : 'dso-ul' },
            list.map((item, index) =>
              h('li', { key: `i${index}`, className: 'dso-li' }, renderInline(item.text, `${prefix}${key}-${index}`)),
            ),
          ),
        )
        list = []
      }

      while (i < lines.length) {
        const line = lines[i]
        if (/^\s*```/.test(line)) {
          flushParagraph()
          flushList()
          const fence = []
          i += 1
          while (i < lines.length && !/^\s*```/.test(lines[i])) {
            fence.push(lines[i])
            i += 1
          }
          i += 1
          blocks.push(h('pre', { key: `c${key++}`, className: 'dso-pre' }, h('code', null, fence.join('\n'))))
          continue
        }
        if (/^\s*$/.test(line)) {
          flushParagraph()
          flushList()
          i += 1
          continue
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading !== null) {
          flushParagraph()
          flushList()
          const level = Math.min(heading[1].length + 2, 6)
          blocks.push(
            h(`h${level}`, { key: `h${key++}`, className: 'dso-h' }, renderInline(heading[2], `${prefix}${key}`)),
          )
          i += 1
          continue
        }
        if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
          flushParagraph()
          flushList()
          blocks.push(h('hr', { key: `r${key++}`, className: 'dso-hr' }))
          i += 1
          continue
        }
        const quote = /^\s*>\s?(.*)$/.exec(line)
        if (quote !== null) {
          flushParagraph()
          flushList()
          blocks.push(h('blockquote', { key: `q${key++}`, className: 'dso-quote' }, renderInline(quote[1], `${prefix}${key}`)))
          i += 1
          continue
        }
        const orderedMatch = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
        const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
        const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line)
        if (task !== null || bullet !== null || orderedMatch !== null) {
          flushParagraph()
          const isOrdered = orderedMatch !== null
          if (list.length > 0 && ordered !== isOrdered) flushList()
          ordered = isOrdered
          if (task !== null) list.push({ text: `${task[1] === ' ' ? '☐' : '☑'} ${task[2]}` })
          else if (orderedMatch !== null) list.push({ text: orderedMatch[2] })
          else list.push({ text: bullet[1] })
          i += 1
          continue
        }
        paragraph.push(line.trim())
        i += 1
      }
      flushParagraph()
      flushList()
      return blocks
    }

    // ------------------------------------------------------------------
    // Styles: theme tokens only, all selectors behind .dso-root.
    // ------------------------------------------------------------------
    const CSS = `
.dso-root{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;
  padding-top:calc(24px + var(--dsh-frame-top-clearance,0px));
  color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;line-height:20px}
.dso-head{display:flex;align-items:center;gap:10px;padding:0 max(16px,min(4vw,40px)) 12px}
.dso-brand{display:flex;align-items:center;gap:8px;min-width:0}
.dso-brandName{font-size:15px;font-weight:600;line-height:22px}
.dso-vault{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:44vw}
.dso-grow{flex:1}
.dso-chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;
  background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px}
.dso-chip[data-on=true]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 12%,transparent);
  color:var(--dsw-alias-state-success-primary,#16a34a)}
.dso-btn{font:inherit;font-size:12px;line-height:18px;height:28px;padding:0 10px;border-radius:8px;cursor:pointer;
  border:.5px solid var(--dsw-alias-border-l3,#d9dde3);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;white-space:nowrap}
.dso-btn:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6)}
.dso-btn:disabled{opacity:.45;cursor:default}
.dso-btn[data-primary=true]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4f6ef7);color:#fff;font-weight:600}
.dso-btn[data-primary=true]:hover{filter:brightness(.96)}
.dso-body{display:flex;flex:1;min-height:0;gap:0;border-top:1px solid var(--dsw-alias-border-l1,#eef0f4)}
.dso-side{width:284px;min-width:220px;display:flex;flex-direction:column;min-height:0;
  border-right:1px solid var(--dsw-alias-border-l1,#eef0f4);padding:12px 0 0 0}
.dso-searchPad{padding:0 12px 10px}
.dso-input{box-sizing:border-box;width:100%;height:30px;padding:0 10px;border-radius:8px;font:inherit;font-size:12px;
  border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit}
.dso-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4f6ef7)}
.dso-scroll{overflow:auto;min-height:0;flex:1;padding-bottom:12px}
.dso-row{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 12px;
  border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;font-size:12px}
.dso-row:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6)}
.dso-row[data-active=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 10%,transparent)}
.dso-rowName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.dso-rowMeta{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:11px;flex:none}
.dso-snip{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;line-height:16px;padding:0 12px 6px 12px;
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.dso-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.dso-noteHead{display:flex;align-items:center;gap:10px;padding:10px max(16px,min(3vw,32px)) 8px;
  border-bottom:1px solid var(--dsw-alias-border-l1,#eef0f4)}
.dso-notePath{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dso-note{padding:14px max(16px,min(3vw,32px)) 40px;overflow:auto;min-height:0;flex:1}
.dso-h{margin:18px 0 8px;line-height:1.4}
.dso-p{margin:8px 0;line-height:1.75}
.dso-ul,.dso-ol{margin:8px 0;padding-left:20px;line-height:1.75}
.dso-pre{background:var(--dsw-alias-bg-layer-2,#f3f4f6);border-radius:8px;padding:10px 12px;overflow:auto;font-size:12px}
.dso-quote{margin:10px 0;padding:8px 12px;border-left:3px solid var(--dsw-alias-border-l3,#d9dde3);
  background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-radius:0 6px 6px 0;color:var(--dsw-alias-label-secondary,#5c6570)}
.dso-hr{border:0;border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb);margin:16px 0}
.dso-code{font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);font-size:12px;
  background:var(--dsw-alias-bg-layer-2,#eef0f4);border-radius:4px;padding:1px 4px}
.dso-wiki{color:var(--dsw-alias-brand-primary,#4f6ef7);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 10%,transparent);
  border-radius:4px;padding:0 4px}
.dso-tag{color:var(--dsw-alias-state-business-primary,#4f6ef7);background:var(--dsw-alias-bg-layer-2,#f3f4f6);
  border-radius:4px;padding:0 5px;font-size:12px}
.dso-a{color:var(--dsw-alias-link,#3b82f6);text-decoration:none}
.dso-a:hover{text-decoration:underline}
.dso-empty{color:var(--dsw-alias-label-tertiary,#8b93a1);padding:40px 24px;text-align:center}
.dso-err{margin:10px 16px;padding:8px 10px;border-radius:8px;font-size:12px;
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 10%,transparent);
  color:var(--dsw-alias-state-error-primary,#dc2626)}
.dso-bar{display:flex;align-items:center;gap:10px;padding:10px max(16px,min(3vw,32px));
  border-top:1px solid var(--dsw-alias-border-l1,#eef0f4)}
.dso-stats{display:flex;flex-wrap:wrap;gap:10px;padding:14px max(16px,min(3vw,32px));overflow:auto}
.dso-metric{flex:1 1 160px;min-width:150px;border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;
  background:var(--dsw-alias-bg-layer-1,#fff);padding:12px 14px}
.dso-metricK{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:11px}
.dso-metricV{font-size:20px;font-weight:600;line-height:28px;margin-top:2px}
.dso-bars{width:100%;border:.5px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;
  background:var(--dsw-alias-bg-layer-1,#fff);padding:12px 14px;margin:0 max(16px,min(3vw,32px)) 12px;box-sizing:border-box}
.dso-barRow{display:flex;align-items:center;gap:10px;height:24px;font-size:12px}
.dso-barLabel{width:170px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dso-barTrack{flex:1;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f3f4f6);overflow:hidden}
.dso-barFill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary,#4f6ef7)}
.dso-barCount{width:44px;text-align:right;color:var(--dsw-alias-label-secondary,#6b7280);font-variant-numeric:tabular-nums}
`

    function StyleTag() {
      return h('style', null, CSS)
    }

    function ObsidianGlyph(props) {
      const size = props.size ?? 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M12 2.6 20 9l-3.1 10.2L12 21.4 7.1 19.2 4 9l8-6.4Z',
          stroke: props.active ? 'var(--dsw-alias-brand-primary,#4f6ef7)' : 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
          fill: props.active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary,#4f6ef7) 18%, transparent)' : 'none',
        }),
        h('path', {
          d: 'M12 2.6v18.8M4 9l8 3.6L20 9',
          stroke: props.active ? 'var(--dsw-alias-brand-primary,#4f6ef7)' : 'currentColor',
          strokeWidth: 1.1,
          strokeLinejoin: 'round',
          opacity: 0.75,
        }),
      )
    }

    function PanelIcon(props) {
      return h(ObsidianGlyph, { size: props?.size ?? 16, active: props?.active === true })
    }

    // ------------------------------------------------------------------
    // Panel
    // ------------------------------------------------------------------
    function ObsidianPanel(props) {
      const t = props.t
      const ui = props.ui
      const [status, setStatus] = React.useState(null)
      const [tree, setTree] = React.useState([])
      const [query, setQuery] = React.useState('')
      const [hits, setHits] = React.useState(null)
      const [browse, setBrowse] = React.useState({ folder: null, notes: [] })
      const [note, setNote] = React.useState(null)
      const [view, setView] = React.useState('browse')
      const [stats, setStats] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [toast, setToast] = React.useState('')
      const searchTimer = React.useRef(null)

      const refreshStatus = React.useCallback(async () => {
        try {
          const next = await call('status')
          setStatus(next)
          setError('')
          return next
        } catch (caught) {
          setError(String(caught?.message ?? caught))
          return null
        }
      }, [])

      const loadTree = React.useCallback(async () => {
        try {
          const body = await call('tree')
          setTree(Array.isArray(body.folders) ? body.folders : [])
        } catch {
          /* the status error already surfaces this */
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          const next = await refreshStatus()
          if (!alive || next === null) return
          if (next.mounted) await loadTree()
        }
        tick()
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          tick()
        }, 4000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [refreshStatus, loadTree])

      React.useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(() => setToast(''), 2600)
        return () => clearTimeout(timer)
      }, [toast])

      const runSearch = React.useCallback(async (text, folder) => {
        if (text.trim() === '') {
          setHits(null)
          return
        }
        try {
          const params = new URLSearchParams({ q: text, limit: '30' })
          if (folder) params.set('folder', folder)
          const body = await call(`search?${params.toString()}`)
          setHits(Array.isArray(body.hits) ? body.hits : [])
        } catch (caught) {
          setError(String(caught?.message ?? caught))
        }
      }, [])

      const onQuery = (event) => {
        const value = event.target.value
        setQuery(value)
        if (searchTimer.current !== null) clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(() => void runSearch(value), 220)
      }

      const openFolder = async (folder) => {
        try {
          const body = await call(`list?folder=${encodeURIComponent(folder)}&limit=400`)
          setBrowse({ folder, notes: Array.isArray(body.notes) ? body.notes : [] })
          setHits(null)
        } catch (caught) {
          setError(String(caught?.message ?? caught))
        }
      }

      const openNote = async (rel) => {
        setBusy(true)
        try {
          const body = await call(`note?path=${encodeURIComponent(rel)}`)
          setNote(body)
          setView('browse')
          setError('')
        } catch (caught) {
          setError(String(caught?.message ?? caught))
        } finally {
          setBusy(false)
        }
      }

      const doRescan = async () => {
        setBusy(true)
        try {
          await postJson('reindex')
          await refreshStatus()
          await loadTree()
          setToast(t('refresh'))
        } catch (caught) {
          setError(String(caught?.message ?? caught))
        } finally {
          setBusy(false)
        }
      }

      const pickVault = async () => {
        try {
          const picked = await ui.pickDirectory()
          if (typeof picked !== 'string' || picked === '') return
          await postJson('vault', { path: picked })
          setNote(null)
          setHits(null)
          setQuery('')
          await refreshStatus()
          await loadTree()
        } catch (caught) {
          setError(String(caught?.message ?? caught))
        }
      }

      const showStats = async () => {
        setBusy(true)
        try {
          const body = await call('stats?groupBy=folder')
          setStats(body)
          setView('stats')
        } catch (caught) {
          setError(String(caught?.message ?? caught))
        } finally {
          setBusy(false)
        }
      }

      const askInChat = async (mode) => {
        if (note === null) return
        const excerpt = mode === 'summarize'
          ? `请总结这篇笔记，并给出 3 条要点：\n${note.path}`
          : `${t.askPrefix}${note.path}`
        try {
          await navigator.clipboard.writeText(excerpt)
        } catch {
          /* clipboard may be unavailable; the new chat still helps */
        }
        ui.startSession()
        setToast(t('copied'))
      }

      const createNote = async () => {
        const rel = window.prompt(t('promptName'), '收件箱/新笔记.md')
        if (rel === null || rel.trim() === '') return
        const body = window.prompt(t('promptBody'), '')
        if (body === null) return
        setBusy(true)
        try {
          const created = await postJson('write', {
            path: rel.trim(),
            content: body === '' ? `# ${rel.trim().replace(/\.md$/i, '').split('/').pop()}\n\n` : body,
            mode: 'create',
          })
          await refreshStatus()
          await loadTree()
          await openNote(created.path)
          setToast(`${t.created} ${created.path}`)
        } catch (caught) {
          setError(String(caught?.message ?? caught))
        } finally {
          setBusy(false)
        }
      }

      const mounted = status?.mounted === true
      const folderRows = React.useMemo(() => {
        const rows = Array.isArray(tree) ? tree.filter((row) => row.path !== '') : []
        rows.sort((a, b) => b.total - a.total || a.path.localeCompare(b.path, 'zh'))
        return rows.slice(0, 40)
      }, [tree])

      const head = h(
        'div',
        { className: 'dso-head' },
        h('div', { className: 'dso-brand' }, h(ObsidianGlyph, { size: 18, active: true })),
        h('div', { style: { minWidth: 0 } },
          h('div', { className: 'dso-brandName' }, t('title')),
          h('div', { className: 'dso-vault', title: status?.vault ?? '' }, mounted ? status.vault : t('noVault')),
        ),
        h('div', { className: 'dso-grow' }),
        mounted
          ? h('span', { className: 'dso-chip', 'data-on': 'true' },
              `${status.noteCount} ${t('notes')} · ${status.folderCount} ${t('folders')} · ${status.tagCount} ${t('tags')}`)
          : null,
        h('button', { className: 'dso-btn', type: 'button', onClick: pickVault, title: t('switchVault') }, t('switchVault')),
        mounted
          ? h('button', { className: 'dso-btn', type: 'button', disabled: busy, onClick: doRescan }, t('refresh'))
          : null,
        mounted
          ? h('button', { className: 'dso-btn', type: 'button', disabled: busy, onClick: () => void showStats() }, t('stats'))
          : null,
        mounted
          ? h('button', { className: 'dso-btn', type: 'button', 'data-primary': 'true', disabled: busy, onClick: () => void createNote() }, t('newNote'))
          : null,
      )

      if (!mounted) {
        return h(
          'div',
          { className: 'dso-root' },
          h(StyleTag),
          head,
          error !== '' ? h('div', { className: 'dso-err' }, error) : null,
          h('div', { className: 'dso-empty' },
            h('div', { style: { fontWeight: 600, marginBottom: 6 } }, t('noVault')),
            h('div', null, t('noVaultHint')),
            h('div', { style: { marginTop: 14 } },
              h('button', { className: 'dso-btn', 'data-primary': 'true', type: 'button', onClick: pickVault }, t('pickDir')),
            ),
          ),
        )
      }

      const listRows = hits !== null
        ? hits.map((hit) =>
            h(React.Fragment, { key: hit.path },
              h('button', {
                className: 'dso-row',
                type: 'button',
                'data-active': note?.path === hit.path ? 'true' : 'false',
                onClick: () => void openNote(hit.path),
              },
                h('span', { className: 'dso-rowName', title: hit.path }, hit.title || hit.path),
                hit.date ? h('span', { className: 'dso-rowMeta' }, hit.date) : null,
              ),
              hit.hits?.[0] ? h('div', { className: 'dso-snip' }, hit.hits[0].text) : null,
            ),
          )
        : browse.folder !== null
          ? [
              h('button', {
                key: '__back',
                className: 'dso-row',
                type: 'button',
                onClick: () => setBrowse({ folder: null, notes: [] }),
              },
                h('span', { className: 'dso-rowName' }, `← ${t('back')}`),
                h('span', { className: 'dso-rowMeta' }, String(browse.notes.length)),
              ),
              ...browse.notes.map((entry) =>
                h('button', {
                  key: entry.path,
                  className: 'dso-row',
                  type: 'button',
                  'data-active': note?.path === entry.path ? 'true' : 'false',
                  onClick: () => void openNote(entry.path),
                },
                  h('span', { className: 'dso-rowName', title: entry.path }, entry.title || entry.path),
                  entry.date ? h('span', { className: 'dso-rowMeta' }, entry.date) : null,
                ),
              ),
            ]
          : folderRows.map((row) =>
              h('button', {
                key: row.path,
                className: 'dso-row',
                type: 'button',
                onClick: () => void openFolder(row.path),
              },
                h('span', { className: 'dso-rowName', title: row.path }, row.path),
                h('span', { className: 'dso-rowMeta' }, String(row.total)),
              ),
            )

      const side = h('div', { className: 'dso-side' },
        h('div', { className: 'dso-searchPad' },
          h('input', {
            className: 'dso-input',
            placeholder: t('search'),
            value: query,
            onChange: onQuery,
            spellCheck: false,
          }),
        ),
        h('div', { className: 'dso-scroll' },
          listRows.length === 0
            ? h('div', { className: 'dso-empty' }, hits === null ? t('folders') : t('empty'))
            : listRows,
        ),
      )

      let main
      if (view === 'stats' && stats !== null) {
        const max = Math.max(1, ...(stats.rows ?? []).map((row) => row.count))
        main = h('div', { className: 'dso-main' },
          h('div', { className: 'dso-noteHead' },
            h('button', { className: 'dso-btn', type: 'button', onClick: () => setView('browse') }, t('back')),
            h('div', { className: 'dso-grow' }),
            h('span', { className: 'dso-notePath' }, `${stats.noteCount} ${t('notes')}`),
          ),
          h('div', { className: 'dso-stats' },
            metric(t('notes'), String(stats.noteCount)),
            metric(t('words'), String(stats.cjkChars)),
            metric(t('tasks'), `${stats.tasksDone}/${stats.tasksTotal}`),
            metric(t('done'), stats.completion === null ? '—' : `${stats.completion}%`),
          ),
          h('div', { className: 'dso-bars' },
            (stats.rows ?? []).map((row) =>
              h('div', { key: row.key, className: 'dso-barRow' },
                h('span', { className: 'dso-barLabel', title: row.key }, row.key),
                h('span', { className: 'dso-barTrack' }, h('span', { className: 'dso-barFill', style: { width: `${Math.round((row.count / max) * 100)}%` } })),
                h('span', { className: 'dso-barCount' }, String(row.count)),
              ),
            ),
          ),
        )
      } else if (note !== null) {
        main = h('div', { className: 'dso-main' },
          h('div', { className: 'dso-noteHead' },
            h('div', { style: { minWidth: 0, flex: 1 } },
              h('div', { className: 'dso-brandName' }, note.title || note.path),
              h('div', { className: 'dso-notePath', title: note.path },
                `${note.path}${note.date ? ` · ${note.date}` : ''} · ${String(note.text ?? '').split(/\r?\n/).length} ${t('lines')}`),
            ),
          ),
          h('div', { className: 'dso-note' }, renderMarkdown(note.text, `n${note.path.length}`)),
          h('div', { className: 'dso-bar' },
            h('button', { className: 'dso-btn', 'data-primary': 'true', type: 'button', onClick: () => void askInChat('ask') }, t('ask')),
            h('button', { className: 'dso-btn', type: 'button', onClick: () => void askInChat('summarize') }, t('summarize')),
            h('div', { className: 'dso-grow' }),
            toast !== '' ? h('span', { className: 'dso-vault' }, toast) : null,
          ),
        )
      } else {
        main = h('div', { className: 'dso-main' }, h('div', { className: 'dso-empty' }, t('noSelection')))
      }

      return h('div', { className: 'dso-root' },
        h(StyleTag),
        head,
        error !== '' ? h('div', { className: 'dso-err' }, error) : null,
        h('div', { className: 'dso-body' }, side, main),
      )
    }

    function metric(label, value) {
      return h('div', { className: 'dso-metric', key: label },
        h('div', { className: 'dso-metricK' }, label),
        h('div', { className: 'dso-metricV' }, value),
      )
    }

    // ------------------------------------------------------------------
    // activation
    // ------------------------------------------------------------------
    return {
      inject: ['slots', 'locale', 'layout', 'uiWorkspace'],
      apply(ctx) {
        const t = makeTranslator(ctx)
        const ui = {
          pickDirectory: async () => (ctx.uiWorkspace != null ? ctx.uiWorkspace.pickDirectory() : null),
          startSession: () => {
            try {
              ctx.uiWorkspace?.startSession()
            } catch {
              /* a host without the workspace service keeps the panel usable */
            }
          },
        }
        const Panel = (owner) => h(ObsidianPanel, { ...(owner ?? {}), t, ui })

        ctx.effect(
          () => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel)),
          'obsidian: main panel',
        )
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => t('panel') }, PanelIcon),
            ),
          'obsidian: sidebar panel entry',
        )
      },
    }
  },
})
