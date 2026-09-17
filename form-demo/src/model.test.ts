import { describe, expect, it } from 'vitest'
import { createInitialModel, reducer, restoreModel, sendBlocker, FIELD_IDS, STRONG_IDS, type FieldId, type Model } from './model'
import { matchAddresses } from './address'
const get = (state: Model, id: FieldId = 'people') => state.fields.find(f => f.id === id)!
const incoming = { type: 'incoming' as const, id: 'people' as const, proposal: { value: '4人', evidence: { speaker: '报警人', time: '01:18', quote: '现在一共四个人。' } }, time: '14:34:10' }
const ready = () => STRONG_IDS.reduce((s, id) => reducer(s, { type: 'confirm', id }), createInitialModel())
const edit = (s: Model, id: FieldId, value: string) => reducer(reducer(s, { type: 'edit', id, value }), { type: 'confirm', id })

describe('地点和号码强确认，其余随发送确认', () => {
  it('九字段按固定顺序，初始都待确认', () => { const s = createInitialModel(); expect(s.fields.map(f => f.id)).toEqual(FIELD_IDS); expect(s.fields.every(f => f.review === 'pending')).toBe(true) })
  it('只确认地点不确认其余字段，也不补全未知道路', () => { const s = reducer(createInitialModel(), { type: 'confirm', id: 'location' }); expect(get(s, 'location')).toMatchObject({ review: 'confirmed', origin: 'ai' }); expect(get(s, 'location').value).toBe('合肥安和广场东门'); expect(get(s).review).toBe('pending'); expect(sendBlocker(s)).toContain('回拨号码') })
  it('未完成强确认不能发送', () => { const s = reducer(createInitialModel(), { type: 'send' }); expect(s.sent).toBeNull(); expect(s.fields.every(f => f.review === 'pending')).toBe(true) })
  it('普通字段应用修改只记录人工修改，发送才确认', () => { let s = edit(ready(), 'people', '3人'); expect(get(s)).toMatchObject({ value: '3人', review: 'pending', origin: 'manual', owned: true }); s = reducer(s, { type: 'send' }); expect(get(s).review).toBe('modified'); expect(s.fields.every(f => f.review !== 'pending')).toBe(true); expect(s.sent?.values.people).toBe('3人') })
  it('普通字段原值应用不产生假确认', () => { const s = edit(createInitialModel(), 'people', ' 2人 '); expect(get(s)).toMatchObject({ value: '2人', review: 'pending', origin: 'ai' }) })
  it('强确认字段编辑中阻止发送，取消恢复原确认', () => { let s = reducer(ready(), { type: 'edit', id: 'location', value: '合肥安和广场西门' }); expect(sendBlocker(s)).toContain('事发地点'); s = reducer(s, { type: 'cancel', id: 'location' }); expect(get(s, 'location')).toMatchObject({ review: 'confirmed', draft: null }); expect(sendBlocker(s)).toBeNull() })
  it('空修改不能应用或发送，可取消恢复', () => { let s = edit(ready(), 'people', ''); expect(get(s).error).toBeTruthy(); expect(reducer(s, { type: 'send' }).sent).toBeNull(); s = reducer(s, { type: 'cancel', id: 'people' }); expect(get(s).value).toBe('2人'); expect(sendBlocker(s)).toBeNull() })
  it('不详及待核实随单保留，快照不会被后续修改覆盖', () => { let s = reducer(ready(), { type: 'send', time: '14:35:00' }); const snapshot = structuredClone(s.sent); expect(s.sent?.values.equipment).toBe('不详，报警人看不清'); s = edit(s, 'people', '5人'); expect(s.sent).toEqual(snapshot); expect(get(s).review).toBe('pending') })
  it('未处理AI字段可以更新，聚焦时只给建议', () => { expect(get(reducer(createInitialModel(), incoming)).value).toBe('4人'); expect(get(reducer(createInitialModel(), { ...incoming, focused: 'people' }))).toMatchObject({ value: '2人', proposal: { value: '4人' } }) })
  it('人工修改后即使未发送也不被AI覆盖', () => { const s = reducer(edit(createInitialModel(), 'people', '3人'), incoming); expect(get(s)).toMatchObject({ value: '3人', review: 'pending', proposal: { value: '4人' } }) })
  it('取消编辑不会丢掉期间到达的建议', () => { let s = reducer(reducer(ready(), { type: 'edit', id: 'people', value: '3人' }), incoming); s = reducer(s, { type: 'cancel', id: 'people' }); expect(get(s)).toMatchObject({ value: '2人', draft: null, proposal: { value: '4人' } }) })
  it('未应用草稿不能被采纳覆盖', () => { const s = reducer(reducer(reducer(ready(), { type: 'edit', id: 'people', value: '3人' }), incoming), { type: 'adopt', id: 'people' }); expect(get(s)).toMatchObject({ draft: '3人', value: '2人', proposal: { value: '4人' } }) })
  it('稍后处理不会消除发送阻断，保留当前值解除阻断', () => { let s = reducer(ready(), { ...incoming, focused: 'people' }); s = reducer(s, { type: 'defer', id: 'people' }); expect(sendBlocker(s)).toContain('新信息'); s = reducer(s, { type: 'keep', id: 'people' }); expect(sendBlocker(s)).toBeNull(); expect(get(s).review).toBe('pending'); expect(s.lastIncoming?.quote).toBe('现在一共四个人。') })
  it('采纳新地点直接完成人工核对', () => { let s = reducer(ready(), { ...incoming, id: 'location', proposal: { ...incoming.proposal, value: '合肥安和广场西门，具体道路待核实' } }); s = reducer(s, { type: 'adopt', id: 'location' }); expect(get(s, 'location')).toMatchObject({ origin: 'ai', review: 'confirmed', owned: true, proposal: null }); expect(sendBlocker(s)).toBeNull() })
  it('已确认描述受保护，不会静默覆盖', () => { let s = reducer(ready(), { type: 'send' }); const old = get(s, 'description').value; s = edit(s, 'people', '4人'); expect(get(s, 'description').value).toBe(old); expect(get(s, 'description').proposal?.value).toContain('4人') })
  it('地点修改带入描述且不编造具体道路', () => { const s = edit(createInitialModel(), 'location', '合肥安和广场西门，具体道路待核实'); expect(get(s, 'description').value).toContain('合肥安和广场西门，具体道路待核实') })
  it('刷新保持草稿及建议，损坏数据安全回退', () => { const s = reducer(reducer(ready(), { type: 'edit', id: 'people', value: '3人' }), incoming); expect(restoreModel(JSON.stringify({ version: 2, state: s })).fields).toEqual(s.fields); expect(restoreModel('broken').fields).toHaveLength(9) })
  it('旧六字段草稿迁移保留人工内容并改用整体确认规则', () => { const s = edit(createInitialModel(), 'people', '7人'); get(s).review = 'modified'; const old = { ...s, fields: s.fields.slice(3) }; const migrated = restoreModel(JSON.stringify({ version: 1, state: old })); expect(migrated.fields).toHaveLength(9); expect(get(migrated)).toMatchObject({ value: '7人', review: 'pending', owned: true }); expect(get(migrated, 'location').review).toBe('pending') })
  it('紧急入口仍遵循本轮地点与号码强确认规则', () => { expect(reducer(createInitialModel(), { type: 'send', urgent: true }).sent).toBeNull(); expect(reducer(ready(), { type: 'send', urgent: true }).sent?.urgent).toBe(true) })
})
describe('地点匹配演示', () => {
  it('关键词匹配候选，门位精确匹配优先、保留关联入口，不伪造未找到的地点', () => { expect(matchAddresses('安和')).toHaveLength(12); expect(matchAddresses('合肥安和广场西门，具体道路待核实')[0].name).toBe('安和广场西门'); expect(matchAddresses('安和广场北门')[0].name).toBe('安和广场北门'); expect(matchAddresses('未知商场')).toEqual([]); expect(matchAddresses('')).toEqual([]) })
})

