import type { Outcome, WorkflowRequest } from './workflow'

const KEY = 'moss-prefill-mock-service:v1'
// Local service adapter. A production adapter must keep the same request IDs,
// immutable payloads and independent receipt semantics.
export function mockWorkflowResult(request: WorkflowRequest, planned: Outcome): Outcome {
  try {
    const receipts = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, { outcome: Outcome; request: WorkflowRequest }>
    const previous = receipts[request.id]
    if (previous?.outcome === 'received') return 'received'
    if (planned === 'unknown') return 'unknown'
    receipts[request.id] = { outcome: planned, request: structuredClone(request) }
    localStorage.setItem(KEY, JSON.stringify(receipts))
    return planned
  } catch {
    // Never claim a successful save if browser persistence failed.
    return 'failed'
  }
}
