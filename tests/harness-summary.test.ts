import { describe, expect, it, vi } from 'vitest'
import { HarnessApi } from '../src/main/harness-api'

describe('paper summary task lifecycle', () => {
  it('queues a concise structured review and one in-session continuation', async () => {
    const api = new HarnessApi(() => null)
    const requests: Array<{ method: string; payload: any }> = []
    vi.spyOn(api, 'rpc').mockImplementation(async (method, payload) => {
      requests.push({ method, payload })
      return (method === 'session/create' ? { sessionId: 'session-1' } : undefined) as never
    })
    const sessionId = await api.createPaperTask({ cwd: 'C:/test', title: '总结', paperId: 'paper-1', paperTitle: 'Test paper',
      sourceMarkdown: 'paper.md', artifactPath: 'summary.md', artifactId: 'artifact-1', kind: 'summary' })
    expect(sessionId).toBe('session-1')
    expect(requests.map((request) => request.method)).toEqual(['session/create', 'session/rename', 'session/prompt'])
    expect(requests[2].payload.request.requestId).toEqual(expect.any(String))
    const firstPrompt = requests[2].payload.request.content[0].text as string
    expect(firstPrompt).toContain('paper_save_review')
    expect(firstPrompt).toContain('evidence 最多 1 条')
    await api.continuePaperSummary(sessionId, 'paper-1', 'artifact-1')
    expect(requests[3].payload.request.sessionId).toBe(sessionId)
    expect(requests[3].payload.request.content[0].text).toContain('不要再通读全文')
    expect(requests[3].payload.request.content[0].text).toContain('paper_save_review')
  })

  it('distinguishes output-budget exhaustion from an ordinary completed turn', async () => {
    const api = new HarnessApi(() => null)
    vi.spyOn(api, 'rpc').mockImplementation(async (method) => (method === 'session/list'
      ? { items: [{ sessionId: 'session-1', running: false, projections: { asOfSeq: 17 } }] }
      : { records: [{ type: 'event', event: { type: 'turn/start', data: { turn: 1 } } }, { type: 'event', event: { type: 'turn/end', data: { reason: { kind: 'max-tokens' } } } }] }) as never)
    expect(await api.taskEndState('session-1')).toEqual({ ended: true, reason: 'max-tokens' })
  })

  it('treats a running session as not yet ended', async () => {
    const api = new HarnessApi(() => null)
    vi.spyOn(api, 'rpc').mockResolvedValue({ items: [{ sessionId: 'session-1', running: true, projections: { asOfSeq: 9 } }] } as never)
    expect(await api.taskEndState('session-1')).toEqual({ ended: false, reason: null })
  })
})
