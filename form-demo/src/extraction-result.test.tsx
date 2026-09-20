import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'
import { createIdleModel, type Model } from './model'
import { playbackSteps } from './followups'

afterEach(() => vi.unstubAllGlobals())

function renderState(state: Model) {
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'moss-prefill-form:v3' ? JSON.stringify({ version: 3, state }) : null })
  return renderToStaticMarkup(<App/>)
}

it('结束后单行、多行和下拉均呈现缺失结果，保留真实空值', () => {
  const state = { ...createIdleModel(), playbackCursor: playbackSteps.length }
  const html = renderState(state)
  expect(html.match(/placeholder="未获取到"/g)).toHaveLength(8)
  expect(html).toContain('>未获取到</span>')
  expect(html).not.toContain('value="未获取到"')
  expect(html).not.toContain('正在提取')
  expect(state.fields.every(field => field.value === '')).toBe(true)
})

it('初始及仍有待提取内容时不提前给出缺失结果', () => {
  expect(renderState(createIdleModel())).not.toContain('未获取到')
  const state: Model = { ...createIdleModel(), playbackCursor: playbackSteps.length, pendingFills: [{ id: 'injury', value: '手臂擦伤', evidence: { speaker: '报警人', time: '00:10', quote: '手臂擦伤' } }] }
  expect(renderState(state)).not.toContain('未获取到')
})
