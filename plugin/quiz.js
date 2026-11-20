/**
 * quiz 出题/作答/反馈的确定性解析（纯函数）+ 幂等落盘。
 * 格式契约见 skills/quiz/SKILL.md：
 *   题号行 **第 N / M 题 · 节点**、题干、A. ~ D. 裸选项；
 *   作答是单字母或「我选 B」；反馈首行以 ✅/❌ 开头。
 * 正则均做容错（空格可省、标点变体），不命中一律降级为普通文本，不误伤。
 */
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises'
import path from 'node:path'

// 题号行：**第 2 / 5 题 · 离散采样**（节点可缺省，数字两侧容忍空格）
export const RE_QHEAD = /^\*\*\s*第\s*(\d+)\s*\/\s*(\d+)\s*题\s*(?:·\s*([^*\n]+?))?\s*\*\*\s*$/
// 选项行：行首字母 + . / 、 / ) （容忍全角），选项文本非空
export const RE_OPT = /^[ \t]*([A-D])[.、)）]\s*(\S.+)$/
// 作答：单字母或「我选 B / 选 C / 答案：D」形态
export const RE_ANS = /^\s*(?:我选|选|答案|答)\s*[:：]?\s*([A-D])\s*[.。]?\s*$|^\s*([A-D])\s*[.。]?\s*$/
// 反馈：首个非空行以 ✅/❌ 开头，后跟 正确/错误/答对/答错（可省空格，后缀词可缺省）
export const RE_FB = /^\s*([✅❌])\s*(正确|错误|答对|答错)?/

/**
 * 从 assistant 消息文本解析选择题；题号行 + ≥2 条连续选项行双条件，
 * 任一不满足返回 null（消息按普通文本渲染，降级策略）。
 */
export function parseQuizQuestion(text) {
  if (typeof text !== 'string' || !text.includes('题')) return null
  const lines = text.split(/\r?\n/)
  let head = -1
  let headM = null
  for (let i = 0; i < lines.length; i++) {
    const m = RE_QHEAD.exec(lines[i])
    if (m) { head = i; headM = m; break }
  }
  if (head === -1) return null
  const stem = []
  const options = []
  let i = head + 1
  // 题干：题号行与首个选项行之间的非空行
  for (; i < lines.length; i++) {
    if (RE_OPT.test(lines[i])) break
    const t = lines[i].trim()
    if (t) stem.push(t)
  }
  // 选项：连续选项行（允许中间空行），遇非选项非空行即止
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) { if (options.length) continue; else continue }
    const m = RE_OPT.exec(line)
    if (!m) break
    options.push({ key: m[1], text: m[2].trim() })
  }
  if (options.length < 2) return null
  return {
    index: Number(headM[1]),
    total: Number(headM[2]),
    node: (headM[3] || '').trim() || null,
    stem: stem.join(' '),
    options,
    raw: text,
  }
}

/** 用户消息是否是一次作答；命中返回字母，否则 null */
export function matchAnswer(text) {
  if (typeof text !== 'string') return null
  const m = RE_ANS.exec(text.trim())
  if (!m) return null
  return m[1] || m[2] || null
}

/** assistant 消息首行是否是判分反馈；命中返回 { correct, text }，否则 null */
export function matchFeedback(text) {
  if (typeof text !== 'string') return null
  const firstLine = text.split(/\r?\n/).find(l => l.trim())
  if (!firstLine) return null
  const m = RE_FB.exec(firstLine)
  if (!m) return null
  return { correct: m[1] === '✅', text: text.trim() }
}

/**
 * 「题→答→反馈」配对状态机（纯函数，无副作用）：
 * 顺序扫描（按 seq 升序）映射后的消息，闭环三元组收集进 triples，
 * 题目消息附 m.quiz 结构化标注（state=pending/answered/graded）。
 * 返回 { messages, triples }；messages 是浅拷贝数组，原数组不动。
 */
export function annotateQuiz(messages) {
  const list = (messages || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0))
  const out = new Array(list.length)
  let pending = null   // { qMsg, idx, ans, ansSeq, ansText }
  const triples = []
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (m.role === 'assistant') {
      const q = parseQuizQuestion(m.text)
      if (q) {
        // quiz 规则一次一题；新题出现时旧 pending 未闭环直接丢弃，不落盘
        pending = { qMsg: m, idx: i, q, ans: null, ansSeq: null, ansText: null }
        out[i] = { ...m, quiz: { ...q, state: 'pending', answer: null, correct: null } }
        continue
      }
      if (pending && pending.ans) {
        const fb = matchFeedback(m.text)
        if (fb) {
          // 三元组闭环
          const quiz = out[pending.idx].quiz
          quiz.state = 'graded'
          quiz.answer = pending.ans
          quiz.correct = fb.correct
          triples.push({
            q: pending.q, fbSeq: m.seq, fbText: fb.text, correct: fb.correct,
            answer: pending.ans, answerSeq: pending.ansSeq, answerText: pending.ansText,
          })
          pending = null
        }
      }
    } else if (m.role === 'user' && pending) {
      const letter = matchAnswer(m.text)
      if (letter) {
        pending.ans = letter
        pending.ansSeq = m.seq
        pending.ansText = m.text
        const quiz = out[pending.idx].quiz
        if (quiz) { quiz.state = 'answered'; quiz.answer = letter }
      }
      // 非字母消息视为插入对话，pending 保持
    }
    if (out[i] === undefined) out[i] = m
  }
  return { messages: out, triples }
}

