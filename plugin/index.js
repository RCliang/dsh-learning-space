/**
 * 学习空间 Host 半边：
 * - webServer: /api/learning-space/* 给面板供数据（解析 curriculum 下的 markdown）
 * - tools: learn_guide / learn_status / learn_update（AI 教学时读方法、写进度）
 */
import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID as cryptoRandomUUID } from 'node:crypto'
import { annotateQuiz, appendQuizLog, parseQuizLog } from './quiz.js'

export const inject = ['tools', 'webServer', 'sessionController', 'sessionTitle', 'sessions']

const CLASS_STATUS = { done: 'done', doing: 'doing', warn: 'warn', todo: 'todo' }

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const fm = {}
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^(topic|goal):\s*(.*)$/.exec(line)
      if (kv) fm[kv[1]] = kv[2]
    }
  }
  return fm
}

/** 解析 plan.md：mermaid 节点/边 + checkbox 状态 */
function parsePlan(text) {
  const fm = parseFrontmatter(text)
  const nodes = []
  const edges = []
  const order = []
  const mermaid = /```mermaid([\s\S]*?)```/.exec(text)
  // id + 标签（兼容带引号 A["x"] 与不带引号 A[x]，标签内可含 : / 等字符）+ :::class
  const idDef = s => {
    const def = /^\s*([^\[\]:"'\s]+)\s*(?:\["([^"]*)"\]|\[([^\]]*)\])?\s*(?:::+(\w+))?\s*$/.exec(s)
    if (!def) return null
    const label = def[2] !== undefined ? def[2] : def[3] !== undefined ? def[3].trim() : undefined
    return { id: def[1].trim(), label: label || undefined, cls: def[4] }
  }
  const pushNode = (id, label, cls) => {
    if (!id) return
    let n = nodes.find(x => x.id === id)
    if (!n) { n = { id, label: label || id, status: 'todo' }; nodes.push(n) }
    if (label) n.label = label
    if (cls && CLASS_STATUS[cls]) n.status = cls
  }
  if (mermaid) {
    for (const raw of mermaid[1].split(/\r?\n/)) {
      const line = raw.trim()
      if (line.includes('-->')) {
        const parts = line.split('-->').map(idDef).filter(Boolean)
        for (const p of parts) pushNode(p.id, p.label, p.cls)
        for (let i = 0; i + 1 < parts.length; i++) edges.push([parts[i].id, parts[i + 1].id])
      } else {
        const def = /^\s*([^\[\]:"']+?)\s*\["([^"]*)"\]\s*(?:::+(\w+))?/.exec(line)
        if (def) pushNode(def[1].trim(), def[2], def[3])
      }
    }
  }
  // checkbox 顺序与状态（以 checkbox 为准，覆盖 mermaid class）
  // 宽松匹配：AI 常写「id + 标签 + 注释」「标签（注释）」「标签<br/>换行」三种风格，
  // 按 标签全等 / 行首 id / 归一化前缀（去 <br/>、空白、全半角标点后比前缀）三级回退映射回节点
  const norm = s => String(s).replace(/<br\s*\/?>/gi, ' ').replace(/[\s\u3000（）()：:、，,。.\-—_]/g, '')
  const cbStatus = {}
  for (const m of text.matchAll(/^- \[([ x~!])\] (.+)$/gm)) {
    const st = m[1] === 'x' ? 'done' : m[1] === '~' ? 'doing' : m[1] === '!' ? 'warn' : 'todo'
    order.push(m[2])
    cbStatus[m[2]] = st
  }
  for (const n of nodes) {
    let st, key
    if (cbStatus[n.label] !== undefined) { st = cbStatus[n.label]; key = n.label }
    else {
      // 行首 id：checkbox 以「<id> 」「<id>：」「<id>:」开头
      const idKey = Object.keys(cbStatus).find(k =>
        new RegExp(`^${n.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s：:]`).test(k))
      if (idKey) { st = cbStatus[idKey]; key = idKey }
      else if (n.label) {
        // 归一化前缀：标签或 checkbox 任一方为另一方前缀（后缀注释/截断兼容）；取最长匹配降低歧义
        const nl = norm(n.label)
        const cands = Object.keys(cbStatus)
          .filter(k => { const nk = norm(k); return nk !== '' && nl !== '' && (nk.startsWith(nl) || nl.startsWith(nk)) })
          .sort((a, b) => norm(b).length - norm(a).length)
        if (cands.length) { st = cbStatus[cands[0]]; key = cands[0] }
      }
    }
    if (st !== undefined) n.status = st
    // 匹配到的 checkbox 原文：导出报告提取节点的学习内容描述（标签后的括号注释等）
    if (key !== undefined) n.checkbox = key
  }
  const counts = { done: 0, doing: 0, warn: 0, todo: 0 }
  for (const n of nodes) counts[n.status] = (counts[n.status] || 0) + 1
  // mermaid 块原文透传（面板完整渲染 / 导出报告用）；无块为空串，旧字段零改动
  return { topic: fm.topic || '', goal: fm.goal || '', nodes, edges, order, counts,
    planMermaid: mermaid ? mermaid[1].trim() : '' }
}

function mistakeItems(text) {
  const out = []
  for (const m of text.matchAll(/^- \*\*(.+?)\*\*/gm)) out.push(m[1])
  return out
}

async function listTopics(root) {
  const dir = path.join(root, 'curriculum')
  let entries = []
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return [] }
  const topics = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue
    try {
      const plan = parsePlan(await readFile(path.join(dir, e.name, 'plan.md'), 'utf8'))
      let mistakes = []
      try {
        mistakes = mistakeItems(await readFile(path.join(dir, e.name, 'mistakes.md'), 'utf8'))
      } catch { /* 无错题本 */ }
      let notes = []
      try { notes = (await readdir(path.join(dir, e.name, 'notes'))).filter(f => f.endsWith('.md')) } catch { /* 无笔记 */ }
      // 两阶段会话状态：读侧推导（旧 {sessionId} → phase2 存量），sessionId 保留为镜像字段
      const sessionState = await readSessionState(path.join(dir, e.name))
      const planReady = sessionState.phase === 1 && plan.nodes.length >= 2 && !isSkeletonPlan(plan.nodes)
      let studyLog = []
      try { studyLog = parseStudyLog(await readFile(path.join(dir, e.name, 'study-log.md'), 'utf8')) } catch { /* 无学习记录 */ }
      // 材料列表（materials/<topic>/ 下文件名 + 大小）；无目录时为空数组，既有字段零改动
      const materials = []
      try {
        const mdir = path.join(root, 'materials', e.name)
        for (const f of await readdir(mdir)) {
          try { materials.push({ name: f, size: (await stat(path.join(mdir, f))).size }) } catch { /* 文件刚被删 */ }
        }
      } catch { /* 无 materials 目录 */ }
      topics.push({ name: e.name, goal: plan.goal, nodes: plan.nodes, edges: plan.edges,
        order: plan.order, counts: plan.counts, planMermaid: plan.planMermaid,
        mistakes, notes, sessionId: sessionState.phase2SessionId ?? sessionState.phase1SessionId,
        phase: sessionState.phase, phase1SessionId: sessionState.phase1SessionId,
        phase2SessionId: sessionState.phase2SessionId, webSearch: sessionState.webSearch,
        planReady, studyLog: studyLog.slice().reverse().slice(0, 50), materials })
    } catch { /* 无 plan.md 的目录跳过 */ }
  }
  return topics
}

/** 取 content 块数组里的 text 块拼接 */
function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content.filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text).join('').trim()
}

/**
 * 会话历史记录是 { type:'event', event } 包装（宿主 SessionEventsPage.records），
 * 取事件本体后才能用 type/seq 分支。
 */
function unwrapRecord(record) {
  if (!record || typeof record !== 'object') return null
  return record.type === 'event' && record.event ? record.event : record
}

/**
 * 把会话事件流映射为面板用的精简消息数组（client 不接触原始事件）。
 * tool/result 不新增消息条目，只更新更早 seq 的 tool 行；它的状态变化单独放进
 * toolUpdates 回传，否则会被 afterSeq 增量裁剪丢掉。
 */
function mapEvents(records) {
  const messages = []
  const toolUpdates = []
  let lastStart = -1
  let lastEnd = -1
  let cursor = 0
  for (const record of records || []) {
    const ev = unwrapRecord(record)
    if (!ev) continue
    const seq = ev.seq
    if (typeof seq === 'number' && seq > cursor) cursor = seq
    if (ev.type === 'user/message') {
      const src = ev.data && ev.data.source
      // 宿主按 source.kind === 'user' 取真人消息；agent.inject() 的上下文不能混进对话
      if (!src || src.kind !== 'user') continue
      const text = textOf(ev.data && ev.data.content)
      if (text) messages.push({ seq, role: 'user', text })
    } else if (ev.type === 'assistant/message') {
      const text = textOf(ev.data && ev.data.message && ev.data.message.content)
      if (text) messages.push({ seq, role: 'assistant', text })
    } else if (ev.type === 'tool/call') {
      const d = ev.data || {}
      const m = { seq, role: 'tool', toolName: d.name, callId: d.callId, state: 'running' }
      // ask_user_question：把问题内容带上面板渲染成提示卡片（面板输入框可直接作答）
      if (d.name === 'ask_user_question' && typeof d.arguments === 'string') {
        try {
          const parsed = JSON.parse(d.arguments)
          if (Array.isArray(parsed.questions) && parsed.questions.length) m.ask = parsed.questions
        } catch { /* 参数不是合法 JSON 就退回普通工具行 */ }
      }
      messages.push(m)
    } else if (ev.type === 'tool/result') {
      const d = ev.data || {}
      const msg = d.message || {}
      // tool/result 顶层没有 callId：调用标识在 message.toolCallId 或 message.source.callId
      const callId = d.callId || msg.toolCallId || (msg.source && msg.source.callId)
      if (!callId) continue
      const state = d.error || msg.isError ? 'error' : 'done'
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role === 'tool' && m.callId === callId) {
          m.state = state
          break
        }
      }
      if (typeof seq === 'number') toolUpdates.push({ seq, callId, state })
    } else if (ev.type === 'turn/start') {
      if (typeof seq === 'number' && seq > lastStart) lastStart = seq
    } else if (ev.type === 'turn/end') {
      if (typeof seq === 'number' && seq > lastEnd) lastEnd = seq
    }
  }
  return { messages, cursor, running: lastStart > lastEnd, toolUpdates }
}

