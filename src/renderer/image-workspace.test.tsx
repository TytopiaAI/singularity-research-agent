// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ImageWorkspace } from './ImageWorkspace'
import type { ImageAsset, ImageSettings } from '../shared/image'

const settings: ImageSettings = {
  hasMiniMaxCredential: true, minimaxBaseUrl: 'https://api.minimax.cn',
  model: 'MiniMax-H3-Image', aspectRatio: '1:1', area: '2K', count: 1, format: 'jpeg',
}
const asset: ImageAsset = {
  id: 'a0f1c2d3-0000-4000-8000-000000000001', prompt: '深色背景下的发光水母',
  revisedPrompt: 'A glowing jellyfish on a dark background', model: 'MiniMax-H3-Image',
  aspectRatio: '1:1', area: '2K', format: 'jpeg', size: '2048x2048',
  bytes: 1024, createdAt: '2026-11-14T12:00:00.000Z', file: 'a0f1c2d3-0000-4000-8000-000000000001.jpg',
}

interface Harness {
  host: HTMLDivElement
  root: Root
  api: Record<string, ReturnType<typeof vi.fn>>
  click: (selector: string) => Promise<void>
  type: (selector: string, value: string) => Promise<void>
  text: () => string
  close: () => Promise<void>
}

async function render(hasKey = true): Promise<Harness> {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  const api = {
    settings: vi.fn().mockResolvedValue({ ...settings, hasMiniMaxCredential: hasKey }),
    saveSettings: vi.fn().mockImplementation(async () => ({ ...settings, hasMiniMaxCredential: true })),
    list: vi.fn().mockResolvedValue([]),
    generate: vi.fn().mockResolvedValue({ assets: [asset], images: ['data:image/jpeg;base64,AAAA'], failures: [] }),
    cancel: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue('data:image/jpeg;base64,AAAA'),
    remove: vi.fn().mockResolvedValue(undefined),
    reveal: vi.fn().mockResolvedValue(undefined),
  }
  Object.defineProperty(window, 'singularity', { configurable: true, value: { images: api } })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<ImageWorkspace />))
  const click = async (selector: string): Promise<void> => {
    const element = host.querySelector(selector) as HTMLElement | null
    if (!element) throw new Error(`missing ${selector}`)
    await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  }
  const type = async (selector: string, value: string): Promise<void> => {
    const element = host.querySelector(selector) as HTMLTextAreaElement | HTMLInputElement | null
    if (!element) throw new Error(`missing ${selector}`)
    const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  return {
    host, root, api, click, type,
    text: () => host.textContent ?? '',
    close: async () => { await act(async () => root.unmount()); host.remove() },
  }
}

it('renders the three-panel workspace with the empty canvas and all parameters', async () => {
  const view = await render()
  expect(view.host.querySelector('.image-assets')).not.toBeNull()
  expect(view.host.querySelector('.image-canvas')).not.toBeNull()
  expect(view.host.querySelector('.image-composer')).not.toBeNull()
  expect(view.text()).toContain('写一句描述，生成第一张图')
  expect(view.text()).toContain('开始创作')
  expect(view.text()).toContain('最近创作')
  expect([...view.host.querySelectorAll('option')].map(o => o.textContent)).toContain('4K · 4096²')
  expect(view.host.querySelector('.image-result-grid')).toBeNull()
  await view.close()
})

it('opens settings instead of billing a request when no key is saved', async () => {
  const view = await render(false)
  await view.type('#image-prompt', '发光的猫')
  await view.click('.image-generate-button')
  expect(view.api.generate).not.toHaveBeenCalled()
  expect(view.text()).toContain('请先在设置中保存 MiniMax API Key')
  expect(view.host.querySelector('.image-settings-panel')).not.toBeNull()
  await view.close()
})

it('sends the prompt and parameters, then shows the generated image', async () => {
  const view = await render()
  await view.type('#image-prompt', '深色背景下的发光水母')
  await view.click('.image-generate-button')
  expect(view.api.generate).toHaveBeenCalledTimes(1)
  const [taskId, input] = view.api.generate.mock.calls[0] as unknown as [string, Record<string, unknown>]
  expect(taskId).toMatch(/^img-/)
  expect(input).toMatchObject({ prompt: '深色背景下的发光水母', model: 'MiniMax-H3-Image', area: '2K', aspectRatio: '1:1', count: 1, format: 'jpeg' })
  expect(view.host.querySelector('.image-result-grid img')?.getAttribute('src')).toMatch(/^data:image\/jpeg/)
  expect(view.text()).toContain('已生成 1 张')
  await view.close()
})

it('saves the shared key and service region from the settings sheet', async () => {
  const view = await render(false)
  await view.click('[aria-label="图片生成设置"]')
  await view.type('.image-settings-panel input[type="password"]', 'sk-new-key')
  await view.click('.image-settings-save')
  expect(view.api.saveSettings).toHaveBeenCalledTimes(1)
  expect(view.api.saveSettings.mock.calls[0][0]).toMatchObject({ minimaxKey: 'sk-new-key', minimaxBaseUrl: 'https://api.minimax.cn' })
  expect(view.host.querySelector('.image-settings-panel')).toBeNull()
  await view.close()
})

it('uses flat theme colours and no gradients in the stylesheet', () => {
  const css = fs.readFileSync(path.resolve('src/renderer/image-workspace.css'), 'utf8')
  expect(css).toContain('var(--theme-tint)')
  expect(css).toContain('data-chat-theme="blue"')
  expect(css).toContain('data-theme="dark"')
  expect(css).not.toMatch(/linear-gradient|radial-gradient/)
})
