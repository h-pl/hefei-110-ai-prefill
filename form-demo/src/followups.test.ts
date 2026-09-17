import { describe, expect, it } from 'vitest'
import { initialDialogue, conversationSteps, getFollowups } from './followups'
import { createInitialModel, reducer, restoreModel } from './model'

describe('追问随对话更新', () => {
  it('新人数不影响未回答的问题，已回答伤情退出列表', () => {
    const initial = getFollowups(initialDialogue)
    expect(getFollowups([...initialDialogue, conversationSteps[0].evidence])).toEqual(initial)
    const next = getFollowups([...initialDialogue, conversationSteps[1].evidence])
    expect(next.map(q => q.id)).toEqual(['arrival', 'aid'])
  })
  it('接警员提问不算回答，无法看清器械不重复追问', () => {
    const next = getFollowups([...initialDialogue, { ...conversationSteps[1].evidence, speaker: '接警员' }])
    expect(next.map(q => q.id)).toEqual(['injury', 'arrival'])
    expect(next.some(q => q.text.includes('器械'))).toBe(false)
  })
  it('位置得到补充后退出，停手后生成去向问题', () => {
    const next = getFollowups([...initialDialogue, ...conversationSteps.map(s => s.evidence)])
    expect(next.map(q => q.id)).toEqual(['whereabouts', 'aid'])
    expect(next).toHaveLength(2)
  })
  it('对话追加持久化，确认字段不会假装对话已回答，重置清空原话', () => {
    let state = createInitialModel()
    state = reducer(state, { type: 'confirm', id: 'location' })
    expect(getFollowups([...initialDialogue, ...state.conversation]).some(q => q.id === 'arrival')).toBe(true)
    for (const step of conversationSteps) state = reducer(state, { type: 'incoming', id: step.id, proposal: { value: step.value, evidence: step.evidence } })
    const restored = restoreModel(JSON.stringify({ version: 2, state }))
    expect(restored.conversation).toEqual(conversationSteps.map(s => s.evidence))
    expect(reducer(restored, { type: 'reset' }).conversation).toEqual([])
  })
})