/** topic 只允许单段目录名，字符白名单与 /topic/create 对齐 */
function validTopic(topic) {
  return typeof topic === 'string' && topic.length > 0 &&
    !/[\\/:*?"<>|]/.test(topic) && !topic.includes('..')
}

/** 宿主 Remote 错误：会话不存在（冷会话也读不到持久化时） */
function isSessionNotFound(err) {
  for (let e = err, depth = 0; e && depth < 4; depth++) {
    const code = typeof e.code === 'string' ? e.code : ''
    if (/not[-_]?found/i.test(code)) return true
    e = e.cause
  }
  return false
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8') || '{}'
  try {
    return JSON.parse(raw)
  } catch {
    const err = new Error('invalid body')
    err.status = 400
    throw err
  }
}

/** 读原始请求体（上传用）：Content-Length 预检 + 读取累计硬顶，超限 413 并断开 */
async function readRawBody(req, cap) {
  const len = Number(req.headers['content-length'] || 0)
  if (len > cap) { const e = new Error('payload too large'); e.status = 413; throw e }
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > cap) {
      try { req.destroy() } catch { /* 已断开 */ }
      const e = new Error('payload too large'); e.status = 413; throw e
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * 手工解析 multipart/form-data（零依赖）：
 * Buffer.indexOf 按 '--boundary' 字节级切段（二进制安全），头区按 utf8 解码取
 * Content-Disposition 的 name / filename（filename*= 优先，RFC 5987）。
 * 文本字段转字符串，文件字段保留 Buffer。解析不出任何 part → 400。
 */
function parseMultipart(buffer, contentType) {
  const bm = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(String(contentType || ''))
  if (!bm) { const e = new Error('missing multipart boundary'); e.status = 400; throw e }
  const boundary = bm[1] || bm[2]
  const delim = Buffer.from('--' + boundary)
  // 行首 boundary（前面必是 \r\n；首个除外）——避免文件内容里恰好出现 boundary 字面量而截断
  const lineDelim = Buffer.concat([Buffer.from('\r\n'), delim])
  const fields = {}
  const files = []
  let pos = buffer.indexOf(delim)
  if (pos === -1) { const e = new Error('invalid multipart body'); e.status = 400; throw e }
  while (pos !== -1) {
    // part 起点：分隔符行后的 \r\n；结尾分隔符是 --boundary--
    let start = pos + delim.length
    if (buffer.slice(start, start + 2).toString('latin1') === '--') break
    start += 2
    const headEnd = buffer.indexOf('\r\n\r\n', start)
    if (headEnd === -1) break
    const next = buffer.indexOf(lineDelim, headEnd)
    if (next === -1) break
    const head = buffer.slice(start, headEnd).toString('utf8')
    // part 体区到 \r\n--boundary 为止（不含该 \r\n）
    const data = buffer.slice(headEnd + 4, next)
    const cd = /content-disposition:([^\r\n]*)/i.exec(head)
    if (cd) {
      const disp = cd[1]
      const nameM = /name="((?:[^"\\]|\\.)*)"/i.exec(disp)
      const name = nameM ? nameM[1].replace(/\\(.)/g, '$1') : ''
      // filename*=UTF-8''...（RFC 5987，百分号解码）优先于普通 filename
      let filename = ''
      const starM = /filename\*=(?:utf-8|UTF-8)''([^;\r\n]+)/i.exec(disp)
      if (starM) {
        try { filename = decodeURIComponent(starM[1].trim()) } catch { filename = starM[1].trim() }
      } else {
        const fileM = /filename="((?:[^"\\]|\\.)*)"/i.exec(disp)
        if (fileM) filename = fileM[1].replace(/\\(.)/g, '$1')
      }
      if (filename) files.push({ name: name || 'file', filename, data })
      else if (name) fields[name] = data.toString('utf8')
    }
    pos = next + 2
  }
  if (!Object.keys(fields).length && !files.length) {
    const e = new Error('invalid multipart body: no parts'); e.status = 400; throw e
  }
  return { fields, files }
}

/** 材料扩展名白名单（小写比较） */
const MATERIAL_EXTS = new Set(['pdf', 'md', 'txt', 'docx', 'pptx', 'xlsx', 'csv', 'json', 'epub', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'zip'])
const MAX_FILE_SIZE = 20 * 1024 * 1024        // 单文件 20MB
const MAX_TOPIC_TOTAL = 200 * 1024 * 1024     // 课程总量 200MB
const MAX_UPLOAD_BODY = 25 * 1024 * 1024      // 请求级硬顶 25MB

