import { describe, expect, it } from 'vitest'
import { createIdleModel, isPlaybackComplete, reducer, restoreModel } from './model'
import { playbackSteps } from './followups'
const field = (s: ReturnType<typeof createIdleModel>, id: string) => s.fields.find(f => f.id === id)!
describe('提取结束状态', () => {
  it('原话和提取队列全部完成后才结束，未提到的字段保留空值供人工填写', () => {
    let s = reducer(createIdleModel(), { type: 'playback-start' })
    expect(isPlaybackComplete(s, 1)).toBe(false)
    s = reducer(s, { type: 'stream-start', evidence: { speaker: '报警人', time: '00:01', quote: '有人打架。' }, updates: { reason: '有人打架' } })
    expect(isPlaybackComplete(s, 1)).toBe(false)
    while (s.streams.length) s = reducer(s, { type: 'stream-tick' })
    expect(isPlaybackComplete(s, 1)).toBe(false)
    while (s.pendingFills.length) s = reducer(s, { type: 'fill-tick' })
    expect(isPlaybackComplete(s, 1)).toBe(true)
    expect(field(s, 'injury').value).toBe('')
    expect(field(s, 'injury').review).toBe('pending')
    expect(field(s, 'reason').value).toBe('有人打架')
    expect(isPlaybackComplete(restoreModel(JSON.stringify({ version: 3, state: s })), 1)).toBe(true)
    s = reducer(s, { type: 'edit', id: 'injury', value: '手臂擦伤' })
    s = reducer(s, { type: 'save', id: 'injury' })
    expect(field(s, 'injury').value).toBe('手臂擦伤')
    expect(isPlaybackComplete(reducer(s, { type: 'playback-start' }), 1)).toBe(false)
    expect(isPlaybackComplete(reducer(s, { type: 'playback-idle' }), 1)).toBe(false)
  })
})
describe('逐句对话和逐字段预填', () => {
  it('初始空白，先收到原话，再逐项填入，不提前写入后续信息', () => {
    let s = createIdleModel()
    expect(s.fields.every(f => f.value === '')).toBe(true)
    s = reducer(s, { type: 'playback-start' })
    s = reducer(s, { type: 'playback-step', ...playbackSteps[0] })
    s = reducer(s, { type: 'playback-step', ...playbackSteps[1] })
    expect(field(s, 'location').value).toBe('')
    expect(s.pendingFills).toHaveLength(4)
    s = reducer(s, { type: 'playback-fill' })
    expect(field(s, 'location').value).toBe('商场东门')
    expect(field(s, 'reason').value).toBe('')
    expect(field(s, 'caller').value).toBe('')
    expect(s.conversation).toHaveLength(2)
  })
  it('完整播放顺序正确，人工值受保护，刷新保留待填队列', () => {
    let s = reducer(createIdleModel(), { type: 'playback-start' })
    s = reducer(reducer(s, { type: 'edit', id: 'people', value: '5人' }), { type: 'save', id: 'people' })
    for (const step of playbackSteps) {
      s = reducer(s, { type: 'playback-step', ...step })
      s = restoreModel(JSON.stringify({ version: 3, state: s }))
      while (s.pendingFills.length) s = reducer(s, { type: 'playback-fill' })
    }
    expect(s.conversation).toHaveLength(10)
    expect(s.playbackCursor).toBe(10)
    expect(field(s, 'people').value).toBe('5人')
    expect(field(s, 'people').proposal?.value).toBe('3人')
    expect(field(s, 'ongoing').value).toBe('否')
    expect(field(s, 'location').value).toBe('合肥安和广场东门外的咖啡店旁')
    const reset = reducer(s, { type: 'playback-idle' })
    expect(reset).toEqual(createIdleModel())
  })
})


describe('流式分角色转写与字段生成', () => {
  it('文字片段不提前提交，角色保留，字段逐字完成后才写入', () => {
    let s = reducer(createIdleModel(), { type: 'playback-start' })
    s = reducer(s, { type: 'stream-start', ...playbackSteps[1] })
    s = reducer(s, { type: 'stream-tick' })
    expect(s.streams[0]?.evidence.speaker).toBe('报警人')
    expect(s.streams[0]?.offset).toBe(2)
    expect(s.conversation).toHaveLength(0)
    expect(s.pendingFills).toHaveLength(0)
    while (s.streams.length) s = reducer(s, { type: 'stream-tick' })
    expect(s.conversation).toHaveLength(1)
    s = reducer(s, { type: 'fill-tick' })
    expect(s.fillOffset).toBe(1)
    expect(field(s, 'location').value).toBe('')
    s = restoreModel(JSON.stringify({ version: 3, state: s }))
    expect(s.fillOffset).toBe(1)
    while (s.pendingFills[0]?.id === 'location') s = reducer(s, { type: 'fill-tick' })
    expect(field(s, 'location').value).toBe('商场东门')
    expect(field(s, 'description').value).toBe('')
    while (s.pendingFills[0]?.id !== 'description') s = reducer(s, { type: 'fill-tick' })
    expect(field(s, 'description').value).toBe('')
    s = reducer(s, { type: 'fill-tick' })
    expect(s.fillOffset).toBe(4)
    while (s.pendingFills.length) s = reducer(s, { type: 'fill-tick' })
    expect(field(s, 'description').value).toContain('有人打架')
  })
})

