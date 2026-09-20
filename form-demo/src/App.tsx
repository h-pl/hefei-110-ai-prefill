import { useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Play, Pause, History, RotateCcw, Sparkles, X, ArrowRight, ChevronDown, CircleAlert, UserRoundPen, UserRoundCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AudioSourceCard, type AudioMode } from './AudioSourceCard'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { isPlaybackComplete, isStrong, sendBlocker, submissionIssues, createIdleModel, reducer, restoreModel, type Action, type Field, type FieldId, type Model } from './model'

import { textChange, previewChange } from './text-change'
import { matchAddresses } from './address'
import { usePageTextMotion } from './text-motion'
import { playbackSteps, getFollowups } from './followups'
import { emptyWorkflow, getRoot, getActive, isBusy, makeRequest, restoreWorkflow, workflowReducer, type Outcome, type Workflow } from './workflow'
import { WorkflowPanel, SnapshotFields } from './WorkflowPanel'
import { mockWorkflowResult } from './mock-workflow-service'

const STORAGE_KEY = 'moss-prefill-form:v3'
const WORKFLOW_KEY = 'moss-prefill-workflow:v1'
const readModeModel = (mode: AudioMode) => { try { const saved = localStorage.getItem(`${STORAGE_KEY}:${mode}`) ?? (mode === 'upload' ? localStorage.getItem(STORAGE_KEY) : null); return saved ? restoreModel(saved) : createIdleModel() } catch { return createIdleModel() } }
const readModeWorkflow = (mode: AudioMode) => { try { return restoreWorkflow(localStorage.getItem(`${WORKFLOW_KEY}:${mode}`) ?? (mode === 'upload' ? localStorage.getItem(WORKFLOW_KEY) : null)) } catch { return emptyWorkflow() } }
const formatCallTime = (milliseconds: number) => { const seconds = Math.floor(milliseconds / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }

function Status({ field }: { field: Field }) {
  if (!field.value && !field.draft) return null
  const dirty = field.draft !== null && field.draft.trim() !== field.value
  const confirmed = field.review !== 'pending' && !dirty
  const manual = dirty || field.origin === 'manual'
  if (!confirmed && !manual) return <span className="ai-mark" role="img" title="AI填写" aria-label={`${field.label}由AI填写`}>AI</span>
  const Icon = manual ? UserRoundPen : UserRoundCheck
  const label = confirmed ? (manual ? '人工修改，已确认' : '人工已确认') : isStrong(field.id) ? '人工修改，待单独确认' : '人工修改，待发送时确认'
  return <span role="img" aria-label={label} title={label} className={`field-status ${confirmed ? 'status-confirmed' : 'status-modified'}`}><Icon size={18} strokeWidth={1.8} aria-hidden="true"/></span>
}

function EvidenceIcon() {
  return <img src="/icons/comment-quote-outline.svg" className="evidence-icon" width={16} height={16} alt="" aria-hidden="true"/>
}

function hasFieldEvidence(field: Field) {
  const quote = field.evidence.quote.trim()
  return Boolean(quote && !/^(?:等待对话信息|等待识别)[。.]?$/.test(quote))
}

function Evidence({ field }: { field: Field }) {
  const [open, setOpen] = useState(false)
  if (!hasFieldEvidence(field)) return null
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="ghost" size="sm" className="evidence-trigger" title="查看依据与记录" aria-label={`${field.label}的依据与记录`}><EvidenceIcon/></Button></PopoverTrigger>
    <PopoverContent align="start" className="evidence-panel" data-motion-static>
      <div className="popover-heading"><strong>{field.label}的依据</strong><Button variant="ghost" size="icon" className="close-popover" onClick={() => setOpen(false)} aria-label="关闭依据"><X size={15}/></Button></div>
      <div className="evidence-meta"><EvidenceIcon/>{field.evidence.speaker}<span>{field.evidence.time}</span></div>
      <blockquote>{field.evidence.quote}</blockquote>
      {field.initialAI && <div className="original-ai"><Sparkles size={13}/><span>原 AI 预填</span><strong>{field.initialAI}</strong></div>}
      {field.history.length > 0 && <div className="history-list"><h3><History size={14}/>处理记录</h3>{field.history.slice(-5).reverse().map((event, i) => <div className="history-item" key={`${event.time}-${i}`}><div><span>{event.actor}</span><time>{event.time}</time></div><p>{event.action}</p>{event.before !== undefined && event.before !== event.after && <div className="history-diff"><span>{event.before || '空值'}</span><ArrowRight size={12}/><strong>{event.after}</strong></div>}</div>)}</div>}
    </PopoverContent>
  </Popover>
}

function FormField({ field, submitIssue, dispatch, setFocused, thinking, streamText, extractionComplete }: { field: Field; extractionComplete: boolean; streamText?: string; thinking?: boolean; submitIssue?: string; dispatch: React.Dispatch<Action>; setFocused: (id: FieldId | null) => void }) {
  const [locationOpen, setLocationOpen] = useState(false)
  const [candidateIndex, setCandidateIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const selectRef = useRef<HTMLButtonElement>(null)
  // All generated fields retain the same text layer after completion. Native
  // controls render their text only during editing, avoiding a delayed glyph swap.
  const [streamTail, setStreamTail] = useState<string | undefined>(streamText)
  const previousStream = useRef(streamText)
  const completing = streamText === undefined && previousStream.current !== undefined
  const preview = field.draft === null ? streamText ?? (completing ? field.value : streamTail === field.value ? streamTail : undefined) : undefined
  useLayoutEffect(() => {
    const hadStream = previousStream.current !== undefined
    previousStream.current = streamText
    if (streamText !== undefined) { setStreamTail(streamText); return }
    if (!hadStream) return
    setStreamTail(field.value)
  }, [streamText, field.value])
  const value = field.draft ?? streamText ?? field.value
  const candidates = field.id === 'location' ? matchAddresses(value) : []
  const editing = field.draft !== null
  const changed = editing && field.draft!.trim() !== field.value
  const proposal = field.proposal
  const strong = isStrong(field.id)
  const hint = field.error ?? submitIssue ?? ''
  const confirmLabel = field.id === 'location' ? '确认地点' : '确认号码'
  const focus = () => (inputRef.current ?? textRef.current ?? selectRef.current)?.focus()
  const save = () => dispatch({ type: 'save', id: field.id })
  const blur = () => { setFocused(null); setLocationOpen(false); save() }
  const confirm = () => { if (streamText !== undefined) return; dispatch({ type: 'confirm', id: field.id }); focus(); setLocationOpen(false) }
  const cancel = () => { dispatch({ type: 'cancel', id: field.id }); focus(); setLocationOpen(false) }
  const chooseAddress = (index: number) => { if (!candidates[index]) return; dispatch({ type: 'select-location', id: 'location', value: candidates[index].value }); setLocationOpen(false); setCandidateIndex(-1); inputRef.current?.focus() }
  useLayoutEffect(() => {
    const textarea = textRef.current
    if (!textarea) return
    const fitContent = () => { textarea.style.height = 'auto'; textarea.style.height = `${Math.max(72, textarea.scrollHeight)}px` }
    fitContent()
    let width = textarea.clientWidth
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth !== width) { width = textarea.clientWidth; fitContent() }
    })
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [value])
  useEffect(() => {
    if (locationOpen && candidateIndex >= 0) document.getElementById(candidates[candidateIndex]?.id)?.scrollIntoView({ block: 'nearest' })
  }, [candidateIndex, locationOpen])
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (field.id === 'location' && locationOpen) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setLocationOpen(false); return }
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setCandidateIndex(index => event.key === 'ArrowDown' ? Math.min(index + 1, candidates.length - 1) : Math.max(0, index - 1)); return }
      if (event.key === 'Enter' && candidateIndex >= 0) { event.preventDefault(); chooseAddress(candidateIndex); return }
    }
    if (event.key === 'Escape' && editing) { event.preventDefault(); event.stopPropagation(); cancel() }
    if (event.key === 'Enter' && (field.id !== 'description' || event.metaKey || event.ctrlKey)) { event.preventDefault(); (inputRef.current ?? textRef.current)?.blur() }
  }
  const controlProps = { id: field.id, value, 'aria-invalid': Boolean(field.error), 'aria-describedby': hint ? `${field.id}-hint` : undefined, onFocus: () => setFocused(field.id), onBlur: blur, onKeyDown, 'aria-busy': streamText !== undefined }
  const placeholder = thinking ? '' : extractionComplete ? '未获取到' : field.id === 'description' ? '等待生成' : '等待识别'
  const tone = !value && !thinking ? 'empty' : changed ? 'modified' : field.review !== 'pending' ? 'confirmed' : field.origin === 'manual' ? 'modified' : 'ai'
  return <section className={`form-field ${thinking ? 'is-thinking' : ''} ${streamText !== undefined ? 'is-streaming' : ''} ${preview !== undefined ? 'has-stream-preview' : ''} tone-${tone} ${editing ? 'is-editing' : ''} ${strong ? 'strong-field' : ''} ${field.error ? 'has-error' : ''}`} data-field={field.id} aria-labelledby={`${field.id}-label`} onKeyDown={event => { if (event.key === 'Escape' && editing && !event.defaultPrevented) { event.preventDefault(); cancel() } }}>
    <div className="field-heading"><div className="label-group"><label id={`${field.id}-label`} htmlFor={field.id}>{field.label}</label><Evidence field={field}/></div>{hint && <span className={`field-hint ${field.error ? 'hint-error' : 'hint-warning'}`} id={`${field.id}-hint`} role="alert">{hint}</span>}</div>
    <div className={`input-frame ${field.id === 'description' ? 'long-input' : ''}`}>
      <Status field={streamText !== undefined ? { ...field, value: streamText || field.value } : field}/>{preview !== undefined && <div className="field-stream-copy" aria-hidden="true"><StreamedText quote={preview} offset={preview.length} baseline={field.value}/></div>}{thinking && !value && <span className="thinking-text" aria-hidden="true">正在提取{field.label}…</span>}
      {field.id === 'ongoing' ? <Select value={value || undefined} onValueChange={v => dispatch({ type: 'edit', id: field.id, value: v })}><SelectTrigger ref={selectRef} id={field.id} className="field-select" aria-labelledby={`${field.id}-label`} aria-describedby={hint ? `${field.id}-hint` : undefined} aria-invalid={Boolean(field.error)} onFocus={() => setFocused(field.id)} onBlur={blur}><SelectValue placeholder={placeholder}/></SelectTrigger><SelectContent data-motion-static onCloseAutoFocus={save}><SelectItem value="是">是</SelectItem><SelectItem value="否">否</SelectItem><SelectItem value="不详">不详</SelectItem></SelectContent></Select> : field.id === 'description' ? <Textarea {...controlProps} ref={textRef} className="field-input field-textarea" onChange={e => dispatch({ type: 'edit', id: field.id, value: e.target.value })} placeholder={placeholder}/> : <Input {...controlProps} ref={inputRef} className="field-input" role={field.id === 'location' ? 'combobox' : undefined} aria-autocomplete={field.id === 'location' ? 'list' : undefined} aria-expanded={field.id === 'location' ? locationOpen : undefined} aria-controls={field.id === 'location' && locationOpen ? 'address-options' : undefined} aria-activedescendant={field.id === 'location' && locationOpen && candidateIndex >= 0 ? candidates[candidateIndex]?.id : undefined} onClick={() => { if (field.id === 'location') setLocationOpen(true) }} onFocus={() => { setFocused(field.id); if (field.id === 'location') setLocationOpen(true) }} onBlur={blur} onChange={e => { dispatch({ type: 'edit', id: field.id, value: e.target.value }); if (field.id === 'location') { setLocationOpen(true); setCandidateIndex(-1) } }} placeholder={placeholder} autoComplete="off"/>}
      {field.id === 'location' && locationOpen && <div className="address-panel" onMouseDown={e => e.preventDefault()}><div className="address-panel-heading"><strong>关联地点 · {candidates.length} 个候选</strong><span>模拟候选 · 未接入 API</span></div><div id="address-options" role="listbox" aria-label="地点匹配候选">{candidates.map((candidate, i) => <button type="button" role="option" aria-selected={i === candidateIndex} id={candidate.id} key={candidate.id} tabIndex={-1} onClick={() => chooseAddress(i)}><strong>{candidate.name}</strong><span>{candidate.area}</span><small>{candidate.value === value ? '当前' : '选择'}</small></button>)}</div>{!candidates.length && <p className="address-empty">未匹配到候选。请调整关键词，或保留口述地点，不补填未知信息。</p>}<div className="address-panel-note">选择即确认，并更新到事发地点。</div></div>}
      {strong && (field.review === 'pending' || changed) && (field.draft ?? field.value).trim() && <Button variant="ghost" size="sm" className="inline-confirm" data-motion-static disabled={streamText !== undefined} onClick={confirm} aria-label={confirmLabel}><Check size={15}/>确认</Button>}

    </div>

    {proposal && (field.deferred ? <Button variant="ghost" className="deferred-message" onClick={() => dispatch({ type: 'expand', id: field.id })}><CircleAlert size={14}/>有新信息待核对，当前内容已保留<ChevronDown size={14}/></Button> : <div className="proposal-panel" role="region" aria-label={`${field.label}的新信息`}>
      <div className="proposal-heading"><span><Sparkles size={14}/>有新信息，请核对</span><span className="preserved-label">当前内容未被覆盖</span></div>
      <blockquote>{proposal.evidence.quote}</blockquote>
      <div className="proposal-diff"><span>当前 <strong>{field.value || '空值'}</strong></span><ArrowRight size={14}/><span>建议 <strong>{proposal.value}</strong></span></div>
      <div className="proposal-footer"><span>{proposal.evidence.speaker} · {proposal.evidence.time}</span><div><Button variant="ghost" size="sm" onClick={() => dispatch({ type: 'defer', id: field.id })}>稍后核对</Button><Button variant="outline" size="sm" onClick={() => dispatch({ type: 'keep', id: field.id })}>保留当前值</Button><Button size="sm" disabled={changed} onClick={() => dispatch({ type: 'adopt', id: field.id })}>采纳建议</Button></div></div>
      {changed && <p className="proposal-edit-note">请先修正输入，失焦后自动保存；按 Esc 可撤销本次编辑。</p>}
    </div>)}
  </section>
}

