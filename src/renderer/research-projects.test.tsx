// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import { ResearchProjects } from './ResearchProjects'

vi.mock('./ProjectLifecycle', () => ({ ProjectLifecycle: () => null }))
vi.mock('./ProjectChat', () => ({ ProjectChat: () => null }))

const saveProject = vi.fn().mockImplementation(async (input: { title: string; question: string; paperIds?: string[] }) =>
  ({ id: 'created', title: input.title, question: input.question, paperIds: input.paperIds ?? [], createdAt: '', updatedAt: '' }))

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  Object.defineProperty(window, 'singularity', { configurable: true, value: {
    papers: { list: vi.fn().mockResolvedValue([
      { id: 'paper-a', title: 'Shuffled-image controls', missing: false },
      { id: 'paper-b', title: 'Visual grounding survey', missing: false },
    ]) },
    knowledge: {
      projects: vi.fn().mockResolvedValue([]),
      materials: vi.fn().mockResolvedValue([]),
      sources: vi.fn().mockResolvedValue([]),
      saveProject,
      setProjectPaper: vi.fn(),
    },
  } })
})

it('creates a project with a topic, direction, focus and zero or more papers', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const onSelect = vi.fn()
  try {
    await act(async () => { root.render(<ResearchProjects currentId={null} onSelect={onSelect} onOpen={() => {}} onVoice={() => {}} onDiscover={() => {}} onWriting={() => {}} onAssistant={() => {}} />) })
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('新建研究项目'))!.click() })
    const boxes = [...host.querySelectorAll<HTMLInputElement>('.research-project-picker-list input[type=checkbox]')]
    expect(boxes).toHaveLength(2)
    expect(host.querySelector('.research-project-picker .muted')?.textContent).toContain('已选 0 篇')
    await act(async () => { boxes[0].click() })
    expect(host.querySelector('.research-project-picker .muted')?.textContent).toContain('已选 1 篇')
    await act(async () => {
      const form = host.querySelector<HTMLFormElement>('.research-project-form')!
      const title = form.querySelector<HTMLInputElement>('input[name=title')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, '视觉信息的真实利用')
      title.dispatchEvent(new Event('input', { bubbles: true }))
      const topic = form.querySelector<HTMLInputElement>('input[name=topic]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(topic, '异常检测')
      topic.dispatchEvent(new Event('input', { bubbles: true }))
      const direction = form.querySelector<HTMLTextAreaElement>('textarea[name=direction]')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(direction, '零样本细粒度异常定位')
      direction.dispatchEvent(new Event('input', { bubbles: true }))
      const focus = form.querySelector<HTMLTextAreaElement>('textarea[name=question]')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(focus, '局部微小异常定位不稳')
      focus.dispatchEvent(new Event('input', { bubbles: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(saveProject).toHaveBeenCalledWith(expect.objectContaining({ title: '视觉信息的真实利用', topic: '异常检测', direction: '零样本细粒度异常定位', question: '局部微小异常定位不稳', paperIds: ['paper-a'] }))
    expect(onSelect).toHaveBeenCalledWith('created')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('shows the project brief and lets the user edit the three settings on an existing project', async () => {
  vi.mocked(window.singularity.knowledge.projects).mockResolvedValue([{ id: 'p1', title: '异常检测项目', topic: '异常检测', direction: '零样本细粒度异常定位', question: '局部微小异常定位不稳', paperIds: [], createdAt: '', updatedAt: '' }])
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const onSelect = vi.fn()
  try {
    await act(async () => { root.render(<ResearchProjects currentId="p1" onSelect={onSelect} onOpen={() => {}} onVoice={() => {}} onDiscover={() => {}} onWriting={() => {}} onAssistant={() => {}} />) })
    const brief = host.querySelector('.project-brief')!
    expect(brief.textContent).toContain('研究主题')
    expect(brief.textContent).toContain('异常检测')
    expect(brief.textContent).toContain('研究方向')
    expect(brief.textContent).toContain('零样本细粒度异常定位')
    expect(brief.textContent).toContain('研究重点')
    expect(brief.textContent).toContain('局部微小异常定位不稳')
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('编辑项目设定'))!.click() })
    const form = host.querySelector<HTMLFormElement>('.research-project-form')!
    expect(form.querySelector<HTMLInputElement>('input[name=topic]')!.value).toBe('异常检测')
    expect(form.querySelector<HTMLTextAreaElement>('textarea[name=direction]')!.value).toBe('零样本细粒度异常定位')
    expect(form.querySelector<HTMLTextAreaElement>('textarea[name=question]')!.value).toBe('局部微小异常定位不稳')
    await act(async () => {
      const topic = form.querySelector<HTMLInputElement>('input[name=topic]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(topic, '医学图像异常检测')
      topic.dispatchEvent(new Event('input', { bubbles: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(saveProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', topic: '医学图像异常检测', direction: '零样本细粒度异常定位', question: '局部微小异常定位不稳' }))
  } finally { await act(async () => root.unmount()); host.remove() }
})
