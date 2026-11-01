/**
 * Client half of the `dsh-obsidian` bundle.
 *
 * Registers one left-sidebar panel row and the `main` panel it opens. The
 * panel is Q&A-first: a global "ask your vault" surface backed by the Host
 * half's retrieval + streaming `/obsidian/api/ask` route, with the note
 * browser and statistics kept as secondary tabs.
 *
 * All data comes from the Host half's same-origin `/obsidian/api/*` routes, so
 * this file imports no Harness Client package and needs no build step.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-obsidian',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'obsidian'
    const API = 'obsidian/api/'
    const RECENT_KEY = 'dso.recent-questions.v1'
    const THREAD_KEY = 'dso.thread.v1'
    const READING_KEY = 'dso.reading.v1'
    const MODEL_KEY = 'dso.model.v1'
    const WIDTH_PRESETS = [
      { id: 'narrow', label: '窄', labelEn: 'Narrow', px: 760 },
      { id: 'standard', label: '标准', labelEn: 'Standard', px: 900 },
      { id: 'wide', label: '宽', labelEn: 'Wide', px: 1040 },
      { id: 'full', label: '超宽', labelEn: 'Full', px: 1200 },
    ]
    const FONT_PRESETS = [
      { id: 'small', label: '小', labelEn: 'Small', px: 14 },
      { id: 'standard', label: '标准', labelEn: 'Standard', px: 15.5 },
      { id: 'large', label: '大', labelEn: 'Large', px: 17 },
      { id: 'xlarge', label: '特大', labelEn: 'XL', px: 18.5 },
    ]
    const DEFAULT_READING = { width: 'standard', font: 'standard', typeface: 'serif' }
    const PROMPT_TEMPLATES = [
      {
        id: 'work-month',
        label: '最近一个月的工作情况',
        hint: '进展、卡点、节奏',
        prompt: '请总结我最近一个月的工作情况：主要推进了什么、遇到了哪些卡点、节奏和精力如何变化。请按主题归纳，并引用具体日记。',
      },
      {
        id: 'week-think',
        label: '本周思考回顾',
        hint: '反复出现的念头与判断',
        prompt: '请回顾我本周的思考：有哪些反复出现的主题、重要的判断变化、未想清楚的问题？请引用具体日记。',
      },
      {
        id: 'week-tasks',
        label: '本周待办完成情况',
        hint: '完成数 / 总数 / 占比',
        prompt: '请统计我本周的待办完成情况：完成了多少、还剩多少、完成占比是多少？列出仍未完成的重要事项，并指出延期最久的几项。',
      },
      {
        id: 'important',
        label: '重要事项总结',
        hint: '真正改变方向的事',
        prompt: '请总结我近期最重要的事项：哪些事情真正改变了方向或状态？哪些只是忙碌但没有推进？请按重要性排序并引用来源。',
      },
      {
        id: 'health-month',
        label: '本月健康与体重趋势',
        hint: '体重、尿酸、血糖、睡眠',
        prompt: '请总结我本月记录的健康数据趋势：体重、尿酸、血糖、睡眠和运动情况。数据不足时明确说明，不要推测。',
      },
      {
        id: 'mood-week',
        label: '最近一周的情绪与精力',
        hint: '状态高点、低谷与触发因素',
        prompt: '请回顾我最近一周的情绪与精力变化：什么时候状态最好、什么时候明显下滑、触发因素是什么？请引用具体记录。',
      },
      {
        id: 'projects',
        label: '我在推进的项目与卡点',
        hint: '进展、下一步、阻塞',
        prompt: '请梳理我最近在推进的项目：每个项目当前进展、下一步和卡点分别是什么？优先引用项目笔记和最近日记。',
      },
      {
        id: 'reading-week',
        label: '本周阅读与收藏收获',
        hint: '值得记住的观点与行动',
        prompt: '请总结我本周阅读和收藏的内容：有哪些值得记住的观点？哪些可以转化为行动？请引用收藏或笔记原文。',
      },
    ]

    // ------------------------------------------------------------------
    // i18n: the Client locale service when it accepts our namespace, else a
    // built-in dictionary chosen from the browser language.
    // ------------------------------------------------------------------
    const DICT = {
      zh: {
        panel: 'Obsidian 笔记',
        title: 'Obsidian',
        subtitle: '笔记库',
        tabAsk: '问答',
        tabNotes: '笔记',
        tabStats: '统计',
        search: '搜索笔记…',
        refresh: '重新扫描',
        switchVault: '切换库',
        stats: '统计',
        back: '返回',
        newNote: '新建',
        ask: '在对话中提问',
        summarize: '总结这篇',
        askHere: '问这篇',
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
        copiedAnswer: '答案已复制',
        // Q&A home
        heroEyebrow: 'YOUR SECOND BRAIN',
        threadTitle: '全局问答',
        heroTitleA: '今天想从笔记里',
        heroTitleB: '知道些什么？',
        heroSub: '不用打开每一篇。全局问答会检索整个笔记库，回答带来源，还能继续追问。',
        askPlaceholder: '问任何关于你笔记的问题，例如：最近一个月的工作状态…',
        askHint: 'Enter 发送 · Shift+Enter 换行',
        send: '发送',
        stop: '停止',
        deep: '深度思考',
        deepOn: '深度思考已开',
        thinkingRetrieve: '正在翻阅笔记库…',
        thinkingWrite: '正在整理答案…',
        thinkingReason: '正在深入思考…',
        newChat: '新对话',
        sources: '来源',
        sourceCount: '篇笔记',
        sourceMore: '展开其余',
        copy: '复制',
        retry: '重试',
        stopped: '已停止生成',
        followUp: '继续追问…',
        recentQuestions: '继续上次的问题',
        recentEdited: '最近编辑',
        vaultReady: '库已就绪',
        suggestion1: '最近一个月的工作状态',
        suggestion1Sub: '从日记与复盘里提炼进展、问题与节奏',
        suggestion2: '我现在有哪些待办？',
        suggestion2Sub: '汇总所有未完成事项，按笔记分组',
        suggestion3: '总结上周的日记',
        suggestion3Sub: '一周脉络、情绪与关键事件',
        suggestion4: '我最近在关注什么？',
        suggestion4Sub: '主题、反复出现的人与事',
        weekNotes: '本周记录',
        monthNotes: '本月记录',
        openTasks: '未完成待办',
        completion: '待办完成率',
        streamError: '生成失败',
        emptyAnswer: '模型没有返回内容，请换个问法或重试。',
        streamRetry: '再试一次',
        readingSettings: '问答设置',
        close: '关闭',
        answerWidth: '回答宽度',
        answerFont: '正文字号',
        answerTypeface: '字体风格',
        typeSerif: '衬线 · Claude',
        typeUI: '跟随界面',
        answerModel: '回答模型',
        modelLoading: '正在读取模型列表…',
        followDSH: '跟随 DSH 当前模型',
        modelFollowHint: '与 DSH 当前会话保持一致',
        modelEmpty: '当前环境没有可选模型',
        customModel: '已保存的自定义模型',
        modelNote: '默认跟随 DSH 当前会话模型；自定义只影响这个面板。',
        modelRetry: '重试',
        modelFallback: '自定义模型不可用，已回退到 DSH 当前模型',
        settingsHint: '仅影响 Obsidian 问答',
        settingsReset: '恢复默认',
        templates: '常用模板',
        templatesHint: '↑↓ 选择 · Enter 填入',
        templatesEmpty: '没有匹配模板，按 Enter 直接提问',
        emptyThread: '问一个关于整个笔记库的问题',
        noteQuestionPrefix: '关于《',
        noteQuestionSuffix: '》：',
        allNotes: '全部笔记',
        saveNote: '保存为笔记',
        savedNote: '已保存为笔记',
        openInObsidian: '在 Obsidian 中打开',
        feedbackUp: '有帮助',
        feedbackDown: '没帮助',
        feedbackSaved: '感谢反馈',
        feedbackDone: '已反馈过',
      },
      en: {
        panel: 'Obsidian notes',
        title: 'Obsidian',
        subtitle: 'vault',
        tabAsk: 'Ask',
        tabNotes: 'Notes',
        tabStats: 'Stats',
        search: 'Search notes…',
        refresh: 'Rescan',
        switchVault: 'Switch vault',
        stats: 'Stats',
        back: 'Back',
        newNote: 'New',
        ask: 'Ask in chat',
        summarize: 'Summarize',
        askHere: 'Ask about this',
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
        copiedAnswer: 'Answer copied',
        heroEyebrow: 'YOUR SECOND BRAIN',
        threadTitle: 'Vault Q&A',
        heroTitleA: 'What would you like',
        heroTitleB: 'to know today?',
        heroSub: 'Skip opening every note. Global Q&A searches the whole vault, cites its sources and lets you keep asking.',
        askPlaceholder: 'Ask anything about your notes, e.g. how was work last month?',
        askHint: 'Enter to send · Shift+Enter for a new line',
        send: 'Send',
        stop: 'Stop',
        deep: 'Deep think',
        deepOn: 'Deep think on',
        thinkingRetrieve: 'Searching the vault…',
        thinkingWrite: 'Writing the answer…',
        thinkingReason: 'Thinking deeply…',
        newChat: 'New chat',
        sources: 'Sources',
        sourceCount: 'notes',
        sourceMore: 'Show rest',
        copy: 'Copy',
        retry: 'Retry',
        stopped: 'Generation stopped',
        followUp: 'Ask a follow-up…',
        recentQuestions: 'Pick up a recent question',
        recentEdited: 'Recently edited',
        vaultReady: 'Vault ready',
        suggestion1: 'How was my work last month?',
        suggestion1Sub: 'Progress, friction and rhythm from journals and reviews',
        suggestion2: 'What are my open todos?',
        suggestion2Sub: 'All unfinished tasks grouped by note',
        suggestion3: 'Summarize last week’s journal',
        suggestion3Sub: 'Key events, mood and the week’s arc',
        suggestion4: 'What have I been focused on?',
        suggestion4Sub: 'Recurring themes, people and projects',
        weekNotes: 'This week',
        monthNotes: 'This month',
        openTasks: 'Open tasks',
        completion: 'Task completion',
        streamError: 'Generation failed',
        emptyAnswer: 'The model returned no text. Try rephrasing or retry.',
        streamRetry: 'Try again',
        readingSettings: 'Q&A settings',
        close: 'Close',
        answerWidth: 'Answer width',
        answerFont: 'Body size',
        answerTypeface: 'Typeface',
        typeSerif: 'Serif · Claude',
        typeUI: 'Match UI',
        answerModel: 'Answer model',
        modelLoading: 'Loading models…',
        followDSH: 'Follow DSH model',
        modelFollowHint: 'Matches the current DSH session',
        modelEmpty: 'No selectable models in this environment',
        customModel: 'Saved custom model',
        modelNote: 'Follows the current DSH model by default; a custom choice only affects this panel.',
        modelRetry: 'Retry',
        modelFallback: 'Custom model unavailable; fell back to the current DSH model',
        settingsHint: 'Affects Obsidian Q&A only',
        settingsReset: 'Reset',
        templates: 'Templates',
        templatesHint: '↑↓ select · Enter insert',
        templatesEmpty: 'No match — press Enter to ask directly',
        emptyThread: 'Ask a question about the whole vault',
        noteQuestionPrefix: 'About “',
        noteQuestionSuffix: '”: ',
        allNotes: 'All notes',
        saveNote: 'Save as note',
        savedNote: 'Saved as a note',
        openInObsidian: 'Open in Obsidian',
        feedbackUp: 'Helpful',
        feedbackDown: 'Not helpful',
        feedbackSaved: 'Thanks for the feedback',
        feedbackDone: 'Already rated',
      },
    }

    function makeTranslator(ctx) {
      const ns = 'obsidian'
      let active = 'zh'
      const attachLang = (translate) => {
        try {
          Object.defineProperty(translate, 'lang', { value: /^en/i.test(active) ? 'en' : 'zh', configurable: true })
        } catch {
          translate.lang = /^en/i.test(active) ? 'en' : 'zh'
        }
        return translate
      }
      try {
        const locale = ctx.locale
        if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
          try {
            active = String(locale.getLocale?.().active ?? locale.getSnapshot?.().active ?? 'zh')
          } catch {
            active = 'zh'
          }
          // The app's active tag can be `zh-CN` / `en-US`; register both the
          // exact tag and its base language so either lookup succeeds.
          const tags = new Set([active, /^en/i.test(active) ? 'en' : 'zh', 'zh-CN', 'en-US', 'zh', 'en'])
          for (const tag of tags) {
            try {
              locale.register(ns, tag, /^en/i.test(tag) ? DICT.en : DICT.zh)
            } catch {
              /* a duplicate tag or an unavailable locale must not break the panel */
            }
          }
          const bound = locale.bind(ns)
          return attachLang((key) => {
            try {
              const value = bound(key)
              if (typeof value === 'string' && value !== '' && value !== key) return value
            } catch {
              /* a locale service that rejects this namespace falls back below */
            }
            return (/^en/i.test(active) ? DICT.en : DICT.zh)[key] ?? key
          })
        }
      } catch {
        /* fall through to the built-in dictionary */
      }
      return attachLang((key) => (/^en/i.test(active) ? DICT.en : DICT.zh)[key] ?? key)
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
    // fences, tables, rules, paragraphs, plus inline code/bold/wiki/tags.
    // ------------------------------------------------------------------
    const RE_INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[\[[^\]\n]+\]\])|(^|[^\w\u4e00-\u9fff])#[^\s#'"`]+|(\[[^\]\n]+\]\([^)\s]+\))/u

    function renderInline(text, prefix, onWiki) {
      const out = []
      let rest = text
      let guard = 0
      while (rest.length > 0 && guard < 500) {
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
        else if (m[3] !== undefined) {
          const raw = token.slice(2, -2)
          const target = raw.split('|')[0].split('#')[0].trim()
          const label = raw.includes('|') ? raw.slice(raw.indexOf('|') + 1) : raw
          if (typeof onWiki === 'function' && target !== '') {
            out.push(h('button', { key, className: 'dso-wikiLink', type: 'button', title: target, onClick: () => onWiki(target) }, label))
          } else out.push(h('span', { key, className: 'dso-wiki', title: target }, label))
        } else if (m[5] !== undefined) {
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

    function splitTableRow(line) {
      return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
    }

    function renderMarkdown(text, prefix, onWiki) {
      const lines = String(text ?? '').split(/\r?\n/)
      const blocks = []
      let i = 0
      let key = 0
      let paragraph = []
      let list = []
      let ordered = false

      const flushParagraph = () => {
        if (paragraph.length === 0) return
        blocks.push(h('p', { key: `p${key++}`, className: 'dso-p' }, renderInline(paragraph.join(' '), `${prefix}${key}`, onWiki)))
        paragraph = []
      }
      const flushList = () => {
        if (list.length === 0) return
        blocks.push(
          h(
            ordered ? 'ol' : 'ul',
            { key: `l${key++}`, className: ordered ? 'dso-ol' : 'dso-ul' },
            list.map((item, index) =>
              h(
                'li',
                { key: `i${index}`, className: item.task === true ? 'dso-li dso-liTask' : 'dso-li' },
                item.task === true
                  ? h('span', { className: item.done ? 'dso-check dso-checkDone' : 'dso-check', 'aria-hidden': true }, item.done ? '✓' : '')
                  : null,
                h('span', null, renderInline(item.text, `${prefix}${key}-${index}`, onWiki)),
              ),
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
          blocks.push(h(`h${level}`, { key: `h${key++}`, className: 'dso-h' }, renderInline(heading[2], `${prefix}${key}`, onWiki)))
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
        if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
          flushParagraph()
          flushList()
          const header = splitTableRow(line)
          const rows = []
          i += 2
          while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
            rows.push(splitTableRow(lines[i]))
            i += 1
          }
          blocks.push(
            h('div', { key: `t${key++}`, className: 'dso-tableWrap' },
              h('table', { className: 'dso-table' },
                h('thead', null, h('tr', null, header.map((cell, ci) => h('th', { key: ci }, renderInline(cell, `${prefix}t${ci}`, onWiki))))),
                h('tbody', null, rows.map((row, ri) => h('tr', { key: ri }, row.map((cell, ci) => h('td', { key: ci }, renderInline(cell, `${prefix}t${ri}-${ci}`, onWiki)))))),
              ),
            ),
          )
          continue
        }
        const quote = /^\s*>\s?(.*)$/.exec(line)
        if (quote !== null) {
          flushParagraph()
          flushList()
          blocks.push(h('blockquote', { key: `q${key++}`, className: 'dso-quote' }, renderInline(quote[1], `${prefix}${key}`, onWiki)))
          i += 1
          continue
        }
        const task = /^\s*([-*+])\s+\[([ xX])\]\s+(.*)$/.exec(line)
        const orderedMatch = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
        const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
        if (task !== null || bullet !== null || orderedMatch !== null) {
          flushParagraph()
          const isOrdered = orderedMatch !== null && task === null
          if (list.length > 0 && ordered !== isOrdered) flushList()
          ordered = isOrdered
          if (task !== null) list.push({ text: task[3], task: true, done: task[2] !== ' ' })
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
  --dso-serif:"Anthropic Serif Web Text","Claude Style Noto Serif","Iowan Old Style",Charter,Georgia,"Times New Roman","Songti SC","STSong","Noto Serif SC","Source Han Serif SC",serif;
  --dso-prose:var(--dso-serif);--dso-answer-width:900px;--dso-answer-font:15.5px;
  padding-top:calc(20px + var(--dsh-frame-top-clearance,0px));
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dso-topbar{display:flex;align-items:center;gap:12px;padding:0 max(16px,min(4vw,40px)) 12px;flex:none;min-width:0}
.dso-brand{display:flex;align-items:center;gap:8px;min-width:0;flex:none}
.dso-brandName{font-size:15px;font-weight:650;line-height:22px;letter-spacing:-.01em}
.dso-vault{color:var(--dsw-alias-label-secondary);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:30vw}
.dso-grow{flex:1;min-width:8px}
.dso-tabs{display:flex;align-items:center;gap:2px;padding:3px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);flex:none}
.dso-tab{height:28px;padding:0 11px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap}
.dso-tab:hover{color:var(--dsw-alias-label-primary)}
.dso-tab[data-active=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.dso-actions{display:flex;align-items:center;gap:6px;flex:none;position:relative}
.dso-action{font:inherit;font-size:11.5px;height:28px;min-height:28px;flex:none;line-height:1;padding:0 9px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;
  border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dso-action:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dso-action:disabled{opacity:.45;cursor:default}
.dso-actionPrimary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff;font-weight:600}
.dso-actionPrimary:hover{background:var(--dsw-alias-brand-primary);color:#fff;filter:brightness(1.05)}
.dso-chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
.dso-chip[data-on=true]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.dso-body{display:flex;flex:1;min-height:0;border-top:1px solid var(--dsw-alias-border-l1)}
.dso-err{margin:8px max(16px,min(4vw,40px));padding:8px 11px;border-radius:9px;font-size:12px;
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
/* ---------- ask view ---------- */
.dso-ask{flex:1;min-height:0;display:flex;flex-direction:column;position:relative;overflow:hidden}
.dso-askScroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
.dso-askInner{max-width:var(--dso-answer-width,900px);margin:0 auto;padding:18px max(20px,min(6vw,44px)) 30px;box-sizing:border-box}
.dso-hero{position:relative;text-align:center;padding:clamp(20px,5vh,56px) 0 8px}
.dso-heroGlow{position:absolute;left:12%;right:12%;top:-30px;height:330px;pointer-events:none;
  background:radial-gradient(ellipse at 50% 42%,color-mix(in srgb,var(--dsw-alias-brand-primary) 17%,transparent),transparent 68%);filter:blur(24px)}
.dso-orb{position:relative;width:62px;height:62px;margin:0 auto 20px;border-radius:19px;display:grid;place-items:center;
  background:linear-gradient(145deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 78%,#fff 22%),color-mix(in srgb,var(--dsw-alias-brand-primary) 62%,#10131a 38%));
  box-shadow:0 20px 46px -18px color-mix(in srgb,var(--dsw-alias-brand-primary) 62%,transparent),inset 0 1px 0 rgba(255,255,255,.4)}
.dso-orb::after{content:'';position:absolute;inset:-9px;border-radius:26px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent);animation:dsoPulse 3.8s ease-in-out infinite}
.dso-eyebrow{font-size:10px;line-height:14px;letter-spacing:.17em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);font-weight:650}
.dso-heroTitle{font-size:clamp(25px,3.2vw,36px);line-height:1.16;font-weight:650;letter-spacing:-.025em;margin:10px 0 10px;position:relative}
.dso-heroTitle em{font-style:normal;background:linear-gradient(92deg,var(--dsw-alias-brand-primary),#e39a4a);-webkit-background-clip:text;background-clip:text;color:transparent}
.dso-heroSub{max-width:560px;margin:0 auto;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.7;position:relative}
.dso-composer{margin-top:26px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 10px 32px -22px rgba(0,0,0,.45);transition:border-color .15s,box-shadow .15s;text-align:left;position:relative}
.dso-composer:focus-within{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 52%,var(--dsw-alias-border-l2));
  box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 11%,transparent),0 14px 38px -24px rgba(0,0,0,.4)}
.dso-composer[data-big=true]{border-radius:18px}
.dso-textarea{display:block;width:100%;box-sizing:border-box;border:0;background:transparent;color:inherit;font:inherit;
  font-size:13.5px;line-height:1.65;resize:none;padding:14px 16px 6px;min-height:54px;max-height:170px;outline:none}
.dso-textarea::placeholder{color:var(--dsw-alias-label-secondary);opacity:.82}
.dso-composerBar{display:flex;align-items:center;gap:8px;padding:5px 9px 9px 11px}
.dso-deep{height:26px;padding:0 9px;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:11px;display:inline-flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap}
.dso-deep:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dso-deep[data-on=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 11%,transparent);color:var(--dsw-alias-brand-primary)}
.dso-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.78;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dso-send{width:32px;height:32px;border-radius:10px;border:0;background:var(--dsw-alias-brand-primary);color:#fff;display:grid;place-items:center;
  cursor:pointer;margin-left:auto;flex:none;transition:transform .12s,opacity .12s,background .12s}
.dso-send:hover{transform:translateY(-1px)}
.dso-send:disabled{opacity:.35;cursor:default;transform:none}
.dso-send[data-stop=true]{background:var(--dsw-alias-state-error-primary)}
/* ---------- reading / model settings ---------- */
.dso-settingsBackdrop{position:fixed;inset:0;z-index:60;background:transparent}
.dso-settings{position:absolute;top:36px;right:0;z-index:61;width:min(350px,calc(100vw - 32px));max-height:min(76vh,640px);overflow:auto;
  border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));
  box-shadow:0 20px 54px -18px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.18);padding:14px;box-sizing:border-box;text-align:left}
.dso-settingsHead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.dso-settingsTitle{font-size:13px;font-weight:650}
.dso-settingsClose{width:24px;height:24px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:16px;line-height:1}
.dso-settingsClose:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dso-settingGroup{margin:12px 0}
.dso-settingLabel{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;
  font-size:11px;color:var(--dsw-alias-label-secondary)}
.dso-seg{display:flex;gap:4px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.dso-segBtn{flex:1;min-width:0;height:26px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.dso-segBtn:hover{color:var(--dsw-alias-label-primary)}
.dso-segBtn[data-on=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.14)}
.dso-select{width:100%;box-sizing:border-box;height:32px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;outline:none;
  display:flex;align-items:center;gap:8px;text-align:left;cursor:pointer}
.dso-select:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,var(--dsw-alias-border-l2))}
.dso-select:focus-visible{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l2))}
.dso-selectText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dso-selectCaret{flex:none;font-size:9px;color:var(--dsw-alias-label-secondary);line-height:1}
.dso-modelPicker{position:relative}
.dso-modelMenu{margin-top:5px;max-height:210px;overflow:auto;
  border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.03);padding:5px;box-sizing:border-box;
  scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent}
