import fs from 'node:fs'
import path from 'node:path'
import { isChatTheme, type ChatTheme } from '../shared/chat-theme'

export class ChatThemeStore {
  private current: ChatTheme = 'warm'
  private readonly file: string

  constructor(configDirectory: string) {
    this.file = path.join(configDirectory, 'chat-appearance.json')
    try {
      const saved: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8')).background
      if (isChatTheme(saved)) this.current = saved
    } catch { /* Missing or invalid preferences use the existing warm background. */ }
  }

  get(): ChatTheme { return this.current }

  set(value: unknown): ChatTheme {
    if (!isChatTheme(value)) throw new Error('不支持的聊天背景')
    const temporary = `${this.file}.tmp`
    fs.writeFileSync(temporary, JSON.stringify({ background: value }), 'utf8')
    fs.renameSync(temporary, this.file)
    this.current = value
    return value
  }
}