/** 材料文件名清洗：去 Windows 非法字符与首尾空白/点；空名拒绝 */
function cleanMaterialName(filename) {
  let n = String(filename || '').replace(/[\\/:*?"<>|]/g, '').trim().replace(/^[. ]+|[. ]+$/g, '')
  if (!n || n === '.' || n === '..') { const e = new Error('文件名为空或不合法'); e.status = 400; throw e }
  return n
}

/** 同名冲突：name-1.ext、name-2.ext 依序找空位，不覆盖 */
async function dedupeName(dir, name) {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let candidate = name
  for (let i = 1; ; i++) {
    try { await stat(path.join(dir, candidate)); candidate = `${stem}-${i}${ext}` }
    catch { return candidate }
  }
}

async function journalLines(root, limit = 8) {
  const dir = path.join(root, 'journal')
  let files = []
  try { files = (await readdir(dir)).filter(f => f.endsWith('.md')).sort().reverse() } catch { return [] }
  const lines = []
  for (const f of files) {
    const text = await readFile(path.join(dir, f), 'utf8')
    for (const m of text.matchAll(/^- (\d{4}-\d{2}-\d{2}[^\n]*)$/gm)) lines.push(m[1])
    if (lines.length >= limit) break
  }
  return lines.slice(0, limit)
}

// ── session.json 两阶段状态（读侧推导 + 写侧镜像） ──────────────

/**
 * 读课程会话状态并做内存推导（迁移不落盘）：
 * 旧 {sessionId}（无 phase 字段）→ 视为 { phase:2, phase2SessionId:sessionId }，
 * 存量课程直接进阶段二续学；webSearch 缺省 true（对齐 learn_guide 现有「上网检索核实」）。
 * 无 session.json 返回初始空态（phase 1、双空）。
 */
async function readSessionState(topicDir) {
  let raw = null
  try { raw = JSON.parse(await readFile(path.join(topicDir, 'session.json'), 'utf8')) } catch { /* 未绑定 */ }
  if (!raw) return { phase: 1, phase1SessionId: null, phase2SessionId: null, webSearch: true }
  if (raw.phase == null && raw.sessionId) {
    return { phase: 2, phase1SessionId: null, phase2SessionId: raw.sessionId, webSearch: raw.webSearch !== false }
  }
  const phase1SessionId = raw.phase1SessionId ?? null
  const phase2SessionId = raw.phase2SessionId ?? null
  let phase = raw.phase
  if (phase !== 1 && phase !== 2) phase = phase2SessionId ? 2 : 1
  return { phase, phase1SessionId, phase2SessionId, webSearch: raw.webSearch !== false }
}

/** 写侧始终带镜像 sessionId = phase2SessionId ?? phase1SessionId：回滚到旧插件仍能路由到会话 */
async function writeSessionState(topicDir, state) {
  const doc = {
    phase: state.phase === 2 ? 2 : 1,
    phase1SessionId: state.phase1SessionId ?? null,
    phase2SessionId: state.phase2SessionId ?? null,
    webSearch: state.webSearch !== false,
    sessionId: state.phase2SessionId ?? state.phase1SessionId ?? null,
  }
  await writeFile(path.join(topicDir, 'session.json'), JSON.stringify(doc, null, 2), 'utf8')
  return doc
}

// ── 模型选择持久化（项目根 .learning-space.json） ──────────────

/** 读模型选择：无文件 / 坏 JSON / 形状不合法 → null（= 跟随宿主默认，与现状一致） */
async function readModelSelection(root) {
  let raw = null
  try { raw = JSON.parse(await readFile(path.join(root, '.learning-space.json'), 'utf8')) }
  catch { /* 无文件或坏 JSON：按 null 处理，可 warn 但不必打扰 */ }
  const m = raw && raw.model
  if (!m || typeof m !== 'object' || typeof m.provider !== 'string' || !m.provider ||
    typeof m.model !== 'string' || !m.model) return null
  const sel = { provider: m.provider, model: m.model }
  if (typeof m.reasoningEffort === 'string' && m.reasoningEffort) sel.reasoningEffort = m.reasoningEffort
  return sel
}

/** 写模型选择：sel 为 null 时写 {model:null}（读侧与无文件等价） */
async function writeModelSelection(root, sel) {
  await writeFile(path.join(root, '.learning-space.json'),
    JSON.stringify({ model: sel ?? null }, null, 2), 'utf8')
}

/** 立即应用的目标会话：phase2 优先，无则 phase1，都未绑定返回 null */
async function modelApplyTarget(root, topic) {
  const state = await readSessionState(path.join(root, 'curriculum', topic))
  if (state.phase2SessionId) return { phase: 2, sessionId: state.phase2SessionId }
  if (state.phase1SessionId) return { phase: 1, sessionId: state.phase1SessionId }
  return null
}

/** 缺省 phase 推导：显式 1|2 优先，否则有 phase2SessionId → 2，再退 state.phase */
function resolvePhase(state, phase) {
  if (phase === 1 || phase === 2) return phase
  if (state.phase2SessionId) return 2
  return state.phase === 2 ? 2 : 1
}

/** 按 phase 取对应会话 id */
function phaseSessionId(state, phase) {
  return phase === 1 ? state.phase1SessionId : phase === 2 ? state.phase2SessionId : null
}

// ── 两段 seed 指令（联网话术同一处三元拼接，保证两段一致） ──────────

/** 资料来源话术：按材料目录实际存在与否拼接，避免 AI 去找不存在的目录或误以为无源可教 */
function sourceLine(topic, webSearch, hasMaterials) {
  if (hasMaterials) {
    return `用户上传的材料在 materials/${topic}/ 目录下，先读原文再规划。${webSearch ? '材料不足时允许用网络搜索核实补充。' : '只允许使用用户上传的材料，禁止联网检索。'}`
  }
  return `用户未上传材料（materials/${topic}/ 目录不存在或为空，这是正常情况，不必再查找或报错）。${webSearch ? '以网络搜索获取并核实教学资料。' : '以你已有知识教学，禁止联网检索；对没把握的关键事实，明确向我标注「未经核实」。'}`
}

/** 阶段一 seed：只摸底 + 生成 plan.md，不开教 */
function seedPhase1(topic, goal, webSearch, hasMaterials) {
  return `我开始了课程《${topic}》的摸底与学习计划生成${goal ? `（目标：${goal}）` : ''}。请先调用 learn_guide 获取完整教学方法，然后**只执行教学流程的前三步**：
1. 确认资料来源：${sourceLine(topic, webSearch, hasMaterials)}
2. 出题定位：按 quiz 教学方法出摸底题，定位我的当前水平。
3. 生成学习计划：综合目标和摸底结果，用 learn_update 的 save 把完整的 curriculum/${topic}/plan.md 重写（必须保持 frontmatter(topic/goal) + mermaid 依赖图(classDef done/doing/warn/todo + 节点:::类名) + 「## 学习顺序」checkbox 的格式）。

**本阶段不要开始正式教学，不要讲解任何节点的内容。** 计划写入 plan.md 后，明确告诉我：「学习计划已生成，请在学习空间面板点击开始学习」。`
}

/** 阶段二 seed：按 plan.md 逐节点教学，每节点确认后必须写 study_log 与节点笔记 */
function seedPhase2(topic, goal, webSearch, hasMaterials) {
  return `我开始课程《${topic}》的正式学习${goal ? `（目标：${goal}）` : ''}。请先调用 learn_guide 获取教学方法，再调用 learn_status 查看进度，然后严格按 curriculum/${topic}/plan.md 的「学习顺序」教学：从第一个未确认（\`[ ]\`/\`[!]\`）节点开始，已确认的跳过。
每教完一个节点，依次：①向我确认掌握情况后才进入下一节点；②用 learn_update 的 save 更新 plan.md 中该节点的 checkbox 状态；③**必须**用 learn_update 的 study_log 把本节点摘要（知识点要点 + 我的掌握情况）写入学习记录；④发现我答错的题用 record_mistake 记错题；⑤**必须**用 learn_update 的 save 把该节点教学笔记写入 curriculum/${topic}/notes/<节点>.md（frontmatter 带 node/deps/date，正文为本节点讲解要点，公式用 LaTeX）——面板的节点笔记区靠这个文件渲染，缺了会一直显示「还没有教学笔记」。
资料来源：${sourceLine(topic, webSearch, hasMaterials)}`
}

// ── 计划成型检测 + 学习记录解析 ──────────────────

const SKELETON_LABELS = ['无条件真理', '目标']
/** 骨架 plan 签名：恰好两节点且标签为骨架对（/topic/create 与 init_topic 写入的初始骨架） */
function isSkeletonPlan(nodes) {
  return nodes.length === 2 && nodes.every(n => SKELETON_LABELS.includes(n.label))
}

/** study-log.md → 条目数组（文件顺序，最早在前）；条目 = `## 日期 · 节点` + 要点/掌握行 */
function parseStudyLog(text) {
  const entries = []
  for (const b of String(text || '').split(/(?=^## )/m)) {
    const head = /^## (\d{4}-\d{2}-\d{2}) · (.+?)\s*$/m.exec(b)
    if (!head) continue
    const pick = re => { const m = re.exec(b); return m ? m[1].trim() : '' }
    entries.push({ date: head[1], node: head[2], summary: pick(/^- 要点：(.*)$/m), mastery: pick(/^- 掌握：(.*)$/m) })
  }
  return entries
}

/** 限制相对路径只在允许的根内，防逃逸 */
function safeJoin(root, rel, allowedBases) {
  const norm = rel.replace(/\\/g, '/')
  const base = allowedBases.find(b => norm === b || norm.startsWith(b + '/'))
  if (!base || norm.includes('..')) throw new Error(`路径越界或不被允许: ${rel}（只允许 ${allowedBases.join(', ')} 下）`)
  return path.join(root, norm)
}

// ── 导出报告（自包含 HTML）─────────────────────────

/** 笔记文件名匹配：notes 目录文件列表 + 节点名 → 匹配的文件名（精确/清洗/归一化三级） */
function matchNoteFile(files, node) {
  const stem = n => n.replace(/\.md$/i, '')
  const norm = s => s.replace(/[\s\u3000（）()：:、，,。.\-—_/\\]/g, '')
  return files.find(f =>
    stem(f) === node
    || stem(f) === node.replace(/[\\/:*?"<>|]/g, '-')
    || norm(stem(f)) === norm(node)) || null
}

/** 报告展示用标签清洗：<br/> 换行标记 → 「 · 」（源数据不动） */
const reportLabel = s => String(s || '').replace(/<br\s*\/?>/gi, ' · ').replace(/\s{2,}/g, ' ').trim()

/** 节点在计划中的学习内容描述：mermaid 标签 <br/> 后的子描述 + checkbox 超出标签的注释 */
function nodePlanDesc(n) {
  const punct = /[\s　（）()：:、，,。.\-—_/]/
  const norm = s => String(s).replace(new RegExp(punct.source, 'g'), '')
  // 纯进度注释（「（2026-11-19 已确认）」之类）不是学习内容，过滤
  const statusOnly = /^[(（]?\s*(\d{4}-\d{2}-\d{2}\s*)?(摸底)?(已确认|待学|待修复|进行中|未学|已掌握|基本掌握|需复习)\s*[)）]?$/
  const parts = []
  const label = String(n.label || '')
  const br = /<br\s*\/?>/i.exec(label)
  if (br) {
    const tail = label.slice(br.index + br[0].length).replace(/<br\s*\/?>/gi, '；').trim()
    if (tail) parts.push(tail)
  }
  const cb = String(n.checkbox || '')
  if (cb) {
    // checkbox 可能带「<id> 」前缀；标签取 <br/> 前的主标题做前缀比对。
    // 全半角标点/空白差异（mermaid 用 : checkbox 用 ：）按归一化前缀定位，再映射回原文取注释
    const head = (br ? label.slice(0, br.index) : label).trim()
    const idPrefix = new RegExp(`^${String(n.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s：:]+`)
    const body = cb.replace(idPrefix, '').trim()
    const normHead = norm(head)
    // idx[i] = 归一化第 i 个字符在原文中的下一位置，用于把前缀长度映射回原文切出注释
    const idx = []
    let normBody = ''
    for (let i = 0; i < body.length; i++) {
      if (!punct.test(body[i])) { normBody += body[i]; idx.push(i + 1) }
    }
    if (normHead && normBody.length > normHead.length && normBody.startsWith(normHead)) {
      const tail = body.slice(idx[normHead.length - 1]).trim()
      const inner = tail.replace(/^[（(]\s*/, '').replace(/\s*[)）]$/, '')
      // 与 <br/> 子描述归一化后互为子串的视为重复（「终止」vs「终止条件」），只留更长的
      const nt = norm(inner)
      const dup = parts.findIndex(p => { const np = norm(p); return np && nt && (np.includes(nt) || nt.includes(np)) })
      if (tail && !statusOnly.test(inner)) {
        if (dup >= 0) { if (nt.length > norm(parts[dup]).length) parts[dup] = tail }
        else parts.push(tail)
      }
    }
  }
  return parts.join('；')
}

/** 插件自身目录（定位 assets/，不依赖 cwd） */
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))

/** Host 侧 KaTeX：导出报告时直接把公式渲染成 HTML（报告离线单文件，不带 katex.min.js） */
let katexHostState = 0   // 0 未加载 / 1 可用 / 2 缺失
let katexHost = null
function getKatexHost() {
  if (!katexHostState) {
    try {
      // 本包 type:module，require 会把 UMD 当 ESM 解析失败；读源码按 CJS 沙箱求值拿 module.exports
      const code = readFileSync(path.join(PLUGIN_DIR, 'assets', 'katex', 'katex.min.js'), 'utf8')
      const mod = { exports: {} }
      new Function('module', 'exports', code)(mod, mod.exports)
      if (typeof mod.exports.renderToString !== 'function') throw new Error('katex UMD 求值后无 renderToString')
      katexHost = mod.exports
      katexHostState = 1
    } catch { katexHostState = 2 }
  }
  return katexHostState === 1 ? katexHost : null
}
let katexCssCache = null
/** katex.min.css 的 woff2 内联成 data URI（单文件报告没法相对引字体），读过一次即缓存 */
function getKatexCss() {
  if (katexCssCache) return katexCssCache
  try {
    let css = readFileSync(path.join(PLUGIN_DIR, 'assets', 'katex', 'katex.min.css'), 'utf8')
    css = css.replace(/url\(fonts\/([\w-]+\.woff2)\)/g, (m, name) => {
      const b64 = readFileSync(path.join(PLUGIN_DIR, 'assets', 'katex', 'fonts', name)).toString('base64')
      return `url(data:font/woff2;base64,${b64})`
    })
    katexCssCache = css
  } catch { katexCssCache = '' }
  return katexCssCache
}
/** 渲染一条公式；资产缺失记 ctx.wanted 走降级，成功记 ctx.used 供 head 决定是否内嵌样式 */
function renderTexHost(tex, block, ctx) {
  const k = getKatexHost()
  if (!k || !getKatexCss()) { ctx.wanted = true; return null }
  ctx.used = true
  return k.renderToString(tex, { displayMode: block, throwOnError: false, strict: false })
}
/** 报告行内片段 → HTML：非公式/非标记部分转义，公式走 KaTeX，**加粗** 与 `行内码` 同客户端规则 */
function reportInlineHtml(text, ctx) {
  const src = String(text ?? '')
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\$\$[^$\n]+?\$\$|(?<!\\)\$(?![\s$])[^$\n]+?(?<![\s\\])\$(?!\d)|\\\((?:[^\\\n]|\\.)+?\\\)|\\\[(?:[^\\\n]|\\.)+?\\\])/g
  let out = ''
  let last = 0, m
  while ((m = re.exec(src))) {
    out += escapeHtml(src.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out += `<strong>${escapeHtml(t.slice(2, -2))}</strong>`
    else if (t.startsWith('`')) out += `<code>${escapeHtml(t.slice(1, -1))}</code>`
    else {
      const tex = t.startsWith('$') && !t.startsWith('$$') ? t.slice(1, -1) : t.slice(2, -2)
      out += renderTexHost(tex, false, ctx) ?? escapeHtml(t)
    }
    last = m.index + t.length
  }
  return out + escapeHtml(src.slice(last))
}

/** HTML 转义：& < > " ' 五字符 */
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** mermaid 源码进 <script>/HTML 前的双保险：先 HTML 转义，再拆 </script 字面量 */
function escapeMermaidSrc(s) {
  return escapeHtml(s).replace(/<\/script/gi, '&lt;\\/script')
}

/** 内嵌 JS（mermaid.min.js 全文）安全放进 <script>：拆掉闭合标签字面量 */
function embedJs(code) {
  return String(code).replace(/<\/script/gi, '<\\/script')
}

const REPORT_STATUS_LABEL = { done: '已确认', doing: '进行中', warn: '待修复', todo: '未学' }
const REPORT_STATUS_COLOR = { done: '#3E6B4F', doing: '#3D5A80', warn: '#B5432E', todo: '#6E6A60' }

/**
 * 自包含 HTML 报告（方案 A）：mermaid.min.js 全文内嵌，浏览器打开时 startOnLoad 渲染。
 * mermaidJs 为 null 时降级：不嵌脚本，.mermaid 块直接显示源码文本 + 顶部提示。
 */
/** 导出报告用极简 markdown → HTML：代码块/块级公式/标题/列表/加粗/行内码/行内公式；无法识别的行按段落（先整体转义防注入） */
function mdToHtmlHost(text, ctx) {
  const esc = escapeHtml
  const lines = String(text || '').split(/\r?\n/)
  const out = []
  let code = null
  let list = null
  let math = null
  let mathClose = null
  const flushList = () => { if (list && list.length) { out.push(`<ul>${list.map(li => `<li>${reportInlineHtml(li, ctx)}</li>`).join('')}</ul>`); list = null } }
  const pushBlock = tex => {
    const html = renderTexHost(tex, true, ctx)
    out.push(html ? `<div class="math-block">${html}</div>` : `<pre><code>${esc(`$$${tex}$$`)}</code></pre>`)
  }
  const flushMath = () => {
    if (!math) return
    const tex = math.join('\n').trim()
    math = null; mathClose = null
    if (tex) pushBlock(tex)
  }
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      if (code) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null } else { flushList(); code = [] }
      continue
    }
    if (code) { code.push(raw); continue }
    if (math) {
      const at = raw.search(mathClose)
      if (at >= 0) {
        const before = raw.slice(0, at)
        if (before.trim()) math.push(before)
        flushMath()
      } else math.push(raw)
      continue
    }
    // 块级公式：$$…$$ 或 \[…\]，同行闭合且后面没正文才当块，否则交给行内处理
    const openAt = /^\s*(?:\$\$|\\\[)/.test(raw) ? (/^\s*\$\$/.test(raw) ? raw.indexOf('$$') : raw.indexOf('\\[')) : -1
    if (openAt >= 0) {
      const dollar = raw[openAt] === '$'
      const body = raw.slice(openAt + 2)
      const closeRe = dollar ? /\$\$/ : /\\\]/
      const at = body.search(closeRe)
      const after = at >= 0 ? body.slice(at + 2) : ''
      if (at < 0 || !after.trim()) {
        flushList()
        if (at < 0) { math = []; mathClose = closeRe; if (body.trim()) math.push(body) }
        else {
          const tex = body.slice(0, at).trim()
          if (tex) pushBlock(tex)
        }
        continue
      }
    }
    const hm = /^(#{1,4})\s+(.*)$/.exec(raw)
    if (hm) { flushList(); out.push(`<h4>${reportInlineHtml(hm[2], ctx)}</h4>`); continue }
    if (/^\s*[-*]\s+/.test(raw)) { list = list || []; list.push(raw.replace(/^\s*[-*]\s+/, '')); continue }
    flushList()
    if (raw.trim()) out.push(`<p>${reportInlineHtml(raw, ctx)}</p>`)
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
  flushList()
  flushMath()
  return out.join('\n')
}

function buildReportHtml(topicsData, { all, mermaidJs }) {
  const esc = escapeHtml
  const mctx = { used: false, wanted: false }
  const date = new Date().toISOString().slice(0, 10)
  const title = all ? `学习报告 · 全部课程（${date}）` : `学习报告 · ${topicsData[0] ? topicsData[0].name : ''}（${date}）`
  const sections = topicsData.map(t => {
    const { name, goal, counts, nodes, planMermaid, quizRecords, mistakes, journal } = t
    const total = nodes.length
    const doneCount = counts.done || 0
    const pct = total ? Math.round((doneCount / total) * 100) : 0
    const badges = ['done', 'doing', 'warn', 'todo'].filter(s => counts[s])
      .map(s => `<span class="badge" style="background:${REPORT_STATUS_COLOR[s]}">${REPORT_STATUS_LABEL[s]} ${counts[s]}</span>`).join('')
    const nodeRows = nodes.map(n =>
      `<tr><td>${esc(reportLabel(n.label))}</td><td><span class="badge" style="background:${REPORT_STATUS_COLOR[n.status] || REPORT_STATUS_COLOR.todo}">${REPORT_STATUS_LABEL[n.status] || n.status}</span></td></tr>`).join('')
    const quizRows = quizRecords.length ? quizRecords.map(r =>
      `<tr><td>${esc(r.date)}</td><td>第 ${esc(r.index)} / ${esc(r.total)} 题</td><td>${r.correct ? '✅ 答对' : '❌ 答错'}</td><td>${reportInlineHtml(r.stem, mctx)}</td><td>答 ${esc(r.answer)}</td><td>${reportInlineHtml(r.feedback, mctx)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">暂无答题记录</td></tr>'
    const mistakeItemsHtml = mistakes.length
      ? `<ul>${mistakes.map(m => `<li>${reportInlineHtml(m, mctx)}</li>`).join('')}</ul>`
      : '<p class="muted">暂无错题</p>'
    const journalHtml = journal.length
      ? `<ul>${journal.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
      : '<p class="muted">暂无日志</p>'
    const studyLog = t.studyLog || []
    const studyRows = studyLog.length ? studyLog.map(e =>
      `<tr><td>${esc(e.date)}</td><td>${esc(e.node)}</td><td>${esc(e.mastery || '—')}</td><td>${reportInlineHtml(e.summary, mctx)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="muted">暂无学习记录</td></tr>'
    const nodeNotes = t.nodeNotes || []
    const notesHtml = nodeNotes.length
      ? nodeNotes.map(nn => {
        const body = nn.content
          ? mdToHtmlHost(nn.content, mctx)
          : nn.desc
            ? `<p>${esc(nn.desc)}</p><p class="muted">以上为该节点计划中的学习内容，教学笔记将在学习确认后写入。</p>`
            : '<p class="muted">暂无教学笔记（学到这里时 AI 会写入 notes/&lt;节点&gt;.md）</p>'
        return `<details class="note"${nn.content ? ' open' : ''}><summary><span class="badge" style="background:${REPORT_STATUS_COLOR[nn.status] || REPORT_STATUS_COLOR.todo}">${REPORT_STATUS_LABEL[nn.status] || nn.status || ''}</span> ${esc(reportLabel(nn.label))}</summary><div class="note-body">${body}</div></details>`
      }).join('\n')
      : '<p class="muted">暂无教学笔记（学到的节点会由 AI 写入 notes 后出现在这里）</p>'
    return `<section>
  <h2>${esc(name)}</h2>
  <p class="goal">${esc(goal || '（未设置目标）')}</p>
  <div class="meta">${esc(doneCount)} / ${esc(total)} 已确认（${esc(pct)}%） ${badges}</div>
  <div class="bar"><div class="bar-fill" style="width:${esc(pct)}%"></div></div>
  <h3>依赖图</h3>
  <div class="graph-wrap">${planMermaid
    ? `<div class="mermaid${mermaidJs ? '' : ' raw'}">${escapeMermaidSrc(planMermaid)}</div>`
    : '<p class="muted">plan.md 中无 mermaid 图</p>'}</div>
  <h3>节点状态</h3>
  <table><thead><tr><th>节点</th><th>状态</th></tr></thead><tbody>${nodeRows || '<tr><td colspan="2" class="muted">无节点</td></tr>'}</tbody></table>
  <h3>节点学习内容</h3>
  <div class="notes">${notesHtml}</div>
  <h3>学习记录</h3>
  <table><thead><tr><th>日期</th><th>节点</th><th>掌握</th><th>要点</th></tr></thead><tbody>${studyRows}</tbody></table>
  <h3>答题历史</h3>
  <table><thead><tr><th>日期</th><th>序号</th><th>结果</th><th>题面</th><th>作答</th><th>反馈</th></tr></thead><tbody>${quizRows}</tbody></table>
  <h3>错题</h3>${mistakeItemsHtml}
  <h3>学习日志</h3>${journalHtml}
</section>`
  }).join('\n')
  const mermaidBoot = mermaidJs
    ? `<script>${embedJs(mermaidJs)}</script>
<script>
mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose' })
</script>`
    : `<p class="warn">mermaid 资产缺失，依赖图以源码文本显示。</p>`
  const katexCss = mctx.used ? getKatexCss() : ''
  const katexWarn = mctx.wanted ? '<p class="warn">KaTeX 资产缺失，公式以原始 TeX 显示。</p>' : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0 auto;
  max-width: 960px; padding: 24px 20px; color: #2c2c2c; background: #faf9f6; line-height: 1.7; }
h1 { font-size: 24px; } h2 { font-size: 18px; border-bottom: 2px solid #3d5a80; padding-bottom: 6px; }
h3 { font-size: 14px; color: #6e6a60; letter-spacing: 2px; margin-bottom: 6px; }
section { background: #fff; border: 1px solid #e4e0d8; border-radius: 10px; padding: 18px 22px; margin-bottom: 20px; }
.goal { color: #6e6a60; margin: 4px 0 10px; }
.meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; }
.badge { display: inline-block; color: #faf7f0; font-size: 12px; border-radius: 10px; padding: 1px 10px; }
.bar { height: 6px; border-radius: 3px; background: #e4e0d8; margin: 10px 0 16px; overflow: hidden; }
.bar-fill { height: 100%; background: #3e6b4f; }
.graph-wrap { border: 1px solid #e4e0d8; border-radius: 8px; padding: 10px; overflow-x: auto; margin-bottom: 14px; }
.mermaid { display: flex; justify-content: center; }
.mermaid.raw { white-space: pre; font-family: Consolas, monospace; font-size: 12px; text-align: left; }
.mermaid svg { max-width: 100%; }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin-bottom: 14px; }
th, td { border: 1px solid #e4e0d8; padding: 5px 9px; text-align: left; word-break: break-word; }
th { background: #f1eee7; }
.notes details.note { border: 1px solid #e4e0d8; border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; }
.notes summary { cursor: pointer; font-weight: 600; font-size: 13px; }
.notes .note-body { border-top: 1px dashed #e4e0d8; margin-top: 8px; padding-top: 8px; font-size: 13px; }
.notes .note-body pre { background: #f1eee7; border-radius: 6px; padding: 8px 10px; overflow-x: auto; font-size: 12px; }
.notes .note-body code { background: #f1eee7; border-radius: 3px; padding: 0 4px; }
ul { padding-left: 20px; } li { margin: 3px 0; font-size: 13px; }
.muted { color: #9a968c; font-size: 13px; }
.warn { background: #fdf3e7; border: 1px solid #e8c89a; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
.math-block { overflow-x: auto; overflow-y: hidden; margin: 8px 0; }
.math-block .katex-display { margin: 0; }
footer { color: #9a968c; font-size: 12px; text-align: center; margin-top: 12px; }
</style>
${katexCss ? `<style>${katexCss}</style>` : ''}
</head>
<body>
<h1>${esc(title)}</h1>
${all && topicsData.length > 1 ? `<p class="muted">共 ${esc(topicsData.length)} 门课程</p>` : ''}
${mermaidBoot}
${katexWarn}
${sections}
<footer>由学习空间面板导出 · ${esc(date)}</footer>
</body>
</html>`
}

/** 导出用：课程名进文件名的清洗 */
function cleanFilename(s) {
  return String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 50) || 'report'
}

/** 收集一门课程的导出数据（plan/mistakes 已在 listTopics 读过，补 quiz 记录、study-log、节点教学笔记与该课日志） */
async function collectTopicForExport(root, t) {
  const quizRecords = await parseQuizLog(root, t.name).catch(() => [])
  const allJournal = await journalLines(root, 100).catch(() => [])
  const journal = allJournal.filter(l => l.includes(`· ${t.name} ·`))
  let studyLog = []
  try { studyLog = parseStudyLog(await readFile(path.join(root, 'curriculum', t.name, 'study-log.md'), 'utf8')) } catch { /* 无学习记录 */ }
  // 节点教学内容：全部节点按顺序列出；有 notes/<节点>.md 的带笔记全文，
  // 没有的带计划里的学习内容描述（mermaid <br/> 子描述 + checkbox 注释）
  let noteFiles = []
  try { noteFiles = await readdir(path.join(root, 'curriculum', t.name, 'notes')) } catch { /* 无 notes 目录 */ }
  const nodeNotes = []
  for (const n of t.nodes) {
    const label = n.label || n.id
    let content = ''
    const f = matchNoteFile(noteFiles, label)
    if (f) {
      try { content = await readFile(path.join(root, 'curriculum', t.name, 'notes', f), 'utf8') } catch { /* 读失败按无笔记 */ }
      // 笔记头部 frontmatter（node/deps/date）是元数据，报告只呈现正文
      content = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    }
    nodeNotes.push({ label, status: n.status, desc: nodePlanDesc(n), content: content.trim() ? content : '' })
  }
  return { name: t.name, goal: t.goal, counts: t.counts, nodes: t.nodes,
    planMermaid: t.planMermaid, quizRecords, mistakes: t.mistakes, journal,
    studyLog: studyLog.slice().reverse(), nodeNotes }
}

const toolOutput = {
  schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
  render: (_args, result) => [{ type: 'text', text: result.text }],
}

export function apply(ctx, config) {
  const root = (config && config.root) || process.cwd()

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/learning-space',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(body))
      }
      try {
        // 路由分派：multipart 只允许上传路由，其余路由收到 multipart 直接 415（readBody 只吃 JSON）
        const ct = (req.headers['content-type'] || '').toLowerCase()
        const isMultipart = ct.startsWith('multipart/')
        const isUpload = req.method === 'POST' && url.pathname === '/api/learning-space/materials/upload'
        if (isMultipart && !isUpload) { send(415, { ok: false, error: '该接口只接受 JSON 请求' }); return }
        if (!isMultipart && isUpload) { send(415, { ok: false, error: '上传接口要求 multipart/form-data 请求' }); return }

        // 材料上传：multipart 落盘 materials/<topic>/（二进制安全手工解析）
        if (isUpload) {
          const raw = await readRawBody(req, MAX_UPLOAD_BODY)
          const { fields, files } = parseMultipart(raw, req.headers['content-type'])
          const topic = fields.topic
          if (!validTopic(topic)) { send(400, { ok: false, error: '课程名不合法' }); return }
          try { await readFile(path.join(root, 'curriculum', topic, 'plan.md'), 'utf8') }
          catch { send(404, { ok: false, error: `课程「${topic}」不存在` }); return }
          if (!files.length) { send(400, { ok: false, error: '缺少文件字段 file' }); return }
          // 先全量校验（扩展名 / 单文件大小 / 课程总量），任一违规则整个请求拒绝，不落半批
          const mdir = path.join(root, 'materials', topic)
          let existing = 0
          try {
            for (const f of await readdir(mdir)) {
              try { existing += (await stat(path.join(mdir, f))).size } catch { /* 忽略 */ }
            }
          } catch { /* 目录尚不存在 */ }
          let incoming = 0
          for (const f of files) {
            const clean = cleanMaterialName(f.filename)
            const dot = clean.lastIndexOf('.')
            const ext = dot > 0 ? clean.slice(dot + 1).toLowerCase() : ''
            if (!MATERIAL_EXTS.has(ext)) {
              send(400, { ok: false, error: `文件类型不允许: .${ext || clean}` }); return
            }
            if (f.data.length > MAX_FILE_SIZE) {
              send(413, { ok: false, error: `文件「${clean}」超过单文件 20MB 上限` }); return
            }
            incoming += f.data.length
          }
          if (existing + incoming > MAX_TOPIC_TOTAL) {
            send(413, { ok: false, error: '课程材料总大小超过 200MB' }); return
          }
          // 全量校验通过后统一写盘；同名冲突加序号
          await mkdir(mdir, { recursive: true })
          const saved = []
          for (const f of files) {
            const clean = cleanMaterialName(f.filename)
            const finalName = await dedupeName(mdir, clean)
            await writeFile(path.join(mdir, finalName), f.data)
            saved.push({ name: finalName, size: f.data.length })
          }
          send(200, { ok: true, files: saved })
          return
        }
        if (req.method === 'GET' && url.pathname === '/api/learning-space/overview') {
          const [topics, journal] = await Promise.all([listTopics(root), journalLines(root)])
          send(200, { ok: true, topics, journal })
          return
        }
        // 模型设置：宿主模型目录透传 + 已保存选择；目录加载失败降级 catalog:null（保存仍可行，前端仅允许跟默认）
        if (req.method === 'GET' && url.pathname === '/api/learning-space/settings/model') {
          const saved = { model: await readModelSelection(root) }
          let catalog = null
          let error = null
          try { catalog = await ctx.sessionController.modelCatalog() }
          catch (err) { error = `模型目录暂不可用: ${String(err && err.message || err)}` }
          send(200, { ok: true, catalog, saved, error })
          return
        }
        // 模型设置保存：写 .learning-space.json；可选 applyToTopic 立即应用到该课程 phase2（无则 phase1）会话，
        // apply 失败不使保存失败，错误文本随 applyError 返回
        if (req.method === 'POST' && url.pathname === '/api/learning-space/settings/model') {
          const { model, applyToTopic } = await readBody(req)
          if (model !== null) {
            const bad = !model || typeof model !== 'object' ||
              typeof model.provider !== 'string' || !model.provider ||
              typeof model.model !== 'string' || !model.model ||
              (model.reasoningEffort !== undefined &&
                (typeof model.reasoningEffort !== 'string' || !model.reasoningEffort))
            if (bad) { send(400, { ok: false, error: 'invalid model' }); return }
          }
          if (applyToTopic !== undefined && !validTopic(applyToTopic)) {
            send(400, { ok: false, error: 'invalid topic' }); return
          }
          const sel = model === null ? null
            : model.reasoningEffort !== undefined
              ? { provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort }
              : { provider: model.provider, model: model.model }
          try { await writeModelSelection(root, sel) }
          catch (err) { send(500, { ok: false, error: String(err && err.message || err) }); return }
          let applied = null
          let applyError = null
          if (applyToTopic && sel) {
            try {
              const target = await modelApplyTarget(root, applyToTopic)
              if (target) {
                await ctx.sessionController.selectModel(
                  { sessionId: target.sessionId, ...sel }, AbortSignal.timeout(8000))
                applied = { topic: applyToTopic, phase: target.phase, sessionId: target.sessionId, selected: sel }
              }
            } catch (err) { applyError = String(err && err.message || err) }
          }
          send(200, { ok: true, saved: { model: sel }, applied, applyError })
          return
        }
        // 开始/继续某课程的学习会话（分相）：phase=1 摸底会话「摸底 · X」，phase=2 学习会话「学习 · X」
        // 有绑定直接返回（幂等）：冷会话由宿主 prompt/events 按需恢复，不重发 seed；
        // 新建仅两入口：对应 phase 无绑定，或失效绑定显式 rebind:true（只重建该 phase 的会话）。
        if (req.method === 'POST' && url.pathname === '/api/learning-space/session/start') {
          const { topic, rebind, phase: phaseParam } = await readBody(req)
          if (!topic || typeof topic !== 'string' || topic.includes('..') || topic.includes('/')) {
            send(400, { ok: false, error: 'invalid topic' }); return
          }
          const topicDir = path.join(root, 'curriculum', topic)
          const state = await readSessionState(topicDir)
          const phase = resolvePhase(state, phaseParam)
          let sessionId = phaseSessionId(state, phase)
          if (!sessionId || rebind === true) {
            const created = await ctx.sessionController.create({ cwd: root })
            sessionId = created.sessionId
            const next = { ...state }
            if (phase === 1) { next.phase = 1; next.phase1SessionId = sessionId }
            else { next.phase = 2; next.phase2SessionId = sessionId }
            await writeSessionState(topicDir, next)
            const session = ctx.sessions.get(sessionId)
            if (session) {
              try { ctx.sessionTitle.rename(session, phase === 1 ? `摸底 · ${topic}` : `学习 · ${topic}`) } catch { /* 标题失败不阻塞 */ }
            }
            // 点开始学习时，把阶段一摸底会话改名归位「摸底 · X」（旧数据可能叫「学习 · X」）
            if (phase === 2 && next.phase1SessionId && next.phase1SessionId !== sessionId) {
              const s1 = ctx.sessions.get(next.phase1SessionId)
              if (s1) { try { ctx.sessionTitle.rename(s1, `摸底 · ${topic}`) } catch { /* 同上 */ } }
            }
            // 应用已保存的模型选择（无 .learning-space.json / model:null 时跳过，行为与现状一致）
            const sel = await readModelSelection(root)
            if (sel) {
              try {
                await ctx.sessionController.selectModel(
                  { sessionId, ...sel }, AbortSignal.timeout(8000))
              } catch (err) {
                // 失败不阻塞：会话退回宿主默认模型，仅记 warn
                try { ctx.logger.warn(`learning-space: selectModel failed for ${sessionId}: ${String(err && err.message || err)}`) } catch { /* 无 logger */ }
              }
            }
            // 唤醒：按 phase 注入对应 seed（联网开关取当时值，指令级生效）
            let goal = ''
            try { goal = parsePlan(await readFile(path.join(topicDir, 'plan.md'), 'utf8')).goal } catch { /* 无 plan */ }
            let hasMaterials = false
            try { hasMaterials = (await readdir(path.join(root, 'materials', topic))).length > 0 } catch { /* 无材料目录 */ }
            const seed = phase === 1
              ? seedPhase1(topic, goal, state.webSearch, hasMaterials)
              : seedPhase2(topic, goal, state.webSearch, hasMaterials)
            try {
              await ctx.sessionController.prompt({
                sessionId,
                requestId: cryptoRandomUUID(),
                mode: 'queue',
                content: [{ type: 'text', text: seed }],
              }, AbortSignal.timeout(15000))
            } catch (err) { /* 注入失败不阻塞打开会话，用户进去后 AI 仍可用工具 */ }
          }
          send(200, { ok: true, sessionId, phase })
          return
        }
        // 内嵌对话窗：读会话历史消息（events 冷安全，不激活会话）；按 phase 路由到对应会话
        if (req.method === 'GET' && url.pathname === '/api/learning-space/session/messages') {
          const topic = url.searchParams.get('topic') || ''
          const afterSeqRaw = url.searchParams.get('afterSeq')
          const phaseRaw = url.searchParams.get('phase')
          if (!validTopic(topic)) { send(400, { ok: false, error: 'invalid topic' }); return }
          let afterSeq = null
          if (afterSeqRaw !== null && afterSeqRaw !== '') {
            afterSeq = Number(afterSeqRaw)
            if (!Number.isInteger(afterSeq) || afterSeq < 0) { send(400, { ok: false, error: 'invalid afterSeq' }); return }
          }
          const state = await readSessionState(path.join(root, 'curriculum', topic))
          const phase = resolvePhase(state, phaseRaw === '1' ? 1 : phaseRaw === '2' ? 2 : undefined)
          const sessionId = phaseSessionId(state, phase)
          if (!sessionId) { send(404, { ok: false, error: 'no session' }); return }
          let page
          try {
            page = await ctx.sessionController.events(
              { address: { kind: 'session', sessionId }, maxMessages: 200 },
              AbortSignal.timeout(10000),
            )
          } catch (err) {
            if (isSessionNotFound(err)) { send(404, { ok: false, error: 'no session' }); return }
            if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) { send(504, { ok: false, error: 'history read timeout' }); return }
            send(500, { ok: false, error: String(err && err.message || err) }); return
          }
          const mapped = mapEvents(page && page.records)
          // cursor 用宿主返回的日志读切点（records 的最大 seq），不要从记录自算
          const cursor = page && typeof page.cursor === 'number' ? page.cursor : mapped.cursor
          // quiz 配对：全量重放标注 m.quiz，闭环三元组幂等落盘（fbSeq 水位 + 文件内标记双保险）；
          // 阶段一摸底题若走 quiz 协议同样落盘——annotateQuiz 逻辑不动，phase 只影响会话路由
          const annotated = annotateQuiz(mapped.messages)
          for (const triple of annotated.triples) {
            try { await appendQuizLog(root, topic, triple) } catch (err) { console.warn('[learning-space] quiz 落盘失败:', err) }
          }
          const messages = afterSeq === null ? annotated.messages : annotated.messages.filter(m => m.seq > afterSeq)
          const toolUpdates = (afterSeq === null ? mapped.toolUpdates : mapped.toolUpdates.filter(u => u.seq > afterSeq))
            .map(u => ({ callId: u.callId, state: u.state }))
          send(200, {
            ok: true, sessionId, cursor, running: mapped.running,
            hasMore: !!(page && page.hasMore), messages, toolUpdates,
          })
          return
        }
        // 内嵌对话窗：往绑定会话发消息（不在此隐式建课）；按 phase 路由到对应会话
        if (req.method === 'POST' && url.pathname === '/api/learning-space/session/send') {
          const { topic, text, phase: phaseParam, askCallId } = await readBody(req)
          if (!validTopic(topic)) { send(400, { ok: false, error: 'invalid topic' }); return }
          if (!text || typeof text !== 'string') { send(400, { ok: false, error: 'empty text' }); return }
          if (text.length > 8000) { send(400, { ok: false, error: 'text too long' }); return }
          const state = await readSessionState(path.join(root, 'curriculum', topic))
          const phase = resolvePhase(state, phaseParam)
          const sessionId = phaseSessionId(state, phase)
          if (!sessionId) { send(409, { ok: false, error: 'session gone, start first' }); return }
          // ask_user_question 待作答时回合挂在工具调用上，queue 的回复要等超时才执行：
          // 客户端带上它看到的待答 callId，这里核实后先入 inbox 再 cancel 当前回合，
          // cancel 不丢 inbox，回复随即开新回合执行（模型收到 ASK_ABORTED + 用户回复）
          let cancelStalledAsk = false
          if (typeof askCallId === 'string' && askCallId) {
            try {
              const page = await ctx.sessionController.events(
                { address: { kind: 'session', sessionId }, maxMessages: 200 },
                AbortSignal.timeout(10000),
              )
              cancelStalledAsk = mapEvents(page && page.records).messages.some(
                m => m.role === 'tool' && m.callId === askCallId && m.state === 'running')
            } catch { cancelStalledAsk = false }
          }
          // 冷会话（DSH 重启后 ctx.sessions 里没有）也直接投递：prompt 会先恢复会话
          try {
            const requestId = cryptoRandomUUID()
            await ctx.sessionController.prompt({
              sessionId,
              requestId,
              mode: 'queue',
              content: [{ type: 'text', text }],
            }, AbortSignal.timeout(15000))
            if (cancelStalledAsk && typeof ctx.sessionController.cancel === 'function') {
              try {
                await ctx.sessionController.cancel({ sessionId }, AbortSignal.timeout(8000))
              } catch (err) {
                try { ctx.logger.warn(`learning-space: cancel stalled ask failed for ${sessionId}: ${String(err && err.message || err)}`) } catch { /* 无 logger */ }
              }
            }
            send(200, { ok: true, requestId })
          } catch (err) {
            if (isSessionNotFound(err)) { send(409, { ok: false, error: 'session gone, start first' }); return }
            send(500, { ok: false, error: String(err && err.message || err) })
          }
          return
        }
        // 答题历史：quiz.md 按标记解析为记录数组（倒序，全量返回）
        if (req.method === 'GET' && url.pathname === '/api/learning-space/quizlog') {
          const topic = url.searchParams.get('topic') || ''
          if (!validTopic(topic)) { send(400, { ok: false, error: 'invalid topic' }); return }
          send(200, { ok: true, records: await parseQuizLog(root, topic) })
          return
        }
        // 联网开关：只写 webSearch 字段，不动会话绑定（指令级，对下一次新会话生效）
        if (req.method === 'POST' && url.pathname === '/api/learning-space/session/websearch') {
          const { topic, enabled } = await readBody(req)
          if (!validTopic(topic)) { send(400, { ok: false, error: 'invalid topic' }); return }
          const topicDir = path.join(root, 'curriculum', topic)
          const state = await readSessionState(topicDir)
          const on = enabled !== false && enabled !== 'false'
          await writeSessionState(topicDir, { ...state, webSearch: on })
          send(200, { ok: true, webSearch: on })
          return
        }
        // 下载 plan.md 原文（ASCII 兜底名 + RFC 5987 filename* 传中文名，写法同 /export）
        if (req.method === 'GET' && url.pathname === '/api/learning-space/export/plan') {
          const topic = url.searchParams.get('topic') || ''
          if (!validTopic(topic)) { send(400, { ok: false, error: 'invalid topic' }); return }
          let text
          try { text = await readFile(path.join(root, 'curriculum', topic, 'plan.md'), 'utf8') }
          catch { send(404, { ok: false, error: `课程「${topic}」不存在或尚无 plan.md` }); return }
          res.writeHead(200, {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': `attachment; filename="learning-plan.md"; filename*=UTF-8''${encodeURIComponent(`学习计划-${cleanFilename(topic)}.md`)}`,
          })
          res.end(text)
          return
        }
        // 下载 study-log.md 原文（同上头写法）
        if (req.method === 'GET' && url.pathname === '/api/learning-space/studylog') {
          const topic = url.searchParams.get('topic') || ''
          if (!validTopic(topic)) { send(400, { ok: false, error: 'invalid topic' }); return }
          let text
          try { text = await readFile(path.join(root, 'curriculum', topic, 'study-log.md'), 'utf8') }
          catch { send(404, { ok: false, error: `课程「${topic}」暂无学习记录` }); return }
          res.writeHead(200, {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': `attachment; filename="study-log.md"; filename*=UTF-8''${encodeURIComponent(`学习记录-${cleanFilename(topic)}.md`)}`,
          })
          res.end(text)
          return
        }
        // 面板新建课程：建骨架后即可开始学习会话
        if (req.method === 'POST' && url.pathname === '/api/learning-space/topic/create') {
          const { topic, goal } = await readBody(req)
          if (!topic || typeof topic !== 'string' || /[\\/:*?"<>|]/.test(topic) || topic.startsWith('_') || topic.length > 60) {
            send(400, { ok: false, error: '课程名不合法（1-60 字，不能含特殊字符）' }); return
          }
          const dir = path.join(root, 'curriculum', topic)
          try { await readdir(dir); send(409, { ok: false, error: `课程「${topic}」已存在` }); return } catch { /* 不存在，继续 */ }
          await mkdir(path.join(dir, 'notes'), { recursive: true })
          const plan = `---\ntopic: ${topic}\ngoal: ${goal || ''}\n---\n\n` +
            `# ${topic} · 依赖图\n\n\`\`\`mermaid\nflowchart BT\n  classDef done fill:#3E6B4F,color:#FAF7F0\n  classDef doing fill:#3D5A80,color:#FAF7F0\n  classDef warn fill:#B5432E,color:#FAF7F0\n  classDef todo fill:#FAF7F0,color:#6E6A60,stroke:#9A968C,stroke-dasharray:4 3\n\n  根节点["无条件真理"]:::todo --> 目标["目标"]:::todo\n\`\`\`\n\n## 学习顺序\n\n- [ ] 无条件真理\n- [ ] 目标\n`
          await writeFile(path.join(dir, 'plan.md'), plan, 'utf8')
          await writeFile(path.join(dir, 'mistakes.md'), '# 错题本\n', 'utf8')
          send(200, { ok: true })
          return
        }
        // 删除课程：递归删 curriculum/<topic> 与 materials/<topic>（学习会话保留在 DSH 会话列表，可手动归档）
        if (req.method === 'POST' && url.pathname === '/api/learning-space/topic/delete') {
          const { topic } = await readBody(req)
          if (!validTopic(topic)) { send(400, { ok: false, error: '课程名不合法' }); return }
          const topicDir = path.join(root, 'curriculum', topic)
          // 只删真实课程目录（必须有 plan.md），防止误删/路径逃逸
          try { await readFile(path.join(topicDir, 'plan.md'), 'utf8') }
          catch { send(404, { ok: false, error: `课程「${topic}」不存在` }); return }
          await rm(topicDir, { recursive: true, force: true })
          await rm(path.join(root, 'materials', topic), { recursive: true, force: true })
          send(200, { ok: true })
          return
        }
        // 静态资产：mermaid / KaTeX（文件不可变，缓存一天；缺失 404 JSON 让客户端走降级）
        if (req.method === 'GET' && url.pathname.startsWith('/api/learning-space/assets/')) {
          const assetsDir = path.join(PLUGIN_DIR, 'assets')
          const rel = url.pathname.slice('/api/learning-space/assets/'.length)
          // 资产名全是 ASCII，用白名单字符挡住路径逃逸，免得 decodeURIComponent 抛错变 500
          const file = /^[\w./-]+$/.test(rel) ? path.normalize(path.join(assetsDir, rel)) : ''
          if (!file || !file.startsWith(assetsDir + path.sep)) { send(404, { ok: false, error: 'asset not found' }); return }
          let buf
          try { buf = await readFile(file) }
          catch { send(404, { ok: false, error: 'asset missing' }); return }
          const ext = path.extname(file).toLowerCase()
          const type = ext === '.js' ? 'application/javascript; charset=utf-8'
            : ext === '.css' ? 'text/css; charset=utf-8'
              : ext === '.woff2' ? 'font/woff2'
                : 'application/octet-stream'
          res.writeHead(200, {
            'content-type': type,
            'cache-control': 'public, max-age=86400',
          })
          res.end(buf)
          return
        }
        // 节点教学笔记：notes/<节点名>.md（文件名含非法字符时按清洗/归一化兜底匹配）
        if (req.method === 'GET' && url.pathname === '/api/learning-space/node-note') {
          const topic = url.searchParams.get('topic') || ''
          const node = url.searchParams.get('node') || ''
          if (!validTopic(topic) || !node || node.length > 200) { send(400, { ok: false, error: 'invalid params' }); return }
          const notesDir = path.join(root, 'curriculum', topic, 'notes')
          let files = []
          try { files = await readdir(notesDir) } catch { send(200, { ok: true, content: '' }); return }
          const target = matchNoteFile(files, node)
          if (!target) { send(200, { ok: true, content: '' }); return }
          let content = ''
          try { content = await readFile(path.join(notesDir, target), 'utf8') } catch { /* 读失败按无笔记 */ }
          send(200, { ok: true, content })
          return
        }
        // 导出自包含 HTML 报告：单课程 / 全部
        if (req.method === 'GET' && url.pathname === '/api/learning-space/export') {
          const all = url.searchParams.get('all') === '1'
          const topic = url.searchParams.get('topic') || ''
          if (!all && !validTopic(topic)) { send(400, { ok: false, error: 'invalid topic' }); return }
          const topics = await listTopics(root)
          let targets = topics
          if (!all) {
            targets = topics.filter(t => t.name === topic)
            if (!targets.length) { send(404, { ok: false, error: `课程「${topic}」不存在` }); return }
          }
          // 资产读取失败不 500：导出降级为源码文本 + 提示
          let mermaidJs = null
          try { mermaidJs = await readFile(path.join(PLUGIN_DIR, 'assets', 'mermaid.min.js'), 'utf8') } catch { /* 降级 */ }
          const topicsData = await Promise.all(targets.map(t => collectTopicForExport(root, t)))
          const html = buildReportHtml(topicsData, { all, mermaidJs })
          const filename = all ? 'learning-report-all.html' : `learning-report-${cleanFilename(topic)}.html`
          // header 值不允许非 ASCII：ASCII 兜底名 + RFC 5987 filename* 传中文名
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-disposition': `attachment; filename="${all ? 'learning-report-all.html' : 'learning-report.html'}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          })
          res.end(html)
          return
        }
        send(404, { ok: false, error: 'not found' })
      } catch (err) {
        const status = err && typeof err.status === 'number' ? err.status : 500
        send(status, { ok: false, error: String(err && err.message || err) })
      }
    },
  }))

  // ── 工具：学习方法 ─────────────────────────────
  ctx.effect(() => ctx.tools.register({
    name: 'learn_guide',
    description: '获取学习空间的教学方法论（teach + quiz 两个 skill 的完整内容）。当用户想学习新知识、要求辅导或讲解主题时，先调用它拿到教学方法再开始。教学流程：问目标 → 问资料来源（用户上传在 materials/<主题>/ 或上网检索核实）→ 出题定位水平 → 展示依赖图计划 → 逐节点教学并用 learn_update 记录进度。',
    parameters: { type: 'object', properties: {} },
    output: toolOutput,
    async execute() {
      const parts = []
      for (const name of ['skills/teach/SKILL.md', 'skills/quiz/SKILL.md']) {
        // 工作区自带 skills 优先（可定制），否则用插件内置副本
        let text = null
        for (const base of [root, PLUGIN_DIR]) {
          try { text = await readFile(path.join(base, name), 'utf8'); break } catch { /* 试下一处 */ }
        }
        parts.push(text ?? `（未找到 ${name}）`)
      }
      return { text: parts.join('\n\n---\n\n') }
    },
  }))

  // ── 工具：读学习状态 ───────────────────────────
  ctx.effect(() => ctx.tools.register({
    name: 'learn_status',
    description: '读取学习空间的当前状态：各课程进度（节点状态统计）、错题、最近日志。继续学习、复习错题或查看进度时调用。',
    parameters: { type: 'object', properties: {} },
    output: toolOutput,
    async execute() {
      const [topics, journal] = await Promise.all([listTopics(root), journalLines(root)])
      const lines = topics.map(t =>
        `## ${t.name}（目标：${t.goal || '未设置'}）\n已确认 ${t.counts.done} / ${t.nodes.length}，进行中 ${t.counts.doing}，待修复 ${t.counts.warn}，错题 ${t.mistakes.length} 条`)
      return { text: (lines.length ? lines.join('\n') : '还没有课程') + '\n\n最近日志：\n' + journal.join('\n') }
    },
  }))

  // ── 工具：写学习数据 ───────────────────────────
  ctx.effect(() => ctx.tools.register({
    name: 'learn_update',
    description: '更新学习空间数据（教学课后沉淀，硬性要求每节课/每节点确认后调用）。action：init_topic=新建课程骨架（参数 topic, goal）；save=写文件（参数 file 为 curriculum/ 或 journal/ 下的相对路径，content 为完整文件内容，如 curriculum/<主题>/plan.md、curriculum/<主题>/notes/<节点>.md）；record_mistake=追加错题（topic, question, kind 粗心/孤立记忆/概念混淆, explanation）；log=追加学习日志（topic, node, summary）；study_log=阶段二每节点确认后追加学习记录（topic, node, summary, mastery 已掌握/基本掌握/需复习）。plan.md 必须保持 frontmatter(topic/goal) + mermaid DAG(classDef done/doing/warn/todo + 节点:::类名) + 「## 学习顺序」checkbox（[x]已确认 [~]进行中 [!]待修复 [ ]未学）的格式，面板按此解析渲染。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['init_topic', 'save', 'record_mistake', 'log', 'study_log'] },
        topic: { type: 'string' },
        goal: { type: 'string' },
        file: { type: 'string' },
        content: { type: 'string' },
        question: { type: 'string' },
        kind: { type: 'string', enum: ['粗心', '孤立记忆', '概念混淆'] },
        explanation: { type: 'string' },
        node: { type: 'string' },
        summary: { type: 'string' },
        mastery: { type: 'string', enum: ['已掌握', '基本掌握', '需复习'] },
      },
      required: ['action'],
    },
    output: toolOutput,
    async execute(args) {
      const today = new Date().toISOString().slice(0, 10)
      try {
        if (args.action === 'init_topic') {
          if (!args.topic) throw new Error('缺少 topic')
          const dir = path.join(root, 'curriculum', args.topic)
          await mkdir(path.join(dir, 'notes'), { recursive: true })
          const plan = `---\ntopic: ${args.topic}\ngoal: ${args.goal || ''}\n---\n\n` +
            `# ${args.topic} · 依赖图\n\n\`\`\`mermaid\nflowchart BT\n  classDef done fill:#3E6B4F,color:#FAF7F0\n  classDef doing fill:#3D5A80,color:#FAF7F0\n  classDef warn fill:#B5432E,color:#FAF7F0\n  classDef todo fill:#FAF7F0,color:#6E6A60,stroke:#9A968C,stroke-dasharray:4 3\n\n  根节点["无条件真理"]:::todo --> 目标["目标"]:::todo\n\`\`\`\n\n## 学习顺序\n\n- [ ] 无条件真理\n- [ ] 目标\n`
          await writeFile(path.join(dir, 'plan.md'), plan, 'utf8')
          await writeFile(path.join(dir, 'mistakes.md'), '# 错题本\n', 'utf8')
          return { text: `已创建课程 ${args.topic}（plan.md + mistakes.md + notes/），教学时把依赖图逐节点写进 plan.md 并维护 checkbox 状态。` }
        }
        if (args.action === 'save') {
          const abs = safeJoin(root, args.file, ['curriculum', 'journal'])
          await mkdir(path.dirname(abs), { recursive: true })
          await writeFile(abs, args.content ?? '', 'utf8')
          return { text: `已写入 ${args.file}` }
        }
        if (args.action === 'record_mistake') {
          if (!args.topic || !args.question) throw new Error('缺少 topic 或 question')
          const file = path.join(root, 'curriculum', args.topic, 'mistakes.md')
          let text = '# 错题本\n'
          try { text = await readFile(file, 'utf8') } catch { /* 新建 */ }
          text += `\n- **${args.question}** · ${args.kind || '未分类'} · ${today}\n  解析：${args.explanation || ''}\n`
          await writeFile(file, text, 'utf8')
          return { text: '错题已记录' }
        }
        if (args.action === 'log') {
          if (!args.topic || !args.summary) throw new Error('缺少 topic 或 summary')
          const month = today.slice(0, 7)
          const file = path.join(root, 'journal', `${month}.md`)
          await mkdir(path.dirname(file), { recursive: true })
          let text = `# 学习日志（${month}）\n`
          try { text = await readFile(file, 'utf8') } catch { /* 新建 */ }
          text += `- ${today} · ${args.topic} · ${args.node || '-'} · ${args.summary}\n`
          await writeFile(file, text, 'utf8')
          return { text: '日志已追加' }
        }
        if (args.action === 'study_log') {
          if (!args.topic || !args.node || !args.summary) throw new Error('缺少 topic / node / summary')
          const file = path.join(root, 'curriculum', args.topic, 'study-log.md')
          let text = '# 学习记录\n'
          try { text = await readFile(file, 'utf8') } catch { /* 新建 */ }
          text += `\n## ${today} · ${args.node}\n- 要点：${args.summary}\n- 掌握：${args.mastery || '未标注'}\n`
          await writeFile(file, text, 'utf8')
          return { text: '学习记录已追加' }
        }
        throw new Error(`未知 action: ${args.action}`)
      } catch (err) {
        return { text: `learn_update 失败：${String(err && err.message || err)}` }
      }
    },
  }))
}