.dso-modelMenu::-webkit-scrollbar{width:7px}
.dso-modelMenu::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px}
.dso-modelItem{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:7px;background:transparent;
  color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;text-align:left;cursor:pointer}
.dso-modelItem:hover{background:var(--dsw-alias-bg-layer-2)}
.dso-modelItem[data-on=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary)}
.dso-modelItemMain{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
.dso-modelItemTitle{font-size:11.5px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dso-modelItemHint{font-size:10px;line-height:14px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dso-modelItem[data-on=true] .dso-modelItemHint{color:inherit;opacity:.85}
.dso-modelGroup{margin-top:4px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l1)}
.dso-modelGroupName{padding:3px 8px;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.dso-modelEmpty{padding:10px 8px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dso-settingNote{margin-top:7px;font-size:10.5px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.dso-settingsFoot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;padding-top:11px;border-top:1px solid var(--dsw-alias-border-l1)}
.dso-settingsLink{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;padding:0}
.dso-settingsLink:hover{color:var(--dsw-alias-label-primary)}
.dso-modelErr{color:var(--dsw-alias-state-error-primary);font-size:10.5px;line-height:1.5;margin-top:6px}
.dso-aa{font-family:var(--dso-serif);font-size:12px;font-weight:700;letter-spacing:-.06em}
/* ---------- slash templates ---------- */
.dso-slashBtn{height:26px;padding:0 8px;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:11px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap}
.dso-slashBtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dso-slashMark{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:700;line-height:1}
.dso-slashMenu{position:absolute;left:0;bottom:calc(100% + 8px);z-index:30;width:min(460px,100%);max-height:300px;overflow:auto;
  scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;
  border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 18px 44px -18px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.16);padding:6px;box-sizing:border-box}
.dso-slashMenu[data-side=below]{top:calc(100% + 8px);bottom:auto}
.dso-slashMenu::-webkit-scrollbar{width:7px}
.dso-slashMenu::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px}
.dso-slashMenu::-webkit-scrollbar-track{background:transparent}
.dso-slashHead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 7px 7px;
  color:var(--dsw-alias-label-secondary);font-size:10px;letter-spacing:.02em}
.dso-slashItem{display:flex;align-items:center;gap:9px;width:100%;padding:8px 9px;border:0;border-radius:8px;background:transparent;
  color:inherit;font:inherit;text-align:left;cursor:pointer}
.dso-slashItem:hover,.dso-slashItem[data-active=true]{background:var(--dsw-alias-bg-layer-2)}
.dso-slashItemMain{min-width:0;flex:1}
.dso-slashLabel{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;line-height:17px}
.dso-slashKey{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:10px;font-weight:600;
  color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 11%,transparent);
  border-radius:5px;padding:1px 5px}
