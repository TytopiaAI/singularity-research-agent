// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { WelcomeGuide } from './WelcomeGuide'

let cleanup = () => {}
afterEach(async () => { await act(async () => cleanup()) })

async function render(saveModel = vi.fn(async () => {}), saveVoice = vi.fn(async () => {})) {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const onClose = vi.fn()
  cleanup = () => { root.unmount(); host.remove() }
  await act(async () => { root.render(<WelcomeGuide onClose={onClose} saveModel={saveModel} saveVoice={saveVoice} />) })
  const click = async (label: string) => {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent === label)
    expect(button, label).toBeTruthy()
    await act(async () => { button!.click() })
  }
  return { host, click, onClose, saveModel, saveVoice }
}

it('skips model setup when the key is empty', async () => {
  const saveModel = vi.fn(async () => {})
  const { host, click } = await render(saveModel)
  await click('下一步')
  await click('保存并下一步')
  expect(saveModel).not.toHaveBeenCalled()
  expect(host.querySelector('h1')?.textContent).toBe('配置语音')
})

it('walks from the welcome through model and voice setup', async () => {
  const saveModel = vi.fn(async () => {})
  const { host, click, onClose, saveVoice } = await render(saveModel)
  expect(host.querySelector('h1')?.textContent).toBe('欢迎来到 Singularity')
  expect(host.querySelector('.welcome-mark')).toBeTruthy()
  await click('下一步')
  expect(host.querySelector('h1')?.textContent).toBe('配置对话模型')
  expect(host.textContent).toContain('首页对话')
  const key = host.querySelector<HTMLInputElement>('[aria-label="模型 API Key"]')!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(key, 'sk-example')
    key.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('保存并下一步')
  expect(saveModel).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-example', kind: 'deepseek' }))
  expect(host.querySelector('h1')?.textContent).toBe('配置语音')
  expect(host.textContent).toContain('Windows')
  await click('跳过')
  expect(saveVoice).not.toHaveBeenCalled()
  expect(host.querySelector('h1')?.textContent).toBe('可以开始了')
  await click('进入 Singularity')
  expect(onClose).toHaveBeenCalled()
})