describe('失焦自动保存', () => {
  const blur = (s: Model, id: FieldId, value: string) => reducer(reducer(s, { type: 'edit', id, value }), { type: 'save', id })
  it('未更改或改回原值保持AI，不产生人工操作记录', () => { const s = blur(createInitialModel(), 'caller', ' 陈（自述姓氏） '); expect(get(s, 'caller')).toMatchObject({ origin: 'ai', review: 'pending', draft: null, owned: false, history: [] }) })
  it('真正更改失焦保存为人工修改，但不替代强确认', () => { const s = blur(ready(), 'location', '合肥安和广场西门'); expect(get(s, 'location')).toMatchObject({ origin: 'manual', review: 'pending', draft: null, owned: true }); expect(sendBlocker(s)).toContain('事发地点') })
  it('已确认字段无改动失焦保留原确认', () => { const s = ready(); const after = blur(s, 'callback', get(s, 'callback').value); expect(get(after, 'callback')).toEqual(get(s, 'callback')) })
  it('普通字段失焦保护人工内容并记录一次变化', () => { let s = blur(createInitialModel(), 'caller', '李（自述姓氏）'); s = reducer(s, { type: 'save', id: 'caller' }); expect(get(s, 'caller')).toMatchObject({ origin: 'manual', value: '李（自述姓氏）', draft: null, review: 'pending' }); expect(get(s, 'caller').history).toHaveLength(1) })
  it('空值失焦保留可恢复的编辑，不静默覆盖已保存内容', () => { const s = blur(ready(), 'callback', ''); expect(get(s, 'callback')).toMatchObject({ value: '138****6721', draft: '' }); expect(get(s, 'callback').error).toBeTruthy(); expect(reducer(s, { type: 'send' }).sent).toBeNull() })
})

