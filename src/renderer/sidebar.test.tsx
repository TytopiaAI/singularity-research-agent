// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {} }))
vi.mock('./ResearchPages', () => ({ DigestPage: () => null }))
vi.mock('./LibraryWorkspace', () => ({ LibraryWorkspace: () => null }))
vi.mock('./WritingWorkspace', () => ({ WritingWorkspace: () => null }))
vi.mock('./VoiceWorkspace', () => ({ VoiceWorkspace: () => null }))
vi.mock('./ResearchProjects', () => ({ ResearchProjects: () => null }))
vi.mock('./PlanningWorkspace', () => ({ PlanningWorkspace: () => null }))
vi.mock('./PlanningGallery', () => ({ PlanningGallery: () => null }))
// Navigation assertions do not depend on the randomly selected startup artwork.
// The real artwork and its lifecycle are covered by the Electron splash checks.
vi.mock('./StartupSplash', () => ({ launchVariant: 'planets', StartupSplash: () => null }))

let root: Root
let host: HTMLDivElement

beforeEach(async () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  globalThis.ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  }
  localStorage.clear()
  Object.defineProperty(window, 'singularity', {
    configurable: true,
    value: {
      runtime: {
        get: vi.fn().mockResolvedValue({ phase: 'ready', harnessVersion: 'test', electronVersion: 'test', port: 1234, url: null, runningTasks: 0, pendingRestart: false }),
        onStatus: vi.fn().mockReturnValue(() => {}),
        setTheme: vi.fn().mockResolvedValue(undefined),
        getChatTheme: vi.fn().mockResolvedValue('warm'),
        onChatTheme: vi.fn().mockReturnValue(() => {}),
        setHarnessView: vi.fn().mockResolvedValue(undefined),
        assistantAction: vi.fn().mockResolvedValue(undefined),
      },
    },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root.render(<App />) })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

describe('icon navigation rail', () => {
  it('keeps native assistant content hidden until it is loaded and offers local navigation during startup', async () => {
    const update = vi.mocked(window.singularity.runtime.onStatus).mock.calls[0][0]
    const status = { phase: 'ready' as const, harnessVersion: 'test', electronVersion: 'test', port: 1234, url: null, runningTasks: 0, pendingRestart: false, viewReady: false }
    await act(async () => update(status))
    expect(host.querySelector('.harness-host')?.textContent).toContain('正在打开助手')
    expect(vi.mocked(window.singularity.runtime.setHarnessView).mock.lastCall?.[0].visible).toBe(false)
    await act(async () => update({ ...status, phase: 'starting' }))
    expect(host.querySelector('.harness-host')?.textContent).toContain('可以先使用论文库、计划等本地功能')
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="计划"]')!.click() })
    expect(host.querySelector('[aria-label="计划"]')?.getAttribute('aria-current')).toBe('page')
  })
  it('keeps the saved background across every route and applies live changes', async () => {
    const listener = vi.mocked(window.singularity.runtime.onChatTheme).mock.calls[0][0]
    await act(async () => { listener('transparent') })
    for (const label of ['语音对话', '科研发现', '消息订阅', '论文库', '研究项目', '论文写作', '插件管理', '计划', '首页']) {
      await act(async () => { host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click() })
      expect(host.querySelector<HTMLElement>('.main-content')!.dataset.chatTheme).toBe('transparent')
    }
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="消息订阅"]')!.click(); listener('blue') })
    expect(host.querySelector<HTMLElement>('.main-content')!.dataset.chatTheme).toBe('blue')
  })
  it('shows icon-only top actions with hover labels', () => {
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.top-navigation .top-icon-button')]
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['新建会话', '会话历史', '设置'])
    expect(buttons.map((button) => button.querySelector('.top-icon-tooltip')?.textContent)).toEqual(['新建会话', '会话', '设置'])
    for (const button of buttons) expect(button.querySelector('svg')).not.toBeNull()
  })

  it('shows vector navigation with accessible hover labels and a home action', async () => {
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.sidebar-navigation .rail-button')]
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['首页', '语音对话', '科研发现', '消息订阅', '论文库', '研究项目', '论文写作', '图片生成', '插件管理', '计划'])
    for (const button of buttons) {
      expect(button.querySelector('svg')).not.toBeNull()
      expect(button.title).toBe(button.getAttribute('aria-label'))
      expect(button.querySelector('.nav-tooltip')?.textContent).toBe(button.title)
    }
    const home = buttons[0]
    const news = buttons[3]
    expect(home.getAttribute('aria-current')).toBe('page')
    await act(async () => { news.click() })
    expect(news.getAttribute('aria-current')).toBe('page')
    await act(async () => { home.click() })
    expect(home.getAttribute('aria-current')).toBe('page')
  })

  it('removes the hidden rail from keyboard navigation', async () => {
    const sidebar = host.querySelector<HTMLElement>('.app-sidebar')!
    await act(async () => { host.querySelector<HTMLButtonElement>('.sidebar-toggle')!.click() })
    expect(sidebar.hasAttribute('inert')).toBe(true)
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('.app-shell')?.classList.contains('sidebar-closed')).toBe(true)
  })
})
