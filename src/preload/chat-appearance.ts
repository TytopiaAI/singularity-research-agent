import { contextBridge, ipcRenderer } from 'electron'
import { chatThemes, isChatTheme, type ChatTheme } from '../shared/chat-theme'

// Narrow upstream browser protocol, without access to the shell's desktop APIs.
contextBridge.exposeInMainWorld('dshDesktop', { protocolVersion: 1, mentions: { list: () => ipcRenderer.invoke('mentions:catalog') }, browser: {
  acquire: (workspace: string) => ipcRenderer.invoke('harness-browser:acquire', workspace),
  release: (lease: string) => ipcRenderer.invoke('harness-browser:release', lease),
  onOpenRequested: (lease: string, listener: (url: string) => void) => {
    const handler = (_event: unknown, request: {lease: string; url: string}): void => {
      if (request.lease === lease) listener(request.url)
    }
    ipcRenderer.on('harness-browser:open-requested', handler)
    return () => ipcRenderer.removeListener('harness-browser:open-requested', handler)
  },
} })
window.addEventListener('DOMContentLoaded', () => {
  const root = document.createElement('div')
  root.id = 'singularity-chat-appearance'
  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'chat-theme-trigger'
  trigger.setAttribute('aria-label', '选择聊天背景')
  trigger.title = '聊天背景'
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-controls', 'singularity-chat-theme-panel')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value)
  const outline = document.createElementNS(svg.namespaceURI, 'path')
  outline.setAttribute('d', 'M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.4-3.4 1.5 1.5 0 0 1 1.1-2.6h1a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z')
  svg.append(outline)
  for (const [cx,cy] of [[7.5,10],[10,6.5],[15,6.5],[17.5,10]]) {
    const dot = document.createElementNS(svg.namespaceURI, 'circle')
    dot.setAttribute('cx', String(cx)); dot.setAttribute('cy', String(cy)); dot.setAttribute('r', '.8'); dot.setAttribute('fill', 'currentColor')
    svg.append(dot)
  }
  trigger.append(svg)
  const panel = document.createElement('section')
  panel.id = 'singularity-chat-theme-panel'
  panel.className = 'chat-theme-panel'
  panel.hidden = true
  panel.setAttribute('aria-label', '聊天背景')
  const heading = document.createElement('strong')
  heading.textContent = '聊天背景'
  const group = document.createElement('div')
  group.className = 'chat-theme-options'
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-label', '聊天背景颜色')
  const message = document.createElement('div')
  message.className = 'chat-theme-error'
  message.setAttribute('role', 'status')
  let selected: ChatTheme = 'warm'
  const buttons: HTMLButtonElement[] = []
  const apply = (value: unknown): void => {
    if (!isChatTheme(value)) return
    selected = value
    document.documentElement.dataset.singularityChatTheme = value
    for (const button of buttons) {
      const checked = button.dataset.chatTheme === value
      button.setAttribute('aria-checked', String(checked))
      button.tabIndex = checked ? 0 : -1
    }
  }
  const close = (restoreFocus = false): void => {
    panel.hidden = true; trigger.setAttribute('aria-expanded', 'false')
    if (restoreFocus) trigger.focus()
  }
  const choose = async (value: ChatTheme): Promise<void> => {
    try { apply(await ipcRenderer.invoke('appearance:set-chat-theme', value)); message.textContent = '' }
    catch { message.textContent = '背景保存失败，请重试' }
  }
  for (const theme of chatThemes) {
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'chat-theme-option'; button.dataset.chatTheme = theme.id
    button.setAttribute('role', 'radio'); button.setAttribute('aria-label', theme.label)
    const swatch = document.createElement('span')
    swatch.className = `chat-theme-swatch${theme.id === 'transparent' ? ' is-transparent' : ''}`
    swatch.style.setProperty('--swatch', theme.color)
    swatch.setAttribute('aria-hidden', 'true')
    const label = document.createElement('span'); label.textContent = theme.label
    button.append(swatch, label)
    button.addEventListener('click', () => { void choose(theme.id) })
    buttons.push(button); group.append(button)
  }
  group.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return
    event.preventDefault()
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length
    buttons[next].focus(); void choose(chatThemes[next].id)
  })
  trigger.addEventListener('click', () => {
    if (!panel.hidden) { close(); return }
    panel.hidden = false; trigger.setAttribute('aria-expanded', 'true')
    buttons[chatThemes.findIndex(theme => theme.id === selected)].focus()
  })
  document.addEventListener('pointerdown', event => { if (!root.contains(event.target as Node)) close() }, true)
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) } })
  // In Electron's isolated preload world, a microtask can run between blur and
  // the next focus event. activeElement is temporarily BODY at that point;
  // hiding the panel there removes the pressed option before mouseup/click.
  root.addEventListener('focusout', event => {
    if (!root.contains(event.relatedTarget as Node | null)) close()
  })
  panel.append(heading, group, message); root.append(trigger, panel); document.body.append(root)
  ipcRenderer.on('appearance:chat-theme-changed', (_event, value: unknown) => apply(value))
  apply('warm')
  void ipcRenderer.invoke('appearance:get-chat-theme').then(apply).catch(() => {})
}, { once: true })