.dso-slashHint{display:block;margin-top:1px;font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-secondary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dso-slashEmpty{padding:12px 9px;color:var(--dsw-alias-label-secondary);font-size:11px}
.dso-suggestGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:26px;text-align:left}
.dso-suggest{display:flex;gap:10px;align-items:flex-start;padding:12px 13px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 86%,transparent);cursor:pointer;text-align:left;font:inherit;color:inherit;
  transition:transform .15s,border-color .15s,background .15s}
.dso-suggest:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,var(--dsw-alias-border-l1));background:var(--dsw-alias-bg-layer-1)}
.dso-suggestIcon{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;flex:none;
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-brand-primary)}
.dso-suggestTitle{font-size:12.5px;font-weight:620;line-height:1.4}
.dso-suggestSub{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5;margin-top:2px}
.dso-pulse{display:flex;gap:8px;margin-top:22px;flex-wrap:wrap;justify-content:center}
.dso-pulseItem{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:6px;align-items:center;padding:5px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2)}
.dso-pulseItem b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:620}
.dso-dotSep{width:3px;height:3px;border-radius:50%;background:var(--dsw-alias-label-secondary);opacity:.5}
.dso-recents{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:16px}
.dso-recent{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:inherit;font-size:11px;height:26px;padding:0 10px;
  border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dso-recent:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.dso-thread{display:flex;flex-direction:column;gap:24px;padding:8px 0 8px}
.dso-threadHead{display:flex;align-items:center;gap:10px;min-height:28px;padding-bottom:2px}
.dso-threadTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:7px}
.dso-msgUser{display:flex;justify-content:flex-end;animation:dsoIn .22s ease both}
.dso-bubble{max-width:82%;padding:10px 14px;border-radius:14px 14px 4px 14px;line-height:1.65;white-space:pre-wrap;
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent)}
.dso-msgAssistant{display:flex;gap:10px;align-items:flex-start;animation:dsoIn .26s ease both}
.dso-avatar{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:none;margin-top:1px;
  background:linear-gradient(145deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 72%,#fff 28%),color-mix(in srgb,var(--dsw-alias-brand-primary) 58%,#111 42%));color:#fff}
.dso-assistantBody{flex:1;min-width:0}
.dso-assistantName{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:5px;line-height:16px}
.dso-assistantName b{color:var(--dsw-alias-label-primary);font-weight:600}
.dso-modelTag{font-size:10px;padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dso-answer{font-family:var(--dso-prose,var(--dso-serif));font-size:var(--dso-answer-font,15.5px);line-height:1.86;
  color:var(--dsw-alias-label-primary);word-break:break-word;font-optical-sizing:auto}
.dso-answer .dso-h{font-size:1.1em;line-height:1.36;letter-spacing:-.012em;margin:20px 0 9px}
.dso-answer .dso-h:first-child{margin-top:0}
.dso-thinking{display:inline-flex;align-items:center;gap:9px;color:var(--dsw-alias-label-secondary);font-size:12px;padding:4px 0 2px}
.dso-dots{display:inline-flex;gap:3px;align-items:center}
.dso-dots i{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-brand-primary);opacity:.35;animation:dsoDot 1.2s ease-in-out infinite}
.dso-dots i:nth-child(2){animation-delay:.15s}
.dso-dots i:nth-child(3){animation-delay:.3s}
.dso-caret{display:inline-block;width:7px;height:15px;margin-left:2px;vertical-align:-2px;border-radius:2px;background:var(--dsw-alias-brand-primary);animation:dsoBlink 1s steps(2,start) infinite}
.dso-sources{margin-top:13px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.dso-sourcesHead{display:flex;align-items:center;gap:6px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin-bottom:7px}
.dso-sourceList{display:flex;flex-wrap:wrap;gap:6px}
.dso-source{display:inline-flex;align-items:center;gap:6px;max-width:270px;height:27px;padding:0 9px;border-radius:7px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font:inherit;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dso-source:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dso-sourceName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dso-sourceMore{height:27px;padding:0 9px;border-radius:7px;border:1px dashed var(--dsw-alias-border-l2);background:transparent;
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.dso-sourceMore:hover{color:var(--dsw-alias-label-primary)}
.dso-sourceWrap{display:inline-flex;align-items:stretch;max-width:300px}
.dso-sourceWrap .dso-source{border-top-right-radius:0;border-bottom-right-radius:0}
.dso-sourceExt{width:24px;height:27px;display:grid;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-left:0;
  border-radius:0 7px 7px 0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer}
.dso-sourceExt:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dso-sourceReason{flex:none;align-self:center;font-size:9.5px;line-height:14px;padding:0 5px;border-radius:4px;
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dso-answerActions{display:flex;gap:6px;margin-top:11px;align-items:center}
.dso-miniBtn{height:24px;padding:0 8px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:10.5px;display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.dso-miniBtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dso-miniBtn[data-on=true]{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.dso-miniBtn:disabled{opacity:.5;cursor:default}
.dso-errorCard{border-radius:11px;padding:10px 12px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent);
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 24%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.6}
.dso-stopped{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:8px}
.dso-askDock{flex:none;position:relative;padding:12px max(20px,min(6vw,44px)) 16px;
  background:linear-gradient(to top,var(--dsw-alias-bg-base) 62%,transparent)}
.dso-askDockInner{max-width:880px;margin:0 auto}
/* ---------- notes view ---------- */
.dso-side{width:284px;min-width:220px;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l1);padding:12px 0 0 0;background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,var(--dsw-alias-bg-layer-1) 45%)}
.dso-searchPad{padding:0 12px 10px}
.dso-input{box-sizing:border-box;width:100%;height:30px;padding:0 10px;border-radius:8px;font:inherit;font-size:12px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit}
.dso-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dso-scroll{overflow:auto;min-height:0;flex:1;padding-bottom:12px}
.dso-row{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 12px;
  border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;font-size:12px}
.dso-row:hover{background:var(--dsw-alias-bg-layer-2)}
.dso-row[data-active=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
.dso-rowName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.dso-rowMeta{color:var(--dsw-alias-label-secondary);font-size:11px;flex:none;font-variant-numeric:tabular-nums}
.dso-snip{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;padding:0 12px 6px 12px;
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.dso-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.dso-noteHead{display:flex;align-items:center;gap:10px;padding:10px max(16px,min(3vw,32px)) 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dso-notePath{color:var(--dsw-alias-label-secondary);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dso-note{padding:14px max(16px,min(3vw,32px)) 40px;overflow:auto;min-height:0;flex:1}
.dso-noteBody{max-width:var(--dso-answer-width,900px);font-family:var(--dso-prose,var(--dso-serif));
  font-size:var(--dso-answer-font,15.5px);line-height:1.86;font-optical-sizing:auto}
.dso-h{margin:18px 0 8px;line-height:1.42;font-weight:650}
.dso-p{margin:8px 0;line-height:1.78}
.dso-ul,.dso-ol{margin:8px 0;padding-left:20px;line-height:1.78}
.dso-li{margin:2px 0}
.dso-liTask{list-style:none;margin-left:-18px;display:flex;gap:7px;align-items:flex-start}
.dso-check{width:14px;height:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;display:inline-grid;place-items:center;
  font-size:10px;flex:none;margin-top:4px;color:#fff}
.dso-checkDone{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary)}
.dso-pre{background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:10px 12px;overflow:auto;font-size:12px;
  font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);line-height:1.6}
.dso-pre code{font-family:inherit;font-size:inherit}
.dso-quote{margin:10px 0;padding:8px 12px;border-left:3px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-2);border-radius:0 6px 6px 0;color:var(--dsw-alias-label-secondary)}
.dso-hr{border:0;border-top:1px solid var(--dsw-alias-border-l2);margin:16px 0}
.dso-code{font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);font-size:12px;
  background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:1px 4px}
.dso-wiki{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);border-radius:4px;padding:0 4px}
.dso-wikiLink{border:0;font:inherit;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);
  border-radius:4px;padding:0 4px;cursor:pointer}
.dso-wikiLink:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
.dso-tag{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:0 5px;font-size:12px}
.dso-a{color:var(--dsw-alias-brand-primary);text-decoration:none}
.dso-a:hover{text-decoration:underline}
.dso-tableWrap{overflow:auto;margin:10px 0}
.dso-table{border-collapse:collapse;font-size:12px;min-width:50%}
.dso-table th,.dso-table td{border:1px solid var(--dsw-alias-border-l2);padding:6px 9px;text-align:left;vertical-align:top}
.dso-table th{background:var(--dsw-alias-bg-layer-2);font-weight:600}
.dso-empty{color:var(--dsw-alias-label-secondary);padding:40px 24px;text-align:center}
.dso-bar{display:flex;align-items:center;gap:10px;padding:10px max(16px,min(3vw,32px));border-top:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
.dso-stats{display:flex;flex-wrap:wrap;gap:10px;padding:14px max(16px,min(3vw,32px));overflow:auto}
.dso-metric{flex:1 1 160px;min-width:150px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px}
.dso-metricK{color:var(--dsw-alias-label-secondary);font-size:11px}
.dso-metricV{font-size:20px;font-weight:650;line-height:28px;margin-top:2px;font-variant-numeric:tabular-nums}
.dso-bars{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);
  padding:12px 14px;margin:0 max(16px,min(3vw,32px)) 12px;box-sizing:border-box}
.dso-barRow{display:flex;align-items:center;gap:10px;height:24px;font-size:12px}
.dso-barLabel{width:170px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dso-barTrack{flex:1;height:7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.dso-barFill{display:block;height:100%;min-width:3px;border-radius:999px;
  background:linear-gradient(90deg,var(--dsw-alias-brand-primary),color-mix(in srgb,var(--dsw-alias-brand-primary) 62%,#fff 38%))}
.dso-barCount{width:44px;text-align:right;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
/* ---------- animation ---------- */
@keyframes dsoPulse{0%,100%{transform:scale(1);opacity:.55}50%{transform:scale(1.06);opacity:.95}}
@keyframes dsoDot{0%,80%,100%{transform:translateY(0);opacity:.35}40%{transform:translateY(-3px);opacity:1}}
@keyframes dsoBlink{0%,49%{opacity:1}50%,100%{opacity:.15}}
@keyframes dsoIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@media (max-width:740px){
  .dso-suggestGrid{grid-template-columns:1fr}
  .dso-vault{max-width:22vw}
  .dso-hint{display:none}
  .dso-side{width:230px;min-width:200px}
}
@media (prefers-reduced-motion:reduce){
  .dso-orb::after,.dso-dots i,.dso-caret,.dso-msgUser,.dso-msgAssistant{animation:none!important}
  .dso-suggest,.dso-send{transition:none!important}
}
`

    function StyleTag() {
      return h('style', null, CSS)
    }

    // ------------------------------------------------------------------
    // Icons (inline SVG, stroke = currentColor)
    // ------------------------------------------------------------------
    function Svg(props) {
      return h(
        'svg',
        {
          width: props.size ?? 16,
          height: props.size ?? 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: props.strokeWidth ?? 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block', flex: 'none', ...(props.style ?? {}) },
        },
        props.children,
      )
    }

    function Icon(props) {
      const name = props.name
      const size = props.size ?? 16
      if (name === 'spark') {
        return h(Svg, { size }, h('path', { d: 'M12 3.2l1.8 5.1 5.1 1.8-5.1 1.8L12 17l-1.8-5.1L5.1 10l5.1-1.8L12 3.2Z' }), h('path', { d: 'M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z', opacity: 0.7 }))
      }
      if (name === 'send') return h(Svg, { size, strokeWidth: 2 }, h('path', { d: 'M12 19V5' }), h('path', { d: 'M6 11l6-6 6 6' }))
      if (name === 'stop') return h(Svg, { size, strokeWidth: 2 }, h('rect', { x: 7, y: 7, width: 10, height: 10, rx: 2, fill: 'currentColor', stroke: 'none' }))
      if (name === 'search') return h(Svg, { size }, h('circle', { cx: 11, cy: 11, r: 6.2 }), h('path', { d: 'M16.2 16.2L21 21' }))
      if (name === 'chart') return h(Svg, { size }, h('path', { d: 'M4 19V5' }), h('path', { d: 'M4 19h16' }), h('path', { d: 'M7.5 15.5l3.2-4 3 2.4 3.8-6' }))
      if (name === 'check') return h(Svg, { size }, h('path', { d: 'M4.5 12.5l5 5 10-11' }))
      if (name === 'calendar') return h(Svg, { size }, h('rect', { x: 4, y: 5.5, width: 16, height: 15, rx: 2.5 }), h('path', { d: 'M8 3.5v4M16 3.5v4M4 10h16' }))
      if (name === 'compass') return h(Svg, { size }, h('circle', { cx: 12, cy: 12, r: 8.2 }), h('path', { d: 'M14.8 9.2l-1.6 4-4 1.6 1.6-4 4-1.6Z' }))
      if (name === 'file') return h(Svg, { size }, h('path', { d: 'M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5Z' }), h('path', { d: 'M14 3.8V8h4.2' }), h('path', { d: 'M9 12h6M9 15.5h6' }))
      if (name === 'folder') return h(Svg, { size }, h('path', { d: 'M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V6.5Z' }))
      if (name === 'refresh') return h(Svg, { size }, h('path', { d: 'M20 11a8 8 0 1 0-2.3 6.2' }), h('path', { d: 'M20 4v7h-7' }))
      if (name === 'plus') return h(Svg, { size, strokeWidth: 2 }, h('path', { d: 'M12 5v14M5 12h14' }))
      if (name === 'copy') return h(Svg, { size }, h('rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }), h('path', { d: 'M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3' }))
      if (name === 'back') return h(Svg, { size }, h('path', { d: 'M15 5l-7 7 7 7' }))
      if (name === 'chevron') return h(Svg, { size }, h('path', { d: 'M9 6l6 6-6 6' }))
      if (name === 'arrow') return h(Svg, { size }, h('path', { d: 'M5 12h14M13 6l6 6-6 6' }))
      if (name === 'book') return h(Svg, { size }, h('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z' }), h('path', { d: 'M4 18.5A2.5 2.5 0 0 1 6.5 16H20' }))
      if (name === 'external') return h(Svg, { size }, h('path', { d: 'M14 4h6v6' }), h('path', { d: 'M20 4l-8.5 8.5' }), h('path', { d: 'M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10' }))
      if (name === 'thumbUp') return h(Svg, { size }, h('path', { d: 'M7 10.5v9.5' }), h('path', { d: 'M3.5 10.5H7V20H3.5a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1Z' }), h('path', { d: 'M7 11l4-7.5a2 2 0 0 1 2 2V9h5.2a1.8 1.8 0 0 1 1.77 2.11l-1.1 6.5A1.8 1.8 0 0 1 17.1 19H7' }))
      if (name === 'thumbDown') return h(Svg, { size }, h('path', { d: 'M7 13.5V4' }), h('path', { d: 'M3.5 13.5H7V4H3.5a1 1 0 0 0-1 1V12.5a1 1 0 0 0 1 1Z' }), h('path', { d: 'M7 13l4 7.5a2 2 0 0 0 2-2V15h5.2a1.8 1.8 0 0 0 1.77-2.11l-1.1-6.5A1.8 1.8 0 0 0 17.1 5H7' }))
      return h(Svg, { size }, h('circle', { cx: 12, cy: 12, r: 8 }))
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
          stroke: props.light ? '#fff' : props.active ? 'var(--dsw-alias-brand-primary)' : 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
          fill: props.light ? 'rgba(255,255,255,.14)' : props.active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)' : 'none',
        }),
        h('path', {
          d: 'M12 2.6v18.8M4 9l8 3.6L20 9',
          stroke: props.light ? '#fff' : props.active ? 'var(--dsw-alias-brand-primary)' : 'currentColor',
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
    // small helpers
    // ------------------------------------------------------------------
    function formatNumber(value) {
      const number = Number(value)
      return Number.isFinite(number) ? number.toLocaleString('zh-CN') : String(value ?? '—')
    }

    function shortModel(model) {
      const text = String(model ?? '')
      if (text === '') return ''
      const parts = text.split('/')
      return parts[parts.length - 1]
    }

    function noteLabel(source) {
      if (source === null || source === undefined) return ''
      if (typeof source.title === 'string' && source.title !== '') return source.title
      const path = String(source.path ?? '')
      return path.split('/').pop().replace(/\.md$/i, '')
    }

    // Host retrieval reasons are Chinese constants; keep the chips readable in
    // either UI language without a second round-trip.
    const REASON_LABELS = {
      检索命中: { zh: '检索命中', en: 'hit' },
      时间范围内: { zh: '时间范围内', en: 'in range' },
      未完成待办: { zh: '未完成待办', en: 'open task' },
      链接关联: { zh: '链接关联', en: 'linked' },
      承接上文: { zh: '承接上文', en: 'follow-up' },
      最近更新: { zh: '最近更新', en: 'recent' },
    }

    function reasonLabel(reason, lang) {
      const text = String(reason ?? '').trim()
      if (text === '') return ''
      const row = REASON_LABELS[text]
      return row === undefined ? text : row[lang === 'en' ? 'en' : 'zh']
    }

    function obsidianOpenUrl(vaultPath, rel) {
      const name = String(vaultPath ?? '').replace(/\/+$/, '').split('/').pop() ?? ''
      return `obsidian://open?vault=${encodeURIComponent(name)}&file=${encodeURIComponent(String(rel ?? ''))}`
    }

    function readStorage(key, fallback) {
      try {
        const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null
        if (raw === null || raw === '') return fallback
        return JSON.parse(raw)
      } catch {
        return fallback
      }
    }

    function writeStorage(key, value) {
      try {
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, JSON.stringify(value))
      } catch {
        /* storage can be unavailable in private windows */
      }
    }

    function readLocal(key, fallback) {
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
        if (raw === null || raw === '') return fallback
        return JSON.parse(raw)
      } catch {
        return fallback
      }
    }

    function writeLocal(key, value) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value))
      } catch {
        /* ignore quota/privacy errors */
      }
    }

    function metric(label, value) {
      return h('div', { className: 'dso-metric', key: label },
        h('div', { className: 'dso-metricK' }, label),
        h('div', { className: 'dso-metricV' }, value),
      )
    }

    // ------------------------------------------------------------------
    // composer
    // ------------------------------------------------------------------
    function Composer(props) {
      const { t, value, onChange, onSend, onStop, streaming, deep, onDeep, big, templates } = props
      const textareaRef = React.useRef(null)
      const [slashIndex, setSlashIndex] = React.useState(0)

      React.useEffect(() => {
        const element = textareaRef.current
        if (element === null) return
        element.style.height = '0px'
        element.style.height = `${Math.min(element.scrollHeight, 170)}px`
      }, [value])

      const slash = String(value).startsWith('/') ? String(value).slice(1) : null
      const slashQuery = slash === null ? '' : slash.trim().toLowerCase()
      const slashItems = slash === null
        ? []
        : (slashQuery === ''
            ? (Array.isArray(templates) ? templates : [])
            : (Array.isArray(templates) ? templates : []).filter((item) =>
                `${item.label} ${item.hint} ${item.prompt}`.toLowerCase().includes(slashQuery)))

      React.useEffect(() => {
        setSlashIndex(0)
      }, [slash])

      const pickTemplate = (item) => {
        onChange(item.prompt)
        requestAnimationFrame(() => {
          const element = textareaRef.current
          if (element === null) return
          element.focus()
          try {
            element.setSelectionRange(item.prompt.length, item.prompt.length)
          } catch {
            /* some engines reject selection on a controlled textarea */
          }
        })
      }

      const openTemplates = () => {
        onChange('/')
        requestAnimationFrame(() => textareaRef.current?.focus())
      }

      const onKeyDown = (event) => {
        if (slash !== null && slashItems.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setSlashIndex((index) => (index + 1) % slashItems.length)
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setSlashIndex((index) => (index - 1 + slashItems.length) % slashItems.length)
            return
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            pickTemplate(slashItems[Math.min(slashIndex, slashItems.length - 1)])
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onChange('')
            return
          }
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          if (!streaming && String(value).trim() !== '') onSend()
        }
      }

      return h('div', { className: 'dso-composer', 'data-big': big === true ? 'true' : 'false' },
        slash !== null
          ? h('div', { className: 'dso-slashMenu', role: 'listbox', 'aria-label': t('templates'), 'data-side': big === true ? 'below' : 'above' },
              h('div', { className: 'dso-slashHead' },
                h('span', null, t('templates')),
                h('span', null, t('templatesHint')),
              ),
              slashItems.length === 0
                ? h('div', { className: 'dso-slashEmpty' }, t('templatesEmpty'))
                : slashItems.map((item, index) =>
                    h('button', {
                      key: item.id,
                      className: 'dso-slashItem',
                      type: 'button',
                      role: 'option',
                      'aria-selected': index === slashIndex ? 'true' : 'false',
                      'data-active': index === slashIndex ? 'true' : 'false',
                      onMouseEnter: () => setSlashIndex(index),
                      onClick: () => pickTemplate(item),
                    },
                      h('span', { className: 'dso-slashItemMain' },
                        h('span', { className: 'dso-slashLabel' },
                          h('span', { className: 'dso-slashKey' }, '/'),
                          item.label,
                        ),
                        h('span', { className: 'dso-slashHint' }, item.hint),
                      ),
                    ),
                  ),
            )
          : null,
        h('textarea', {
          ref: textareaRef,
          className: 'dso-textarea',
          placeholder: t('askPlaceholder'),
          value,
          rows: 1,
          spellCheck: false,
          onChange: (event) => onChange(event.target.value),
          onKeyDown,
          'aria-label': t('askPlaceholder'),
        }),
        h('div', { className: 'dso-composerBar' },
          h('button', {
            className: 'dso-slashBtn',
            type: 'button',
            title: t('templates'),
            onClick: openTemplates,
          }, h('span', { className: 'dso-slashMark' }, '/'), t('templates')),
          h('button', {
            className: 'dso-deep',
            type: 'button',
            'data-on': deep ? 'true' : 'false',
            title: deep ? t('deepOn') : t('deep'),
            onClick: () => onDeep(!deep),
          }, h(Icon, { name: 'spark', size: 13 }), t('deep')),
          h('span', { className: 'dso-hint' }, t('askHint')),
          h('button', {
            className: 'dso-send',
            type: 'button',
            'data-stop': streaming ? 'true' : 'false',
            title: streaming ? t('stop') : t('send'),
            'aria-label': streaming ? t('stop') : t('send'),
            disabled: streaming ? false : String(value).trim() === '',
            onClick: streaming ? onStop : onSend,
          }, h(Icon, { name: streaming ? 'stop' : 'send', size: 16 })),
        ),
      )
    }

    function SettingsPopover(props) {
      const { t, reading, onReading, modelChoice, onModel, catalog, loading, modelError, onRetry, onClose } = props
      const providers = Array.isArray(catalog?.providers) ? catalog.providers : []
      const current = catalog?.current
      const [modelOpen, setModelOpen] = React.useState(false)
      const savedMissing = modelChoice.provider !== '' && !providers.some((provider) =>
        provider.provider === modelChoice.provider && Array.isArray(provider.models) && provider.models.some((model) => model.id === modelChoice.model))

      const modelLabel = modelChoice.provider !== '' && modelChoice.model !== ''
        ? savedMissing
          ? `${t('customModel')} · ${modelChoice.provider}/${modelChoice.model}`
          : `${modelChoice.model} · ${modelChoice.provider}`
        : `${t('followDSH')}${current?.model ? ` · ${shortModel(current.model)}` : ''}`

      const chooseModel = (choice) => {
        setModelOpen(false)
        if (choice.provider === '' || choice.model === '') {
          onModel({ provider: '', model: '' })
          return
        }
        onModel({ provider: choice.provider, model: choice.model })
      }

      const segment = (options, active, onPick) => h('div', { className: 'dso-seg' },
        options.map((option) =>
          h('button', {
            key: option.id,
            className: 'dso-segBtn',
            type: 'button',
            'data-on': active === option.id ? 'true' : 'false',
            onClick: () => onPick(option.id),
          }, option.label),
        ),
      )

      return h('div', { className: 'dso-settings', onClick: (event) => event.stopPropagation() },
        h('div', { className: 'dso-settingsHead' },
          h('div', { className: 'dso-settingsTitle' }, t('readingSettings')),
          h('button', { className: 'dso-settingsClose', type: 'button', onClick: onClose, title: t('close') }, '×'),
        ),
        h('div', { className: 'dso-settingGroup' },
          h('div', { className: 'dso-settingLabel' }, h('span', null, t('answerWidth')), h('span', null, `${WIDTH_PRESETS.find((item) => item.id === reading.width)?.px ?? 900}px`)),
          segment(WIDTH_PRESETS, reading.width, (id) => onReading({ ...reading, width: id })),
        ),
        h('div', { className: 'dso-settingGroup' },
          h('div', { className: 'dso-settingLabel' }, h('span', null, t('answerFont')), h('span', null, `${FONT_PRESETS.find((item) => item.id === reading.font)?.px ?? 15.5}px`)),
          segment(FONT_PRESETS, reading.font, (id) => onReading({ ...reading, font: id })),
        ),
        h('div', { className: 'dso-settingGroup' },
          h('div', { className: 'dso-settingLabel' }, h('span', null, t('answerTypeface'))),
          segment([
            { id: 'serif', label: t('typeSerif') },
            { id: 'ui', label: t('typeUI') },
          ], reading.typeface, (id) => onReading({ ...reading, typeface: id })),
        ),
        h('div', { className: 'dso-settingGroup' },
          h('div', { className: 'dso-settingLabel' }, h('span', null, t('answerModel'))),
          loading
            ? h('div', { className: 'dso-settingNote' }, t('modelLoading'))
            : h('div', { className: 'dso-modelPicker' },
                h('button', {
                  className: 'dso-select',
                  type: 'button',
                  'aria-haspopup': 'listbox',
                  'aria-expanded': modelOpen ? 'true' : 'false',
                  onClick: () => setModelOpen((open) => !open),
                },
                  h('span', { className: 'dso-selectText' }, modelLabel),
                  h('span', { className: 'dso-selectCaret' }, modelOpen ? '▴' : '▾'),
                ),
                modelOpen
                  ? h('div', { className: 'dso-modelMenu', role: 'listbox' },
                      h('button', {
                        className: 'dso-modelItem',
                        type: 'button',
                        role: 'option',
                        'aria-selected': modelChoice.provider === '' ? 'true' : 'false',
                        'data-on': modelChoice.provider === '' ? 'true' : 'false',
                        onClick: () => chooseModel({ provider: '', model: '' }),
                      },
                        h('span', { className: 'dso-modelItemMain' },
                          h('span', { className: 'dso-modelItemTitle' }, t('followDSH')),
                          h('span', { className: 'dso-modelItemHint' }, current?.model ? shortModel(current.model) : t('modelFollowHint')),
                        ),
                      ),
                      providers.map((provider) =>
                        h('div', { key: provider.provider, className: 'dso-modelGroup' },
                          h('div', { className: 'dso-modelGroupName' }, provider.name || provider.provider),
                          (Array.isArray(provider.models) ? provider.models : []).map((model) => {
                            const on = modelChoice.provider === provider.provider && modelChoice.model === model.id
                            return h('button', {
                              key: `${provider.provider}:${model.id}`,
                              className: 'dso-modelItem',
                              type: 'button',
                              role: 'option',
                              'aria-selected': on ? 'true' : 'false',
                              'data-on': on ? 'true' : 'false',
                              onClick: () => chooseModel({ provider: provider.provider, model: model.id }),
                            },
                              h('span', { className: 'dso-modelItemMain' },
                                h('span', { className: 'dso-modelItemTitle' }, model.name || model.id),
                                h('span', { className: 'dso-modelItemHint' }, provider.name || provider.provider),
                              ),
                            )
                          }),
                        ),
                      ),
                      savedMissing
                        ? h('button', {
                            className: 'dso-modelItem',
                            type: 'button',
                            role: 'option',
                            'aria-selected': 'true',
                            'data-on': 'true',
                            onClick: () => chooseModel({ provider: modelChoice.provider, model: modelChoice.model }),
                          },
                            h('span', { className: 'dso-modelItemMain' },
                              h('span', { className: 'dso-modelItemTitle' }, `${t('customModel')} · ${modelChoice.provider}/${modelChoice.model}`),
                            ),
                          )
                        : null,
                      providers.length === 0 && !savedMissing
                        ? h('div', { className: 'dso-modelEmpty' }, t('modelEmpty'))
                        : null,
                    )
                  : null,
              ),
          modelError !== ''
            ? h('div', { className: 'dso-modelErr' }, modelError, ' ',
                h('button', { className: 'dso-settingsLink', type: 'button', onClick: onRetry }, t('modelRetry')))
            : null,
          h('div', { className: 'dso-settingNote' }, t('modelNote')),
        ),
        h('div', { className: 'dso-settingsFoot' },
          h('span', { className: 'dso-settingNote' }, t('settingsHint')),
          h('button', { className: 'dso-settingsLink', type: 'button', onClick: () => { onReading(DEFAULT_READING); onModel({ provider: '', model: '' }) } }, t('settingsReset')),
        ),
      )
    }

    // ------------------------------------------------------------------
    // source list
    // ------------------------------------------------------------------
    function SourceList(props) {
      const { t, sources, onOpen, onExternal } = props
      const [expanded, setExpanded] = React.useState(false)
      if (!Array.isArray(sources) || sources.length === 0) return null
      const shown = expanded ? sources : sources.slice(0, 4)
      return h('div', { className: 'dso-sources' },
        h('div', { className: 'dso-sourcesHead' },
          h(Icon, { name: 'book', size: 12 }),
          `${t('sources')} · ${sources.length} ${t('sourceCount')}`,
        ),
        h('div', { className: 'dso-sourceList' },
          shown.map((source) =>
            h('span', { key: source.path, className: 'dso-sourceWrap' },
              h('button', {
                className: 'dso-source',
                type: 'button',
                title: `${source.path}${source.date ? ` · ${source.date}` : ''}`,
                onClick: () => onOpen(source.path),
              },
                h(Icon, { name: 'file', size: 12 }),
                h('span', { className: 'dso-sourceName' }, noteLabel(source)),
                reasonLabel(source.reason, t.lang) !== ''
                  ? h('span', { className: 'dso-sourceReason' }, reasonLabel(source.reason, t.lang))
                  : null,
              ),
              typeof onExternal === 'function'
                ? h('button', {
                    className: 'dso-sourceExt',
                    type: 'button',
                    title: t('openInObsidian'),
                    'aria-label': `${t('openInObsidian')}：${source.path}`,
                    onClick: () => onExternal(source.path),
                  }, h(Icon, { name: 'external', size: 11 }))
                : null,
            ),
          ),
          sources.length > 4
            ? h('button', { className: 'dso-sourceMore', type: 'button', onClick: () => setExpanded(!expanded) },
                expanded ? '−' : `+${sources.length - 4} ${t('sourceMore')}`)
            : null,
        ),
      )
    }

    // ------------------------------------------------------------------
    // panel
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
      const [tab, setTab] = React.useState('ask')
      const [stats, setStats] = React.useState(null)
      const [overview, setOverview] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [toast, setToast] = React.useState('')
      const [messages, setMessages] = React.useState(() => {
        const saved = readStorage(THREAD_KEY, [])
        if (!Array.isArray(saved)) return []
        return saved.map((message) => message && message.status === 'streaming' ? { ...message, status: 'stopped', phase: null } : message)
      })
      const [askText, setAskText] = React.useState('')
      const [deep, setDeep] = React.useState(false)
      const [streaming, setStreaming] = React.useState(false)
      const [recent, setRecent] = React.useState(() => {
        const saved = readLocal(RECENT_KEY, [])
        return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string').slice(0, 6) : []
      })
      const [reading, setReading] = React.useState(() => {
        const saved = readLocal(READING_KEY, null)
        const merged = { ...DEFAULT_READING, ...(saved !== null && typeof saved === 'object' ? saved : {}) }
        if (!WIDTH_PRESETS.some((item) => item.id === merged.width)) merged.width = DEFAULT_READING.width
        if (!FONT_PRESETS.some((item) => item.id === merged.font)) merged.font = DEFAULT_READING.font
        if (merged.typeface !== 'ui') merged.typeface = 'serif'
        return merged
      })
      const [modelChoice, setModelChoice] = React.useState(() => {
        const saved = readLocal(MODEL_KEY, null)
        if (saved !== null && typeof saved === 'object' && typeof saved.provider === 'string' && typeof saved.model === 'string') {
          return { provider: saved.provider, model: saved.model }
        }
        return { provider: '', model: '' }
      })
      const [modelCatalog, setModelCatalog] = React.useState(null)
      const [modelLoading, setModelLoading] = React.useState(false)
      const [modelError, setModelError] = React.useState('')
      const [settingsOpen, setSettingsOpen] = React.useState(false)
      const searchTimer = React.useRef(null)
      const abortRef = React.useRef(null)
      const pendingRef = React.useRef({ id: '', text: '' })
      const flushTimerRef = React.useRef(null)
      const scrollRef = React.useRef(null)
      const stickRef = React.useRef(true)

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

      const loadOverview = React.useCallback(async () => {
        try {
          const body = await call('overview')
          setOverview(body)
        } catch {
          /* overview is decorative; the ask view still works */
        }
      }, [])

      const loadModels = React.useCallback(async () => {
        setModelLoading(true)
        setModelError('')
        try {
          const body = await call('models')
          setModelCatalog(body)
        } catch (caught) {
          setModelError(String(caught?.message ?? caught))
        } finally {
          setModelLoading(false)
        }
      }, [])

      React.useEffect(() => {
        void loadModels()
      }, [loadModels])

      React.useEffect(() => {
        writeLocal(READING_KEY, reading)
      }, [reading])

      React.useEffect(() => {
        writeLocal(MODEL_KEY, modelChoice)
      }, [modelChoice])

      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          const next = await refreshStatus()
          if (!alive || next === null) return
          if (next.mounted) {
            await loadTree()
            await loadOverview()
          }
        }
        tick()
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          tick()
        }, 8000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [refreshStatus, loadTree, loadOverview])

      React.useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(() => setToast(''), 2400)
        return () => clearTimeout(timer)
      }, [toast])

      React.useEffect(() => {
        if (tab !== 'ask' || messages.length === 0) return
        const element = scrollRef.current
        if (element !== null && stickRef.current) element.scrollTop = element.scrollHeight
      }, [messages, tab])

      React.useEffect(() => {
        writeLocal(RECENT_KEY, recent)
      }, [recent])

      React.useEffect(() => {
        if (streaming) return
        if (messages.length === 0) {
          try {
            if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(THREAD_KEY)
          } catch {
            /* ignore */
          }
          return
        }
        writeStorage(THREAD_KEY, messages.slice(-12))
      }, [messages, streaming])

      const flushPending = React.useCallback(() => {
        const pending = pendingRef.current
        if (pending.id === '' || pending.text === '') return
        const id = pending.id
        const text = pending.text
        pendingRef.current = { id, text: '' }
        setMessages((previous) => previous.map((message) => message.id === id ? { ...message, text: message.text + text } : message))
      }, [])

      const queueDelta = (id, text) => {
        const pending = pendingRef.current
        if (pending.id !== id) {
          if (pending.id !== '' && pending.text !== '') flushPending()
          pendingRef.current = { id, text }
        } else {
          pending.text += text
        }
        if (flushTimerRef.current === null) {
          flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null
            flushPending()
          }, 32)
        }
      }

      React.useEffect(() => () => {
        if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current)
        if (abortRef.current !== null) abortRef.current.abort()
      }, [])

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
        if (typeof rel !== 'string' || rel === '') return
        setBusy(true)
        try {
          const body = await call(`note?path=${encodeURIComponent(rel)}`)
          setNote(body)
          setTab('notes')
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
          await loadOverview()
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
          setMessages([])
          setAskText('')
          await refreshStatus()
          await loadTree()
          await loadOverview()
        } catch (caught) {
          setError(String(caught?.message ?? caught))
        }
      }

      const showStats = async () => {
        setBusy(true)
        try {
          const body = await call('stats?groupBy=folder')
          setStats(body)
          setTab('stats')
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

      const askAboutNote = () => {
        if (note === null) return
        setAskText(`${t('noteQuestionPrefix')}${note.title || note.path}${t('noteQuestionSuffix')}`)
        setTab('ask')
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
          await loadOverview()
          await openNote(created.path)
          setToast(`${t('created')} ${created.path}`)
        } catch (caught) {
          setError(String(caught?.message ?? caught))
        } finally {
          setBusy(false)
        }
      }

      const stopStreaming = () => {
        if (abortRef.current !== null) abortRef.current.abort()
      }

      const sendQuestion = async (rawText) => {
        const question = String(rawText ?? '').trim()
        if (question === '' || streaming) return
        const assistantId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const userMessage = { id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'user', text: question }
        const assistantMessage = {
          id: assistantId,
          role: 'assistant',
          text: '',
          status: 'streaming',
          phase: 'retrieving',
          sources: [],
          model: '',
          question,
          range: null,
          feedback: null,
          matched: null,
          strong: null,
          characters: 0,
          startedAt: Date.now(),
        }
        // Follow-ups keep the previous answer's scope: its sources and time
        // range become a retrieval prior on the Host side.
        let prior = null
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const item = messages[i]
          if (item && item.role === 'assistant' && item.status === 'done' && Array.isArray(item.sources) && item.sources.length > 0) {
            prior = {
              question: typeof item.question === 'string' ? item.question : '',
              sources: item.sources.slice(0, 30).map((source) => ({ path: source && typeof source === 'object' ? String(source.path ?? '') : '' })),
              ...(item.range !== null && item.range !== undefined ? { range: item.range } : {}),
            }
            break
          }
        }
        const history = messages
          .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.text === 'string' && message.text !== '')
          .slice(-6)
          .map((message) => ({ role: message.role, text: message.text.slice(0, 1800) }))
        setMessages((previous) => [...previous, userMessage, assistantMessage])
        setRecent((previous) => [question, ...previous.filter((item) => item !== question)].slice(0, 6))
        setAskText('')
        setTab('ask')
        setStreaming(true)
        setError('')
        stickRef.current = true
        if (flushTimerRef.current !== null) {
          clearTimeout(flushTimerRef.current)
          flushTimerRef.current = null
        }
        pendingRef.current = { id: assistantId, text: '' }
        const controller = new AbortController()
        abortRef.current = controller

        let sawDelta = false
        const applyEvent = (eventName, data) => {
          if (eventName === 'meta') {
            setMessages((previous) => previous.map((message) => message.id === assistantId
              ? {
                  ...message,
                  phase: 'writing',
                  sources: Array.isArray(data.sources) ? data.sources : [],
                  model: String(data.model ?? ''),
                  range: data.range !== null && typeof data.range === 'object' ? data.range : null,
                  matched: Number(data.matched) || 0,
                  strong: Number(data.strongMatches) || 0,
                }
              : message))
            if (typeof data.fallbackFrom === 'string' && data.fallbackFrom !== '') setToast(t('modelFallback'))
            return
          }
          if (eventName === 'phase') {
            setMessages((previous) => previous.map((message) => message.id === assistantId ? { ...message, phase: data.phase === 'thinking' ? 'thinking' : message.phase } : message))
            return
          }
          if (eventName === 'delta') {
            queueDelta(assistantId, String(data.text ?? ''))
            if (!sawDelta) {
              sawDelta = true
              setMessages((previous) => previous.map((message) => message.id === assistantId ? { ...message, phase: 'writing' } : message))
            }
            return
          }
          if (eventName === 'done') {
            if (flushTimerRef.current !== null) {
              clearTimeout(flushTimerRef.current)
              flushTimerRef.current = null
            }
            flushPending()
            const characters = Number(data.characters ?? 0)
            setMessages((previous) => previous.map((message) => message.id === assistantId
              ? {
                  ...message,
                  status: message.status === 'stopped' ? 'stopped' : characters === 0 && message.text === '' ? 'error' : 'done',
                  phase: null,
                  error: characters === 0 && message.text === '' ? t('emptyAnswer') : message.error,
                  usage: data.usage ?? null,
                  characters,
                }
              : message))
            return
          }
          if (eventName === 'error') {
            if (flushTimerRef.current !== null) {
              clearTimeout(flushTimerRef.current)
              flushTimerRef.current = null
            }
            flushPending()
            setMessages((previous) => previous.map((message) => message.id === assistantId
              ? { ...message, status: 'error', phase: null, error: String(data.message ?? t('streamError')) }
              : message))
          }
        }

        try {
          const response = await fetch(apiUrl('ask'), {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              question,
              history,
              ...(prior !== null ? { prior } : {}),
              deep,
              ...(modelChoice.provider !== '' && modelChoice.model !== ''
                ? { provider: modelChoice.provider, model: modelChoice.model }
                : {}),
            }),
            signal: controller.signal,
          })
          if (!response.ok) {
            let message = `HTTP ${response.status}`
            try {
              const body = await response.json()
              if (body && typeof body.error === 'string') message = body.error
            } catch {
              /* keep status text */
            }
            throw new Error(message)
          }
          if (response.body === null) throw new Error('浏览器不支持流式响应')
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            buffer = buffer.replace(/\r\n/g, '\n')
            let boundary = buffer.indexOf('\n\n')
            while (boundary !== -1) {
              const block = buffer.slice(0, boundary)
              buffer = buffer.slice(boundary + 2)
              let eventName = 'message'
              let dataText = ''
              for (const line of block.split('\n')) {
                if (line.startsWith('event:')) eventName = line.slice(6).trim()
                else if (line.startsWith('data:')) dataText += line.slice(5).trim()
              }
              if (dataText !== '') {
                try {
                  applyEvent(eventName, JSON.parse(dataText))
                } catch {
                  /* a malformed frame must not kill the rest of the stream */
                }
              }
              boundary = buffer.indexOf('\n\n')
            }
          }
        } catch (caught) {
          if (flushTimerRef.current !== null) {
            clearTimeout(flushTimerRef.current)
            flushTimerRef.current = null
          }
          flushPending()
          const aborted = caught instanceof Error && (caught.name === 'AbortError' || controller.signal.aborted)
          setMessages((previous) => previous.map((message) => message.id === assistantId
            ? aborted
              ? { ...message, status: 'stopped', phase: null }
              : { ...message, status: 'error', phase: null, error: String(caught?.message ?? caught) }
            : message))
        } finally {
          if (abortRef.current === controller) abortRef.current = null
          setStreaming(false)
        }
      }

      const retryMessage = (message) => {
        // Find the user question immediately before this assistant answer.
        const index = messages.findIndex((item) => item.id === message.id)
        for (let i = index - 1; i >= 0; i -= 1) {
          if (messages[i].role === 'user') {
            setMessages((previous) => previous.filter((item) => item.id !== message.id))
            void sendQuestion(messages[i].text)
            return
          }
        }
      }

      const copyAnswer = async (text) => {
        try {
          await navigator.clipboard.writeText(text)
          setToast(t('copiedAnswer'))
        } catch {
          setToast('复制失败')
        }
      }

      const saveAnswer = async (message) => {
        try {
          const saved = await postJson('ask-save', {
            question: message.question ?? '',
            answer: message.text,
            sources: Array.isArray(message.sources) ? message.sources : [],
          })
          setToast(`${t('savedNote')}：${saved.path}`)
        } catch (caught) {
          setError(String(caught?.message ?? caught))
        }
      }

      const sendFeedback = async (message, rating) => {
        if (message.feedback === 'up' || message.feedback === 'down') return
        setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, feedback: rating } : item))
        try {
          await postJson('feedback', {
            rating,
            question: message.question ?? '',
            model: message.model ?? '',
            matched: message.matched ?? 0,
            strongMatches: message.strong ?? 0,
            characters: message.characters ?? 0,
          })
          setToast(t('feedbackSaved'))
        } catch {
          setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, feedback: null } : item))
        }
      }

      const openExternal = (rel) => {
        try {
          window.open(obsidianOpenUrl(status?.vault ?? '', rel), '_blank')
        } catch {
          /* the obsidian:// handler may be unavailable in this browser */
        }
      }

      const mounted = status?.mounted === true
      const folderRows = React.useMemo(() => {
        const rows = Array.isArray(tree) ? tree.filter((row) => row.path !== '') : []
        rows.sort((a, b) => b.total - a.total || a.path.localeCompare(b.path, 'zh'))
        return rows.slice(0, 40)
      }, [tree])

      const suggestions = [
        { icon: 'chart', title: t('suggestion1'), sub: t('suggestion1Sub') },
        { icon: 'check', title: t('suggestion2'), sub: t('suggestion2Sub') },
        { icon: 'calendar', title: t('suggestion3'), sub: t('suggestion3Sub') },
        { icon: 'compass', title: t('suggestion4'), sub: t('suggestion4Sub') },
      ]

      const readingStyle = {
        '--dso-answer-width': `${WIDTH_PRESETS.find((item) => item.id === reading.width)?.px ?? 900}px`,
        '--dso-answer-font': `${FONT_PRESETS.find((item) => item.id === reading.font)?.px ?? 15.5}px`,
        '--dso-prose': reading.typeface === 'serif' ? 'var(--dso-serif)' : 'var(--dsw-font-family)',
      }

      const topbar = h('div', { className: 'dso-topbar' },
        h('div', { className: 'dso-brand' },
          h(ObsidianGlyph, { size: 19, active: true }),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'dso-brandName' }, t('title')),
            h('div', { className: 'dso-vault', title: status?.vault ?? '' }, mounted ? status.vault : t('noVault')),
          ),
        ),
        h('div', { className: 'dso-grow' }),
        mounted
          ? h('div', { className: 'dso-tabs', role: 'tablist' },
              h('button', { className: 'dso-tab', type: 'button', role: 'tab', 'data-active': tab === 'ask' ? 'true' : 'false', onClick: () => setTab('ask') }, h(Icon, { name: 'spark', size: 13 }), t('tabAsk')),
              h('button', { className: 'dso-tab', type: 'button', role: 'tab', 'data-active': tab === 'notes' ? 'true' : 'false', onClick: () => setTab('notes') }, h(Icon, { name: 'book', size: 13 }), t('tabNotes')),
              h('button', { className: 'dso-tab', type: 'button', role: 'tab', 'data-active': tab === 'stats' ? 'true' : 'false', onClick: () => void showStats() }, h(Icon, { name: 'chart', size: 13 }), t('tabStats')),
            )
          : null,
        h('div', { className: 'dso-grow' }),
        h('div', { className: 'dso-actions' },
          mounted
            ? h('span', { className: 'dso-chip', 'data-on': 'true', title: t('vaultReady') },
                `${formatNumber(status.noteCount)} ${t('notes')} · ${formatNumber(status.folderCount)} ${t('folders')}`)
            : null,
          h('button', {
            className: 'dso-action',
            type: 'button',
            title: t('readingSettings'),
            'aria-expanded': settingsOpen ? 'true' : 'false',
            onClick: () => setSettingsOpen((open) => !open),
          }, h('span', { className: 'dso-aa' }, 'Aa')),
          h('button', { className: 'dso-action', type: 'button', onClick: () => void pickVault(), title: t('switchVault') }, h(Icon, { name: 'folder', size: 14 })),
          mounted ? h('button', { className: 'dso-action', type: 'button', disabled: busy, onClick: () => void doRescan(), title: t('refresh') }, h(Icon, { name: 'refresh', size: 14 })) : null,
          mounted ? h('button', { className: 'dso-action dso-actionPrimary', type: 'button', disabled: busy, onClick: () => void createNote(), title: t('newNote') }, h(Icon, { name: 'plus', size: 14 }), t('newNote')) : null,
          settingsOpen ? h('div', { className: 'dso-settingsBackdrop', onClick: () => setSettingsOpen(false) }) : null,
          settingsOpen
            ? h(SettingsPopover, {
                t,
                reading,
                onReading: setReading,
                modelChoice,
                onModel: setModelChoice,
                catalog: modelCatalog,
                loading: modelLoading,
                modelError,
                onRetry: () => void loadModels(),
                onClose: () => setSettingsOpen(false),
              })
            : null,
        ),
      )

      if (!mounted) {
        return h('div', { className: 'dso-root', style: readingStyle },
          h(StyleTag),
          topbar,
          error !== '' ? h('div', { className: 'dso-err' }, error) : null,
          h('div', { className: 'dso-empty' },
            h('div', { style: { fontWeight: 600, marginBottom: 6 } }, t('noVault')),
            h('div', null, t('noVaultHint')),
            h('div', { style: { marginTop: 14 } },
              h('button', { className: 'dso-action dso-actionPrimary', type: 'button', onClick: () => void pickVault() }, t('pickDir')),
            ),
          ),
        )
      }

      // ----- ask view ---------------------------------------------------
      let askView = null
      if (tab === 'ask') {
        const empty = messages.length === 0
        const onScroll = () => {
          const element = scrollRef.current
          if (element === null) return
          stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72
        }
        const home = h('div', { className: 'dso-hero' },
          h('div', { className: 'dso-heroGlow' }),
          h('div', { className: 'dso-orb' }, h(ObsidianGlyph, { size: 30, light: true })),
          h('div', { className: 'dso-eyebrow' }, t('heroEyebrow')),
          h('h1', { className: 'dso-heroTitle' }, `${t('heroTitleA')} `, h('em', null, t('heroTitleB'))),
          h('p', { className: 'dso-heroSub' }, t('heroSub')),
          h(Composer, { t, value: askText, onChange: setAskText, onSend: () => void sendQuestion(askText), onStop: stopStreaming, streaming: false, deep, onDeep: setDeep, big: true, templates: PROMPT_TEMPLATES }),
          h('div', { className: 'dso-suggestGrid' },
            suggestions.map((item) =>
              h('button', { key: item.title, className: 'dso-suggest', type: 'button', onClick: () => void sendQuestion(item.title) },
                h('span', { className: 'dso-suggestIcon' }, h(Icon, { name: item.icon, size: 15 })),
                h('span', null,
                  h('span', { className: 'dso-suggestTitle', style: { display: 'block' } }, item.title),
                  h('span', { className: 'dso-suggestSub', style: { display: 'block' } }, item.sub),
                ),
              ),
            ),
          ),
          overview !== null
            ? h('div', { className: 'dso-pulse' },
                h('span', { className: 'dso-pulseItem' }, h('b', null, formatNumber(overview.noteCount)), t('notes')),
                h('span', { className: 'dso-pulseItem' }, h('b', null, formatNumber(overview.weekNotes)), t('weekNotes')),
                h('span', { className: 'dso-pulseItem' }, h('b', null, formatNumber(overview.monthNotes)), t('monthNotes')),
                h('span', { className: 'dso-pulseItem' }, h('b', null, formatNumber(overview.tasksOpen)), t('openTasks')),
                overview.completion !== null
                  ? h('span', { className: 'dso-pulseItem' }, h('b', null, `${overview.completion}%`), t('completion'))
                  : null,
              )
            : null,
          overview !== null && Array.isArray(overview.recentNotes) && overview.recentNotes.length > 0
            ? h('div', { className: 'dso-recents' },
                h('span', { className: 'dso-vault', style: { lineHeight: '26px' } }, `${t('recentEdited')}：`),
                overview.recentNotes.slice(0, 3).map((item) =>
                  h('button', { key: item.path, className: 'dso-recent', type: 'button', title: item.path, onClick: () => void openNote(item.path) }, item.title || item.path),
                ),
              )
            : null,
          recent.length > 0
            ? h('div', { className: 'dso-recents' },
                h('span', { className: 'dso-vault', style: { lineHeight: '26px' } }, `${t('recentQuestions')}：`),
                recent.slice(0, 4).map((item) => h('button', { key: item, className: 'dso-recent', type: 'button', title: item, onClick: () => void sendQuestion(item) }, item)),
              )
            : null,
        )

        const thread = h('div', { className: 'dso-thread' },
          h('div', { className: 'dso-threadHead' },
            h('div', { className: 'dso-threadTitle' }, h(Icon, { name: 'spark', size: 13 }), t('threadTitle')),
            h('div', { className: 'dso-grow' }),
            h('button', { className: 'dso-action', type: 'button', onClick: () => { if (streaming) stopStreaming(); setMessages([]); setAskText('') } }, t('newChat')),
          ),
          messages.map((message) => {
            if (message.role === 'user') {
              return h('div', { key: message.id, className: 'dso-msgUser' },
                h('div', { className: 'dso-bubble' }, message.text),
              )
            }
            const isStreaming = message.status === 'streaming'
            const phaseText = message.phase === 'retrieving' ? t('thinkingRetrieve') : message.phase === 'thinking' ? t('thinkingReason') : t('thinkingWrite')
            return h('div', { key: message.id, className: 'dso-msgAssistant' },
              h('div', { className: 'dso-avatar' }, h(ObsidianGlyph, { size: 15, light: true })),
              h('div', { className: 'dso-assistantBody' },
                h('div', { className: 'dso-assistantName' },
                  h('b', null, t('title')),
                  message.model !== '' ? h('span', { className: 'dso-modelTag' }, shortModel(message.model)) : null,
                  message.sources.length > 0 ? h('span', null, `· ${message.sources.length} ${t('sourceCount')}`) : null,
                ),
                message.status === 'error' && message.text === ''
                  ? h('div', { className: 'dso-errorCard' },
                      h('div', { style: { fontWeight: 600, marginBottom: 3 } }, t('streamError')),
                      message.error ?? '',
                    )
                  : message.text === ''
                    ? h('div', { className: 'dso-thinking' },
                        h('span', { className: 'dso-dots' }, h('i', null), h('i', null), h('i', null)),
                        phaseText,
                      )
                    : h('div', { className: 'dso-answer' },
                        renderMarkdown(message.text, `a${message.id}`, openNote),
                        isStreaming ? h('span', { className: 'dso-caret' }) : null,
                      ),
                isStreaming && message.text !== '' && message.phase === 'thinking'
                  ? h('div', { className: 'dso-thinking' }, h('span', { className: 'dso-dots' }, h('i', null), h('i', null), h('i', null)), t('thinkingReason'))
                  : null,
                message.status === 'error' && message.text !== ''
                  ? h('div', { className: 'dso-errorCard', style: { marginTop: 9 } },
                      h('div', { style: { fontWeight: 600, marginBottom: 3 } }, t('streamError')),
                      message.error ?? '',
                    )
                  : null,
                message.status === 'stopped' ? h('div', { className: 'dso-stopped' }, t('stopped')) : null,
                message.sources.length > 0
                  ? h(SourceList, { t, sources: message.sources, onOpen: (path) => void openNote(path), onExternal: openExternal })
                  : null,
                message.status === 'done' && message.text !== ''
                  ? h('div', { className: 'dso-answerActions' },
                      h('button', { className: 'dso-miniBtn', type: 'button', onClick: () => void copyAnswer(message.text) }, h(Icon, { name: 'copy', size: 12 }), t('copy')),
                      message.error === undefined ? h('button', { className: 'dso-miniBtn', type: 'button', onClick: () => retryMessage(message) }, h(Icon, { name: 'refresh', size: 12 }), t('retry')) : null,
                      h('button', { className: 'dso-miniBtn', type: 'button', title: t('saveNote'), onClick: () => void saveAnswer(message) }, h(Icon, { name: 'book', size: 12 }), t('saveNote')),
                      h('span', { style: { flex: 1 } }),
                      h('button', {
                        className: 'dso-miniBtn',
                        type: 'button',
                        title: t('feedbackUp'),
                        'aria-label': t('feedbackUp'),
                        'data-on': message.feedback === 'up' ? 'true' : 'false',
                        disabled: message.feedback === 'up' || message.feedback === 'down',
                        onClick: () => void sendFeedback(message, 'up'),
                      }, h(Icon, { name: 'thumbUp', size: 12 })),
                      h('button', {
                        className: 'dso-miniBtn',
                        type: 'button',
                        title: t('feedbackDown'),
                        'aria-label': t('feedbackDown'),
                        'data-on': message.feedback === 'down' ? 'true' : 'false',
                        disabled: message.feedback === 'up' || message.feedback === 'down',
                        onClick: () => void sendFeedback(message, 'down'),
                      }, h(Icon, { name: 'thumbDown', size: 12 })),
                    )
                  : null,
                message.status === 'error'
                  ? h('div', { className: 'dso-answerActions' },
                      h('button', { className: 'dso-miniBtn', type: 'button', onClick: () => retryMessage(message) }, h(Icon, { name: 'refresh', size: 12 }), t('streamRetry')),
                    )
                  : null,
              ),
            )
          }),
        )

        askView = h('div', { className: 'dso-ask' },
          h('div', { className: 'dso-askScroll', ref: scrollRef, onScroll },
            h('div', { className: 'dso-askInner' }, empty ? home : thread),
          ),
          empty
            ? null
            : h('div', { className: 'dso-askDock' },
                h('div', { className: 'dso-askDockInner' },
                  h(Composer, { t, value: askText, onChange: setAskText, onSend: () => void sendQuestion(askText), onStop: stopStreaming, streaming, deep, onDeep: setDeep, big: false, templates: PROMPT_TEMPLATES }),
                ),
              ),
        )
      }

      // ----- notes view -------------------------------------------------
      let notesView = null
      if (tab === 'notes') {
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
                  hit.date && hit.date !== (hit.title || '') ? h('span', { className: 'dso-rowMeta' }, hit.date) : null,
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
                    entry.date && entry.date !== (entry.title || '') ? h('span', { className: 'dso-rowMeta' }, entry.date) : null,
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
        if (note !== null) {
          main = h('div', { className: 'dso-main' },
            h('div', { className: 'dso-noteHead' },
              h('div', { style: { minWidth: 0, flex: 1 } },
                h('div', { className: 'dso-brandName' }, note.title || note.path),
                h('div', { className: 'dso-notePath', title: note.path },
                  `${note.path}${note.date && note.date !== note.title ? ` · ${note.date}` : ''} · ${String(note.text ?? '').split(/\r?\n/).length} ${t('lines')}`),
              ),
              h('button', { className: 'dso-action', type: 'button', onClick: askAboutNote }, h(Icon, { name: 'spark', size: 13 }), t('askHere')),
              h('button', {
                className: 'dso-action',
                type: 'button',
                title: t('openInObsidian'),
                'aria-label': t('openInObsidian'),
                onClick: () => openExternal(note.path),
              }, h(Icon, { name: 'external', size: 13 })),
            ),
            h('div', { className: 'dso-note' }, h('div', { className: 'dso-noteBody' }, renderMarkdown(note.text, `n${note.path.length}`, openNote))),
            h('div', { className: 'dso-bar' },
              h('button', { className: 'dso-action dso-actionPrimary', type: 'button', onClick: () => void askInChat('ask') }, t('ask')),
              h('button', { className: 'dso-action', type: 'button', onClick: () => void askInChat('summarize') }, t('summarize')),
              h('div', { className: 'dso-grow' }),
              toast !== '' ? h('span', { className: 'dso-vault' }, toast) : null,
            ),
          )
        } else {
          main = h('div', { className: 'dso-main' }, h('div', { className: 'dso-empty' }, t('noSelection')))
        }

        notesView = h('div', { className: 'dso-body' }, side, main)
      }

      // ----- stats view -------------------------------------------------
      let statsView = null
      if (tab === 'stats') {
        const data = stats ?? { noteCount: status.noteCount, cjkChars: 0, tasksDone: 0, tasksTotal: 0, completion: null, rows: [] }
        const max = Math.max(1, ...(data.rows ?? []).map((row) => row.count))
        statsView = h('div', { className: 'dso-main' },
          h('div', { className: 'dso-noteHead' },
            h('button', { className: 'dso-action', type: 'button', onClick: () => setTab('notes') }, h(Icon, { name: 'back', size: 14 }), t('back')),
            h('div', { className: 'dso-grow' }),
            h('span', { className: 'dso-notePath' }, `${formatNumber(data.noteCount)} ${t('notes')}`),
          ),
          h('div', { className: 'dso-stats' },
            metric(t('notes'), formatNumber(data.noteCount)),
            metric(t('words'), formatNumber(data.cjkChars)),
            metric(t('tasks'), `${data.tasksDone}/${data.tasksTotal}`),
            metric(t('done'), data.completion === null ? '—' : `${data.completion}%`),
          ),
          h('div', { className: 'dso-bars' },
            (data.rows ?? []).map((row) =>
              h('div', { key: row.key, className: 'dso-barRow' },
                h('span', { className: 'dso-barLabel', title: row.key }, row.key),
                h('span', { className: 'dso-barTrack' }, h('span', { className: 'dso-barFill', style: { width: `${Math.round((row.count / max) * 100)}%` } })),
                h('span', { className: 'dso-barCount' }, String(row.count)),
              ),
            ),
          ),
        )
      }

      return h('div', { className: 'dso-root', style: readingStyle },
        h(StyleTag),
        topbar,
        error !== '' ? h('div', { className: 'dso-err' }, error) : null,
        askView,
        notesView,
        statsView,
        toast !== '' && tab !== 'notes' ? h('div', { className: 'dso-err', style: { color: 'var(--dsw-alias-state-success-primary)', background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent)' } }, toast) : null,
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