function useCardMotion(signature: string) {
  const listRef = useRef<HTMLUListElement>(null)
  const previousPositions = useRef(new Map<string, { top: number; height: number }>())
  const movements = useRef(new Map<string, Animation>())
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const previous = previousPositions.current
    const next = new Map<string, { top: number; height: number }>()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const previousBottom = Math.max(0, ...[...previous.values()].map(p => p.top + p.height))
    for (const el of list.querySelectorAll<HTMLElement>('[data-question-id]')) {
      const id = el.dataset.questionId!
      const old = previous.get(id)
      const active = movements.current.get(id)
      const transform = getComputedStyle(el).transform
      const inFlightY = active && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0
      active?.cancel()
      const top = el.offsetTop
      next.set(id, { top, height: el.offsetHeight })
      if (!previous.size || reduced) continue
      const from = old ? old.top + inFlightY - top : Math.max(12, previousBottom + 6 - top)
      if (Math.abs(from) < 1) continue
      movements.current.set(id, el.animate([
        { transform: `translateY(${from}px)`, opacity: old ? 1 : .35 },
        { transform: 'translateY(0)', opacity: 1 },
      ], { duration: 560, easing: 'cubic-bezier(.22,1,.36,1)' }))
    }
    for (const [id, animation] of movements.current) {
      if (!next.has(id)) { animation.cancel(); movements.current.delete(id) }
    }
    previousPositions.current = next
  }, [signature])
  useEffect(() => () => { movements.current.forEach(animation => animation.cancel()) }, [])
  return listRef
}