// ── 幂等落盘（路由层调用，唯一带副作用的部分） ─────────────────────

const FB_MARK = /<!--\s*quiz:fbSeq=(\d+)\s*-->/g

function quizFiles(root, topic) {
  const dir = path.join(root, 'curriculum', topic)
  return { dir, log: path.join(dir, 'quiz.md'), state: path.join(dir, 'quiz-state.json') }
}

/**
 * 水位：取 quiz-state.json 与 quiz.md 最后 fbSeq 标记的较大者（双保险）。
 * append 成功后写水位文件失败/崩溃时，状态文件会落后于 quiz.md 内标记，
 * 无条件取 max 才能挡住重复追加（文件内标记去重是设计的兜底承诺）。
 */
export async function readWatermark(root, topic) {
  const { log, state } = quizFiles(root, topic)
  let fromState = -1
  try {
    const j = JSON.parse(await readFile(state, 'utf8'))
    if (typeof j.feedbackSeq === 'number') fromState = j.feedbackSeq
  } catch { /* 损坏/缺失，视为 -1 */ }
  let fromLog = -1
  try {
    const text = await readFile(log, 'utf8')
    for (const m of text.matchAll(FB_MARK)) fromLog = Math.max(fromLog, Number(m[1]))
  } catch { /* 无 quiz.md，视为 -1 */ }
  return Math.max(fromState, fromLog)
}

function formatRecord(t, date) {
  const opts = t.q.options.map(o => `${o.key}. ${o.text}`).join(' ｜ ')
  const ansOpt = t.q.options.find(o => o.key === t.answer)
  return `\n## ${date} · 第 ${t.q.index} / ${t.q.total} 题 · ${t.q.node || '-'} ${t.correct ? '✅' : '❌'}\n` +
    `- 题面：${t.q.stem}\n` +
    `- 选项：${opts}\n` +
    `- 所答：${t.answer}${ansOpt ? `（${ansOpt.text}）` : ''}\n` +
    `- 反馈：${t.fbText.split(/\r?\n/)[0]}\n` +
    `<!-- quiz:fbSeq=${t.fbSeq} -->\n`
}

/**
 * 追加一条闭环三元组到 quiz.md（幂等：fbSeq ≤ 水位直接跳过）。
 * 写入顺序：先 append quiz.md（标记在内），成功后更新水位文件。
 * 失败抛错由调用方捕获（路由层只 console.warn，不阻断响应）。
 */
export async function appendQuizLog(root, topic, triple, today) {
  const { dir, log, state } = quizFiles(root, topic)
  const watermark = await readWatermark(root, topic)
  if (!(triple.fbSeq > watermark)) return false
  const date = today || new Date().toISOString().slice(0, 10)
  await mkdir(dir, { recursive: true })
  let header = ''
  try { await readFile(log, 'utf8') } catch { header = `# 答题记录 · ${topic}\n` }
  await appendFile(log, header + formatRecord(triple, date), 'utf8')
  await writeFile(state, JSON.stringify({ feedbackSeq: triple.fbSeq }), 'utf8')
  return true
}

/** quiz.md → 记录数组（倒序，最新在前）；无文件返回 [] */
export async function parseQuizLog(root, topic) {
  const { log } = quizFiles(root, topic)
  let text = ''
  try { text = await readFile(log, 'utf8') } catch { return [] }
  const records = []
  const blocks = text.split(/(?=^## )/m)
  for (const b of blocks) {
    const mark = [...b.matchAll(FB_MARK)].pop()
    const head = /^## (\d{4}-\d{2}-\d{2}) · 第 (\d+) \/ (\d+) 题 · (.*?) (✅|❌)\s*$/m.exec(b)
    if (!head || !mark) continue
    const pick = (re) => { const m = re.exec(b); return m ? m[1].trim() : '' }
    const answerM = /^- 所答：([A-D])(?:（(.*)）)?$/m.exec(b)
    records.push({
      date: head[1],
      index: Number(head[2]),
      total: Number(head[3]),
      node: head[4] === '-' ? null : head[4],
      correct: head[5] === '✅',
      stem: pick(/^- 题面：(.*)$/m),
      options: pick(/^- 选项：(.*)$/m),
      answer: answerM ? answerM[1] : '',
      answerText: answerM && answerM[2] ? answerM[2] : '',
      feedback: pick(/^- 反馈：(.*)$/m),
      fbSeq: Number(mark[1]),
    })
  }
  return records.reverse()
}
