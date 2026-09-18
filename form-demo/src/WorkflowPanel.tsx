import { type Dispatch, type ReactNode } from 'react'
import { UserRoundCheck } from 'lucide-react'
import { Button } from './components/ui/button'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './components/ui/alert-dialog'
import { completionBlocker, getActive, getRoot, isBusy, type Workflow, type WorkflowAction, type WorkflowRequest } from './workflow'
import type { Field } from './model'

export function SnapshotFields({ request, renderEvidence }: { request: WorkflowRequest; renderEvidence: (field: Field) => ReactNode }) {
  return <div className="prefill-form snapshot-form" aria-label="已发送内容快照" data-motion-static>{request.fields.map(f => {
    const confirmed = !request.urgent || f.review !== 'pending'
    return <section key={f.id} className={`form-field ${['location', 'equipment', 'description'].includes(f.id) ? 'snapshot-wide' : ''}`}>
      <div className="field-heading"><div className="label-group"><span>{f.label}</span>{renderEvidence(f)}</div></div>
      <div className={`snapshot-value ${confirmed ? 'snapshot-confirmed' : ''}`}>{confirmed ? <UserRoundCheck size={17} aria-label="人工已确认"/> : <span className="snapshot-ai">AI</span>}<p>{f.value || '尚未获取'}</p></div>
    </section>
  })}</div>
}