function CardDetails({ items, revision = 0 }: { items: { id: string; text: string; className?: string; analysis?: { started: boolean; playing: boolean } }[]; revision?: number }) {
  const listRef = useCardMotion(JSON.stringify(items))
  return <ul ref={listRef} className="assist-detail-list">{items.map((item, i) => <li key={item.id} data-question-id={item.id} className={item.className}>{item.analysis ? <AnalysisStatus {...item.analysis}/> : <span key={`${revision}:${item.text}`} data-motion-static={item.text.startsWith('等待') || item.text.startsWith('对话开始后') || undefined} className={item.text.startsWith('等待') || item.text.startsWith('对话开始后') ? undefined : "followup-copy"} style={{ animationDelay: `${i * 100}ms` }}>{item.text}</span>}</li>)}</ul>
}

function StreamedText({ quote, offset, baseline }: { quote: string; offset: number | null; baseline?: string }) {
  const text = offset === null ? quote : quote.slice(0, offset)
  const [frame, setFrame] = useState(() => {
    const initial = baseline ?? text
    return { text: initial, serial: initial.length, streaming: offset !== null, tokens: Array.from(initial).map((char, id) => ({ char, id, fresh: baseline === undefined && offset !== null })) }
  })
  let current = frame
  if (frame.text !== text) {
    const { start, beforeEnd, afterEnd } = textChange(frame.text, text)
    let serial = frame.serial
    const inserted = Array.from(text.slice(start, afterEnd)).map(char => ({ char, id: serial++, fresh: frame.streaming || offset !== null }))
    current = { text, serial, streaming: frame.streaming || offset !== null, tokens: [...frame.tokens.slice(0, start), ...inserted, ...frame.tokens.slice(beforeEnd)] }
    setFrame(current)
  }
  return <>{current.tokens.map(token => <span key={token.id} className={token.fresh ? 'transcript-chunk' : undefined}>{token.char}</span>)}</>
}

