/**
 * 学习空间 Client 半边：sidebar 面板图标 + main 面板页。
 * 数据来自 Host 的 /api/learning-space/overview。
 */
window.__ModuleLoader__.load({
  id: 'dsh-learn-space',
  factory(require) {
    const React = require('react')
    const { useEffect, useState, useCallback, useMemo, useRef } = React
    const h = React.createElement

    const STATUS_COLOR = {
      done: '#3E6B4F',
      doing: '#3D5A80',
      warn: '#B5432E',
      todo: '#9A968C',
    }
    const STATUS_LABEL = { done: '已确认', doing: '进行中', warn: '待修复', todo: '未学' }

    // ── 轻量 toast：模块级队列 + 右下角栈，不引第三方运行时 ──
    const toastStore = { items: [], listeners: new Set() }
    let toastSeq = 0
    const emitToasts = () => { for (const l of toastStore.listeners) l(toastStore.items) }
    const dismissToast = id => {
      const t = toastStore.items.find(x => x.id === id)
      if (!t || t.leaving) return
      toastStore.items = toastStore.items.map(x => x.id === id ? { ...x, leaving: true } : x)
      emitToasts()
      setTimeout(() => {
        toastStore.items = toastStore.items.filter(x => x.id !== id)
        emitToasts()
      }, 180)
    }
    const pushToast = (type, title, desc) => {
      const id = ++toastSeq
      toastStore.items = [...toastStore.items, { id, type, title, desc }].slice(-3)
      emitToasts()
      setTimeout(() => dismissToast(id), 3200)
      return id
    }
    const toast = {
      success: (title, desc) => pushToast('success', title, desc),
      error: (title, desc) => pushToast('error', title, desc),
      warning: (title, desc) => pushToast('warning', title, desc),
      info: (title, desc) => pushToast('info', title, desc),
      loading: (title, desc) => pushToast('loading', title, desc),
    }

    function ToastGlyph({ type }) {
      if (type === 'loading') {
        return h('svg', {
          className: 'ls-spin', viewBox: '0 0 24 24', width: 17, height: 17,
          fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round',
        },
          h('circle', { cx: 12, cy: 12, r: 8, strokeOpacity: .3 }),
          h('path', { d: 'M12 4a8 8 0 0 1 8 8' }))
      }
      const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }
      return h('svg', { viewBox: '0 0 24 24', width: 17, height: 17, ...stroke },
        type === 'success' ? h('path', { d: 'M6 12.5l4 4 8-9' })
        : type === 'error' ? h('path', { d: 'M7.5 7.5l9 9M16.5 7.5l-9 9' })
        : type === 'warning' ? h('path', { d: 'M12 6v6.5M12 16.8v.7' })
        : h('path', { d: 'M12 6.2v.7M12 10.5v7' }))
    }

    function ToastHost() {
      const [items, setItems] = useState(toastStore.items)
      useEffect(() => {
        const fn = list => setItems(list)
        toastStore.listeners.add(fn)
        return () => { toastStore.listeners.delete(fn) }
      }, [])
      return h('div', { className: 'ls-toasts', 'aria-live': 'polite' },
        items.map(t => h('div', { key: t.id, className: 'ls-toast' + (t.leaving ? ' leaving' : ''), 'data-type': t.type },
          h('span', { className: `ls-toast-tile ${t.type}` }, h(ToastGlyph, { type: t.type })),
          h('div', { className: 'ls-toast-body' },
            h('div', { className: 'ls-toast-title' }, t.title),
            t.desc ? h('div', { className: 'ls-toast-desc' }, t.desc) : null),
          h('button', { className: 'ls-toast-x', type: 'button', 'aria-label': '关闭', onClick: () => dismissToast(t.id) }, '×'))))
    }

    // ── AI 状态行：闪烁文字 + 图标动画 + 秒表（AiStatus 的移植版） ──
    const SPARKLE_PATH = 'M11 5Q12 12 19 13Q12 14 11 21Q10 14 3 13Q10 12 11 5Z'
    const TWINKLE_PATH = 'M18 2Q18.4 4.6 21 5Q18.4 5.4 18 8Q17.6 5.4 15 5Q17.6 4.6 18 2Z'

    function AiStatus({ state = 'thinking', label, detail, elapsed }) {
      const busy = state === 'thinking' || state === 'tool'
      const [secs, setSecs] = useState(0)
      useEffect(() => {
        if (!busy) return
        const start = Date.now()
        setSecs(0)
        const id = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000)
        return () => clearInterval(id)
      }, [busy])
      const time = elapsed != null ? elapsed : (busy ? secs : null)
      const icon = state === 'done'
        ? h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
            strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
            h('path', { className: 'ls-ai-check', d: 'M5 12.5L10 17.5L19 7' }))
        : state === 'tool'
          ? h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
              strokeWidth: 2.6, strokeLinecap: 'round' },
              [6, 12, 18].map(x => h('line', {
                key: x, className: 'ls-ai-bar', x1: x, y1: 18.5, x2: x, y2: 7.5,
                style: { transformBox: 'fill-box', transformOrigin: 'center' },
              })))
          : h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'currentColor' },
              h('path', { className: 'ls-ai-spark', d: SPARKLE_PATH }),
              h('path', { className: 'ls-ai-spark2', d: TWINKLE_PATH }))
      return h('div', { className: 'ls-aistatus' + (busy ? ' active' : ''), role: 'status', 'aria-busy': busy },
        h('span', { className: 'ls-aistatus-icon' + (state === 'done' ? ' ls-aistatus-done' : '') }, icon),
        h('span', { className: 'ls-aistatus-label' }, label || (busy ? '思考中' : '完成')),
        detail ? h('span', { className: 'ls-aistatus-detail' }, detail) : null,
        time != null && time > 0 ? h('span', { className: 'ls-aistatus-time' }, `${time}s`) : null)
    }

    // ── 课程剩余节点铃铛：数字徽标 + 换数时摆铃 + 点开列剩余节点 ──
    const BELL_BODY = 'M3.5 6.5C3.5 3.46279 5.96279 1 9 1C12.0372 1 14.5 3.46279 14.5 6.5V10.75C14.5 11.4408 15.0592 12 15.75 12C16.1642 12 16.5 12.3358 16.5 12.75C16.5 13.1642 16.1642 13.5 15.75 13.5H2.25C1.83579 13.5 1.5 13.1642 1.5 12.75C1.5 12.3358 1.83579 12 2.25 12C2.94079 12 3.5 11.4408 3.5 10.75V6.5Z'
    const BELL_CLAPPER = 'M10.2 15H7.80099C7.64999 15 7.50799 15.068 7.41299 15.185C7.31799 15.302 7.28099 15.456 7.31199 15.603C7.48499 16.425 8.17999 17 9.00099 17C9.82199 17 10.517 16.425 10.69 15.603C10.721 15.456 10.684 15.302 10.589 15.185C10.494 15.068 10.351 15 10.2 15Z'

    function NotificationBell({ nodes }) {
      const [open, setOpen] = useState(false)
      const [ring, setRing] = useState(0)
      const rootRef = useRef(null)
      const todo = nodes.filter(n => n.status === 'todo')
      const count = todo.length
      const prevRef = useRef(count)
      useEffect(() => {
        if (count !== prevRef.current) { prevRef.current = count; setRing(r => r + 1) }
      }, [count])
      useEffect(() => {
        if (!open) return
        const onDown = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
        const onKey = e => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('pointerdown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])
      return h('div', { className: 'ls-bell-wrap', ref: rootRef },
        h('button', {
          className: 'ls-bell' + (open ? ' open' : ''), type: 'button',
          'aria-expanded': open, 'aria-label': count ? `剩余 ${count} 个节点未学` : '所有节点已确认',
          title: count ? `剩余 ${count} 个节点未学` : '所有节点已确认',
          onClick: e => { e.stopPropagation(); setOpen(v => !v) },
        },
          h('svg', {
            key: ring, className: ring ? 'ls-bell-swing' : '', viewBox: '0 0 18 18',
            width: 17, height: 17, fill: 'currentColor', 'aria-hidden': true,
          },
            h('path', { fillOpacity: .55, d: BELL_BODY }),
            h('path', { d: BELL_CLAPPER })),
          count > 0 ? h('span', { className: 'ls-bell-badge' }, count > 99 ? '99+' : count) : null),
        open ? h('div', { className: 'ls-bell-pop', onClick: e => e.stopPropagation() },
          h('div', { className: 'ls-bell-pop-h' }, count ? `剩余 ${count} 个节点未学` : '所有节点已确认'),
          count ? h('div', { className: 'ls-bell-pop-list' }, todo.map(n =>
            h('div', { key: n.label, className: 'ls-bell-pop-item' },
              h('span', { className: 'ls-dot', style: { background: STATUS_COLOR.todo, flex: 'none' } }),
              cleanLabel(n.label)))) : null) : null)
    }

    // ── 模型选择：按 provider 分组的搜索式下拉（ModelPicker 的移植版） ──
    function ModelPicker({ models, value, onChange, disabled, placeholder }) {
      const [open, setOpen] = useState(false)
      const [q, setQ] = useState('')
      const [active, setActive] = useState(0)
      const [dropUp, setDropUp] = useState(false)
      const rootRef = useRef(null)
      const triggerRef = useRef(null)
      const inputRef = useRef(null)
      const listRef = useRef(null)
      const selected = models.find(m => m.provider === value.provider && m.modelId === value.model)
      const filtered = useMemo(() => {
        const s = q.trim().toLowerCase()
        return s ? models.filter(m => `${m.name} ${m.providerName}`.toLowerCase().includes(s)) : models
      }, [models, q])
      const sections = []
      filtered.forEach((m, i) => {
        const last = sections[sections.length - 1]
        if (last && last.name === m.providerName) last.items.push({ m, i })
        else sections.push({ name: m.providerName, items: [{ m, i }] })
      })

      useEffect(() => { if (disabled) setOpen(false) }, [disabled])
      useEffect(() => {
        if (!open) { setQ(''); return }
        const rect = triggerRef.current && triggerRef.current.getBoundingClientRect()
        setDropUp(!!rect && rect.bottom + 300 > window.innerHeight && rect.top > 300)
        setActive(Math.max(0, models.findIndex(m => m.provider === value.provider && m.modelId === value.model)))
        if (inputRef.current) inputRef.current.focus()
      }, [open])
      useEffect(() => {
        if (!open) return
        const onDown = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
        document.addEventListener('pointerdown', onDown)
        return () => document.removeEventListener('pointerdown', onDown)
      }, [open])
      useEffect(() => {
        if (!open || !listRef.current) return
        const row = listRef.current.querySelector(`[data-i="${active}"]`)
        if (row) row.scrollIntoView({ block: 'nearest' })
      }, [active, open])

      const pick = m => {
        onChange({ provider: m.provider, model: m.modelId })
        setOpen(false)
      }
      const onKey = e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % Math.max(1, filtered.length)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + filtered.length) % Math.max(1, filtered.length)) }
        else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) pick(filtered[active]) }
        else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
      }
      return h('div', { className: 'ls-mp' + (open ? ' open' : ''), ref: rootRef },
        h('button', {
          className: 'ls-mp-trigger', type: 'button', disabled, ref: triggerRef,
          'aria-haspopup': 'listbox', 'aria-expanded': open,
          onClick: () => setOpen(v => !v),
          onKeyDown: e => { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); if (!disabled) setOpen(true) } },
        },
          h('span', { className: 'ls-mp-icon' }, (selected ? selected.providerName : '?').slice(0, 1)),
          h('span', { className: 'ls-mp-name' }, selected ? selected.name : (placeholder || '选择模型')),
          h('svg', { className: 'ls-mp-chev', viewBox: '0 0 12 12', width: 12, height: 12,
            fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 },
            h('path', { d: 'M3 4.5L6 7.5L9 4.5', strokeLinecap: 'round', strokeLinejoin: 'round' }))),
        open ? h('div', { className: 'ls-mp-panel' + (dropUp ? ' up' : ''), onKeyDown: onKey },
          h('div', { className: 'ls-mp-search' },
            h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 },
              h('circle', { cx: 7, cy: 7, r: 4.5 }), h('path', { d: 'M10.5 10.5L14 14', strokeLinecap: 'round' })),
            h('input', {
              ref: inputRef, value: q, placeholder: '搜索模型', 'aria-label': '搜索模型',
              onChange: e => { setQ(e.target.value); setActive(0) },
            })),
          h('div', { className: 'ls-mp-list', role: 'listbox', ref: listRef },
            sections.length ? sections.map(s => h('div', { key: s.name, role: 'group' },
              h('div', { className: 'ls-mp-group' }, s.name),
              s.items.map(({ m, i }) => {
                const sel = m.provider === value.provider && m.modelId === value.model
                return h('div', {
                  key: `${m.provider}-${m.modelId}`, role: 'option', 'aria-selected': sel,
                  'data-i': i, className: 'ls-mp-item' + (i === active ? ' active' : ''),
                  onMouseEnter: () => setActive(i),
                  onMouseDown: e => e.preventDefault(),
                  onClick: () => pick(m),
                },
                  h('span', { className: 'ls-mp-icon' }, m.providerName.slice(0, 1)),
                  h('span', { className: 'ls-mp-item-name' }, m.name),
                  sel ? h('svg', { className: 'ls-check', viewBox: '0 0 16 16', width: 13, height: 13,
                    fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                    h('path', { d: 'M3 8.5l3.2 3.2L13 4.5' })) : null)
              }))) : h('div', { className: 'ls-mp-empty' }, '没有匹配的模型'))) : null)
    }

    function PanelIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 22, height: 22, 'aria-hidden': true },
        h('path', {
          d: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v16.5a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 0 4 22z',
          fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6',
        }),
        h('path', {
          d: 'M8 7h8M8 11h8M8 15h5',
          fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round',
        }))
    }

    const css = `
.ls-panel { padding: 20px 24px; overflow-y: auto; height: 100%;
  color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.7; }
.ls-title { font-size: 20px; font-weight: 700; letter-spacing: 1px; margin: 0 0 2px; }
.ls-sub { color: var(--dsw-alias-label-secondary); font-size: 13px; margin-bottom: 20px; }
.ls-section { margin-bottom: 24px; }
.ls-h { font-size: 13px; letter-spacing: 2px; color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border-l1); padding-bottom: 6px; margin-bottom: 10px; }
.ls-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; cursor: pointer; }
.ls-card:hover { border-color: var(--dsw-alias-border-l2); }
.ls-card.open { border-color: var(--dsw-alias-brand-primary); }
.ls-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.ls-name { font-size: 15px; font-weight: 600; }
.ls-frac { font-size: 13px; color: var(--dsw-alias-label-secondary); flex: none; }
.ls-goal { font-size: 13px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.ls-bar { height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l1); margin-top: 10px; overflow: hidden; }
.ls-bar-fill { height: 100%; background: var(--dsw-alias-state-success-primary); }
.ls-badges { display: flex; gap: 12px; margin-top: 8px; font-size: 12px;
  color: var(--dsw-alias-label-secondary); }
.ls-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
.ls-nodes { list-style: none; margin: 10px 0 0; padding: 0; }
.ls-node { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 13px; }
.ls-journal-item { padding: 3px 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.ls-btn { font-family: inherit; font-size: 12px; padding: 3px 12px; cursor: pointer;
  background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground, #fff);
  border: none; border-radius: 4px; flex: none; }
.ls-btn:disabled { opacity: .5; cursor: default; }
.ls-new { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.ls-input { flex: 1; min-width: 120px; font-family: inherit; font-size: 13px; color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 4px; padding: 6px 10px; }
.ls-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.ls-empty { color: var(--dsw-alias-label-secondary); font-size: 13px; padding: 8px 0; }
.ls-dag-wrap { margin-top: 12px; overflow-x: auto; }
.ls-dag text { font-size: 11px; fill: var(--dsw-alias-label-primary); }
.ls-mermaid-wrap { margin-top: 12px; overflow-x: auto; }
.ls-mermaid-wrap svg { max-width: none; }
.ls-mermaid-err { font-size: 12px; color: var(--dsw-alias-state-danger-primary, #B5432E);
  padding: 4px 0; }
.ls-mermaid-src { margin: 6px 0; padding: 8px 10px; background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; overflow-x: auto; }
.ls-mermaid-src code { font-family: Consolas, monospace; font-size: 12px; white-space: pre; }
.ls-side-head { display: flex; align-items: baseline; justify-content: space-between; }
.ls-loading { color: var(--dsw-alias-label-secondary); padding: 32px 0; text-align: center; }
.ls-chat { margin-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 10px; }
.ls-chat-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.ls-chat-title { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ls-chat-list { max-height: 320px; overflow-y: auto; padding: 4px 2px; display: flex; flex-direction: column; gap: 8px; }
.ls-msg { max-width: 88%; border-radius: 8px; padding: 6px 10px; font-size: 13px; }
.ls-msg-user { align-self: flex-end; background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground, #fff); }
.ls-msg-assistant { align-self: flex-start; background: var(--dsw-alias-bg-layer-2);
  animation: ls-soft-in .24s ease-out; }
.ls-msg-user .ls-md-code { background: rgba(255,255,255,.25); }
.ls-md-p { margin: 2px 0; white-space: pre-wrap; word-break: break-word; }
.ls-md-h { font-size: 13px; font-weight: 700; margin: 6px 0 2px; }
.ls-md-ul { margin: 2px 0; padding-left: 18px; }
.ls-md-code { font-family: inherit; background: var(--dsw-alias-bg-layer-1); border-radius: 3px; padding: 0 4px; }
.ls-md-pre { margin: 4px 0; padding: 8px 10px; background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; overflow-x: auto; }
.ls-md-pre code { font-family: Consolas, monospace; font-size: 12px; white-space: pre; }
.ls-math { white-space: normal; }
.ls-math-block { display: block; margin: 6px 0; padding: 2px 0; overflow-x: auto; overflow-y: hidden; text-align: center; }
.ls-math-block .katex-display { margin: 0; }
.ls-math-fallback { font-family: Consolas, monospace; font-size: 12px; white-space: pre-wrap;
  color: var(--dsw-alias-state-warning-primary, #b7791f); }
.ls-tool { align-self: flex-start; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ls-chat-err { font-size: 12px; color: var(--dsw-alias-state-danger-primary, #B5432E); padding: 4px 0; }
.ls-chat-row { display: flex; gap: 8px; margin-top: 8px; align-items: flex-end; }
.ls-chat-input { flex: 1; resize: vertical; min-height: 34px; max-height: 120px; }
.ls-chat-more { font-size: 12px; color: var(--dsw-alias-label-secondary); align-self: center; }
.ls-ask { align-self: stretch; border: 1px solid var(--dsw-alias-brand-primary); border-radius: 8px;
  padding: 10px 12px; background: var(--dsw-alias-bg-layer-2); }
.ls-ask-badge { font-size: 12px; font-weight: 700; color: var(--dsw-alias-brand-primary); margin-bottom: 6px; }
.ls-ask-q { margin-bottom: 8px; }
.ls-ask-h { font-size: 12px; color: var(--dsw-alias-label-secondary); letter-spacing: 1px; }
.ls-ask-text { font-size: 13px; font-weight: 600; margin: 2px 0 4px; }
.ls-ask-opts { display: flex; flex-direction: column; gap: 3px; }
.ls-ask-opt { font-size: 12px; padding: 3px 8px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 5px; }
.ls-ask-opt-label { font-weight: 600; margin-right: 6px; }
.ls-ask-opt-desc { color: var(--dsw-alias-label-secondary); }
.ls-ask-go { margin-top: 4px; }
.ls-layout { display: grid; grid-template-columns: 260px 1fr; gap: 16px; min-height: 0; align-items: start; }
.ls-side { position: sticky; top: 0; }
.ls-side-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.ls-side-item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 6px;
  cursor: pointer; font-size: 13px; border-left: 3px solid transparent; word-break: break-all; }
.ls-side-item:hover { background: var(--dsw-alias-bg-layer-1); }
.ls-side-item.active { background: var(--dsw-alias-bg-layer-2); border-left-color: var(--dsw-alias-brand-primary); }
.ls-side-del { flex: none; border: none; background: none; color: var(--dsw-alias-label-secondary);
  cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 4px; border-radius: 4px; visibility: hidden; }
.ls-side-item:hover .ls-side-del { visibility: visible; }
.ls-side-del:hover { color: #B5432E; background: var(--dsw-alias-bg-layer-2); }
.ls-modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 100;
  display: flex; align-items: center; justify-content: center; }
.ls-modal { width: 360px; max-width: 90vw; background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 18px 20px; }
.ls-modal-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
.ls-modal-body { font-size: 13px; color: var(--dsw-alias-label-secondary); line-height: 1.7; margin-bottom: 14px; }
.ls-modal-body strong { color: var(--dsw-alias-state-danger-primary, #B5432E); }
.ls-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.ls-btn-danger { background: #B5432E; color: #fff; }
.ls-title-row { display: flex; align-items: center; gap: 10px; }
.ls-title-row .ls-title { margin: 0 0 2px; }
.ls-gear { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary); border-radius: 6px; cursor: pointer;
  font-size: 14px; line-height: 1; padding: 5px 8px; flex: none; }
.ls-gear:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.ls-select { width: 100%; font-family: inherit; font-size: 13px; color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 4px; padding: 6px 8px; margin-top: 4px; }
.ls-select:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.ls-select:disabled { opacity: .5; }
.ls-set-label { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 10px; display: block; }
.ls-set-check { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 13px; }
.ls-set-note { font-size: 12px; color: var(--dsw-alias-label-secondary); margin: 8px 0 0; }
.ls-set-warn { font-size: 12px; color: var(--dsw-alias-state-danger-primary, #B5432E); margin: 8px 0 0; }
.ls-set-ok { font-size: 12px; color: var(--dsw-alias-state-success-primary); margin: 8px 0 0; }
.ls-focus { display: grid; grid-template-columns: minmax(280px, 5fr) 7fr; gap: 16px; height: calc(100vh - 140px); }
.ls-focus-left { overflow-y: auto; padding-right: 4px; }
.ls-focus-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.ls-focus-title { font-size: 17px; font-weight: 700; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ls-focus-right { display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 12px 14px; background: var(--dsw-alias-bg-layer-1); }
.ls-focus-right .ls-chat { margin-top: 0; border-top: none; padding-top: 0; flex: 1; display: flex; flex-direction: column; min-height: 0; }
.ls-focus-right .ls-chat-list { flex: 1; max-height: none; min-height: 200px; }
@media (max-width: 900px) { .ls-focus { grid-template-columns: 1fr; height: auto; } .ls-focus-left { max-height: 40vh; } }
.ls-side-name { flex: 1; min-width: 0; }
.ls-side-frac { font-size: 12px; color: var(--dsw-alias-label-secondary); flex: none; }
.ls-detail { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px; padding: 16px 18px; min-width: 0; }
.ls-detail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
.ls-mat-item { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 4px 0; font-size: 13px; word-break: break-all; }
.ls-mat-size { color: var(--dsw-alias-label-secondary); font-size: 12px; flex: none; }
.ls-upload-bar { height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l1); margin: 8px 0 4px; overflow: hidden; }
.ls-upload-fill { height: 100%; background: var(--dsw-alias-brand-primary); transition: width .15s; }
.ls-upload-err { font-size: 12px; color: var(--dsw-alias-state-danger-primary, #B5432E); padding: 4px 0; }
.ls-file-label { display: inline-flex; align-items: center; gap: 6px; }
/* 自绘悬停气泡：原生 title 在面板环境不浮现，改用 data-tip + ::after */
.ls-tip { position: relative; }
.ls-tip::after { content: attr(data-tip); position: absolute; right: 0; top: calc(100% + 6px); z-index: 40;
  width: max-content; max-width: 220px; padding: 5px 8px; border-radius: 6px; text-align: left;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); font-size: 11px; font-weight: 400; line-height: 1.5;
  white-space: normal; opacity: 0; pointer-events: none; transition: opacity .12s ease-out; }
.ls-tip:hover::after, .ls-tip:focus-visible::after { opacity: 1; transition-delay: .3s; }
.ls-tip-left::after { right: auto; left: 0; }
.ls-picked { margin-top: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ls-picked-item { display: flex; align-items: center; gap: 6px; padding: 1px 0; word-break: break-all; }
.ls-picked-x { cursor: pointer; border: none; background: none; color: var(--dsw-alias-label-secondary);
  font-size: 13px; padding: 0 2px; flex: none; }
.ls-picked-x:hover { color: var(--dsw-alias-state-danger-primary, #B5432E); }
.ls-rebind { margin-top: 6px; }
.ls-ws { display: inline-flex; align-items: center; gap: 6px; font-size: 13px;
  color: var(--dsw-alias-label-secondary); cursor: pointer; }
.ls-quiz { align-self: stretch; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  padding: 10px 12px; background: var(--dsw-alias-bg-layer-2); }
.ls-quiz-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.ls-quiz-no { font-size: 12px; font-weight: 700; color: var(--dsw-alias-brand-primary); }
.ls-quiz-node { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ls-quiz-badge { font-size: 12px; font-weight: 600; margin-left: auto; }
.ls-quiz-badge.ok { color: var(--dsw-alias-state-success-primary); }
.ls-quiz-badge.bad { color: var(--dsw-alias-state-danger-primary, #B5432E); }
.ls-quiz-badge.wait { color: var(--dsw-alias-label-secondary); }
.ls-quiz-stem { font-size: 13px; margin-bottom: 8px; }
.ls-quiz-opts { display: flex; flex-direction: column; gap: 4px; }
.ls-quiz-opt { display: flex; gap: 8px; align-items: baseline; text-align: left; font-family: inherit;
  font-size: 13px; padding: 5px 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 5px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; }
.ls-quiz-opt:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); }
.ls-quiz-opt:disabled { cursor: default; opacity: .8; }
.ls-quiz-opt.chosen { border-style: solid; border-color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-layer-1)); }
.ls-quiz-opt-key { font-weight: 700; flex: none; }
.ls-qh-list { display: flex; flex-direction: column; gap: 2px; }
.ls-qh-item { border-left: 2px solid var(--dsw-alias-border-l1); padding: 4px 8px; cursor: pointer;
  font-size: 13px; }
.ls-qh-item:hover { background: var(--dsw-alias-bg-layer-1); }
.ls-qh-row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.ls-qh-date { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.ls-qh-frac { font-size: 12px; }
.ls-qh-node { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ls-qh-ans { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ls-qh-detail { margin-top: 4px; padding: 6px 10px; background: var(--dsw-alias-bg-layer-1);
  border-radius: 6px; font-size: 12px; }
.ls-qh-line { padding: 2px 0; word-break: break-word; }
@media (max-width: 720px) {
  .ls-layout { grid-template-columns: 1fr; }
  .ls-side { position: static; }
}

/* ── AI 状态行（AiStatus） ───────────────────────── */
.ls-aistatus { display: inline-flex; align-items: center; gap: 7px; align-self: flex-start;
  height: 24px; font-size: 12px; color: var(--dsw-alias-label-secondary);
  animation: ls-soft-in .24s ease-out; }
.ls-aistatus-icon { display: inline-grid; place-items: center; width: 16px; height: 16px; flex: none; }
.ls-aistatus-label { font-weight: 600; letter-spacing: .2px; }
.ls-aistatus.active .ls-aistatus-label {
  background-image: linear-gradient(90deg,
    var(--dsw-alias-label-secondary) 42%,
    var(--dsw-alias-label-primary) 50%,
    var(--dsw-alias-label-secondary) 58%);
  background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: ls-shimmer 1.6s linear infinite; }
.ls-aistatus-detail, .ls-aistatus-time { color: var(--dsw-alias-label-secondary); opacity: .72; font-weight: 500; }
.ls-aistatus-time { font-variant-numeric: tabular-nums; }
.ls-aistatus-done { color: var(--dsw-alias-state-success-primary); }
.ls-ai-spark { transform-origin: 11px 13px; animation: ls-spark 2.4s ease-in-out infinite; }
.ls-ai-spark2 { transform-origin: 18px 5px; animation: ls-spark2 1.2s ease-in-out infinite; }
.ls-ai-bar { animation: ls-bar .9s ease-in-out infinite; }
.ls-ai-bar:nth-child(2) { animation-delay: .15s; }
.ls-ai-bar:nth-child(3) { animation-delay: .3s; }
.ls-ai-check { stroke-dasharray: 22; stroke-dashoffset: 22; animation: ls-draw .45s ease-out .05s forwards; }
@keyframes ls-shimmer { from { background-position: 100% 0; } to { background-position: 0% 0; } }
@keyframes ls-soft-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes ls-spark { 0%, 100% { transform: rotate(0) scale(1); } 50% { transform: rotate(90deg) scale(.82); } }
@keyframes ls-spark2 { 0%, 100% { transform: scale(.5); opacity: .35; } 50% { transform: scale(1); opacity: 1; } }
@keyframes ls-bar { 0%, 100% { transform: scaleY(.35); } 50% { transform: scaleY(1); } }
@keyframes ls-draw { to { stroke-dashoffset: 0; } }

/* ── 剩余节点铃铛（NotificationBell） ─────────────── */
.ls-bell-wrap { position: relative; flex: none; }
.ls-bell { position: relative; display: grid; place-items: center; width: 30px; height: 30px;
  padding: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 50%;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); cursor: pointer;
  transition: border-color .15s, color .15s, transform .08s; }
.ls-bell:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.ls-bell:active { transform: scale(.94); }
.ls-bell.open { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.ls-bell-badge { position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: #B5432E; color: #fff; font-size: 10px; font-weight: 700;
  line-height: 1; display: grid; place-items: center; animation: ls-badge-pop .3s ease-out; }
.ls-bell-swing { animation: ls-bell-ring .9s ease-in-out; transform-origin: 50% 12%; }
.ls-bell-pop { position: absolute; top: calc(100% + 8px); right: 0; width: 240px; z-index: 80;
  padding: 10px 12px; background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.16); transform-origin: top right;
  animation: ls-pop-in .22s cubic-bezier(.2,.85,.25,1); }
.ls-bell-pop-h { font-size: 12px; font-weight: 600; margin-bottom: 6px; }
.ls-bell-pop-list { display: flex; flex-direction: column; gap: 1px; max-height: 220px; overflow-y: auto; }
.ls-bell-pop-item { display: flex; align-items: center; gap: 7px; padding: 3px 0;
  font-size: 12px; color: var(--dsw-alias-label-secondary); }
@keyframes ls-bell-ring {
  0% { transform: rotate(0); } 15% { transform: rotate(14deg); } 30% { transform: rotate(-12deg); }
  45% { transform: rotate(9deg); } 60% { transform: rotate(-6deg); } 80% { transform: rotate(3deg); }
  100% { transform: rotate(0); } }
@keyframes ls-badge-pop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.15); } 100% { transform: scale(1); opacity: 1; } }
@keyframes ls-pop-in { from { opacity: 0; transform: translateY(-4px) scale(.97); } to { opacity: 1; transform: none; } }

/* ── 模型选择（ModelPicker） ─────────────────────── */
.ls-mp { position: relative; }
.ls-mp-trigger { display: flex; align-items: center; gap: 8px; width: 100%; height: 34px;
  padding: 0 12px 0 8px; font-family: inherit; font-size: 13px; text-align: left;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 17px; cursor: pointer;
  transition: border-color .15s; }
.ls-mp-trigger:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
.ls-mp-trigger:disabled { opacity: .5; cursor: default; }
.ls-mp.open .ls-mp-trigger { border-color: var(--dsw-alias-brand-primary); }
.ls-mp-icon { display: grid; place-items: center; width: 20px; height: 20px; flex: none;
  border-radius: 6px; background: var(--dsw-alias-bg-layer-2); text-transform: uppercase;
  font-size: 10px; font-weight: 700; color: var(--dsw-alias-label-secondary); }
.ls-mp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ls-mp-chev { flex: none; transition: transform .18s; }
.ls-mp.open .ls-mp-chev { transform: rotate(180deg); }
.ls-mp-panel { position: absolute; top: calc(100% + 6px); left: 0; width: 100%; min-width: 268px;
  z-index: 90; overflow: hidden; background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  box-shadow: 0 12px 36px rgba(0,0,0,.18);
  animation: ls-pop-in .22s cubic-bezier(.2,.85,.25,1); }
.ls-mp-panel.up { top: auto; bottom: calc(100% + 6px); transform-origin: bottom left; }
.ls-mp-search { display: flex; align-items: center; gap: 7px; height: 38px; padding: 0 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.ls-mp-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); }
.ls-mp-list { max-height: 248px; overflow-y: auto; padding: 6px; }
.ls-mp-group { padding: 6px 8px 3px; font-size: 11px; letter-spacing: .5px;
  color: var(--dsw-alias-label-secondary); }
.ls-mp-item { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 8px;
  border-radius: 8px; font-size: 13px; color: var(--dsw-alias-label-primary); cursor: pointer; }
.ls-mp-item.active { background: var(--dsw-alias-bg-layer-2); }
.ls-mp-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ls-mp-item .ls-check { color: var(--dsw-alias-brand-primary); flex: none; }
.ls-mp-empty { padding: 14px 8px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-secondary); }

/* ── Toast ──────────────────────────────────────── */
.ls-toasts { position: fixed; right: 18px; bottom: 18px; z-index: 240; display: flex;
  flex-direction: column-reverse; gap: 10px; width: 304px; max-width: calc(100vw - 36px);
  pointer-events: none; }
.ls-toast { pointer-events: auto; display: flex; align-items: center; gap: 10px; padding: 10px;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px; box-shadow: 0 6px 24px rgba(0,0,0,.14);
  animation: ls-toast-in .3s cubic-bezier(.2,.85,.25,1); }
.ls-toast.leaving { animation: ls-toast-out .18s ease-in forwards; }
.ls-toast-tile { display: grid; place-items: center; width: 34px; height: 34px; flex: none;
  border-radius: 11px; color: #fff; }
.ls-toast-tile.success { background: var(--dsw-alias-state-success-primary); }
.ls-toast-tile.error { background: var(--dsw-alias-state-danger-primary, #B5432E); }
.ls-toast-tile.warning { background: var(--dsw-alias-state-warning-primary, #B7791F); }
.ls-toast-tile.info { background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground, #fff); }
.ls-toast-tile.loading { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.ls-toast-body { flex: 1; min-width: 0; }
.ls-toast-title { font-size: 13px; font-weight: 600; line-height: 1.35; }
.ls-toast-desc { margin-top: 1px; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-secondary); word-break: break-word; }
.ls-toast-x { flex: none; border: none; background: none; padding: 2px 4px; cursor: pointer;
  font-size: 14px; line-height: 1; color: var(--dsw-alias-label-secondary); }
.ls-toast-x:hover { color: var(--dsw-alias-label-primary); }
.ls-spin { animation: ls-spin .9s linear infinite; }
@keyframes ls-spin { to { transform: rotate(360deg); } }
@keyframes ls-toast-in { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes ls-toast-out { to { opacity: 0; transform: translateX(8px) scale(.97); } }

/* 按钮反馈 */
.ls-btn { transition: background-color .15s, border-color .15s, transform .08s; }
.ls-btn:active:not(:disabled) { transform: translateY(1px) scale(.99); }
.ls-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }

@media (prefers-reduced-motion: reduce) {
  .ls-aistatus, .ls-aistatus-label, .ls-ai-spark, .ls-ai-spark2, .ls-ai-bar, .ls-ai-check,
  .ls-toast, .ls-bell-swing, .ls-bell-badge, .ls-bell-pop, .ls-mp-panel, .ls-spin {
    animation: none !important; }
}
`

    /** 极简 DAG 分层布局：roots 在底，目标在顶 */
    function Dag({ nodes, edges }) {
      if (!nodes.length) return null
      const level = new Map()
      const nexts = new Map(nodes.map(n => [n.id, []]))
      for (const [a, b] of edges) if (nexts.has(a)) nexts.get(a).push(b)
      const depth = id => {
        if (level.has(id)) return level.get(id)
        level.set(id, 0)
        let d = 0
        for (const nx of nexts.get(id) || []) d = Math.max(d, depth(nx) + 1)
        level.set(id, d)
        return d
      }
      nodes.forEach(n => depth(n.id))
      const maxLevel = Math.max(...level.values())
      const byLevel = new Map()
      for (const n of nodes) {
        const l = maxLevel - level.get(n.id) // roots (level0) 放最底一行
        if (!byLevel.has(l)) byLevel.set(l, [])
        byLevel.get(l).push(n)
      }
      const rowH = 46, colW = 150, nodeW = 118, nodeH = 30
      const pos = new Map()
      for (const [l, list] of byLevel) {
        list.forEach((n, i) => pos.set(n.id, { x: colW / 2 + i * colW + l * 18, y: 24 + l * rowH, n }))
      }
      const width = Math.max(...[...pos.values()].map(p => p.x)) + 80
      const height = 24 + (byLevel.size) * rowH
      const key = n => (n.id === n.label ? n.id : `${n.id}`)
      return h('svg', { className: 'ls-dag', width, height, viewBox: `0 0 ${width} ${height}` },
        edges.map(([a, b], i) => {
          const pa = pos.get(a), pb = pos.get(b)
          if (!pa || !pb) return null
          const x1 = pa.x + nodeW / 2, y1 = pa.y + nodeH / 2, x2 = pb.x + nodeW / 2, y2 = pb.y + nodeH / 2
          return h('line', { key: `e${i}`, x1, y1, x2, y2, stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1 })
        }),
        [...pos.values()].map(({ x, y, n }) => h('g', { key: n.id },
          h('rect', {
            x: x - nodeW / 2, y, width: nodeW, height: nodeH, rx: 5,
            fill: n.status === 'todo' ? 'var(--dsw-alias-bg-layer-2)' : STATUS_COLOR[n.status],
            stroke: n.status === 'todo' ? STATUS_COLOR.todo : 'none',
            strokeDasharray: n.status === 'todo' ? '3 3' : undefined,
          }),
          h('text', {
            x, y: y + nodeH / 2 + 4, textAnchor: 'middle',
            fill: n.status === 'todo' ? 'currentColor' : '#FAF7F0',
            style: { fill: n.status === 'todo' ? undefined : '#FAF7F0' },
          }, n.label.length > 8 ? n.label.slice(0, 7) + '…' : n.label),
        )),
      )
    }

    /** mermaid UMD 模块级 Promise 单例：动态注入 script，失败记 mermaidFailed 不再重试 */
    let mermaidPromise = null
    let mermaidFailed = false
    function loadMermaid() {
      if (mermaidFailed) return Promise.reject(new Error('mermaid asset failed'))
      if (!mermaidPromise) {
        mermaidPromise = new Promise((resolve, reject) => {
          const s = document.createElement('script')
          s.src = '/api/learning-space/assets/mermaid.min.js'
          s.onload = () => {
            try {
              window.mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' })
              resolve(window.mermaid)
            } catch (e) { mermaidFailed = true; reject(e) }
          }
          s.onerror = () => { mermaidFailed = true; mermaidPromise = null; reject(new Error('mermaid 资产加载失败')) }
          document.head.appendChild(s)
        })
      }
      return mermaidPromise
    }

    /**
     * 完整 mermaid 渲染：render 成功挂 SVG；失败（语法错/资产 404）提示 + 源码 + 旧 Dag 兜底。
     * planMermaid 字符串未变时跳过重渲染（render 是秒级全量 SVG 重排，不能 15s 轮询盲跑）。
     */
    function MermaidGraph({ src, nodes, edges }) {
      const wrapRef = useRef(null)
      const lastSrcRef = useRef(null)
      const [err, setErr] = useState(null)
      useEffect(() => {
        const el = wrapRef.current
        if (!el) return
        if (!src) { el.innerHTML = ''; lastSrcRef.current = null; setErr(null); return }
        if (lastSrcRef.current === src && !err) return   // 轮询未变化：跳过
        let alive = true
        loadMermaid().then(m => {
          if (!alive || !wrapRef.current) return
          return m.render(`ls-mermaid-${Date.now()}`, src).then(({ svg }) => {
            if (!alive) return
            el.innerHTML = svg
            lastSrcRef.current = src
            setErr(null)
          })
        }).catch(e => {
          if (!alive) return
          el.innerHTML = ''
          lastSrcRef.current = null
          setErr(String((e && e.message) || e))
        })
        return () => { alive = false }
      }, [src])
      return h('div', { className: 'ls-dag-wrap' },
        err ? h('div', { className: 'ls-mermaid-err' }, `mermaid 渲染失败（${err}），已降级显示源码与简图`) : null,
        err ? h('pre', { className: 'ls-mermaid-src' }, h('code', null, src)) : null,
        h('div', { className: 'ls-mermaid-wrap', ref: wrapRef }),
        err ? h('div', { className: 'ls-dag-wrap' }, h(Dag, { nodes, edges })) : null,
      )
    }

    /** KaTeX 模块级 Promise 单例：注入样式表 + UMD，失败记 katexFailed 不再重试 */
    let katexPromise = null
    let katexFailed = false
    function loadKatex() {
      if (katexFailed) return Promise.reject(new Error('katex asset failed'))
      if (!katexPromise) {
        katexPromise = new Promise((resolve, reject) => {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = '/api/learning-space/assets/katex/katex.min.css'
          document.head.appendChild(link)
          const s = document.createElement('script')
          s.src = '/api/learning-space/assets/katex/katex.min.js'
          s.onload = () => {
            if (window.katex) resolve(window.katex)
            else { katexFailed = true; katexPromise = null; reject(new Error('katex 未挂载')) }
          }
          s.onerror = () => { katexFailed = true; katexPromise = null; reject(new Error('katex 资产加载失败')) }
          document.head.appendChild(s)
        })
      }
      return katexPromise
    }

    /** LaTeX 公式：katex.render 写进 ref 元素（不拼用户文本进 innerHTML），失败降级显示原始 TeX */
    function MathNode({ tex, block }) {
      const ref = useRef(null)
      const [failed, setFailed] = useState(false)
      useEffect(() => {
        let alive = true
        loadKatex().then(k => {
          if (!alive || !ref.current) return
          k.render(tex, ref.current, { displayMode: !!block, throwOnError: false, strict: false })
        }).catch(() => { if (alive) setFailed(true) })
        return () => { alive = false }
      }, [tex, block])
      if (failed) return h('code', { className: 'ls-math-fallback' }, block ? `$$${tex}$$` : `$${tex}$`)
      return h(block ? 'div' : 'span', { className: block ? 'ls-math ls-math-block' : 'ls-math', ref })
    }

    /** 行内 markdown：**加粗**、`行内码`、$$…$$ / $…$ / \(…\) 公式，其余按原文本 */
    function inlineNodes(text, keyBase) {
      const src = String(text == null ? '' : text)
      const out = []
      const re = /(\*\*[^*]+\*\*|`[^`]+`|\$\$[^$\n]+?\$\$|(?<!\\)\$(?![\s$])[^$\n]+?(?<![\s\\])\$(?!\d)|\\\((?:[^\\\n]|\\.)+?\\\)|\\\[(?:[^\\\n]|\\.)+?\\\])/g
      let last = 0, m, i = 0
      while ((m = re.exec(src))) {
        if (m.index > last) out.push(src.slice(last, m.index))
        const t = m[0]
        if (t.startsWith('**')) out.push(h('strong', { key: `${keyBase}b${i}` }, t.slice(2, -2)))
        else if (t.startsWith('`')) out.push(h('code', { key: `${keyBase}c${i}`, className: 'ls-md-code' }, t.slice(1, -1)))
        else if (t.startsWith('$$')) out.push(h(MathNode, { key: `${keyBase}m${i}`, tex: t.slice(2, -2), block: false }))
        else if (t.startsWith('$')) out.push(h(MathNode, { key: `${keyBase}m${i}`, tex: t.slice(1, -1), block: false }))
        else out.push(h(MathNode, { key: `${keyBase}m${i}`, tex: t.slice(2, -2), block: false }))
        last = m.index + t.length
        i++
      }
      if (last < src.length) out.push(src.slice(last))
      return out
    }

    /** 极简 markdown → React 元素数组（代码块/块级公式/标题/列表/加粗/行内码/行内公式），无法识别的行原样输出 */
    function markdownLite(text) {
      const lines = String(text || '').split(/\r?\n/)
      const els = []
      let code = null
      let list = null
      let math = null
      let mathClose = null
      let k = 0
      const flushCode = () => {
        if (code) { els.push(h('pre', { key: `pre${k++}`, className: 'ls-md-pre' }, h('code', null, code.join('\n')))); code = null }
      }
      const flushList = () => {
        if (list && list.length) { els.push(h('ul', { key: `ul${k++}`, className: 'ls-md-ul' }, list.map((li, i) => h('li', { key: i }, li)))); list = null }
      }
      const flushMath = () => {
        if (!math) return
        const tex = math.join('\n').trim()
        math = null; mathClose = null
        if (tex) els.push(h(MathNode, { key: `m${k++}`, tex, block: true }))
      }
      const pushMath = (tex) => { els.push(h(MathNode, { key: `m${k++}`, tex, block: true })) }
      for (const line of lines) {
        if (/^\s*```/.test(line)) {
          if (code) flushCode()
          else { flushList(); code = [] }
          continue
        }
        if (code) { code.push(line); continue }
        if (math) {
          const closeAt = line.search(mathClose)
          if (closeAt >= 0) {
            const before = line.slice(0, closeAt)
            if (before.trim()) math.push(before)
            flushMath()
          } else math.push(line)
          continue
        }
        // 块级公式：$$…$$ 或 \[…\]，同行闭合且后面没正文才当块，否则交给行内处理（免得吞掉尾部文字）
        const openAt = /^\s*(?:\$\$|\\\[)/.test(line) ? (/^\s*\$\$/.test(line) ? line.indexOf('$$') : line.indexOf('\\[')) : -1
        if (openAt >= 0) {
          const dollar = line[openAt] === '$'
          const body = line.slice(openAt + 2)
          const closeRe = dollar ? /\$\$/ : /\\\]/
          const closeAt = body.search(closeRe)
          const after = closeAt >= 0 ? body.slice(closeAt + 2) : ''
          if (closeAt < 0 || !after.trim()) {
            flushList()
            if (closeAt < 0) { math = []; mathClose = closeRe; if (body.trim()) math.push(body) }
            else {
              const tex = body.slice(0, closeAt).trim()
              if (tex) pushMath(tex)
            }
            continue
          }
        }
        const hm = /^(#{1,3})\s+(.*)$/.exec(line)
        if (hm) {
          flushList()
          els.push(h(`h${hm[1].length + 3}`, { key: `h${k++}`, className: 'ls-md-h' }, inlineNodes(hm[2], `i${k}`)))
          continue
        }
        if (/^\s*[-*]\s+/.test(line)) {
          if (!list) list = []
          list.push(inlineNodes(line.replace(/^\s*[-*]\s+/, ''), `l${k++}`))
          continue
        }
        flushList()
        if (line.trim()) els.push(h('p', { key: `p${k++}`, className: 'ls-md-p' }, inlineNodes(line, `i${k}`)))
      }
      flushCode()
      flushList()
      flushMath()
      return els
    }

    /** 选择题卡片：题干 + 可点选项；点选即发送字母（复用 sendText 与发送锁） */
    function QuizCard({ quiz, sending, onAnswer }) {
      const [localAnswer, setLocalAnswer] = useState(null)
      const answered = quiz.state === 'answered' || quiz.state === 'graded' || localAnswer
      const chosen = quiz.answer || localAnswer
      const disabled = !!answered || sending
      return h('div', { className: 'ls-quiz' },
        h('div', { className: 'ls-quiz-head' },
          h('span', { className: 'ls-quiz-no' }, `第 ${quiz.index} / ${quiz.total} 题`),
          quiz.node ? h('span', { className: 'ls-quiz-node' }, quiz.node) : null,
          quiz.state === 'graded'
            ? h('span', { className: 'ls-quiz-badge' + (quiz.correct ? ' ok' : ' bad') }, quiz.correct ? '✅ 答对' : '❌ 答错')
            : answered ? h('span', { className: 'ls-quiz-badge wait' }, '已作答，等待反馈') : null),
        quiz.stem ? h('div', { className: 'ls-quiz-stem' }, inlineNodes(quiz.stem, 'qs')) : null,
        h('div', { className: 'ls-quiz-opts' },
          (quiz.options || []).map(o =>
            h('button', {
              key: o.key, type: 'button',
              className: 'ls-quiz-opt' + (chosen === o.key ? ' chosen' : ''),
              disabled,
              // 发送失败（含非 409 错误）时回滚 localAnswer，允许重点重试
              onClick: () => { Promise.resolve(onAnswer(o.key)).then(ok => setLocalAnswer(ok ? o.key : null)) },
            },
              h('span', { className: 'ls-quiz-opt-key' }, o.key),
              h('span', null, inlineNodes(o.text, `qo${o.key}`))))),
      )
    }

    /** 答题历史：quizlog 时间线，点击展开题面与反馈；refreshKey 变化时重拉（答完题联动刷新） */
    function QuizHistory({ topic, refreshKey }) {
      const [records, setRecords] = useState(null)
      const [openSeq, setOpenSeq] = useState(null)
      useEffect(() => {
        let alive = true
        fetch(`/api/learning-space/quizlog?topic=${encodeURIComponent(topic)}`)
          .then(r => r.json())
          .then(j => { if (alive && j.ok) setRecords(j.records || []) })
          .catch(() => { if (alive) setRecords([]) })
        return () => { alive = false }
      }, [topic, refreshKey])
      if (!records || !records.length) return null
      return h('div', { className: 'ls-section' },
        h('div', { className: 'ls-h' }, `答题历史（${records.length}）`),
        h('div', { className: 'ls-qh-list' }, records.map((r, i) =>
          h('div', { key: `${r.fbSeq}-${i}`, className: 'ls-qh-item' + (openSeq === r.fbSeq ? ' open' : ''),
            onClick: () => setOpenSeq(openSeq === r.fbSeq ? null : r.fbSeq) },
            h('div', { className: 'ls-qh-row' },
              h('span', { className: 'ls-qh-mark ' + (r.correct ? 'ok' : 'bad') }, r.correct ? '✅' : '❌'),
              h('span', { className: 'ls-qh-date' }, r.date),
              h('span', { className: 'ls-qh-frac' }, `第 ${r.index} / ${r.total} 题`),
              r.node ? h('span', { className: 'ls-qh-node' }, r.node) : null,
              h('span', { className: 'ls-qh-ans' }, `答 ${r.answer}`)),
            openSeq === r.fbSeq ? h('div', { className: 'ls-qh-detail' },
              h('div', { className: 'ls-qh-line' }, '题面：', inlineNodes(r.stem, `qhs${r.fbSeq}`)),
              h('div', { className: 'ls-qh-line' }, '选项：', inlineNodes(r.options, `qho${r.fbSeq}`)),
              h('div', { className: 'ls-qh-line' }, '反馈：', inlineNodes(r.feedback, `qhf${r.fbSeq}`))) : null))),
      )
    }

    /** 内嵌对话窗：轮询收消息 + 发消息 + 兜底跳转；phase=1 摸底 / 2 学习（默认 2 兼容存量） */
    function ChatWindow({ topic, phase = 2, sessionId: initialSessionId, onOpenInSession, onQuizGraded }) {
      const [messages, setMessages] = useState([])
      const [input, setInput] = useState('')
      const [sending, setSending] = useState(false)
      const [err, setErr] = useState(null)
      const [running, setRunning] = useState(false)
      const [hasMore, setHasMore] = useState(false)
      const [sessionId, setSessionId] = useState(initialSessionId || null)
      const [needRebind, setNeedRebind] = useState(false)
      const lastSeqRef = useRef(null)
      const inFlightRef = useRef(false)
      const pendingIdRef = useRef(0)
      const listRef = useRef(null)
      const [doneInfo, setDoneInfo] = useState(null)
      const prevRunningRef = useRef(false)
      const runStartRef = useRef(null)

      const poll = useCallback(async () => {
        if (inFlightRef.current) return
        inFlightRef.current = true
        try {
          const afterSeq = lastSeqRef.current
          const qs = `topic=${encodeURIComponent(topic)}&phase=${phase}` + (afterSeq != null ? `&afterSeq=${afterSeq}` : '')
          const r = await fetch(`/api/learning-space/session/messages?${qs}`)
          const j = await r.json()
          if (!j.ok) {
            setErr(j.error)
            if (j.error === 'no session') setNeedRebind(true)
            return
          }
          setErr(null)
          setSessionId(j.sessionId)
          setRunning(j.running)
          setHasMore(!!j.hasMore)
          const incoming = Array.isArray(j.messages) ? j.messages : []
          const updates = Array.isArray(j.toolUpdates) ? j.toolUpdates : []
          if (incoming.length || updates.length) {
            // 新到达的 assistant 消息首字符是 ✅/❌ 即视为判分反馈，触发答题历史刷新
            if (onQuizGraded && incoming.some(m => m.role === 'assistant' && /^\s*[✅❌]/.test(m.text || ''))) onQuizGraded()
            setMessages(prev => {
              // 乐观消息（pending）保持追加在末尾，真实消息到达后按文本确认并移除
              const real = prev.filter(m => !m.pending)
              const optimistic = prev.filter(m => m.pending)
              const seen = new Set(real.map(m => m.seq))
              for (const m of incoming) if (!seen.has(m.seq)) { seen.add(m.seq); real.push(m) }
              const stateByCall = new Map(updates.map(u => [u.callId, u.state]))
              const withState = stateByCall.size
                ? real.map(m => m.role === 'tool' && m.callId && stateByCall.has(m.callId)
                  ? { ...m, state: stateByCall.get(m.callId) } : m)
                : real
              // 只把发送之后才出现的同文本用户消息当作乐观消息的确认，避免重发相同文本时误删
              return [...withState, ...optimistic.filter(p =>
                !withState.some(m => m.role === 'user' && m.text === p.text && m.seq > p.afterSeq))]
            })
          }
          if (typeof j.cursor === 'number') {
            lastSeqRef.current = lastSeqRef.current == null
              ? j.cursor : Math.max(lastSeqRef.current, j.cursor)
          }
        } catch (e) { setErr(String(e)) } finally { inFlightRef.current = false }
      }, [topic, phase])

      useEffect(() => { poll(); const t = setInterval(poll, 2500); return () => clearInterval(t) }, [poll])
      // running 由 true→false 视为一轮结束：记下用时并短暂展示完成态
      useEffect(() => {
        if (running && !prevRunningRef.current) runStartRef.current = Date.now()
        if (!running && prevRunningRef.current && runStartRef.current) {
          const sec = Math.max(1, Math.round((Date.now() - runStartRef.current) / 1000))
          runStartRef.current = null
          setDoneInfo({ sec })
          prevRunningRef.current = running
          const t = setTimeout(() => setDoneInfo(null), 2600)
          return () => clearTimeout(t)
        }
        prevRunningRef.current = running
      }, [running])
      useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [messages, running, doneInfo])

      // 发文本（输入框与 QuizCard 点选共用）：失败里 409 = 绑定会话已失效
      const sendText = async (text) => {
        if (!text || sending) return false
        // 有待答的 ask_user_question 时带上其 callId：Host 会 cancel 挂起的回合让回复执行
        let askCallId = null
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]
          if (m.role === 'tool' && m.ask) { askCallId = m.state === 'running' ? m.callId : null; break }
        }
        setSending(true); setErr(null)
        try {
          const r = await fetch('/api/learning-space/session/send', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ topic, text, phase, askCallId }),
          })
          const j = await r.json()
          if (j.ok) {
            pendingIdRef.current += 1
            const afterSeq = lastSeqRef.current == null ? -1 : lastSeqRef.current
            setMessages(prev => [...prev, {
              seq: -pendingIdRef.current, role: 'user', text, pending: true, afterSeq,
            }])
            poll()
            return true
          }
          if (j.error === 'session gone, start first') {
            setErr('会话已失效'); setNeedRebind(true); toast.warning('会话已失效', '点「重新绑定」即可继续'); return false
          }
          setErr(j.error); toast.error('发送失败', j.error); return false
        } catch (e) { setErr(String(e)); toast.error('发送失败', String(e)); return false }
        finally { setSending(false) }
      }

      const send = async () => {
        const text = input.trim()
        if (!text || sending) return
        if (await sendText(text)) setInput('')
      }

      // 重新绑定：调 /session/start {rebind:true, phase} 只重建当前 phase 的会话，重置轮询
      const rebind = async () => {
        setNeedRebind(false)
        setErr(null)
        try {
          const r = await fetch('/api/learning-space/session/start', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ topic, rebind: true, phase }),
          })
          const j = await r.json()
          if (j.ok && j.sessionId) {
            setSessionId(j.sessionId)
            setMessages([])
            lastSeqRef.current = null
            poll()
            toast.success('会话已重新绑定')
          } else setErr(j.error || '重新绑定失败')
        } catch (e) { setErr(String(e)) }
      }

      const last = messages[messages.length - 1]
      const toolMsg = running && last && last.role === 'tool' && last.state !== 'done' && last.state !== 'error' ? last : null
      const statusNode = doneInfo && !running
        ? h(AiStatus, { state: 'done', label: '完成', elapsed: doneInfo.sec })
        : toolMsg
          ? h(AiStatus, { state: 'tool', label: '正在调用工具', detail: toolMsg.toolName || '工具' })
          : running && (!last || last.role !== 'assistant')
            ? h(AiStatus, { state: 'thinking', label: '思考中' })
            : null
      return h('div', {
        className: 'ls-chat',
        // 点击对话窗（输入框/按钮/滚动）不冒泡到卡片折叠区，否则一点输入框整块就收起
        onClick: e => e.stopPropagation(),
      },
        h('div', { className: 'ls-chat-head' },
          h('span', { className: 'ls-chat-title' }, phase === 1 ? '摸底对话' : '学习对话'),
          h('button', {
            className: 'ls-btn', type: 'button',
            disabled: !sessionId || !onOpenInSession,
            onClick: () => onOpenInSession && onOpenInSession(sessionId),
          }, '在会话中打开 ↗')),
        h('div', { className: 'ls-chat-list', ref: listRef },
          hasMore ? h('span', { className: 'ls-chat-more' }, '更早消息可在会话中查看') : null,
          messages.map((m, i) => {
            if (m.role === 'tool') {
              // ask_user_question 待作答时渲染提示卡片：输入框直接作答（Host 会解除挂起回合）
              if (m.ask && m.state === 'running') {
                return h('div', { key: `q${m.seq}`, className: 'ls-ask' },
                  h('div', { className: 'ls-ask-badge' }, '❓ AI 想问你'),
                  m.ask.map((q, qi) => h('div', { key: qi, className: 'ls-ask-q' },
                    q.header ? h('div', { className: 'ls-ask-h' }, q.header) : null,
                    h('div', { className: 'ls-ask-text' }, q.question || ''),
                    Array.isArray(q.options) && q.options.length
                      ? h('div', { className: 'ls-ask-opts' }, q.options.map((o, oi) =>
                          h('div', { key: oi, className: 'ls-ask-opt' },
                            h('span', { className: 'ls-ask-opt-label' }, o.label || ''),
                            o.description ? h('span', { className: 'ls-ask-opt-desc' }, o.description) : null)))
                      : null,
                    q.multi_select ? h('div', { className: 'ls-ask-opt-desc' }, '（可多选）') : null)),
                  h('div', { className: 'ls-ask-opt-desc' }, '在下方输入框直接输入回答发送，或去会话里点选'),
                  h('button', {
                    className: 'ls-btn ls-ask-go', type: 'button',
                    disabled: !sessionId || !onOpenInSession,
                    onClick: () => onOpenInSession && onOpenInSession(sessionId),
                  }, '去回答 ↗'))
              }
              return h('div', { key: m.seq < 0 ? `t${i}${m.seq}` : m.seq, className: 'ls-tool' },
                `🛠 ${m.toolName || '工具'} `,
                m.state === 'done' ? '✓' : m.state === 'error' ? '✗' : '…')
            }
            return h('div', { key: m.seq < 0 ? `m${m.seq}` : m.seq, className: `ls-msg ls-msg-${m.role}` },
              m.role === 'assistant' && m.quiz
                ? h(QuizCard, { quiz: m.quiz, sending, onAnswer: sendText })
                : m.role === 'assistant' ? markdownLite(m.text) : m.text)
          }),
          running || doneInfo ? statusNode : null),
        err ? h('div', { className: 'ls-chat-err' }, `出错：${err}，可点「在会话中打开」继续`) : null,
        needRebind ? h('button', { className: 'ls-btn ls-rebind', type: 'button', onClick: rebind }, '会话已失效，重新绑定') : null,
        h('div', { className: 'ls-chat-row' },
          h('textarea', {
            className: 'ls-input ls-chat-input',
            value: input,
            placeholder: '输入问题，Enter 发送，Shift+Enter 换行',
            onChange: e => setInput(e.target.value),
            onKeyDown: e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            },
          }),
          h('button', { className: 'ls-btn', type: 'button', disabled: sending || !input.trim(), onClick: send },
            sending ? '发送中…' : '发送')),
      )
    }

    /** 材料扩展名白名单（与 Host 上传路由一致），供 file input 的 accept */
    const ACCEPT = '.pdf,.md,.txt,.docx,.pptx,.xlsx,.csv,.json,.epub,.png,.jpg,.jpeg,.gif,.webp,.zip'
    const MATERIAL_TIP = '优先用 md/txt/pdf/图片；docx/pptx/xlsx/epub/zip 仅存储，AI 读不出正文'

    /** XHR 上传（fetch 无上传进度）：FormData + xhr.upload.onprogress 回传百分比 */
    function uploadFiles(topic, fileList, onProgress) {
      return new Promise((resolve, reject) => {
        const fd = new FormData()
        fd.append('topic', topic)
        for (const f of fileList) fd.append('file', f)
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/learning-space/materials/upload')
        if (xhr.upload && onProgress) {
          xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
        }
        xhr.onload = () => {
          let j = null
          try { j = JSON.parse(xhr.responseText) } catch { /* 非 JSON */ }
          if (xhr.status >= 200 && xhr.status < 300 && j && j.ok) resolve(j)
          else reject(new Error((j && j.error) || `上传失败（HTTP ${xhr.status}）`))
        }
        xhr.onerror = () => reject(new Error('网络错误，上传失败'))
        xhr.send(fd)
      })
    }

    /** 隐藏 file input + 样式化按钮触发，选中即回调；tip 走 .ls-tip 悬停气泡 */
    function FilePickButton({ onFiles, label, disabled, tip, tipAlign }) {
      const ref = useRef(null)
      return h('span', { className: 'ls-file-label' },
        h('input', {
          ref, type: 'file', multiple: true, accept: ACCEPT, style: { display: 'none' },
          onChange: e => { if (e.target.files && e.target.files.length) onFiles(e.target.files); e.target.value = '' },
        }),
        h('button', {
          className: 'ls-btn' + (tip ? ' ls-tip' + (tipAlign === 'left' ? ' ls-tip-left' : '') : ''),
          type: 'button', disabled,
          'data-tip': tip || null,
          onClick: () => ref.current && ref.current.click(),
        }, label || '导入材料'),
      )
    }

    /** 人类可读文件大小 */
    function fmtSize(n) {
      if (n == null) return ''
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / 1024 / 1024).toFixed(1)} MB`
    }

    /** 材料列表 + 导入按钮 + 上传进度 + 错误展示 */
    function MaterialList({ topic, onRefresh }) {
      const [uploading, setUploading] = useState(false)
      const [pct, setPct] = useState(0)
      const [err, setErr] = useState(null)
      // 材料列表折叠态：默认收起，与「导入材料」按钮同行展示数量
      const [open, setOpen] = useState(false)
      const materials = (topic && topic.materials) || []
      const doUpload = async files => {
        setUploading(true); setPct(0); setErr(null)
        try {
          const res = await uploadFiles(topic.name, files, p => setPct(Math.round(p * 100)))
          toast.success('材料已导入', `${(res && res.files ? res.files.length : files.length) || files.length} 个文件`)
          onRefresh()
        } catch (e) {
          const msg = String(e.message || e)
          setErr(msg); toast.error('上传失败', msg)
        }
        finally { setUploading(false) }
      }
      return h('div', { className: 'ls-section' },
        h('div', { className: 'ls-side-head', style: { marginBottom: 0, flexWrap: 'wrap', rowGap: 6 } },
          h('span', {
            className: 'ls-h', style: { border: 'none', padding: 0, margin: 0, cursor: 'pointer', userSelect: 'none' },
            onClick: () => setOpen(!open),
          }, `${open ? '▾' : '▸'} 学习材料${materials.length ? `（${materials.length}）` : ''}`),
          h(FilePickButton, {
            onFiles: doUpload, disabled: uploading, label: uploading ? '上传中…' : '导入材料',
            tip: MATERIAL_TIP,
          })),
        open ? (materials.length === 0
          ? h('div', { className: 'ls-empty' }, '暂无材料')
          : materials.map(m => h('div', { key: m.name, className: 'ls-mat-item' },
              h('span', null, m.name),
              h('span', { className: 'ls-mat-size' }, fmtSize(m.size))))) : null,
        uploading ? h('div', { className: 'ls-upload-bar' },
          h('div', { className: 'ls-upload-fill', style: { width: pct + '%' } })) : null,
        uploading ? h('div', { className: 'ls-empty' }, `上传中 ${pct}%…`) : null,
        err ? h('div', { className: 'ls-upload-err' }, err) : null,
      )
    }

    /** 阶段卡：阶段一（摸底 + 计划生成）/ 计划已生成 两态；阶段二不渲染（详情区回归现有布局） */
    function PhaseCard({ topic, onStartPhase1, onStartPhase2, onToggleWebSearch, starting }) {
      if (topic.phase !== 1) return null
      return h('div', { className: 'ls-section' },
        h('div', { className: 'ls-h' }, topic.planReady ? '计划已生成' : '摸底 + 学习计划生成'),
        !topic.planReady
          ? h('div', null,
              h('div', { className: 'ls-empty' }, '可先把学习材料导入下方「学习材料」，AI 摸底与计划生成会参考'),
              h('label', { className: 'ls-ws' },
                h('input', {
                  type: 'checkbox',
                  checked: topic.webSearch !== false,
                  onChange: e => onToggleWebSearch(topic.name, e.target.checked),
                }),
                ' 允许联网检索（对下一次新会话生效）'),
              h('div', { style: { marginTop: 8 } },
                h('button', {
                  className: 'ls-btn', type: 'button', disabled: starting,
                  onClick: () => onStartPhase1(topic.name),
                }, starting ? '创建中…' : '开始摸底对话 →')))
          : h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
              h('a', {
                className: 'ls-btn', download: '',
                href: `/api/learning-space/export/plan?topic=${encodeURIComponent(topic.name)}`,
                style: { textDecoration: 'none', lineHeight: '20px' },
              }, '导出学习计划'),
              h('span', { className: 'ls-frac' }, '计划已就绪，开始学习？'),
              h('button', {
                className: 'ls-btn', type: 'button', disabled: starting,
                onClick: () => onStartPhase2(topic.name),
              }, starting ? '创建中…' : '开始学习 →')),
      )
    }

    /** 学习记录：studyLog 条目（倒序，最新在前）+ 下载 study-log.md 原文 */
    function StudyLogList({ topic }) {
      const entries = (topic && topic.studyLog) || []
      return h('div', { className: 'ls-section' },
        h('div', { className: 'ls-side-head', style: { marginBottom: 8 } },
          h('span', { className: 'ls-h', style: { border: 'none', padding: 0, margin: 0 } }, `学习记录（${entries.length}）`),
          entries.length ? h('a', {
            className: 'ls-btn', download: '',
            href: `/api/learning-space/studylog?topic=${encodeURIComponent(topic.name)}`,
            style: { textDecoration: 'none', lineHeight: '20px' },
          }, '下载学习记录') : null),
        entries.length === 0
          ? h('div', { className: 'ls-empty' }, '暂无学习记录（每教完一个节点 AI 应自动写入；长时间没有时可在对话里提醒它调用 learn_update 的 study_log）')
          : entries.map((e, i) => h('div', {
              key: `${e.date}-${i}`, className: 'ls-journal-item', style: { wordBreak: 'break-word' },
            }, `${e.date} · ${e.node}${e.mastery ? ` · ${e.mastery}` : ''} — ${e.summary}`)),
      )
    }

    /** 学习方案（节点列表 + 依赖图）：可折叠；阶段二默认收起，点标题或箭头展开 */
    function PlanSection({ topic, defaultOpen, nodeStatus }) {
      const [open, setOpen] = useState(!!defaultOpen)
      const total = topic.nodes.length || topic.order.length || 0
      const done = topic.counts.done || 0
      return h('div', { className: 'ls-section' },
        h('div', {
          className: 'ls-side-head',
          style: { marginBottom: open ? 8 : 0, cursor: 'pointer', userSelect: 'none' },
          onClick: () => setOpen(!open),
        },
          h('span', {
            className: 'ls-h', style: { border: 'none', padding: 0, margin: 0, flex: 1 },
          }, `${open ? '▾' : '▸'} 学习方案（${done}/${total}）`)),
        open ? h('div', null,
          h('ul', { className: 'ls-nodes' },
            (topic.order.length ? topic.order : topic.nodes.map(n => n.label)).map(label =>
              h('li', { className: 'ls-node', key: label },
                h('span', { className: 'ls-dot', style: { background: STATUS_COLOR[nodeStatus.get(label) || 'todo'] } }),
                cleanLabel(label)))),
          h(MermaidGraph, { src: topic.planMermaid || '', nodes: topic.nodes, edges: topic.edges }),
        ) : null,
      )
    }

    /** 选中课程详情：按 phase 组装——phase1 = PhaseCard + 摸底对话窗；phase2 = 现有布局 + 学习记录 + 学习对话窗 */
    function TopicDetail({ topic, onStart, starting, chat, onOpenInSession, onRefresh, onToggleWebSearch }) {
      const [quizTick, setQuizTick] = useState(0)
      const phase = topic.phase === 1 ? 1 : 2
      const total = topic.nodes.length || topic.order.length || 0
      const done = topic.counts.done || 0
      const pct = total ? Math.round((done / total) * 100) : 0
      const nodeStatus = new Map(topic.nodes.map(n => [n.label, n.status]))
      return h('div', { className: 'ls-detail' },
        h('div', { className: 'ls-detail-head' },
          h('span', { className: 'ls-name' }, topic.name),
          h('span', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
            h('span', { className: 'ls-frac' }, phase === 1 ? '阶段一 · 摸底' : `${done}/${total} 已确认`),
            h('a', {
              className: 'ls-btn', href: `/api/learning-space/export?topic=${encodeURIComponent(topic.name)}`,
              download: '', style: { textDecoration: 'none', lineHeight: '20px' },
            }, '导出报告'),
            h('button', {
              className: 'ls-btn',
              disabled: starting,
              onClick: () => onStart(topic.name, phase),
            }, starting ? '创建中…' : phase === 2 ? '继续学习 →' : '开始摸底对话 →'),
            phase === 2 ? h('button', {
              className: 'ls-btn', title: '新建学习会话，从学习方案开头重新教；旧会话保留在会话列表',
              disabled: starting,
              onClick: () => onStart(topic.name, 2, true),
            }, starting ? '…' : '重新学习 ↻') : null,
            topic.nodes.length ? h(NotificationBell, { nodes: topic.nodes }) : null)),
        topic.goal ? h('div', { className: 'ls-goal' }, topic.goal) : null,
        h('div', { className: 'ls-bar' }, h('div', { className: 'ls-bar-fill', style: { width: pct + '%' } })),
        h('div', { className: 'ls-badges' },
          ['done', 'doing', 'warn', 'todo'].filter(s => topic.counts[s]).map(s =>
            h('span', { key: s },
              h('span', { className: 'ls-dot', style: { background: STATUS_COLOR[s] } }),
              `${STATUS_LABEL[s]} ${topic.counts[s]}`)),
          topic.mistakes.length
            ? h('span', null, `错题 ${topic.mistakes.length}`) : null),
        h(PhaseCard, {
          topic,
          starting,
          onStartPhase1: name => onStart(name, 1),
          onStartPhase2: name => onStart(name, 2),
          onToggleWebSearch,
        }),
        h(PlanSection, { topic, defaultOpen: phase === 1, nodeStatus }),
        h(MaterialList, { topic, onRefresh }),
        h(QuizHistory, { topic: topic.name, refreshKey: quizTick }),
        phase === 2 ? h(StudyLogList, { topic }) : null,
        chat ? h(ChatWindow, {
          key: `${topic.name}-${phase}`,   // phase 切换时重挂载，重置轮询游标，避免双会话消息串窗
          topic: topic.name,
          phase,
          sessionId: phase === 1 ? topic.phase1SessionId : topic.phase2SessionId,
          onOpenInSession,
          onQuizGraded: () => setQuizTick(t => t + 1),
        }) : null,
      )
    }

    /** 节点标签清洗：去掉 mermaid 里带的 <br/> 换行标记（显示层处理，源数据不动） */
    const cleanLabel = s => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/\s{2,}/g, ' ').trim()

    /** 专注页左栏：节点手风琴——点节点展开该节点的教学笔记（notes/<节点>.md） */
    function NodeAccordion({ topic }) {
      const [openNode, setOpenNode] = useState(null)
      const [notes, setNotes] = useState({})   // label -> content（含 '' 已确认为无笔记）
      const nodes = topic.nodes.length ? topic.nodes : (topic.order || []).map(l => ({ id: l, label: l, status: 'todo' }))
      const label = n => cleanLabel(n.label || n.id)
      const toggle = async label => {
        if (openNode === label) { setOpenNode(null); return }
        setOpenNode(label)
        if (notes[label] === undefined) {
          try {
            const r = await fetch(`/api/learning-space/node-note?topic=${encodeURIComponent(topic.name)}&node=${encodeURIComponent(label)}`)
            const j = await r.json()
            setNotes(prev => ({ ...prev, [label]: j.ok ? j.content : null }))
          } catch { setNotes(prev => ({ ...prev, [label]: null })) }
        }
      }
      return h('div', { className: 'ls-section' },
        h('div', { className: 'ls-side-head', style: { marginBottom: 8 } },
          h('span', { className: 'ls-h', style: { border: 'none', padding: 0, margin: 0 } }, '知识节点（点击看教学内容）')),
        h('div', { className: 'ls-side-list' }, nodes.map(n => {
          const label = n.label || n.id          // 原始标签：fetch/匹配 notes 文件用
          const disp = cleanLabel(label)         // 显示用：去 <br/>
          const open = openNode === label
          const content = notes[label]
          return h('div', { key: label, style: { marginBottom: 2 } },
            h('div', {
              className: 'ls-side-item' + (open ? ' active' : ''),
              onClick: () => toggle(label),
              style: { cursor: 'pointer' },
            },
              h('span', { className: 'ls-dot', style: { background: STATUS_COLOR[n.status] || STATUS_COLOR.todo, flex: 'none' } }),
              h('span', { className: 'ls-side-name' }, `${open ? '▾' : '▸'} ${disp}`)),
            open ? h('div', {
              className: 'ls-md-p',
              style: { padding: '8px 10px 8px 24px', fontSize: 13, lineHeight: 1.8 },
            },
              content === undefined ? '加载中…'
              : content === null ? '（读取失败，稍后再试）'
              : content.trim() ? markdownLite(content)
              : '（还没有这个节点的教学笔记——学到这里时 AI 会写入 notes/<节点>.md）')
              : null,
          )
        })),
      )
    }

    /** 专注学习页：左 = 教的知识（方案/学习记录/材料），右 = 问答对话窗，头部带返回 */
    function StudyFocusView({ topic, onBack, onOpenInSession, onRefresh }) {
      const [quizTick, setQuizTick] = useState(0)
      const phase = topic.phase === 1 ? 1 : 2
      const total = topic.nodes.length || topic.order.length || 0
      const done = topic.counts.done || 0
      const nodeStatus = new Map(topic.nodes.map(n => [n.label, n.status]))
      return h('div', { className: 'ls-focus' },
        h('div', { className: 'ls-focus-left' },
          h('div', { className: 'ls-focus-head' },
            h('button', { className: 'ls-btn', type: 'button', onClick: onBack }, '← 返回'),
            h('span', { className: 'ls-focus-title', title: topic.name }, topic.name),
            h('span', { className: 'ls-frac' }, `${done}/${total} 已确认`),
            topic.nodes.length ? h(NotificationBell, { nodes: topic.nodes }) : null),
          h(NodeAccordion, { topic }),
          h(MaterialList, { topic, onRefresh })),
        h('div', { className: 'ls-focus-right' },
          h(ChatWindow, {
            key: `${topic.name}-${phase}`,
            topic: topic.name,
            phase,
            sessionId: phase === 1 ? topic.phase1SessionId : topic.phase2SessionId,
            onOpenInSession,
            onQuizGraded: () => setQuizTick(t => t + 1),
          })),
      )
    }

    /** 左栏：新建入口 + 课程列表（进度摘要 + 状态色点 + 选中态） */
    function TopicSidebar({ topics, selected, onSelect, onCreated, onDelete }) {
      return h('div', { className: 'ls-side' },
        h('div', { className: 'ls-side-head' },
          h('span', { className: 'ls-h', style: { flex: 1 } }, '课程'),
          topics.length ? h('a', {
            className: 'ls-btn', href: '/api/learning-space/export?all=1', download: '',
            style: { textDecoration: 'none', lineHeight: '20px' },
          }, '导出全部') : null),
        h(NewTopicForm, { onCreated }),
        topics.length === 0
          ? h('div', { className: 'ls-empty' }, '还没有课程')
          : h('div', { className: 'ls-side-list' }, topics.map(t => {
              const total = t.nodes.length || t.order.length || 0
              const color = t.counts.warn > 0 ? STATUS_COLOR.warn
                : t.counts.doing > 0 ? STATUS_COLOR.doing
                : t.counts.done > 0 ? STATUS_COLOR.done : STATUS_COLOR.todo
              return h('div', {
                key: t.name,
                className: 'ls-side-item' + (selected === t.name ? ' active' : ''),
                onClick: () => onSelect(t.name),
              },
                h('span', { className: 'ls-dot', style: { background: color, flex: 'none' } }),
                h('span', { className: 'ls-side-name' }, t.name),
                h('span', { className: 'ls-side-frac' }, `${t.counts.done || 0}/${total}`),
                h('button', {
                  className: 'ls-side-del', type: 'button', title: '删除课程',
                  onClick: e => { e.stopPropagation(); onDelete(t) },
                }, '✕'))
            })),
      )
    }

    /** 删除课程确认弹窗：警告不可恢复，会话保留说明 */
    function DeleteTopicDialog({ topic, busy, onCancel, onConfirm }) {
      const total = topic.nodes.length || topic.order.length || 0
      return h('div', { className: 'ls-modal-mask', onClick: busy ? undefined : onCancel },
        h('div', { className: 'ls-modal', onClick: e => e.stopPropagation() },
          h('div', { className: 'ls-modal-title' }, `删除课程「${topic.name}」？`),
          h('div', { className: 'ls-modal-body' },
            h('p', { style: { margin: '0 0 6px' } },
              `当前进度 ${topic.counts.done || 0}/${total} 已确认，材料 ${((topic.materials) || []).length} 个。`),
            h('p', { style: { margin: 0 } },
              h('strong', null, '删除后学习计划、错题本、学习记录、答题记录和上传材料均不可恢复。'),
              '摸底/学习会话会保留在会话列表中，可自行归档。')),
          h('div', { className: 'ls-modal-actions' },
            h('button', { className: 'ls-btn', type: 'button', disabled: busy, onClick: onCancel }, '取消'),
            h('button', {
              className: 'ls-btn ls-btn-danger', type: 'button', disabled: busy, onClick: onConfirm,
            }, busy ? '删除中…' : '确认删除'))))
    }

    /**
     * 模型设置弹窗：跟随宿主默认开关 + provider/model 级联下拉 + 立即应用勾选。
     * 每次打开都重新 GET（目录按当前实况渲染）；已存模型不在目录时回显跟默认态并提示。
     */
    function ModelSettingsDialog({ currentTopic, onClose }) {
      const [catalog, setCatalog] = useState(undefined)   // undefined=加载中 null=目录失败
      const [catalogError, setCatalogError] = useState(null)
      const [followDefault, setFollowDefault] = useState(true)
      const [provider, setProvider] = useState('')
      const [model, setModel] = useState('')
      const [savedStale, setSavedStale] = useState(false) // 已存模型不在当前目录
      const [applyNow, setApplyNow] = useState(false)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      const [applyNotice, setApplyNotice] = useState(null)

      useEffect(() => {
        let alive = true
        fetch('/api/learning-space/settings/model').then(r => r.json()).then(j => {
          if (!alive) return
          const cat = j.ok ? j.catalog : null
          const savedSel = j.ok && j.saved ? j.saved.model : null
          let follow = true, prov = '', mdl = '', stale = false
          if (savedSel && cat && Array.isArray(cat.groups)) {
            const g = cat.groups.find(x => x.id === savedSel.provider)
            const m = g && (g.models || []).find(x => x.id === savedSel.model)
            if (g && m) { follow = false; prov = g.id; mdl = m.id }
            else stale = true   // 已存选择不在当前目录：回显跟默认 + 提示
          }
          if (!follow && !prov && cat && Array.isArray(cat.groups) && cat.groups.length) {
            prov = cat.groups[0].id
            mdl = (cat.groups[0].models || [])[0] ? cat.groups[0].models[0].id : ''
          }
          setCatalog(cat || null)
          setCatalogError(j.ok ? (j.error || null) : (j.error || '加载失败'))
          setFollowDefault(follow); setProvider(prov); setModel(mdl); setSavedStale(stale)
        }).catch(e => { if (alive) { setCatalog(null); setCatalogError(String(e)) } })
        return () => { alive = false }
      }, [])

      const groups = (catalog && Array.isArray(catalog.groups)) ? catalog.groups : []
      const group = groups.find(g => g.id === provider)
      const models = group ? (group.models || []) : []
      const pickerModels = useMemo(() => groups.flatMap(g => (g.models || []).map(m => ({
        provider: g.id,
        providerName: g.name || g.id,
        modelId: m.id,
        name: m.name || m.id,
      }))), [catalog])

      const save = async () => {
        if (busy) return
        setBusy(true); setErr(null); setApplyNotice(null)
        let sel = null
        if (!followDefault) {
          if (!provider || !model) { setErr('请先选择模型'); setBusy(false); return }
          sel = { provider, model }
          // effort 不做 UI：目录里该模型有 defaultEffort 就随保存带上
          const m = models.find(x => x.id === model)
          if (m && m.reasoning && m.reasoning.defaultEffort) sel.reasoningEffort = m.reasoning.defaultEffort
        }
        try {
          const r = await fetch('/api/learning-space/settings/model', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: sel,
              applyToTopic: applyNow && currentTopic ? currentTopic : undefined }),
          })
          const j = await r.json()
          if (!j.ok) { setErr(j.error || '保存失败'); toast.error('保存失败', j.error || ''); return }
          if (j.applyError) {
            const msg = `已保存，但应用到会话失败：${j.applyError}`
            setApplyNotice(msg); toast.warning('已保存', msg); return
          }
          toast.success('模型设置已保存', sel ? `${sel.provider} / ${sel.model}` : '跟随宿主默认')
          onClose(true)
        } catch (e) { setErr(String(e)) }
        finally { setBusy(false) }
      }

      const catalogDown = catalog === null
      return h('div', { className: 'ls-modal-mask', onClick: busy ? undefined : onClose },
        h('div', { className: 'ls-modal', onClick: e => e.stopPropagation() },
          h('div', { className: 'ls-modal-title' }, '模型设置'),
          h('div', { className: 'ls-modal-body' },
            catalog === undefined ? h('div', { className: 'ls-empty' }, '加载模型目录…') : [
              h('label', { key: 'follow', className: 'ls-set-check' },
                h('input', { type: 'checkbox', checked: followDefault,
                  onChange: e => {
                    const on = e.target.checked
                    setFollowDefault(on)
                    // 取消跟随默认且尚未选过：落到目录里的第一个模型，避免空选
                    if (!on && !provider && pickerModels.length) {
                      setProvider(pickerModels[0].provider)
                      setModel(pickerModels[0].modelId)
                    }
                  } }),
                '跟随宿主默认模型'),
              followDefault && catalog && catalog.default
                ? h('div', { key: 'def', className: 'ls-set-note' },
                  `当前默认：${catalog.default.provider} / ${catalog.default.model}`)
                : null,
              h('label', { key: 'mdl', className: 'ls-set-label' }, '模型'),
              h(ModelPicker, {
                key: 'picker',
                models: pickerModels,
                value: { provider, model },
                disabled: followDefault || catalogDown,
                placeholder: catalogDown ? '模型目录不可用' : '选择模型',
                onChange: sel => { setProvider(sel.provider); setModel(sel.model) },
              }),
              h('label', { key: 'apply', className: 'ls-set-check' },
                h('input', { type: 'checkbox', checked: applyNow, disabled: !currentTopic,
                  onChange: e => setApplyNow(e.target.checked) }),
                `同时应用到当前课程的学习会话${currentTopic ? `（${currentTopic}）` : '（未选择课程）'}`),
              applyNow && followDefault
                ? h('div', { key: 'an', className: 'ls-set-note' }, '跟随默认不会改动已有会话。')
                : null,
              h('p', { key: 'doc', className: 'ls-set-note' },
                '选择会保存到项目根 .learning-space.json，新建的教学会话将使用该模型；',
                '宿主会同时把它记为部署默认偏好（DSH 设置里可改回）。'),
              savedStale ? h('div', { key: 'stale', className: 'ls-set-warn' }, '已保存的模型当前不可用，暂按跟随默认显示。') : null,
              catalogError ? h('div', { key: 'cerr', className: 'ls-set-warn' }, catalogError) : null,
              applyNotice ? h('div', { key: 'anotice', className: 'ls-set-warn' }, applyNotice) : null,
              err ? h('div', { key: 'err', className: 'ls-set-warn' }, err) : null,
            ]),
          h('div', { className: 'ls-modal-actions' },
            h('button', { className: 'ls-btn', type: 'button', disabled: busy, onClick: onClose }, '取消'),
            h('button', {
              className: 'ls-btn', type: 'button', disabled: busy || catalog === undefined,
              onClick: save,
            }, busy ? '保存中…' : '保存'))))
    }

    /** 新建课程（可带文件）：create 成功后紧接着对所选文件调上传，两步全成才算完成 */
    function NewTopicForm({ onCreated }) {
      const [name, setName] = useState('')
      const [goal, setGoal] = useState('')
      const [files, setFiles] = useState([])
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      const fileRef = useRef(null)
      const submit = async e => {
        e.preventDefault()
        const t = name.trim()
        if (!t || busy) return
        setBusy(true); setErr(null)
        try {
          // 第一步：建课
          const r = await fetch('/api/learning-space/topic/create', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ topic: t, goal: goal.trim() }),
          })
          const j = await r.json()
          if (!j.ok) { setErr(j.error || '创建失败'); toast.error('创建失败', j.error || ''); return }
          // 第二步：对所选文件上传（失败有补救路径：课程已建成，详情区可再导入）
          if (files.length) {
            try { await uploadFiles(t, files) }
            catch (e2) {
              const msg = `课程已创建，但材料上传失败：${e2.message || e2}`
              setErr(msg); toast.warning('材料上传失败', msg)
            }
          }
          setName(''); setGoal(''); setFiles([])
          onCreated(t)
          toast.success('课程已创建', files.length ? `${t} · ${files.length} 个材料` : t)
        } catch (e2) {
          setErr(String(e2)); toast.error('创建失败', String(e2))
        }
        finally { setBusy(false) }
      }
      return h('form', { className: 'ls-new', onSubmit: submit, style: { flexDirection: 'column' } },
        err ? h('div', { className: 'ls-upload-err' }, err) : null,
        h('input', { className: 'ls-input', placeholder: '课程名，如：傅里叶变换', value: name,
          onChange: e => setName(e.target.value) }),
        h('input', { className: 'ls-input', placeholder: '学习目标（可选）', value: goal,
          onChange: e => setGoal(e.target.value) }),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h(FilePickButton, {
            onFiles: fl => setFiles(prev => [...prev, ...Array.from(fl)]),
            disabled: busy, label: files.length ? `＋ 追加材料（${files.length}）` : '＋ 附带材料',
            tip: MATERIAL_TIP, tipAlign: 'left',
          }),
          h('button', { className: 'ls-btn', type: 'submit', disabled: busy || !name.trim() },
            busy ? '创建中…' : '＋ 新建课程'),
        ),
        files.length ? h('div', { className: 'ls-picked' }, files.map((f, i) =>
          h('div', { key: `${f.name}${i}`, className: 'ls-picked-item' },
            h('span', null, `${f.name}（${fmtSize(f.size)}）`),
            h('button', {
              className: 'ls-picked-x', type: 'button', title: '移除',
              onClick: () => setFiles(prev => prev.filter((_, j) => j !== i)),
            }, '×')),
        )) : null,
      )
    }

    function LearningPanel() {
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [selectedTopic, setSelectedTopic] = useState(null)
      const [starting, setStarting] = useState(null)
      const [chatTopic, setChatTopic] = useState(null)
      // 待删除课程 { name, topic, busy }，非空时渲染确认弹窗
      const [deleting, setDeleting] = useState(null)
      // 专注学习页：课程名非空时整面板切换为左知识右问答视图
      const [studyView, setStudyView] = useState(null)
      // 模型设置弹窗：非空时渲染 ModelSettingsDialog
      const [modelSettings, setModelSettings] = useState(false)

      const load = useCallback(() => {
        fetch('/api/learning-space/overview').then(r => r.json())
          .then(j => { if (j.ok) { setData(j); setError(null) } else setError(j.error) })
          .catch(e => setError(String(e)))
      }, [])
      useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

      // 默认选中第一门课；已选课程被删则回退
      useEffect(() => {
        if (data && data.topics.length) {
          if (!selectedTopic || !data.topics.some(t => t.name === selectedTopic)) {
            setSelectedTopic(data.topics[0].name)
          }
        } else if (selectedTopic !== null) setSelectedTopic(null)
      }, [data])

      // rebind=true：抛弃旧绑定强制新建会话并重注 seed（「重新学习」用；旧会话保留在会话列表）
      const startLearning = useCallback(async (topic, phase, rebind) => {
        setStarting(topic)
        try {
          const r = await fetch('/api/learning-space/session/start', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(rebind ? { topic, phase, rebind: true } : { topic, phase }),
          })
          const j = await r.json()
          if (j.ok && j.sessionId) {
            setSelectedTopic(topic)        // 切到该课程详情
            setChatTopic(topic)            // 详情区展开内嵌对话窗（单窗互斥；窗内按 topic.phase 路由）
            setStudyView(topic)            // 直接进入专注学习页（左知识右问答，可返回）
            toast.success(phase === 1 ? '摸底会话已创建' : '学习会话已创建', topic)
            load()
          } else {
            setError(j.error || '创建会话失败')
            toast.error('创建会话失败', j.error || '')
          }
        } catch (e) {
          setError(String(e)); toast.error('创建会话失败', String(e))
        }
        finally { setStarting(null) }
      }, [load])

      // 联网开关：只改 session.json 的 webSearch 字段（对下一次新建会话生效）
      const toggleWebSearch = useCallback(async (topic, enabled) => {
        try {
          const r = await fetch('/api/learning-space/session/websearch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ topic, enabled }),
          })
          const j = await r.json()
          if (!j.ok) { setError(j.error || '设置失败'); toast.error('设置失败', j.error || ''); return }
          toast.info(enabled ? '已开启联网检索' : '已关闭联网检索', '对下一次新建会话生效')
          load()
        } catch (e) { setError(String(e)) }
      }, [load])

      // 删除课程：确认后调 /topic/delete，成功后刷新并清掉选中/对话窗状态
      const confirmDeleteTopic = useCallback(async () => {
        if (!deleting) return
        setDeleting(d => ({ ...d, busy: true }))
        try {
          const r = await fetch('/api/learning-space/topic/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ topic: deleting.name }),
          })
          const j = await r.json()
          if (j.ok) {
            const name = deleting.name
            setDeleting(null)
            if (selectedTopic === deleting.name) { setSelectedTopic(null); setChatTopic(null) }
            toast.success('课程已删除', name)
            load()
          } else {
            setError(j.error || '删除失败')
            toast.error('删除失败', j.error || '')
          }
        } catch (e) {
          setError(String(e)); toast.error('删除失败', String(e))
        }
        finally { setDeleting(d => d && { ...d, busy: false }) }
      }, [deleting, selectedTopic, load])

      const selected = data && data.topics.find(t => t.name === selectedTopic)
      // 专注学习页：课程还在就整面板切换（overview 刷新后 topic 对象取最新）
      const studyTopic = studyView && data ? data.topics.find(t => t.name === studyView) : null
      if (studyTopic) return h('div', { className: 'ls-panel' },
        h('style', null, css),
        h(ToastHost),
        error ? h('div', { className: 'ls-empty' }, `出错：${error}`) : null,
        h(StudyFocusView, {
          topic: studyTopic,
          onBack: () => setStudyView(null),
          onOpenInSession: sid => panelCtx && panelCtx.uiWorkspace && panelCtx.uiWorkspace.openSession(sid),
          onRefresh: load,
        }),
      )
      return h('div', { className: 'ls-panel' },
        h('style', null, css),
        h(ToastHost),
        h('div', { className: 'ls-title-row' },
          h('h1', { className: 'ls-title' }, '学习空间'),
          h('button', {
            className: 'ls-gear', type: 'button', 'aria-label': '模型设置', title: '模型设置',
            onClick: () => setModelSettings(true),
          }, '⚙')),
        h('p', { className: 'ls-sub' }, '左侧管理课程，右侧看进度、依赖图和错题，材料可导入给教学会话'),
        error ? h('div', { className: 'ls-empty' }, `出错：${error}`) : null,
        !data && !error ? h('div', { className: 'ls-loading' }, '加载中…') : null,
        data ? h('div', { className: 'ls-layout' },
          h(TopicSidebar, {
            topics: data.topics,
            selected: selectedTopic,
            onSelect: name => setSelectedTopic(name),
            onCreated: name => { setSelectedTopic(name); load() },
            onDelete: t => setDeleting({ name: t.name, topic: t, busy: false }),
          }),
          selected
            ? h(TopicDetail, {
                key: selected.name,
                topic: selected,
                starting: starting === selected.name,
                chat: chatTopic === selected.name,
                onStart: startLearning,
                onToggleWebSearch: toggleWebSearch,
                onOpenInSession: sid => panelCtx && panelCtx.uiWorkspace && panelCtx.uiWorkspace.openSession(sid),
                onRefresh: load,
              })
            : h('div', { className: 'ls-empty' }, '在左侧新建或选择一门课程'),
        ) : null,
        data && data.journal.length ? h('div', { className: 'ls-section' },
          h('div', { className: 'ls-h' }, '最近日志'),
          data.journal.map((line, i) => h('div', { key: i, className: 'ls-journal-item' }, line)),
        ) : null,
        deleting ? h(DeleteTopicDialog, {
          topic: deleting.topic,
          busy: deleting.busy,
          onCancel: () => { if (!deleting.busy) setDeleting(null) },
          onConfirm: confirmDeleteTopic,
        }) : null,
        modelSettings ? h(ModelSettingsDialog, {
          currentTopic: selectedTopic,
          onClose: () => setModelSettings(false),
        }) : null,
      )
    }

    let panelCtx = null
    return {
      inject: ['slots', 'uiWorkspace'],
      apply(ctx) {
        panelCtx = ctx
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: 'learning-space', order: 60, label: '学习空间' },
          PanelIcon))
        ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: 'learning-space' },
          LearningPanel))
      },
    }
  },
})
