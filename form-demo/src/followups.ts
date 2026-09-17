import type { Evidence, FieldId } from './model'

// Local scenario rules for the interaction demo, not a language-model service.
export const initialDialogue: Evidence[] = [
  { speaker: '接警员', time: '00:00', quote: '您好，110，请讲。' },
  { speaker: '报警人', time: '00:06', quote: '我在商场东门，这里有两个人在打架，有一个流血了。' },
  { speaker: '接警员', time: '00:19', quote: '哪个商场？靠近哪条路？' },
  { speaker: '报警人', time: '00:27', quote: '合肥的安和广场，东门这边，他们还在打。' },
  { speaker: '接警员', time: '00:43', quote: '您现在安全吗？现场有没有人拿着刀具或其他器械？' },
  { speaker: '报警人', time: '00:57', quote: '我离得远，看不清。我姓陈，就是这个电话。' },
]
export const conversationSteps: { id: FieldId; value: string; evidence: Evidence }[] = [
  { id: 'people', value: '3人', evidence: { speaker: '报警人', time: '01:18', quote: '我再看了一下，参与打架的一共是3个人。' } },
  { id: 'injury', value: '一人手臂流血，意识清醒，能正常说话', evidence: { speaker: '报警人', time: '01:32', quote: '受伤的人是手臂流血，意识清醒，能正常说话。' } },
  { id: 'location', value: '合肥安和广场东门外的咖啡店旁', evidence: { speaker: '报警人', time: '01:46', quote: '就在安和广场东门外的咖啡店旁，从东门过来就能看到。' } },
  { id: 'ongoing', value: '否', evidence: { speaker: '报警人', time: '02:03', quote: '他们已经停手了，没有继续打。' } },
]
export function getFollowups(conversation: Evidence[]) {
  // Only caller statements answer questions; operator questions do not supply facts.
  const quotes = conversation.filter(e => e.speaker === '报警人').map(e => e.quote)
  const text = quotes.join('。')
  if (!/打架|还在打|流血/.test(text)) return []
  const injuryAnswered = /手臂流血.*意识清醒.*能正常说话/.test(text)
  const arrivalAnswered = /东门外的咖啡店旁/.test(text)
  const latestConflict = [...quotes].reverse().find(q => /停手|没有继续打|还在打|正在打/.test(q)) ?? ''
  const stopped = /停手|没有继续打/.test(latestConflict)
  const questions = [
    ...(!injuryAnswered ? [{ id: 'injury', text: '受伤的人现在是什么情况？', priority: '优先了解伤情' }] : []),
    ...(!arrivalAnswered ? [{ id: 'arrival', text: /安和广场/.test(text) ? '东门附近有什么明显标志，方便找到现场？' : '是哪个商场？具体在哪个位置？', priority: '补充到场位置' }] : []),
    ...(stopped ? [{ id: 'whereabouts', text: '停手后，参与人员还在现场吗？', priority: '了解人员去向' }] : []),
    ...(injuryAnswered ? [{ id: 'aid', text: '现场是否已经有人联系急救？', priority: '了解救助情况' }] : []),
    { id: 'safety', text: '您现在所在的位置安全吗？', priority: '了解报警人安全' },
  ]
  // Explicitly unable to see equipment: don't repeatedly ask the same question.
  return questions.slice(0, 2)
}

export const playbackSteps: { evidence: Evidence; updates: Partial<Record<FieldId, string>> }[] = [
  { evidence: initialDialogue[0], updates: {} },
  { evidence: initialDialogue[1], updates: { location: '商场东门', reason: '有人打架', people: '2人', injury: '一人流血，具体伤情待核实' } },
  { evidence: initialDialogue[2], updates: {} },
  { evidence: initialDialogue[3], updates: { location: '合肥安和广场东门', ongoing: '是' } },
  { evidence: initialDialogue[4], updates: {} },
  { evidence: initialDialogue[5], updates: { caller: '陈（自述姓氏）', equipment: '不详，报警人看不清' } },
  ...conversationSteps.map(step => ({ evidence: step.evidence, updates: { [step.id]: step.value } })),
]