// Preserve unchanged character nodes; only newly inserted characters animate.
function UpdatingText({ text, thinking, idle = false, paused = false, streamInitial = false }: { text: string; thinking: boolean; idle?: boolean; paused?: boolean; streamInitial?: boolean }) {
  const serial = useRef(0)
  const [tokens, setTokens] = useState(() => Array.from(streamInitial ? '' : text).map(char => ({ char, id: serial.current++, fresh: false })))
  const current = useRef(tokens)
  useEffect(() => {
    const old = current.current
    const chars = Array.from(text)
    let prefix = 0
    while (prefix < old.length && prefix < chars.length && old[prefix].char === chars[prefix]) prefix++
    let suffix = 0
    while (suffix < old.length - prefix && suffix < chars.length - prefix && old[old.length - 1 - suffix].char === chars[chars.length - 1 - suffix]) suffix++
    const head = old.slice(0, prefix)
    const tail = suffix ? old.slice(-suffix) : []
    const added = chars.slice(prefix, chars.length - suffix).map(char => ({ char, id: serial.current++, fresh: !idle }))
    const publish = (count: number) => { current.current = [...head, ...added.slice(0, count), ...tail]; setTokens(current.current) }
    if (idle || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { publish(added.length); return }
    publish(0)
    if (!added.length) return
    let count = 0
    const timer = window.setInterval(() => { publish(++count); if (count >= added.length) window.clearInterval(timer) }, 45)
    return () => window.clearInterval(timer)
  }, [text, idle])
  return <span className={`risk-copy ${thinking ? 'risk-thinking' : ''} ${idle ? 'risk-placeholder' : ''}`} style={{ animationPlayState: paused ? 'paused' : 'running' }}>{tokens.map(token => <span key={token.id} className={token.fresh ? 'transcript-chunk' : undefined}>{token.char}</span>)}</span>
}

function AnalysisStatus({ started, playing }: { started: boolean; playing: boolean }) {
  return <span data-motion-static className={started ? 'analysis-status analysis-copy' : 'analysis-status'} style={{ animationPlayState: playing ? 'running' : 'paused' }}>{started ? '正在分析对话信息' : '等待识别'}</span>
}

function FollowupCard({ questions, started, playing }: { questions: ReturnType<typeof getFollowups>; started: boolean; playing: boolean }) {
  const listRef = useCardMotion(JSON.stringify(questions))
  return <section className="assist-card followup-card" aria-label="追问辅助">
    <h3>追问辅助</h3>
    <div className="followup-content" aria-live="polite" aria-atomic="true">
      {questions.length > 0 && <div className="followup-status"><span className="assist-priority"><UpdatingText text={questions[0].priority} thinking={false} streamInitial/></span></div>}
      <ul className="followup-questions" ref={listRef}>{!questions.length && <li className="muted" data-motion-static><AnalysisStatus started={started} playing={playing}/></li>}{questions.map(q => <li key={q.id} data-question-id={q.id} className="followup-question"><UpdatingText text={q.text} thinking={false} streamInitial/></li>)}</ul>
    </div>
  </section>
}

export default function App() {
  usePageTextMotion()
  const [audioMode, setAudioMode] = useState<AudioMode>('upload')
  const sessions = useRef<Partial<Record<AudioMode, { state: Model; workflow: Workflow }>>>({})
  const [state, dispatch] = useReducer(reducer, undefined, () => readModeModel('upload'))
  const [workflow, flowDispatch] = useReducer(workflowReducer, undefined, () => readModeWorkflow('upload'))
  const [flowStorageError, setFlowStorageError] = useState(false)
  const [nextOutcome, setNextOutcome] = useState<Outcome>('received')
  const [queryOutcome, setQueryOutcome] = useState<Outcome>('received')
  const [workflowDialog, setWorkflowDialog] = useState<'supplement' | 'record' | null>(null)
  const outcomeRef = useRef({ nextOutcome, queryOutcome })
  outcomeRef.current = { nextOutcome, queryOutcome }
  const rootRequest = getRoot(workflow)
  const activeRequest = getActive(workflow)
  const snapshot = rootRequest && workflow.screen !== 'edit' ? rootRequest : null
  const flowBusy = isBusy(activeRequest)
  const flowComplete = activeRequest?.kind === 'record' && activeRequest.status === 'received'
  const latestSupplement = workflow.requests.filter(r => r.kind === 'supplement' && r.parentId === rootRequest?.id && r.status === 'received').at(-1)
  const supplementBaseline = latestSupplement?.fields ?? rootRequest?.fields
  const supplementChanges = supplementBaseline ? state.fields.filter(f => f.value !== supplementBaseline.find(old => old.id === f.id)?.value) : []
  const supplementText = supplementChanges.map(f => `${f.label}：${supplementBaseline?.find(old => old.id === f.id)?.value || '尚未获取'} → ${f.value || '尚未获取'}`).join('\n')
  const supplementNeedsConfirmation = supplementChanges.some(f => isStrong(f.id) && f.review === 'pending')
  const canSupplement = rootRequest?.status === 'received' && activeRequest?.status === 'received' && !flowComplete && workflow.screen === 'edit'
  useEffect(() => { if (rootRequest?.status === 'received') flowDispatch({ type: 'draft', value: supplementText }) }, [rootRequest?.id, supplementText])
  useEffect(() => { try { localStorage.setItem(`${WORKFLOW_KEY}:${audioMode}`, JSON.stringify(workflow)); setFlowStorageError(false) } catch { setFlowStorageError(true) } }, [workflow, audioMode])
  useEffect(() => {
    if (!activeRequest || !isBusy(activeRequest)) return
    const planned = activeRequest.status === 'querying' ? outcomeRef.current.queryOutcome : outcomeRef.current.nextOutcome
    const timer = window.setTimeout(() => {
      const outcome = mockWorkflowResult(activeRequest, planned)
      flowDispatch({ type: 'result', id: activeRequest.id, attempt: activeRequest.attempt, outcome, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [activeRequest])
  const beginHandoff = (urgent = false) => {
    const confirmed = reducer(state, { type: 'send', urgent })
    const request = makeRequest(confirmed, 'handoff', workflow.requests.filter(r => r.kind === 'handoff').length + 1, null, '', urgent)
    dispatch({ type: 'send', urgent })
    flowDispatch({ type: 'start', request })
    setHandoff(null)
  }
  const beginSupplement = () => flowDispatch({ type: 'start', request: makeRequest(state, 'supplement', workflow.requests.filter(r => r.kind === 'supplement').length + 1, rootRequest!.id, supplementText, rootRequest!.urgent) })
  const beginRecord = () => flowDispatch({ type: 'start', request: makeRequest(state, 'record', workflow.requests.filter(r => r.kind === 'record').length + 1, rootRequest!.id, '保存本轮警情、来源、核对与操作记录', rootRequest!.urgent) })
  const [focused, setFocused] = useState<FieldId | null>(null)
  const [playing, setPlaying] = useState(false)
  const transcriptTitle = audioMode === 'upload' ? '音频转写' : '实时转写'
  const [audioBusy, setAudioBusy] = useState(false)
  const [audioResetVersion, setAudioResetVersion] = useState(0)
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  const transcriptRef = useRef<HTMLDivElement>(null)
  const [storageError, setStorageError] = useState(false)
  const [notice, setNotice] = useState('')
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [resetVersion, setResetVersion] = useState(0)
  const [handoff, setHandoff] = useState<'normal' | 'urgent' | null>(null)
  const persist = () => { try { localStorage.setItem(`${STORAGE_KEY}:${audioMode}`, JSON.stringify({ version: 3, state })); setStorageError(false); return true } catch { setStorageError(true); return false } }
  useEffect(() => { persist() }, [state, audioMode])
  const field = (id: FieldId) => (snapshot?.fields ?? state.fields).find(f => f.id === id)!
  const reviewed = (snapshot?.fields ?? state.fields).filter(f => isStrong(f.id) && f.review !== 'pending' && f.draft === null).length
  const started = state.playbackCursor !== null
  const conversation = state.conversation
  const transcriptionDone = started && state.playbackCursor! >= playbackSteps.length && state.streams.length === 0
  const playbackDone = isPlaybackComplete(state, playbackSteps.length)
  const callTime = formatCallTime(state.elapsedMs)
  const elapsedRef = useRef(state.elapsedMs)
  elapsedRef.current = state.elapsedMs
  const activeFill = state.pendingFills[0]
  const nextStepIndex = (state.playbackCursor ?? 0) + state.streams.length
  const nextStep = playbackSteps[nextStepIndex]
  const nextSpeakerBusy = !!nextStep && state.streams.some(s => s.evidence.speaker === nextStep.evidence.speaker)
  const transcriptRows = [...conversation.map(evidence => ({ evidence, offset: null as number | null })), ...state.streams.map(s => ({ evidence: s.evidence, offset: s.offset }))].sort((a, b) => a.evidence.time.localeCompare(b.evidence.time))
  const operatorStream = state.streams.find(s => s.evidence.speaker === '接警员')
  const callerStream = state.streams.find(s => s.evidence.speaker === '报警人')
  const followups = getFollowups(conversation)
  const pendingUpdates = state.fields.filter(f => f.proposal).length
  const blocker = sendBlocker(state)
  const issues = submitAttempted ? submissionIssues(state) : {}
  const currentSent = snapshot ? !snapshot.urgent : state.sent && state.fields.every(f => f.draft === null && !f.proposal && f.review !== 'pending' && state.sent!.values[f.id] === f.value)
  const submitDirectly = () => {
    setNotice('')
    const validation = submissionIssues(state)
    const first = state.fields.find(f => validation[f.id])
    if (first) {
      setSubmitAttempted(true)
      dispatch({ type: 'send' })
      const target = document.querySelector<HTMLButtonElement>(`[data-field="${first.id}"] .inline-confirm`) ?? document.getElementById(first.id)
      target?.focus()
      target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      return
    }
    setSubmitAttempted(false)
    beginHandoff()
  }
  useEffect(() => {
    if (!playing || !operatorStream) return
    const timer = window.setTimeout(() => dispatch({ type: 'stream-tick', speaker: '接警员' }), 200)
    return () => window.clearTimeout(timer)
  }, [playing, operatorStream])
  useEffect(() => {
    if (!playing || !callerStream) return
    const timer = window.setTimeout(() => dispatch({ type: 'stream-tick', speaker: '报警人' }), 180)
    return () => window.clearTimeout(timer)
  }, [playing, callerStream])
  useEffect(() => {
    if (!started || !playing || transcriptionDone) return
    let previous = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      dispatch({ type: 'clock-tick', milliseconds: now - previous })
      previous = now
    }, 100)
    return () => window.clearInterval(timer)
  }, [started, playing, transcriptionDone, resetVersion])
  useEffect(() => {
    if (!playing || !activeFill) return
    const timer = window.setTimeout(() => { dispatch({ type: 'fill-tick', focused: focusedRef.current }) }, state.fillOffset < 0 ? 400 : 65)
    return () => window.clearTimeout(timer)
  }, [playing, activeFill, state.fillOffset])
  useEffect(() => {
    if (!playing || !started || !nextStep || nextSpeakerBusy) return
    // Speech starts independently of extraction; each role keeps its own stream.
    const timer = window.setTimeout(() => dispatch({ type: 'stream-start', ...nextStep, evidence: { ...nextStep.evidence, time: formatCallTime(elapsedRef.current) } }), nextStepIndex === 0 ? 200 : 650)
    return () => window.clearTimeout(timer)
  }, [playing, started, nextStep, nextSpeakerBusy, nextStepIndex, resetVersion])
  useEffect(() => { if (playing && playbackDone) setPlaying(false) }, [playing, playbackDone])
  useEffect(() => {
    if (state.playbackCursor !== null && transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
  }, [state.playbackCursor, operatorStream?.offset, callerStream?.offset])
  const sampleUnavailable = audioBusy || (!!rootRequest && playbackDone && (flowComplete || conversation.some(e => e.quote === '旁边还有一个人脚踝受伤，走不了路。')))
  const startExample = () => {
    if (sampleUnavailable) return
    if (rootRequest && playbackDone && !flowComplete) {
      const quote = '旁边还有一个人脚踝受伤，走不了路。'
      dispatch({ type: 'stream-start', evidence: { speaker: '报警人', time: formatCallTime(state.elapsedMs), quote }, updates: { injury: '一人手臂流血，意识清醒；另有一人脚踝受伤，无法行走' } })
      setPlaying(true)
      return
    }
    if (state.playbackCursor === null || playbackDone) {
      dispatch({ type: 'playback-start' }); flowDispatch({ type: 'reset' }); setResetVersion(v => v + 1); setSubmitAttempted(false); setNotice(''); setFocused(null); setHandoff(null)
    }
    setPlaying(true)
  }
  const resetProcessing = (start: boolean) => {
    dispatch({ type: start ? 'playback-start' : 'playback-idle' })
    flowDispatch({ type: 'reset' })
    setResetVersion(v => v + 1)
    setSubmitAttempted(false)
    setNotice('')
    setFocused(null)
    setHandoff(null)
    setWorkflowDialog(null)
    setPlaying(start)
  }
  const changeAudioMode = (mode: AudioMode) => {
    if (mode === audioMode || (audioMode === 'upload' && started && !playbackDone)) return
    sessions.current[audioMode] = { state, workflow }
    const cached = sessions.current[mode] ?? { state: readModeModel(mode), workflow: readModeWorkflow(mode) }
    dispatch({ type: 'restore-session', state: cached.state })
    flowDispatch({ type: 'restore-session', state: cached.workflow })
    setPlaying(false)
    setResetVersion(v => v + 1)
    setSubmitAttempted(false)
    setNotice('')
    setFocused(null)
    setHandoff(null)
    setWorkflowDialog(null)
    setAudioMode(mode)
  }
  const resetAllModes = () => {
    sessions.current = { upload: { state: createIdleModel(), workflow: emptyWorkflow() }, microphone: { state: createIdleModel(), workflow: emptyWorkflow() } }
    resetProcessing(false)
    setAudioMode('upload')
    setAudioResetVersion(v => v + 1)
    try {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(WORKFLOW_KEY)
      for (const mode of ['upload', 'microphone'] as const) {
        localStorage.setItem(`${STORAGE_KEY}:${mode}`, JSON.stringify({ version: 3, state: sessions.current[mode]!.state }))
        localStorage.setItem(`${WORKFLOW_KEY}:${mode}`, JSON.stringify(emptyWorkflow()))
      }
    } catch { setStorageError(true); setFlowStorageError(true) }
  }
  const togglePlayback = () => { if (playing) setPlaying(false); else startExample() }
  return <div className="workbench">
    <header className="workbench-nav"><div className="brand">110 / <span>接警助手</span></div><div className="header-call-info" data-motion-static><strong className="header-call-status" tabIndex={0} title="接警时间 14:32:08" aria-label={`${state.playbackCursor === null ? '等待接听' : '正在通话'}，通话时长${callTime}，接警时间14点32分08秒`}><span className="call-status-dot"/><span>{state.playbackCursor === null ? '等待接听' : '正在通话'}</span> <span>{callTime}</span></strong><span className="header-case-id">JQ-20260916-0028</span><span className="header-caller">来电 <b>138****6721</b></span></div><div className="header-tools"><Popover><PopoverTrigger asChild><Button variant="ghost" className="demo-badge" aria-label="交互演示设置">交互演示</Button></PopoverTrigger><PopoverContent className="simulation-settings" data-motion-static><strong>模拟服务回执</strong><p>仅在当前浏览器模拟，未连接调度系统。</p><label>下次提交结果<select aria-label="下次提交结果" value={nextOutcome} onChange={e => setNextOutcome(e.target.value as Outcome)}><option value="received">成功接收</option><option value="failed">明确失败</option><option value="unknown">结果未知</option></select></label><label>下次查询结果<select aria-label="下次查询结果" value={queryOutcome} onChange={e => setQueryOutcome(e.target.value as Outcome)}><option value="received">已成功接收</option><option value="failed">明确未接收</option><option value="unknown">仍然未知</option></select></label></PopoverContent></Popover><Button variant="ghost" size="sm" className="reset-demo" aria-label="重置演示数据" title="重置演示数据" onClick={resetAllModes}><RotateCcw size={14}/><span className="reset-label">重置演示数据</span></Button><span className="nav-operator" data-motion-static>接警员 012<span className="operator-separator">·</span><span className="operator-online">在线</span></span><div className="header-actions" data-motion-static role="group" aria-label="警单操作"><Button variant="outline" className="urgent-action" disabled={!!rootRequest && !(rootRequest.status === 'failed' && workflow.screen === 'edit')} onClick={() => { setNotice(''); setHandoff('urgent') }}>紧急先行移交</Button>{canSupplement ? (supplementChanges.length > 0 && <Button className="handoff-action" title={supplementNeedsConfirmation ? '变更后的地点或回拨号码需先确认' : undefined} disabled={supplementNeedsConfirmation || pendingUpdates > 0 || state.fields.some(f => f.draft !== null || f.error)} onClick={() => { flowDispatch({ type: 'draft', value: supplementText }); setWorkflowDialog('supplement') }}>发送补充（{supplementChanges.length}项）</Button>) : <Button className="handoff-action" disabled={flowBusy || flowComplete || (!!rootRequest && !(rootRequest.status === 'failed' && workflow.screen === 'edit'))} onClick={submitDirectly}><span>{flowComplete ? '已完成整理' : flowBusy ? '处理中' : rootRequest && workflow.screen !== 'edit' ? '已提交' : '移交调度'}</span></Button>}</div></div></header>
    <main className="workspace-grid">
      <aside className="transcript-column" aria-label={transcriptTitle}><AudioSourceCard key={audioResetVersion} mode={audioMode} onModeChange={changeAudioMode} recognizing={audioMode === 'upload' && started && !playbackDone} onSampleSelected={() => resetProcessing(true)} onUseAudio={() => setPlaying(false)} onBusyChange={setAudioBusy}/><div className="transcript-heading"><h2>{transcriptTitle}</h2>{audioMode === 'microphone' && <Button variant="ghost" size="icon" className="playback-button" disabled={sampleUnavailable} onClick={togglePlayback} aria-label={playing ? '暂停模拟对话' : playbackDone ? rootRequest ? '模拟补充对话' : '重新播放模拟对话' : state.playbackCursor !== null ? '继续模拟对话' : '播放模拟对话'} title={playing ? '暂停' : playbackDone ? rootRequest ? '模拟补充对话' : '重新播放' : state.playbackCursor !== null ? '继续播放' : '从头播放模拟对话'}>{playing ? <Pause size={16}/> : playbackDone ? <RotateCcw size={16}/> : <Play size={16}/>}</Button>}</div>{state.playbackCursor !== null && <p className="recording"><span className="recording-dot"/><span className="recording-copy">示例对话 · {playing ? '转写持续更新' : playbackDone ? '播放完成' : '已暂停'}</span></p>}<div className="transcript-messages" ref={transcriptRef} tabIndex={0} role="region" aria-label="对话记录">{transcriptRows.length === 0 && <p className="transcript-empty">{state.playbackCursor === null ? audioMode === 'upload' ? '上传示例音频，开始模拟对话' : '点击播放，开始模拟对话' : '正在接通…'}</p>}{transcriptRows.map(({ evidence: { speaker, time, quote }, offset }) => <article key={`${speaker}-${time}`} className={`message ${offset !== null ? 'streaming-message' : ''} ${speaker === '报警人' ? 'caller' : 'operator-message'}`} aria-label={offset !== null ? `${speaker}正在转写` : undefined}><header><span className="speaker-label">{speaker}</span><span>·</span><time>{time}</time>{offset !== null && <span className="speaking-indicator">{playing ? '正在说话' : '已暂停'}</span>}</header><p><StreamedText quote={quote} offset={offset}/>{offset !== null && <span className={`transcript-caret ${playing ? '' : 'paused'}`} aria-hidden="true"/>}</p></article>)}</div>

      </aside>
      <section className="form-column" aria-labelledby="form-title"><div className="form-title-row"><div><div className="form-heading-main"><h1 id="form-title">预填警单</h1>{currentSent && <span className="form-confirmed-status" role="status" data-motion-static title={`本次警单已整体确认 · ${snapshot?.time ?? state.sent?.time ?? ''} · 未发送至调度系统`} aria-label={`本次警单已整体确认，${snapshot?.time ?? state.sent?.time ?? ''}，未发送至调度系统`}><UserRoundCheck size={15} aria-hidden="true"/>已确认</span>}{(notice || storageError || flowStorageError) && <span role="status" className={`form-save-feedback ${storageError || flowStorageError ? 'storage-error' : ''}`}>{storageError || flowStorageError ? '暂存失败，请保持页面打开' : notice}</span>}</div><p>{snapshot ? '本次移交内容保留；新增信息作为关联补充。' : '人工处理后，AI 不会覆盖。'}{pendingUpdates > 0 && <span className="pending-update-note">{pendingUpdates} 项新信息待处理</span>}</p></div><div className="key-progress"><UserRoundCheck size={15}/><span>关键核对 <b>{reviewed}</b> / 2</span></div></div>
        <div className="risk-banner" data-motion-static tabIndex={0} role="region" aria-label="当前风险提示"><UpdatingText text={field('ongoing').value === '是' ? '现场冲突仍在发生' : field('ongoing').value === '否' ? '当前记录：事件已停止' : field('reason').value ? '事件是否持续待核实' : started ? '正在分析对话信息' : '等待识别'} idle={!field('reason').value && !field('ongoing').value} paused={!playing} thinking={(!field('reason').value && !field('ongoing').value && started) || (playing && state.fillOffset < 0 && state.pendingFills[0]?.id === 'ongoing')}/>{field('injury').value && <span className="risk-divider">·</span>}<UpdatingText text={field('injury').value} thinking={playing && state.fillOffset < 0 && state.pendingFills[0]?.id === 'injury'}/></div>
        {snapshot ? <SnapshotFields request={snapshot} renderEvidence={f => <Evidence field={f}/>}/> : <form onSubmit={e => e.preventDefault()} className="prefill-form" aria-label="预填警单">
          <div className="field-group-heading"><span>基础信息</span><span>地点、号码需单独确认</span></div>
          {state.fields.slice(0, 3).map(f => <FormField key={`${resetVersion}-${f.id}`} field={f} streamText={state.pendingFills[0]?.id === f.id && state.fillOffset >= 0 && f.origin === 'ai' && !f.owned && f.review === 'pending' && focused !== f.id ? previewChange(f.value, state.pendingFills[0].value, state.fillOffset) : undefined} extractionComplete={playbackDone} thinking={playing && !playbackDone && !f.value && f.draft === null && focused !== f.id} submitIssue={issues[f.id]} dispatch={action => { setNotice(''); dispatch(action) }} setFocused={setFocused}/>)}
          <div className="field-group-heading core-group"><span>核心预填</span><span>随发送整体确认</span></div>
          {state.fields.slice(3).map(f => <FormField key={`${resetVersion}-${f.id}`} field={f} streamText={state.pendingFills[0]?.id === f.id && state.fillOffset >= 0 && f.origin === 'ai' && !f.owned && f.review === 'pending' && focused !== f.id ? previewChange(f.value, state.pendingFills[0].value, state.fillOffset) : undefined} extractionComplete={playbackDone} thinking={playing && !playbackDone && !f.value && f.draft === null && focused !== f.id} submitIssue={issues[f.id]} dispatch={action => { setNotice(''); dispatch(action) }} setFocused={setFocused}/>)}
        </form>}
      </section>
      {rootRequest ? <WorkflowPanel workflow={workflow} dispatch={flowDispatch} fields={state.fields} pending={pendingUpdates} storageError={storageError || flowStorageError} startSupplement={beginSupplement} startRecord={beginRecord} dialog={workflowDialog} setDialog={setWorkflowDialog}/> : <aside className="assistance-column" aria-label="接警辅助"><h2>接警辅助</h2><FollowupCard questions={followups} started={started} playing={playing}/>
        <section className="assist-card classification-card">
          <div className="assist-card-heading"><h3>警情分类</h3>{field('reason').value && hasFieldEvidence(field('reason')) && <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className="evidence-trigger" title="查看分类依据" aria-label="警情分类的依据"><EvidenceIcon/></Button></PopoverTrigger><PopoverContent className="evidence-panel" data-motion-static><strong>警情分类的依据</strong>{field('reason').value ? <><div className="evidence-meta"><EvidenceIcon/>{field('reason').evidence.speaker}<span>{field('reason').evidence.time}</span></div><blockquote>{field('reason').evidence.quote}</blockquote><p>仅依据原话展示分类建议，正式分类字典未接入。</p></> : <p>暂无分类依据。</p>}</PopoverContent></Popover>}</div>
          <CardDetails items={[{ id: 'classification', text: field('reason').value ? '打架相关警情 · 待确认' : '', analysis: field('reason').value ? undefined : { started, playing } }]}/>
        </section>
        <section className="assist-card" data-motion-static><h3>处置预案</h3><p className="muted">待接入</p></section>
        <section className="assist-card" data-motion-static><h3>警力辅助</h3><p className="muted">待接入</p></section>
      </aside>}
    </main>

    <span className="sr-only" role="status">{state.announcement}</span>
    <AlertDialog open={handoff !== null} onOpenChange={open => !open && setHandoff(null)}><AlertDialogContent className="handoff-dialog"><AlertDialogHeader><AlertDialogTitle>{handoff === 'urgent' ? '紧急先行移交' : '确认并移交调度'}</AlertDialogTitle><AlertDialogDescription>紧急情况下可先移交已保存的内容；未确认地点、号码及其他未核实事项随单保留。当前使用模拟调度服务。</AlertDialogDescription></AlertDialogHeader>
      <div className="handoff-summary">{state.fields.map(f => {
        const value = f.draft ?? f.value
        return <div key={f.id}><span>{f.label}</span><p><StreamedText quote={value} offset={value.length} baseline={value}/></p>{isStrong(f.id) && <span className={f.review === 'pending' || f.draft !== null ? 'summary-pending' : 'summary-confirmed'}>{f.review === 'pending' || f.draft !== null ? '待单独确认' : '已确认'}</span>}</div>
      })}</div>
      {blocker && <p className="handoff-blocker"><CircleAlert size={15}/>未核实事项将随单保留：{blocker}</p>}
      <AlertDialogFooter><AlertDialogCancel>返回核对</AlertDialogCancel><Button disabled={flowBusy || (!!rootRequest && !(rootRequest.status === 'failed' && workflow.screen === 'edit'))} onClick={() => beginHandoff(true)}>确认并发送</Button></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>
}
