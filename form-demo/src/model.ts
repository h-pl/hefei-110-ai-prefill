import { textChange } from './text-change'
export const FIELD_IDS = ['location', 'caller', 'callback', 'reason', 'ongoing', 'people', 'injury', 'equipment', 'description'] as const
export type FieldId = typeof FIELD_IDS[number]
export const STRONG_IDS: FieldId[] = ['location', 'callback']
export const isStrong = (id: FieldId) => STRONG_IDS.includes(id)
export type Evidence = { speaker: string; time: string; quote: string }
export type Change = { time: string; actor: string; action: string; before?: string; after?: string }
export type Proposal = { value: string; evidence: Evidence }
export type Field = {
  id: FieldId; label: string; value: string; initialAI: string; origin: 'ai' | 'manual';
  review: 'pending' | 'confirmed' | 'modified'; owned: boolean; draft: string | null; error: string | null;
  evidence: Evidence; history: Change[]; proposal: Proposal | null; deferred: boolean;
}
export type Snapshot = { time: string; urgent: boolean; values: Record<FieldId, string> }
export type Stream = { evidence: Evidence; updates: Partial<Record<FieldId, string>>; offset: number }
export type Model = { elapsedMs: number; fields: Field[]; announcement: string; newInfoIndex: number; lastIncoming: Evidence | null; conversation: Evidence[]; playbackCursor: number | null; streams: Stream[]; fillOffset: number; pendingFills: { id: FieldId; value: string; evidence: Evidence }[]; sent: Snapshot | null }
// An ended transcript can still have queued field extraction to finish.
export const isPlaybackComplete = (state: Model, stepCount: number) => state.playbackCursor !== null && state.playbackCursor >= stepCount && state.streams.length === 0 && state.pendingFills.length === 0
export type Action =
  | { type: 'restore-session'; state: Model }
  | { type: 'edit'; id: FieldId; value: string }
  | { type: 'select-location'; id: 'location'; value: string; time?: string }
  | { type: 'save' | 'confirm' | 'cancel' | 'adopt' | 'keep' | 'defer' | 'expand'; id: FieldId; time?: string }
  | { type: 'incoming'; id: FieldId; proposal: Proposal; focused?: FieldId | null; time?: string }
  | { type: 'send'; urgent?: boolean; time?: string }
  | { type: 'reset' }
  | { type: 'playback-start' }
  | { type: 'clock-tick'; milliseconds: number }
  | { type: 'playback-idle' }
  | { type: 'playback-fill'; focused?: FieldId | null }
  | { type: 'stream-start'; evidence: Evidence; updates: Partial<Record<FieldId, string>>; parallel?: { evidence: Evidence; updates: Partial<Record<FieldId, string>> } }
  | { type: 'stream-tick'; speaker?: string }
  | { type: 'fill-tick'; focused?: FieldId | null }
  | { type: 'playback-step'; evidence: Evidence; updates: Partial<Record<FieldId, string>>; focused?: FieldId | null }
