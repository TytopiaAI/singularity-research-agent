// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { VoiceWorkspace } from './VoiceWorkspace'
vi.mock('./VoiceOrb', () => ({ VoiceOrb: () => null }))

it('saves a project discussion with its question and verified citation IDs once', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  const originalScroll = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('AudioContext', class { async resume() {} async close() {} })
  const saveEntry = vi.fn().mockResolvedValue({ id: 'discussion' })
  Object.defineProperty(window, 'singularity', { configurable: true, value: {
    voice: { settings: vi.fn().mockResolvedValue({ provider: 'windows' }), capabilities: vi.fn().mockResolvedValue({ recognition: false, synthesis: false, language: 'zh-CN' }), start: vi.fn().mockResolvedValue('session'), stop: vi.fn().mockResolvedValue(undefined) },
    windowControls: { onConcealed: vi.fn().mockReturnValue(() => {}) },
    papers: { list: vi.fn().mockResolvedValue([]) },
    knowledge: { projects: vi.fn().mockResolvedValue([{ id: 'project', title: 'Grounded reasoning' }]), contextReply: vi.fn().mockResolvedValue({ text: 'Add a shuffled-image control; the hypothesis needs validation.', citations: [{ sourceId: 'source-one', paperId: 'paper', label: 'S001', page: 1 }] }), saveEntry },
  } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => { root.render(<VoiceWorkspace currentProjectId="project" initialMode="project"/>) })
    await act(async () => { const input = host.querySelector<HTMLInputElement>('[aria-label="文字输入"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'How should we validate visual grounding?'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { host.querySelector('.voice-input')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    const click = async (label: string) => act(async () => { [...host.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') || button.textContent?.trim()) === label)!.click() })
    await click('对话记录'); await click('保存为项目讨论')
    expect(saveEntry).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project', kind: 'discussion', origin: 'voice', sourceIds: ['source-one'], description: expect.stringContaining('How should we validate visual grounding?') }))
    expect(saveEntry.mock.calls[0][0].description).toContain('hypothesis needs validation')
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '已保存到项目')?.disabled).toBe(true)
  } finally { await act(async () => root.unmount()); host.remove(); Element.prototype.scrollIntoView = originalScroll; vi.unstubAllGlobals() }
})
