import { describe, expect, it } from 'vitest'
import { createInitialModel } from './model'
import { completionBlocker, emptyWorkflow, getActive, getRoot, makeRequest, restoreWorkflow, workflowReducer as reduce, type Outcome, type Workflow } from './workflow'
const start = () => reduce(emptyWorkflow(), { type: 'start', request: makeRequest(createInitialModel(), 'handoff', 1, null) })
const resolve = (w: Workflow, outcome: Outcome) => reduce(w, { type: 'result', id: w.activeId!, attempt: getActive(w)!.attempt, outcome, time: '14:33:52' })
describe('移交、补充和完成整理', () => {
  it('快照复制数据，原表单后续更改不污染移交内容', () => {
    const model = createInitialModel(), request = makeRequest(model, 'handoff', 1, null), w = reduce(emptyWorkflow(), { type: 'start', request })
    model.fields[0].value = '另一个地点'; request.fields[1].value = '另一姓名'
    expect(getRoot(w)!.fields[0].value).toBe('合肥安和广场东门'); expect(getRoot(w)!.fields[1].value).toBe('陈（自述姓氏）')
  })
  it('提交中防重复，完成接收后也不能创建重复移交', () => {
    for (const w of [start(), resolve(start(), 'received')]) expect(reduce(w, { type: 'start', request: makeRequest(createInitialModel(), 'handoff', 2, null) })).toBe(w)
  })
  it('明确失败重试沿用请求ID和内容，改变版本需返回修改', () => {
    const failed = resolve(start(), 'failed'), retry = reduce(failed, { type: 'retry', id: failed.rootId! })
    expect(getActive(retry)!.id).toBe(failed.rootId); expect(getActive(retry)!.fields).toEqual(getRoot(failed)!.fields); expect(getActive(retry)!.attempt).toBe(2)
    const edited = reduce(failed, { type: 'revise', id: failed.rootId! }), next = reduce(edited, { type: 'start', request: makeRequest(createInitialModel(), 'handoff', 2, null) })
    expect(next.requests).toHaveLength(2); expect(next.rootId).not.toBe(failed.rootId)
  })
  it('未知只允许查询，仍未知不开放重试，明确未接收后才能重试', () => {
    const unknown = resolve(start(), 'unknown'); expect(reduce(unknown, { type: 'retry', id: unknown.rootId! })).toBe(unknown)
    const still = resolve(reduce(unknown, { type: 'query', id: unknown.rootId! }), 'unknown'); expect(getActive(still)!.status).toBe('unknown')
    const failed = resolve(reduce(still, { type: 'query', id: still.rootId! }), 'failed'); expect(getActive(reduce(failed, { type: 'retry', id: failed.rootId! }))!.status).toBe('sending')
  })
  it('过期回执不会覆盖新的请求尝试', () => {
    let w = resolve(start(), 'failed'); w = reduce(w, { type: 'retry', id: w.rootId! })
    expect(reduce(w, { type: 'result', id: w.rootId!, attempt: 1, outcome: 'received', time: '旧回执' })).toBe(w)
  })
  it('刷新发送中变成未知，保留原请求供查询', () => {
    const w = start(), restored = restoreWorkflow(JSON.stringify(w))
    expect(restored.rootId).toBe(w.rootId); expect(getActive(restored)!.status).toBe('unknown')
  })
  it('紧急请求记录未确认和待核对信息，不伪造确认', () => {
    const m = createInitialModel(); m.fields[0].proposal = { value: '西门', evidence: m.fields[0].evidence }
    const r = makeRequest(m, 'handoff', 1, null, '', true)
    expect(r.unresolved).toContain('事发地点未确认'); expect(r.unresolved.join()).toContain('西门'); expect(r.fields[0].review).toBe('pending')
  })
  it('补充必须关联已接收移交，取消或刷新保留草稿', () => {
    const sending = start(), request = makeRequest(createInitialModel(), 'supplement', 1, sending.rootId, '新增伤者')
    expect(reduce(sending, { type: 'start', request })).toBe(sending)
    let w = resolve(sending, 'received'); w = reduce(w, { type: 'draft', value: '新增伤者' }); w = reduce(w, { type: 'screen', screen: 'edit' })
    expect(restoreWorkflow(JSON.stringify(w)).draft).toBe('新增伤者')
    const supplement = reduce(w, { type: 'start', request }); expect(getActive(supplement)!.parentId).toBe(w.rootId); expect(getRoot(supplement)!.fields).toEqual(getRoot(w)!.fields)
  })
  it('失败补充可修改新版本，旧请求保留且不阻断新版本发送', () => {
    let w = resolve(start(), 'received'); w = reduce(w, { type: 'start', request: makeRequest(createInitialModel(), 'supplement', 1, w.rootId, '新增伤者') }); w = resolve(w, 'failed')
    const id = w.activeId!; w = reduce(w, { type: 'revise', id }); expect(w.screen).toBe('edit'); expect(w.draft).toBe('新增伤者'); expect(w.requests.find(r => r.id === id)!.status).toBe('superseded')
    w = reduce(w, { type: 'start', request: makeRequest(createInitialModel(), 'supplement', 2, w.rootId, '伤者已补充说明') }); expect(getActive(w)!.version).toBe(2)
  })
  it('有待发或未知补充不可完成，成功保存后不能新增记录', () => {
    let w = resolve(start(), 'received'); w = reduce(w, { type: 'draft', value: '新情况' }); expect(completionBlocker(w)).toContain('未发送')
    w = reduce(w, { type: 'start', request: makeRequest(createInitialModel(), 'supplement', 1, w.rootId, w.draft) }); w = resolve(w, 'unknown'); expect(completionBlocker(w)).toContain('尚未确认接收')
    w = resolve(reduce(w, { type: 'query', id: w.activeId! }), 'received'); expect(completionBlocker(w)).toBe('')
    w = reduce(w, { type: 'start', request: makeRequest(createInitialModel(), 'record', 1, w.rootId) }); w = resolve(w, 'received')
    expect(reduce(w, { type: 'start', request: makeRequest(createInitialModel(), 'record', 2, w.rootId) })).toBe(w)
  })
})