const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })
export function createInitialModel(): Model {
  const values = ['合肥安和广场东门', '陈（自述姓氏）', '138****6721', '有人打架', '是', '2人', '一人流血，具体伤情待核实', '不详，报警人看不清', '报警人自述姓陈，称合肥安和广场东门有两人正在打架，其中一人流血。是否持有器械不详，具体伤情待进一步核实。']
  const labels = ['事发地点', '报警人', '回拨号码', '报警事由', '事件是否持续', '参与人数', '伤情情况', '器械情况', '警情描述']
  return { elapsedMs: 0, fields: FIELD_IDS.map((id, i) => ({
    id, label: labels[i], value: values[i], initialAI: values[i], origin: 'ai', review: 'pending', owned: false,
    draft: null, error: null, proposal: null, deferred: false,
    evidence: ['location', 'ongoing'].includes(id) ? { speaker: '报警人', time: '00:27', quote: '合肥的安和广场，东门这边，他们还在打。' } : ['caller', 'callback', 'equipment'].includes(id) ? { speaker: '报警人', time: '00:57', quote: '我离得远，看不清。我姓陈，就是这个电话。' } : { speaker: '报警人', time: '00:06', quote: '我在商场东门，这里有两个人在打架，有一个流血了。' },
    history: [],
  })), announcement: '', newInfoIndex: 0, lastIncoming: null, conversation: [], playbackCursor: null, streams: [], fillOffset: -1, pendingFills: [], sent: null }
}
export function createIdleModel(): Model {
  const fresh = createInitialModel()
  return { ...fresh, fields: fresh.fields.map(f => ({ ...f, value: '', initialAI: '', evidence: { speaker: '系统', time: '00:00', quote: '等待识别。' } })) }
}
const addHistory = (field: Field, event: Change): Field => ({ ...field, history: [...field.history, event] })
function summarize(fields: Field[]) {
  const value = (id: FieldId) => fields.find(f => f.id === id)!.value || '尚未获取'
  const ongoing = value('ongoing') === '是' ? '事件仍在持续' : value('ongoing') === '否' ? '事件已停止' : `事件是否持续：${value('ongoing')}`
  return `报警人：${value('caller')}。事发地点：${value('location')}。报警事由：${value('reason')}。${ongoing}，参与人数为${value('people')}。伤情情况：${value('injury')}。器械情况：${value('equipment')}。`
}
function syncDescription(fields: Field[], time: string): Field[] {
  const value = summarize(fields)
  return fields.map(f => {
    if (f.id !== 'description' || f.value === value) return f
    const evidence = { speaker: '已采纳的表单信息', time, quote: value }
    if (f.owned || f.origin === 'manual' || f.review !== 'pending' || f.draft !== null) return { ...f, proposal: { value, evidence }, deferred: false }
    return addHistory({ ...f, value, evidence, proposal: null, deferred: false }, { time, actor: 'AI', action: '依据已采纳字段更新描述', before: f.value, after: value })
  })
}
export function submissionIssues(state: Model): Partial<Record<FieldId, string>> {
  const issues: Partial<Record<FieldId, string>> = {}
  for (const field of state.fields) {
    if (field.error) issues[field.id] = field.error
    else if (field.draft !== null) issues[field.id] = '修改尚未保存，请检查输入内容'
    else if (!field.value.trim()) issues[field.id] = '请补充内容；未知可填“不详”'
    else if (isStrong(field.id) && field.review === 'pending') issues[field.id] = field.id === 'location' ? '地点尚未确认，请先点击确认' : '回拨号码尚未确认，请先点击确认'
    else if (field.proposal) issues[field.id] = '有新信息待核对，请采纳或保留当前值'
  }
  return issues
}
export function sendBlocker(state: Model): string | null {
  const issues = submissionIssues(state)
  const first = state.fields.find(field => issues[field.id])
  return first ? `${first.label}：${issues[first.id]}` : null
}