describe('选择地址直接确认', () => {
  it('选择候选一次完成回填、保存、确认与描述更新，失焦不撤销确认', () => {
    let s = reducer(createInitialModel(), { type: 'edit', id: 'location', value: '安和' })
    s = reducer(s, { type: 'select-location', id: 'location', value: '合肥安和广场地下停车场入口' })
    s = reducer(s, { type: 'save', id: 'location' })
    expect(get(s, 'location')).toMatchObject({ value: '合肥安和广场地下停车场入口', origin: 'manual', review: 'modified', draft: null, owned: true })
    expect(get(s, 'description').value).toContain('合肥安和广场地下停车场入口')
    expect(get(s, 'location').history.at(-1)?.action).toBe('选择地点并确认')
    expect(sendBlocker(s)).toContain('回拨号码')
  })
  it('选中与AI相同的地址也完成确认，后续手输修改仍需确认', () => {
    let s = reducer(createInitialModel(), { type: 'select-location', id: 'location', value: '合肥安和广场东门' })
    expect(get(s, 'location')).toMatchObject({ review: 'confirmed', origin: 'ai' })
    s = reducer(reducer(s, { type: 'edit', id: 'location', value: '合肥安和广场东门外' }), { type: 'save', id: 'location' })
    expect(get(s, 'location').review).toBe('pending')
  })
})


describe('采纳建议即人工核对', () => {
  it.each(['location', 'callback', 'people', 'description'] as FieldId[])('%s采纳后无需二次确认并保留后续AI保护', id => {
    let s = ready()
    s = reducer(s, { type: 'incoming', id, focused: id, proposal: { value: '已核对的新内容', evidence: incoming.proposal.evidence } })
    s = reducer(s, { type: 'adopt', id })
    expect(get(s, id)).toMatchObject({ value: '已核对的新内容', review: 'confirmed', origin: 'ai', owned: true, proposal: null, draft: null })
    expect(get(s, id).history.at(-1)?.action).toBe('采纳建议并确认')
    expect(sendBlocker(s)).toBeNull()
    s = restoreModel(JSON.stringify({ version: 3, state: s }))
    expect(get(s, id).review).toBe('confirmed')
    s = reducer(s, { type: 'incoming', id, proposal: { value: '后续另一条建议', evidence: incoming.proposal.evidence } })
    expect(get(s, id).value).toBe('已核对的新内容')
    expect(get(s, id).proposal?.value).toBe('后续另一条建议')
  })
})
