// Locate the changed range while preserving identical text on both sides.
export function textChange(before: string, after: string) {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let suffix = 0
  while (suffix < before.length - start && suffix < after.length - start && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  return { start, beforeEnd: before.length - suffix, afterEnd: after.length - suffix }
}

export function previewChange(before: string, after: string, offset: number) {
  const { start, afterEnd } = textChange(before, after)
  return after.slice(0, start) + after.slice(start, Math.max(start, Math.min(offset, afterEnd))) + after.slice(afterEnd)
}