export function reducer(state: Model, action: Action): Model {
  if (action.type === 'restore-session') return action.state
  if (action.type === 'reset') return createInitialModel()
  if (action.type === 'playback-idle') return createIdleModel()
  if (action.type === 'clock-tick') {
    if (state.playbackCursor === null || !Number.isFinite(action.milliseconds) || action.milliseconds <= 0) return state
    return { ...state, elapsedMs: state.elapsedMs + action.milliseconds }
  }
  if (action.type === 'playback-start') {
    const fresh = createInitialModel()
    return { ...fresh, playbackCursor: 0, fields: fresh.fields.map(f => ({ ...f, value: f.id === 'callback' ? '138****6721' : '', initialAI: '', evidence: { speaker: '系统', time: '00:00', quote: f.id === 'callback' ? '当前来电号码，是否可回拨待确认。' : '等待识别。' } })) }
  }
  if (action.type === 'stream-start') {
    if (state.playbackCursor === null) return state
    const streams = [...state.streams]
    for (const candidate of [action, ...(action.parallel ? [action.parallel] : [])]) {
      const busy = streams.some(s => s.evidence.speaker === candidate.evidence.speaker)
      const completed = state.conversation.some(e => e.speaker === candidate.evidence.speaker && e.quote === candidate.evidence.quote)
      if (!busy && !completed && streams.length < 2) streams.push({ evidence: candidate.evidence, updates: candidate.updates, offset: 0 })
    }
    return streams.length === state.streams.length ? state : { ...state, streams }
  }
  if (action.type === 'stream-tick') {
    if (!state.streams.length) return state
    const advanced = state.streams.map(stream => !action.speaker || stream.evidence.speaker === action.speaker ? { ...stream, offset: Math.min(stream.offset + 2, stream.evidence.quote.length) } : stream)
    const completed = advanced.filter(stream => stream.offset >= stream.evidence.quote.length)
    const streams = advanced.filter(stream => stream.offset < stream.evidence.quote.length)
    const conversation = completed.length ? [...state.conversation, ...completed.map(s => s.evidence)].sort((a, b) => a.time.localeCompare(b.time)) : state.conversation
    const cursor = (state.playbackCursor ?? 0) + completed.length
    return { ...state, streams, conversation, playbackCursor: cursor,
      lastIncoming: completed.length ? conversation.at(-1)! : state.lastIncoming,
      newInfoIndex: Math.max(0, cursor - 6),
      pendingFills: completed.length ? [...state.pendingFills, ...completed.flatMap(s => Object.entries(s.updates).map(([id, value]) => ({ id: id as FieldId, value, evidence: s.evidence })))] : state.pendingFills }
  }
  if (action.type === 'playback-step') {
    if (state.playbackCursor === null) return state
    if (state.pendingFills.length) return state
    return { ...state, conversation: [...state.conversation, action.evidence], lastIncoming: action.evidence, playbackCursor: state.playbackCursor + 1, newInfoIndex: Math.max(0, state.playbackCursor + 1 - 6), pendingFills: Object.entries(action.updates).map(([id, value]) => ({ id: id as FieldId, value, evidence: action.evidence })) }
  }
  if (action.type === 'fill-tick') {
    const fill = state.pendingFills[0]
    if (!fill) return state
    const before = state.fields.find(f => f.id === fill.id)!.value
    const { start, afterEnd } = textChange(before, fill.value)
    const offset = Math.min(Math.max(start, state.fillOffset) + (fill.id === 'description' ? 4 : 1), afterEnd)
    if (offset < afterEnd) return { ...state, fillOffset: offset }
    return reducer(state, { type: 'playback-fill', focused: action.focused })
  }
  if (action.type === 'playback-fill') {
    const fill = state.pendingFills[0]
    if (!fill) return state
    const next = reducer(state, { type: 'incoming', id: fill.id, proposal: { value: fill.value, evidence: fill.evidence }, focused: action.focused })
    // Generate a description at each completed utterance batch while new speech continues.
    // Its text is streamed too; a partial result never overwrites the saved value.
    const fields = fill.id === 'description' ? next.fields : next.fields.map(f => f.id === 'description' ? state.fields.find(old => old.id === 'description')! : f)
    const pendingFills = state.pendingFills.slice(1)
    const nextFill = pendingFills[0]
    const batchFinished = !nextFill || nextFill.evidence.quote !== fill.evidence.quote
    if (batchFinished && fill.id !== 'description' && fields.some(f => !['callback', 'description'].includes(f.id) && f.value)) {
      const value = summarize(fields)
      if (fields.find(f => f.id === 'description')!.value !== value) pendingFills.unshift({ id: 'description', value, evidence: { speaker: '已采纳的表单信息', time: fill.evidence.time, quote: value } })
    }
    return { ...next, fields, fillOffset: -1, pendingFills, conversation: state.conversation, lastIncoming: state.lastIncoming, newInfoIndex: state.newInfoIndex }
  }
  const time = 'time' in action && action.time ? action.time : stamp()
  if (action.type === 'send') {
    const blocker = action.urgent ? null : sendBlocker(state)
    if (blocker) return { ...state, announcement: blocker }
    const fields = state.fields.map(f => addHistory({ ...f, owned: true, review: action.urgent ? f.review : f.origin === 'manual' ? 'modified' : 'confirmed' }, { time, actor: '接警员012', action: action.urgent ? '紧急先行移交，保留未核实事项' : '随发送整体确认', after: f.value }))
    return { ...state, fields, sent: { time, urgent: !!action.urgent, values: Object.fromEntries(fields.map(f => [f.id, f.value])) as Record<FieldId, string> }, announcement: action.urgent ? '紧急移交已提交；未核实事项随单保留' : '整体确认完成；正在提交移交'  }
  }
  const field = state.fields.find(f => f.id === action.id)!
  let next = { ...field }, announcement = '', valueChanged = false
  switch (action.type) {
    case 'edit': next.draft = action.value; next.error = null; break
    case 'cancel': next.draft = null; next.error = null; announcement = `${field.label}已恢复编辑前内容`; break
    case 'save':
    case 'confirm':
    case 'select-location': {
      const explicitConfirm = (action.type === 'confirm' || action.type === 'select-location') && isStrong(field.id)
      if (action.type === 'save' && field.draft === null) return state
      const value = (action.type === 'select-location' ? action.value : field.draft ?? field.value).trim()
      if (!value) { next.error = '请填写内容；无法确定时可以填写“不详”。'; announcement = `${field.label}尚未填写`; break }
      if (field.id === 'ongoing' && !['是', '否', '不详'].includes(value)) { next.error = '请选择是、否或不详。'; break }
      valueChanged = value !== field.value
      const origin = valueChanged ? 'manual' : field.origin
      const review = explicitConfirm ? (origin === 'manual' ? 'modified' : 'confirmed') : valueChanged ? 'pending' : field.review
      next = { ...next, value, draft: null, error: null, origin, review, owned: field.owned || explicitConfirm || valueChanged }
      if (next.proposal?.value === value) next.proposal = null
      if (valueChanged || explicitConfirm) next = addHistory(next, { time, actor: '接警员012', action: action.type === 'select-location' ? '选择地点并确认' : explicitConfirm ? '单独确认' : '失焦保存修改', before: field.value, after: value })
      announcement = valueChanged || explicitConfirm ? `${field.label}${explicitConfirm ? '已确认' : isStrong(field.id) ? '已保存，请单独确认' : '修改已自动保存'}` : state.announcement
      break
    }
    case 'incoming': {
      const proposal = action.proposal
      if (proposal.value === field.value) { announcement = `${field.label}与新原话一致`; break }
      if (field.owned || field.review !== 'pending' || field.origin === 'manual' || field.draft !== null || action.focused === field.id) {
        next = addHistory({ ...next, proposal, deferred: false }, { time, actor: 'AI', action: '提出新信息，保留当前值', before: field.value, after: proposal.value })
        announcement = `${field.label}收到新信息，当前内容已保留`
      } else {
        next = addHistory({ ...next, value: proposal.value, initialAI: next.initialAI || proposal.value, evidence: proposal.evidence, proposal: null, deferred: false }, { time, actor: 'AI', action: '根据新原话更新', before: field.value, after: proposal.value })
        valueChanged = true
        announcement = `${field.label}已根据新原话更新为${proposal.value}`
      }
      break
    }
    case 'adopt': {
      if (!field.proposal) return state
      if (field.draft !== null && field.draft.trim() !== field.value) return { ...state, announcement: '请先修正当前输入或按 Esc 撤销，再采纳新信息' }
      next = addHistory({ ...next, value: field.proposal.value, evidence: field.proposal.evidence, origin: 'ai', owned: true, review: 'confirmed', draft: null, error: null, proposal: null, deferred: false }, { time, actor: '接警员012', action: '采纳建议并确认', before: field.value, after: field.proposal.value })
      valueChanged = field.value !== next.value
      announcement = `${field.label}已采纳建议并完成人工核对`
      break
    }
    case 'keep':
      if (!field.proposal) return state
      next = addHistory({ ...next, owned: true, proposal: null, deferred: false }, { time, actor: '接警员012', action: '保留当前值', before: field.proposal.value, after: field.value })
      announcement = `${field.label}已保留当前值`; break
    case 'defer': next.deferred = true; announcement = `${field.label}保留新信息提醒`; break
    case 'expand': next.deferred = false; break
  }
  let fields = state.fields.map(f => f.id === action.id ? next : f)
  if (valueChanged && !['description', 'callback'].includes(action.id)) fields = syncDescription(fields, time)
  // A snapshot is immutable. Subsequent edits are a new draft, never a rewrite of what was confirmed.
  return { ...state, fields, announcement, newInfoIndex: state.newInfoIndex + (action.type === 'incoming' ? 1 : 0), lastIncoming: action.type === 'incoming' ? action.proposal.evidence : state.lastIncoming, conversation: action.type === 'incoming' ? [...state.conversation, action.proposal.evidence] : state.conversation }
}
export function restoreModel(raw: string | null): Model {
  const fresh = createInitialModel()
  if (!raw) return fresh
  try {
    const data = JSON.parse(raw)
    const legacyIds = FIELD_IDS.slice(3)
    const ids = data.version === 1 ? legacyIds : FIELD_IDS
    if (![1, 2, 3].includes(data.version) || !Array.isArray(data.state?.fields) || data.state.fields.length !== ids.length) return fresh
    const valid = data.state.fields.every((f: Field, i: number) => f.id === ids[i] && typeof f.value === 'string' && typeof f.initialAI === 'string' && ['ai', 'manual'].includes(f.origin) && ['pending', 'confirmed', 'modified'].includes(f.review) && (f.draft === null || typeof f.draft === 'string') && Array.isArray(f.history) && typeof f.evidence?.quote === 'string' && (f.proposal === null || (typeof f.proposal?.value === 'string' && typeof f.proposal.evidence?.quote === 'string')))
    if (!valid) return fresh
    const fields = fresh.fields.map(f => {
      const saved = data.state.fields.find((item: Field) => item.id === f.id)
      return saved ? { ...f, ...saved, label: f.label, owned: saved.owned || saved.review !== 'pending' || saved.origin === 'manual', review: data.version === 1 ? 'pending' : saved.review } : f
    })
    const conversation = Array.isArray(data.state.conversation) ? data.state.conversation.filter((e: Evidence) => typeof e?.quote === 'string' && typeof e?.speaker === 'string' && typeof e?.time === 'string') : typeof data.state.lastIncoming?.quote === 'string' ? [data.state.lastIncoming] : []
    const pendingFills = Array.isArray(data.state.pendingFills) ? data.state.pendingFills.filter((f: { id: FieldId; value: string; evidence: Evidence }) => FIELD_IDS.includes(f.id) && typeof f.value === 'string' && typeof f.evidence?.quote === 'string') : []
    const oldStreams = Array.isArray(data.state.streams) ? data.state.streams : data.state.stream ? [data.state.stream] : []
    const streams: Stream[] = oldStreams.filter((s: Stream) => typeof s?.evidence?.quote === 'string' && typeof s.evidence.speaker === 'string' && Number.isInteger(s.offset) && s.offset >= 0 && s.offset < s.evidence.quote.length && s.updates && Object.entries(s.updates).every(([id, value]) => FIELD_IDS.includes(id as FieldId) && typeof value === 'string'))

    const fallbackSeconds = Math.max(0, ...[...conversation, ...streams.map(s => s.evidence)].map(e => { const [m, sec] = e.time.split(':').map(Number); return Number.isFinite(m + sec) ? m * 60 + sec : 0 }))
    const elapsedMs = Number.isFinite(data.state.elapsedMs) && data.state.elapsedMs >= 0 ? data.state.elapsedMs : fallbackSeconds * 1000
    return { ...fresh, elapsedMs, fields, conversation, pendingFills, streams, fillOffset: Number.isInteger(data.state.fillOffset) ? data.state.fillOffset : -1, playbackCursor: Number.isInteger(data.state.playbackCursor) && data.state.playbackCursor >= 0 && data.state.playbackCursor <= 11 ? data.state.playbackCursor : null, lastIncoming: typeof data.state.lastIncoming?.quote === 'string' ? data.state.lastIncoming : null, newInfoIndex: Number.isFinite(data.state.newInfoIndex) ? data.state.newInfoIndex : 0, sent: data.version >= 2 && data.state.sent?.values && typeof data.state.sent.time === 'string' ? data.state.sent : null }
  } catch { return fresh }
}
