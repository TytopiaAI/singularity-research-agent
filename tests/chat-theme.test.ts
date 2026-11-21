import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatThemeStore } from '../src/main/chat-theme-store'

const directories: string[] = []
function directory(): string {
  const parent = path.join(process.cwd(), '.local-data', 'temp')
  fs.mkdirSync(parent, { recursive: true })
  const value = fs.mkdtempSync(path.join(parent, 'chat-appearance-test-'))
  directories.push(value)
  return value
}
afterEach(() => { for (const value of directories.splice(0)) fs.rmSync(value, { recursive: true, force: true }) })

describe('chat background preferences', () => {
  it('keeps the existing background by default and persists changes across launches', () => {
    const config = directory()
    const store = new ChatThemeStore(config)
    expect(store.get()).toBe('warm')
    store.set('purple')
    expect(new ChatThemeStore(config).get()).toBe('purple')
    store.set('transparent')
    expect(new ChatThemeStore(config).get()).toBe('transparent')
    expect(fs.readdirSync(config)).toEqual(['chat-appearance.json'])
  })

  it('recovers corrupt preferences and rejects unsupported values without overwriting the saved choice', () => {
    const config = directory()
    fs.writeFileSync(path.join(config, 'chat-appearance.json'), '{broken', 'utf8')
    const store = new ChatThemeStore(config)
    expect(store.get()).toBe('warm')
    store.set('green')
    expect(() => store.set('invalid')).toThrow('不支持的聊天背景')
    expect(new ChatThemeStore(config).get()).toBe('green')
  })
})
