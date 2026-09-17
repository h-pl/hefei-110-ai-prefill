// Illustrative candidates only; these are not verified locations or API results.
// Preserve unknown roads, coordinates and jurisdiction even after selection.
const entrances = ['东门', '西门', '南门', '北门', '东北入口', '东南入口', '西北入口', '西南入口', '地下停车场入口', '地面停车场入口', '一层服务台', '中央广场']
export const addressCandidates = entrances.map((entrance, i) => ({
  id: `demo-location-${i}`, name: `安和广场${entrance}`,
  area: '合肥市 · 示例地点',
  value: `合肥安和广场${entrance}`,
}))
export function matchAddresses(query: string) {
  const text = query.split(/[，,；;]/)[0].replace(/\s/g, '')
  if (!text) return []
  const venue = /安和|广场/.test(text)
  const words = entrances.filter(word => text.includes(word))
  if (!venue && !words.length) return []
  // Keep related entrances visible, but rank the closest text match first.
  return addressCandidates.filter(c => venue || words.some(word => c.name.includes(word)))
    .map((candidate, order) => ({ candidate, order, score: words.reduce((score, word) => score + (candidate.name.includes(word) ? 10 : 0), 0) + (text.includes(candidate.name) ? 20 : 0) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(item => item.candidate)
}