describe('双角色并行转写', () => {
  it('两路独立推进、乱序完成仍按时间排列，提取不等待另一路结束', () => {
    let s = reducer(createIdleModel(), { type: 'playback-start' })
    s = reducer(s, { type: 'stream-start', ...playbackSteps[4], parallel: { evidence: { speaker: '报警人', time: '00:57', quote: '姓陈' }, updates: { caller: '陈' } } })
    expect(s.streams).toHaveLength(2)
    s = reducer(s, { type: 'stream-tick', speaker: '接警员' })
    expect(s.streams.map(t => t.offset)).toEqual([2, 0])
    s = reducer(s, { type: 'stream-tick', speaker: '报警人' })
    expect(s.streams).toHaveLength(1)
    expect(s.conversation[0].speaker).toBe('报警人')
    expect(s.pendingFills[0].id).toBe('caller')
    s = reducer(s, { type: 'fill-tick' })
    expect(field(s, 'caller').value).toBe('陈')
    expect(s.streams[0].offset).toBe(2)
    s = restoreModel(JSON.stringify({ version: 3, state: s }))
    while (s.streams.length) s = reducer(s, { type: 'stream-tick', speaker: '接警员' })
    expect(s.conversation.map(e => e.speaker)).toEqual(['接警员', '报警人'])
    expect(s.playbackCursor).toBe(2)
  })
  it('同一角色不能启动两条并行流，重复启动不覆盖当前片段', () => {
    let s = reducer(createIdleModel(), { type: 'playback-start' })
    s = reducer(s, { type: 'stream-start', ...playbackSteps[1], parallel: playbackSteps[3] })
    expect(s.streams).toHaveLength(1)
    expect(reducer(s, { type: 'stream-start', ...playbackSteps[1] })).toBe(s)
    expect(reducer(s, { type: 'stream-start', ...playbackSteps[0] }).streams).toHaveLength(2)
  })
})

describe('警情描述局部更新', () => {
  it('跳过未变化前文，保留后文，片段完成前不覆盖已保存描述', () => {
    const before = '两人打架，一人流血。器械不详。'
    const after = '两人打架，一人手臂流血，意识清醒。器械不详。'
    let s = createIdleModel()
    s.fields = s.fields.map(f => f.id === 'description' ? { ...f, value: before } : f)
    s.pendingFills = [{ id: 'description', value: after, evidence: { speaker: '报警人', time: '01:00', quote: after } }]
    s = reducer(s, { type: 'fill-tick' })
    expect(s.fillOffset).toBe(11)
    expect(field(s, 'description').value).toBe(before)
    while (s.pendingFills.length) s = reducer(s, { type: 'fill-tick' })
    expect(field(s, 'description').value).toBe(after)
  })
})

describe('连续通话与并行提取', () => {
  it('有待填字段和另一角色在说话时，空闲角色仍可开始下一句', () => {
    let s = reducer(createIdleModel(), { type: 'playback-start' })
    s = reducer(s, { type: 'stream-start', ...playbackSteps[1] })
    while (s.streams.length) s = reducer(s, { type: 'stream-tick', speaker: '报警人' })
    s = reducer(s, { type: 'fill-tick' })
    const queue = s.pendingFills
    const offset = s.fillOffset
    s = reducer(s, { type: 'stream-start', ...playbackSteps[2] })
    s = reducer(s, { type: 'stream-start', ...playbackSteps[3] })
    expect(s.streams).toHaveLength(2)
    expect(s.pendingFills).toBe(queue)
    expect(s.fillOffset).toBe(offset)
    s = reducer(s, { type: 'stream-tick', speaker: '接警员' })
    s = reducer(s, { type: 'fill-tick' })
    expect(s.streams[0].offset).toBe(2)
    expect(s.fillOffset).toBeGreaterThan(offset)
  })
  it('计时独立推进，恢复后保留时长，重置清零', () => {
    const idle = createIdleModel()
    expect(reducer(idle, { type: 'clock-tick', milliseconds: 1000 })).toBe(idle)
    let s = reducer(idle, { type: 'playback-start' })
    s = reducer(s, { type: 'clock-tick', milliseconds: 1250 })
    const rows = s.conversation
    s = reducer(s, { type: 'clock-tick', milliseconds: 875 })
    expect(s.elapsedMs).toBe(2125)
    expect(s.conversation).toBe(rows)
    expect(restoreModel(JSON.stringify({ version: 3, state: s })).elapsedMs).toBe(2125)
    expect(reducer(s, { type: 'playback-idle' }).elapsedMs).toBe(0)
    expect(reducer(s, { type: 'playback-start' }).elapsedMs).toBe(0)
  })
  it('连续收到新原话后仍按批次更新描述，不重复插入原话', () => {
    let s = reducer(createIdleModel(), { type: 'playback-start' })
    for (const step of playbackSteps) {
      s = reducer(s, { type: 'stream-start', ...step })
      while (s.streams.length) s = reducer(s, { type: 'stream-tick' })
    }
    expect(s.conversation).toHaveLength(10)
    expect(s.pendingFills.length).toBeGreaterThan(9)
    while (s.pendingFills.length) s = reducer(s, { type: 'playback-fill' })
    expect(s.conversation).toHaveLength(10)
    expect(field(s, 'description').value).toContain('事件已停止')
    expect(field(s, 'description').value).toContain('3人')
    expect(field(s, 'description').value).toContain('咖啡店旁')
  })
})
