import { describe, expect, it } from 'vitest'
import { projectChatMessages, projectGreetingPrompt, projectPapersMessage, projectSettingsMessage, type HarnessSessionEventLike } from '../src/shared/project-chat'

const event = (seq: number, type: string, data: HarnessSessionEventLike['data'], time = seq * 1000): HarnessSessionEventLike => ({ type, seq, time, data })

describe('projectChatMessages', () => {
  it('renders queued user prompts, assistant text and paired tool calls in seq order', () => {
    const messages = projectChatMessages([
      event(1, 'system/message', { message: { role: 'system', content: [{ type: 'text', text: 'system prompt' }], source: { kind: 'system-prompt' } } }),
      event(2, 'user/message', { message: { role: 'user', content: [{ type: 'text', text: '对比两篇论文的方法。' }], source: { kind: 'user' } } }),
      event(3, 'tool/call', { callId: 'c1', name: 'paper_read_pages' }),
      event(4, 'tool/result', { message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'pages…' }], source: { kind: 'tool' } } }),
      event(5, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'reasoning', text: 'internal' }, { type: 'text', text: '两篇论文的差异在 [p.3]。' }], source: { kind: 'model' } } }),
      event(6, 'user/message', { message: { role: 'user', content: [{ type: 'text', text: 'catalog context' }], source: { kind: 'catalog' } } }),
    ])
    expect(messages).toEqual([
      { id: 'u2', role: 'user', text: '对比两篇论文的方法。', time: 2000 },
      { id: 't4', role: 'tool', text: 'pages…', toolName: 'paper_read_pages', toolError: false, time: 4000 },
      { id: 'a5', role: 'assistant', text: '两篇论文的差异在 [p.3]。', time: 5000 },
    ])
  })

  it('surfaces in-flight tool calls without a result yet', () => {
    const messages = projectChatMessages([
      event(2, 'user/message', { message: { role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } }),
      event(3, 'tool/call', { callId: 'c1', name: 'paper_search' }),
    ])
    expect(messages).toEqual([
      { id: 'u2', role: 'user', text: 'hi', time: 2000 },
      { id: 'p3', role: 'tool', text: '', toolName: 'paper_search', time: 3000 },
    ])
  })

  it('marks failed tool results and skips reasoning-only assistant attempts', () => {
    const messages = projectChatMessages([
      event(2, 'tool/call', { callId: 'c9', name: 'paper_metadata' }),
      event(3, 'tool/result', { message: { role: 'tool', toolCallId: 'c9', content: [{ type: 'text', text: 'Paper not found' }], isError: true } }),
      event(4, 'assistant/attempt', {}),
      event(5, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'reasoning', text: 'only thinking' }] } }),
    ])
    expect(messages).toEqual([
      { id: 't3', role: 'tool', text: 'Paper not found', toolName: 'paper_metadata', toolError: true, time: 3000 },
    ])
  })
})

describe('projectSettingsMessage', () => {
  it('carries the updated brief and asks for a short acknowledgement', () => {
    const text = projectSettingsMessage({ title: '异常检测', topic: '医学图像异常检测', direction: '零样本细粒度异常定位', question: '局部微小异常定位不稳' })
    expect(text).toContain('研究主题：医学图像异常检测')
    expect(text).toContain('研究方向：零样本细粒度异常定位')
    expect(text).toContain('研究重点（想解决什么问题）：局部微小异常定位不稳')
    expect(text).toContain('不用重新开场')
  })
})

describe('projectGreetingPrompt', () => {
  it('lists linked papers and asks for a short opening', () => {
    const prompt = projectGreetingPrompt({ title: '视觉接地', question: '如何验证？' }, [{ id: 'p1', title: 'Paper A' }, { id: 'p2', title: 'Paper B' }])
    expect(prompt).toContain('项目：视觉接地')
    expect(prompt).toContain('如何验证？')
    expect(prompt).toContain('- p1《Paper A》')
    expect(prompt).toContain('- p2《Paper B》')
    expect(prompt).toContain('3–5 句话')
    expect(prompt).toContain('大约 3 个')
    expect(prompt).toContain('只迭代这一个')
  })

  it('carries the project topic, direction and focus into the opening brief', () => {
    const prompt = projectGreetingPrompt({ title: '异常检测', topic: '医学图像异常检测', direction: '零样本细粒度异常定位', question: '局部微小异常定位不稳' }, [])
    expect(prompt).toContain('研究主题：医学图像异常检测')
    expect(prompt).toContain('研究方向：零样本细粒度异常定位')
    expect(prompt).toContain('研究重点（想解决什么问题）：局部微小异常定位不稳')
    expect(prompt).toContain('研究主题、研究方向与研究重点')
  })

  it('falls back to the library hint with no linked papers', () => {
    const prompt = projectGreetingPrompt({ title: '新方向', question: '' }, [])
    expect(prompt).toContain('（用户尚未填写，可在对话中询问确认）')
    expect(prompt).toContain('paper_list')
  })

  it('uses a surveyed field as background and asks for a falsifiable seed', () => {
    const prompt = projectGreetingPrompt({ title: '视觉接地', question: '如何验证？' }, [], { title: '异常检测', summary: '重建误差仍难定位。' })
    expect(prompt).toContain('领域：异常检测')
    expect(prompt).toContain('重建误差仍难定位。')
    expect(prompt).toContain('证伪标准')
    expect(projectPapersMessage([{ id: 'p1', title: 'Paper A' }])).toContain('p1《Paper A》')
    expect(projectPapersMessage([])).toContain('paper_list')
    expect(prompt).toContain('3–5 句话')
  })
})
