import type { Field, Model } from './model'

export type Outcome = 'received' | 'failed' | 'unknown'
export type RequestStatus = Outcome | 'sending' | 'querying' | 'superseded'
export type RequestKind = 'handoff' | 'supplement' | 'record'
export type WorkflowRequest = {
  id: string; caseId: string; parentId: string | null; kind: RequestKind; version: number;
  status: RequestStatus; attempt: number; time: string; receiptTime?: string;
  urgent: boolean; fields: Field[]; content: string; unresolved: string[];
  conversation: Model['conversation'];
}
export type Workflow = {
  requests: WorkflowRequest[]; rootId: string | null; activeId: string | null;
  draft: string; screen: 'result' | 'edit' | 'supplement'; error: string;
}
export const emptyWorkflow = (): Workflow => ({ requests: [], rootId: null, activeId: null, draft: '', screen: 'result', error: '' })
export const getRoot = (w: Workflow) => w.requests.find(r => r.id === w.rootId)
export const getActive = (w: Workflow) => w.requests.find(r => r.id === w.activeId)
export const isBusy = (r?: WorkflowRequest) => r?.status === 'sending' || r?.status === 'querying'
export function completionBlocker(w: Workflow) {
  if (getRoot(w)?.status !== 'received') return '请先确认移交接收结果。'
  if (w.draft.trim()) return '有未发送的重要补充，请先核对并发送。'
  if (w.requests.some(r => r.parentId === w.rootId && r.kind === 'supplement' && !['received', 'superseded'].includes(r.status))) return '补充尚未确认接收，请先处理发送结果。'
  return ''
}
export function makeRequest(model: Model, kind: RequestKind, version: number, parentId: string | null, content = '', urgent = false): WorkflowRequest {
  const fields = structuredClone(model.fields)
  const unresolved = fields.flatMap(f => [
    ...(!f.value.trim() ? [`${f.label}尚未获取`] : []),
    ...(['location', 'callback'].includes(f.id) && (f.review === 'pending' || f.draft !== null) ? [`${f.label}未确认`] : []),
    ...(f.proposal ? [`${f.label}有新信息待核对：${f.proposal.value}`] : []),
    ...(f.draft !== null ? [`${f.label}有未保存修改，提交沿用已保存值`] : []),
  ])
  return { id: crypto.randomUUID(), caseId: 'JQ-20260916-0028', parentId, kind, version, status: 'sending', attempt: 1, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), urgent, fields, content, unresolved, conversation: structuredClone(model.conversation) }
}
export type WorkflowAction =
  | { type: 'restore-session'; state: Workflow }
  | { type: 'start'; request: WorkflowRequest }
  | { type: 'result'; id: string; attempt: number; outcome: Outcome; time: string }
  | { type: 'retry' | 'query' | 'revise'; id: string }
  | { type: 'draft'; value: string }
  | { type: 'screen'; screen: Workflow['screen'] }
  | { type: 'reset' }
export function workflowReducer(w: Workflow, a: WorkflowAction): Workflow {
  if (a.type === 'restore-session') return a.state
  if (a.type === 'reset') return emptyWorkflow()
  if (a.type === 'screen') return isBusy(getActive(w)) ? w : { ...w, screen: a.screen }
  if (a.type === 'draft') return { ...w, draft: a.value, error: '' }
  if (a.type === 'start') {
    const r = a.request, root = getRoot(w), active = getActive(w)
    if (isBusy(active) || active?.status === 'unknown' || (active?.kind === 'record' && active.status === 'received')) return w
    if (r.kind === 'handoff' && root && !(root.status === 'failed' && w.screen === 'edit')) return w
    if (r.kind !== 'handoff' && (root?.status !== 'received' || r.parentId !== root.id)) return w
    if (r.kind === 'supplement' && (!r.content.trim() || w.requests.some(x => x.kind === 'supplement' && x.parentId === root?.id && !['received', 'superseded'].includes(x.status)))) return w
    if (r.kind === 'record' && completionBlocker(w)) return { ...w, error: completionBlocker(w) }
    return { ...w, requests: [...w.requests, structuredClone(r)], rootId: r.kind === 'handoff' ? r.id : w.rootId, activeId: r.id, screen: 'result', draft: r.kind === 'supplement' ? '' : w.draft, error: '' }
  }
  const r = w.requests.find(r => r.id === a.id)
  if (!r) return w
  if (a.type === 'revise') {
    if (r.status !== 'failed') return w
    if (r.kind === 'handoff') return { ...w, screen: 'edit' }
    if (r.kind === 'supplement') return { ...w, screen: 'edit', draft: r.content, activeId: w.rootId, requests: w.requests.map(x => x.id === r.id ? { ...x, status: 'superseded' } : x) }
    return { ...w, screen: 'edit', activeId: w.rootId, requests: w.requests.map(x => x.id === r.id ? { ...x, status: 'superseded' } : x) }
  }
  if (a.type === 'result') {
    if (!isBusy(r) || a.attempt !== r.attempt) return w
    return { ...w, requests: w.requests.map(x => x.id === r.id ? { ...x, status: a.outcome, receiptTime: a.time } : x) }
  }
  if ((a.type === 'retry' && r.status !== 'failed') || (a.type === 'query' && r.status !== 'unknown')) return w
  return { ...w, activeId: r.id, screen: 'result', requests: w.requests.map(x => x.id === r.id ? { ...x, status: a.type === 'query' ? 'querying' : 'sending', attempt: x.attempt + 1 } : x) }
}
export function restoreWorkflow(raw: string | null): Workflow {
  if (!raw) return emptyWorkflow()
  try {
    const w = JSON.parse(raw) as Workflow
    if (!Array.isArray(w.requests) || typeof w.draft !== 'string' || !['result', 'edit', 'supplement'].includes(w.screen)) return emptyWorkflow()
    if (!w.requests.every(r => typeof r.id === 'string' && ['handoff', 'supplement', 'record'].includes(r.kind) && ['sending', 'querying', 'received', 'failed', 'unknown', 'superseded'].includes(r.status) && Array.isArray(r.fields) && r.fields.length === 9 && r.fields.every(f => typeof f.value === 'string') && Array.isArray(r.unresolved))) return emptyWorkflow()
    // Reload cannot establish a receipt: query the same request before retrying.
    return { ...w, requests: w.requests.map(r => isBusy(r) ? { ...r, status: 'unknown' } : r) }
  } catch { return emptyWorkflow() }
}