export function WorkflowPanel({ workflow: w, dispatch, fields, pending, storageError, startSupplement, startRecord, dialog, setDialog }: {
  workflow: Workflow; dispatch: Dispatch<WorkflowAction>; fields: Field[]; pending: number; storageError: boolean;
  startSupplement: () => void; startRecord: () => void;
  dialog: 'supplement' | 'record' | null; setDialog: (value: 'supplement' | 'record' | null) => void;
}) {
  const root = getRoot(w)!, active = getActive(w) ?? root
  const noun = active.kind === 'record' ? '记录保存' : active.kind === 'supplement' ? '补充发送' : '移交'
  const completed = active.kind === 'record' && active.status === 'received'
  const previousSupplements = w.requests.filter(r => r.kind === 'supplement' && r.parentId === root.id && r.status === 'received')
  const baseline = previousSupplements.at(-1)?.fields ?? root.fields
  const newDifferences = fields.filter(f => (f.proposal?.value ?? f.value) !== baseline.find(old => old.id === f.id)?.value)
  const completionError = completionBlocker(w) || (pending || fields.some(f => f.draft !== null) ? '有新信息或编辑内容尚未处理，请返回警单核对。' : '') || (newDifferences.length ? '当前警单有未发送的变更，请加入补充并发送。' : '') || (storageError ? '浏览器暂存失败，请恢复保存后再完成整理。' : '')
  const title = completed ? '本轮整理已完成' : active.status === 'received' ? active.kind === 'supplement' ? '补充已接收' : '已移交调度' : active.status === 'failed' ? `${noun}失败` : active.status === 'unknown' ? `${noun}结果未知` : active.status === 'querying' ? '正在查询原请求' : `${noun}中`
  return <aside className="workflow-column" aria-label="移交与整理" data-motion-static>
    <section className="workflow-panel">
      <h2 className={active.status === 'received' ? 'workflow-success' : active.status === 'failed' ? 'workflow-danger' : ''} tabIndex={-1}>{title}</h2>
      <p>110 指挥调度岗<br/><span className="muted">{root.urgent ? '紧急先行移交' : '常规移交'}</span></p>
      {root.status === 'received' && <p className="workflow-receipt">接收系统已收到 · 待调度签收<br/><span className="muted">接收时间 {root.receiptTime}</span></p>}
      {isBusy(active) && <p role="status">{active.status === 'querying' ? '正在查询同一请求的结果。' : '正在等待回执，请勿重复提交。'}</p>}
      {active.status === 'failed' && <p role="alert">{active.kind === 'record' ? '记录尚未保存，本轮整理未完成。' : '接收目标暂不可用，当前内容已保留。'}</p>}
      {active.status === 'unknown' && <p role="alert">尚未取得确定回执。先查询原请求，不重复创建{active.kind === 'record' ? '记录' : '警单或补充'}。仍无结果时请联系调度岗核实。</p>}
      {root.unresolved.length > 0 && <div className="workflow-unresolved"><strong>未核实事项随单保留</strong><ul>{root.unresolved.map(t => <li key={t}>{t}</li>)}</ul></div>}
      {active.kind === 'supplement' && <div className="workflow-difference"><strong>本次补充</strong><p>{active.content}</p></div>}
      {completed && <p>本轮记录已保存 · {active.receiptTime}<br/>签收、派警及处置状态仍以实际回执为准。</p>}
      {active.status === 'unknown' && <Button onClick={() => dispatch({ type: 'query', id: active.id })}>查询{active.kind === 'record' ? '保存' : '接收'}结果</Button>}
      {active.status === 'failed' && <div className="workflow-actions"><Button variant="outline" onClick={() => dispatch({ type: 'revise', id: active.id })}>返回{active.kind === 'record' ? '整理' : '修改'}</Button><Button onClick={() => dispatch({ type: 'retry', id: active.id })}>{active.kind === 'record' ? '重试保存' : '重试原请求'}</Button></div>}
      {root.status === 'received' && active.status === 'received' && !completed && <>
        <Button variant={completionError && w.screen !== 'edit' ? 'default' : 'outline'} onClick={() => dispatch({ type: 'screen', screen: w.screen === 'edit' ? 'result' : 'edit' })}>{w.screen === 'edit' ? '返回已发快照' : '返回警单继续补充'}</Button>
        {pending > 0 && <p className="workflow-unresolved">{pending} 项新信息待核对；已发快照保持不变。</p>}
        {w.screen === 'edit' && <div className="workflow-difference"><strong>本次变更（{newDifferences.length}项）</strong>{newDifferences.length ? <><p>{newDifferences.map(f => `${f.label}：${baseline.find(old => old.id === f.id)?.value || '尚未获取'} → ${f.proposal?.value ?? f.value}`).join('\n')}</p><p className="muted">核对表单中的新建议后，从右上角发送补充。</p></> : <p className="muted">继续对话或修改表单后，这里会显示本次变化，右上角出现发送补充入口。</p>}</div>}
        <Button variant={completionError ? 'outline' : 'default'} disabled={!!completionError} aria-describedby={completionError ? 'completion-blocker' : undefined} onClick={() => setDialog('record')}>保存记录并完成本轮整理</Button>
        {completionError && <p id="completion-blocker" className="workflow-hint">{completionError}</p>}
      </>}
    </section>
    <AlertDialog open={dialog !== null} onOpenChange={open => !open && setDialog(null)}><AlertDialogContent className="workflow-dialog" data-motion-static><AlertDialogHeader><AlertDialogTitle>{dialog === 'record' ? '保存记录，完成本轮整理' : '核对重要补充'}</AlertDialogTitle><AlertDialogDescription>{dialog === 'record' ? '保存本轮警情、来源、人工确认和操作记录。完成整理不代表调度已签收、派警或处置完成。' : '补充关联当前警情，保留原移交快照。取消后仍保留本次草稿。'}</AlertDialogDescription></AlertDialogHeader>
      {dialog === 'supplement' ? <div className="workflow-difference"><strong>新增信息</strong><p>{w.draft}</p></div> : completionError && <p className="handoff-blocker" role="alert">{completionError}</p>}
      <AlertDialogFooter><AlertDialogCancel>{dialog === 'record' ? '继续整理' : '返回修改'}</AlertDialogCancel><Button disabled={dialog === 'record' ? !!completionError : !w.draft.trim() || pending > 0} onClick={() => { dialog === 'record' ? startRecord() : startSupplement(); setDialog(null) }}>{dialog === 'record' ? '确认保存并完成' : '确认发送补充'}</Button></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </aside>
}
