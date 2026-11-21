// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import { ProjectChat } from './ProjectChat'
import type { ProjectChatState } from '../shared/project-chat'

const project = { id: 'project', title: 'Grounded reasoning', topic: '视觉推理', direction: '视觉证据的因果验证', question: 'How to validate?', paperIds: ['paper'], createdAt: '', updatedAt: '' }
const state = (over: Partial<ProjectChatState> = {}): ProjectChatState => ({
  sessionId: 'session', running: false,
  messages: [
    { id: 'u2', role: 'user', text: 'How should we validate grounding?', time: 1 },
    { id: 'a3', role: 'assistant', text: 'Add a shuffled-image control [p.4].', time: 2 },
    { id: 't4', role: 'tool', text: 'pages…', toolName: 'paper_read_pages', toolError: false, time: 3 },
  ],
  ...over,
})

let projectChat: ReturnType<typeof vi.fn>
let projectChatSend: ReturnType<typeof vi.fn>
let projectChatSync: ReturnType<typeof vi.fn>
let projectChatCancel: ReturnType<typeof vi.fn>

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  projectChat = vi.fn().mockResolvedValue(state())
  projectChatSend = vi.fn().mockResolvedValue(state({ running: true, messages: [...state().messages, { id: 'u6', role: 'user', text: '谢谢', time: 4 }] }))
  projectChatSync = vi.fn().mockResolvedValue(state({ messages: [...state().messages, { id: 'u8', role: 'user', text: '【项目设定更新】', time: 5 }] }))
  projectChatCancel = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window, 'singularity', { configurable: true, value: { knowledge: { projectChat, projectChatSend, projectChatSync, projectChatCancel } } })
})

const mount = async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<ProjectChat project={project} linkedPapers={[{ id: 'paper', title: 'Paper A' }]} />) })
  return { host, root }
}

it('renders the conversation with tool rows and the linked-paper context', async () => {
  const { host, root } = await mount()
  try {
    expect(projectChat).toHaveBeenCalledWith('project')
    expect(host.querySelector('.project-chat-row.user p')?.textContent).toContain('validate grounding')
    expect(host.querySelector('.project-chat-row.assistant p')?.textContent).toContain('shuffled-image control')
    expect(host.querySelector('.project-chat-tool span')?.textContent).toBe('paper_read_pages')
    expect(host.querySelector('.project-chat-context')?.textContent).toContain('1 篇关联论文')
    expect([...host.querySelectorAll('.project-chat-stop')]).toHaveLength(0)
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('queues a typed message through the send API', async () => {
  const { host, root } = await mount()
  try {
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="项目对话输入"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '帮我设计消融实验')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { host.querySelector('.project-chat-input')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(projectChatSend).toHaveBeenCalledWith('project', '帮我设计消融实验')
    const userBubbles = [...host.querySelectorAll('.project-chat-row.user p')]
    expect(userBubbles.at(-1)?.textContent).toContain('谢谢')
    expect(userBubbles).toHaveLength(2)
    expect(input.value).toBe('')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('syncs updated project settings into the existing conversation', async () => {
  const { host, root } = await mount()
  try {
    const sync = host.querySelector<HTMLButtonElement>('.project-chat-sync')!
    expect(sync.title).toContain('研究重点')
    await act(async () => { sync.click() })
    expect(projectChatSync).toHaveBeenCalledWith('project')
    const userBubbles = [...host.querySelectorAll('.project-chat-row.user p')]
    expect(userBubbles.at(-1)?.textContent).toContain('【项目设定更新】')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('mentions a library paper and a surveyed field from the @ menu', async () => {
  const setProjectField = vi.fn().mockResolvedValue(project)
  const onTogglePaper = vi.fn().mockResolvedValue(undefined)
  const fields = vi.fn().mockResolvedValue([{ id: 'field-1', title: '异常检测', paperCount: 3, directionCount: 1, revision: 1, updatedAt: '', documentVersion: 1, documentState: 'current' }])
  Object.defineProperty(window, 'singularity', { configurable: true, value: { knowledge: { projectChat, projectChatSend, projectChatSync, projectChatCancel, setProjectField }, research: { fields } } })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<ProjectChat project={{ ...project, paperIds: [] }} linkedPapers={[]} library={[{ id: 'paper', title: 'Paper A' }]} onTogglePaper={onTogglePaper} />) })
  try {
    const at = host.querySelector<HTMLButtonElement>('[aria-label="提及论文或领域"]')!
    expect(at.textContent).toBe('@')
    await act(async () => { at.click() })
    expect(host.textContent).toContain('Paper A')
    expect(host.textContent).toContain('异常检测')
    const paperBox = [...host.querySelectorAll<HTMLInputElement>('.project-chat-mention input[type="checkbox"]')].find((input) => input.parentElement?.textContent?.includes('Paper A'))!
    await act(async () => { paperBox.click() })
    expect(onTogglePaper).toHaveBeenCalledWith('paper', true)
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="项目对话输入"]')!
    expect(input.value).toContain('@《Paper A》')
    const field = [...host.querySelectorAll<HTMLButtonElement>('.project-chat-mention button')].find((button) => button.textContent === '异常检测')!
    await act(async () => { field.click() })
    expect(setProjectField).toHaveBeenCalledWith('project', 'field-1')
    expect(input.value).toContain('@异常检测')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('offers stop for a running turn and cancels the session', async () => {
  projectChat = vi.fn().mockResolvedValue(state({ running: true }))
  Object.defineProperty(window, 'singularity', { configurable: true, value: { knowledge: { projectChat, projectChatSend, projectChatSync, projectChatCancel } } })
  const { host, root } = await mount()
  try {
    const stop = host.querySelector<HTMLButtonElement>('.project-chat-stop')!
    expect(stop).toBeTruthy()
    expect(host.querySelector('.project-chat-status')?.textContent).toContain('思考')
    await act(async () => { stop.click() })
    expect(projectChatCancel).toHaveBeenCalledWith('project')
  } finally { await act(async () => root.unmount()); host.remove() }
})
