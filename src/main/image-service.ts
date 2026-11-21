import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  IMAGE_ASPECT_RATIOS, IMAGE_DEFAULTS,
  type ImageArea, type ImageAsset, type ImageFormat, type ImageGenerateInput,
  type ImageGenerateResult, type ImageModel, type ImageSettings, type ImageSettingsInput,
} from '../shared/image'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const HISTORY_LIMIT = 200
const ORIGINS = ['https://api.minimax.cn', 'https://api.minimax.io'] as const

const secret = z.string().trim().max(512).refine(value => !/[\r\n]/.test(value)).optional()
const generateSchema = z.object({
  prompt: z.string().trim().min(1).max(8000),
  model: z.enum(['MiniMax-H3-Image', 'MiniMax-H3-Image-Highspeed']),
  aspectRatio: z.string().refine(value => (IMAGE_ASPECT_RATIOS as readonly string[]).includes(value)),
  area: z.enum(['1K', '2K', '4K']),
  count: z.number().int().min(1).max(4),
  format: z.enum(['jpeg', 'png', 'webp']),
})
const settingsSchema = z.object({
  minimaxKey: secret,
  minimaxBaseUrl: z.enum(ORIGINS).optional(),
  model: z.enum(['MiniMax-H3-Image', 'MiniMax-H3-Image-Highspeed']).optional(),
  aspectRatio: z.string().refine(value => (IMAGE_ASPECT_RATIOS as readonly string[]).includes(value)).optional(),
  area: z.enum(['1K', '2K', '4K']).optional(),
  count: z.number().int().min(1).max(4).optional(),
  format: z.enum(['jpeg', 'png', 'webp']).optional(),
})

/** Narrow slice of the shared credential store: the MiniMax key is owned by voice settings. */
export interface ImageCredentialStore {
  settings(): Promise<{ hasMiniMaxCredential: boolean; minimaxBaseUrl?: string }>
  credential(provider: 'minimax'): Promise<string>
  saveMiniMaxCredential(input: { minimaxKey?: string; minimaxBaseUrl?: string }): Promise<unknown>
}

interface StoredSettings {
  model: ImageModel
  aspectRatio: string
  area: ImageArea
  count: number
  format: ImageFormat
}
interface History { items: ImageAsset[] }

const defaultSettings: StoredSettings = {
  model: IMAGE_DEFAULTS.model, aspectRatio: IMAGE_DEFAULTS.aspectRatio,
  area: IMAGE_DEFAULTS.area, count: IMAGE_DEFAULTS.count, format: IMAGE_DEFAULTS.format,
}
const originOf = (value: string): string => value === ORIGINS[1] ? ORIGINS[1] : ORIGINS[0]

function isPrivateHost(host: string): boolean {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '')
  return value === 'localhost' || value === '::1' || value.startsWith('127.') || value.startsWith('10.')
    || value.startsWith('192.168.') || value.startsWith('169.254.') || value.startsWith('0.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(value) || value.startsWith('fc') || value.startsWith('fd')
}

function imageKind(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return { mime: 'image/png', ext: 'png' }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return null
}

function httpError(status: number, body: string): Error {
  const messages: Record<number, string> = {
    400: '请求参数不被接受，请检查画幅、清晰度与格式组合。', 401: 'MiniMax API Key 无效或已停用。',
    402: '账户余额不足，请查看官网。', 403: '当前 Key 无权使用图片生成接口。',
    404: '接口地址不存在，请检查服务区设置。', 422: '生成内容未通过安全检查。',
    429: '请求过于频繁，请稍后再试。', 500: '图片服务暂时不可用。',
  }
  let detail = ''
  try {
    const parsed = JSON.parse(body) as { base_resp?: { status_msg?: unknown }; error?: { message?: unknown }; message?: unknown }
    const text = parsed.base_resp?.status_msg ?? parsed.error?.message ?? parsed.message
    if (typeof text === 'string' && text) detail = `：${text.slice(0, 200)}`
  } catch { /* non-JSON error bodies stay generic */ }
  return new Error(`MiniMax HTTP ${status}：${messages[status] ?? '图片生成未完成，请稍后手动重试。'}${detail}`)
}

/**
 * MiniMax H3-Image text-to-image. Paid requests are only made from generate(); saving
 * settings and reading the gallery are entirely local. There are no automatic retries.
 */
export class ImageService {
  private readonly settingsFile: string
  private readonly historyFile: string
  private readonly cache: string
  private queue: Promise<unknown> = Promise.resolve()
  private readonly tasks = new Map<string, AbortController>()

  constructor(config: string, cache: string, private readonly store: ImageCredentialStore, private readonly request: typeof fetch = fetch) {
    this.settingsFile = path.join(config, 'image-settings.json')
    this.historyFile = path.join(config, 'image-history.json')
    this.cache = path.join(cache, 'image-gen')
  }

  private async read<T>(file: string, fallback: T): Promise<T> {
    try { return JSON.parse(await fs.readFile(file, 'utf8')) as T }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new Error('无法读取图片配置，请检查本地数据。') }
  }
  private async write(file: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    try { await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); await fs.rename(temporary, file) }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
  }
  private locked<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(task); this.queue = pending.then(() => {}, () => {}); return pending
  }

  async settings(): Promise<ImageSettings> {
    const [voice, stored] = await Promise.all([this.store.settings(), this.read<StoredSettings>(this.settingsFile, defaultSettings)])
    return {
      hasMiniMaxCredential: Boolean(voice.hasMiniMaxCredential),
      minimaxBaseUrl: originOf(voice.minimaxBaseUrl ?? ''),
      model: stored.model ?? defaultSettings.model,
      aspectRatio: stored.aspectRatio ?? defaultSettings.aspectRatio,
      area: stored.area ?? defaultSettings.area,
      count: stored.count ?? defaultSettings.count,
      format: stored.format ?? defaultSettings.format,
    }
  }

  /** The MiniMax key is shared with voice settings so it only has to be typed once. */
  async saveSettings(raw: ImageSettingsInput): Promise<ImageSettings> {
    const input = settingsSchema.parse(raw)
    await this.locked(async () => {
      if (input.minimaxKey || input.minimaxBaseUrl) {
        await this.store.saveMiniMaxCredential({ minimaxKey: input.minimaxKey, minimaxBaseUrl: input.minimaxBaseUrl })
      }
      const previous = await this.read<StoredSettings>(this.settingsFile, defaultSettings)
      await this.write(this.settingsFile, {
        model: input.model ?? previous.model,
        aspectRatio: input.aspectRatio ?? previous.aspectRatio,
        area: input.area ?? previous.area,
        count: input.count ?? previous.count,
        format: input.format ?? previous.format,
      } satisfies StoredSettings)
    })
    return this.settings()
  }

  async list(): Promise<ImageAsset[]> {
    const history = await this.read<History>(this.historyFile, { items: [] })
    return Array.isArray(history.items) ? history.items : []
  }

  /** Returns the absolute path for shell.showItemInFolder; ids are validated, never interpolated. */
  async assetPath(id: string): Promise<string> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('图片编号无效。')
    const asset = (await this.list()).find(item => item.id === id)
    if (!asset || !/^[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/i.test(asset.file)) throw new Error('找不到这张图片。')
    return path.join(this.cache, asset.file)
  }

  async readAsset(id: string): Promise<string> {
    const target = await this.assetPath(id)
    const bytes = await fs.readFile(target)
    const kind = imageKind(bytes)
    if (!kind) throw new Error('本地图片格式无法识别。')
    return `data:${kind.mime};base64,${bytes.toString('base64')}`
  }

  async remove(id: string): Promise<void> {
    const target = await this.assetPath(id)
    await this.locked(async () => {
      const history = await this.read<History>(this.historyFile, { items: [] })
      await this.write(this.historyFile, { items: (history.items ?? []).filter(item => item.id !== id) })
      await fs.rm(target, { force: true })
    })
  }

  cancel(taskId: string): void {
    const controller = this.tasks.get(taskId)
    if (!controller) throw new Error('没有正在进行的生成任务。')
    controller.abort()
  }

  private async download(url: string, signal: AbortSignal): Promise<Buffer> {
    let target: URL
    try { target = new URL(url) } catch { throw new Error('生成图片的下载地址无效。') }
    if (target.protocol !== 'https:' || target.username || target.password || isPrivateHost(target.hostname)) throw new Error('生成图片的下载地址不可用。')
    const response = await this.request(target.href, { signal, redirect: 'follow' })
    if (!response.ok) { await response.body?.cancel(); throw new Error(`下载生成图片失败（HTTP ${response.status}）。`) }
    if (!response.body) throw new Error('生成图片未返回数据。')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > MAX_IMAGE_BYTES) throw new Error('生成图片超过 20 MiB 上限。')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    return Buffer.concat(chunks)
  }

  private async generate(input: ImageGenerateInput, signal: AbortSignal): Promise<ImageGenerateResult> {
    signal.throwIfAborted()
    const voice = await this.store.settings()
    if (!voice.hasMiniMaxCredential) throw new Error('请先在图片设置中保存 MiniMax API Key。')
    const key = await this.store.credential('minimax')
    const payload = {
      model: input.model, prompt: input.prompt, aspect_ratio: input.aspectRatio, area: input.area,
      n: input.count, output_format: input.format, response_format: 'url',
    }
    const response = await this.request(`${originOf(voice.minimaxBaseUrl ?? '')}/v1/images/generations`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]), redirect: 'error',
    })
    const body = await response.text()
    if (!response.ok) throw httpError(response.status, body)
    let parsed: unknown
    try { parsed = JSON.parse(body) } catch { throw new Error('MiniMax 返回了无法解析的响应。') }
    if (!parsed || typeof parsed !== 'object') throw new Error('MiniMax 返回了无法解析的响应。')
    const record = parsed as Record<string, unknown>
    const base = record.base_resp as { status_code?: unknown; status_msg?: unknown } | undefined
    if (base && typeof base.status_code === 'number' && base.status_code !== 0) {
      throw new Error(`MiniMax 图片服务返回错误 ${base.status_code}${typeof base.status_msg === 'string' ? `：${base.status_msg.slice(0, 200)}` : ''}。`)
    }
    if (!Array.isArray(record.data) || !record.data.length) throw new Error('MiniMax 未返回任何图片。')

    const assets: ImageAsset[] = [], images: string[] = [], failures: string[] = []
    const createdAt = new Date().toISOString()
    for (const item of record.data as Array<Record<string, unknown>>) {
      if (!item || typeof item !== 'object') continue
      if (item.error) {
        const reason = (item.error as { message?: unknown }).message
        failures.push(typeof reason === 'string' && reason ? reason.slice(0, 200) : '该张图片未通过内容安全检查。')
        continue
      }
      try {
        signal.throwIfAborted()
        let bytes: Buffer
        if (typeof item.url === 'string' && item.url) bytes = await this.download(item.url, signal)
        else if (typeof item.b64_json === 'string' && item.b64_json) bytes = Buffer.from(item.b64_json, 'base64')
        else throw new Error('响应缺少图片数据。')
        if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('生成图片数据无效或过大。')
        const kind = imageKind(bytes)
        if (!kind) throw new Error('MiniMax 返回的图片格式无法识别。')
        const id = randomUUID(), file = `${id}.${kind.ext}`
        await fs.mkdir(this.cache, { recursive: true })
        const temporary = path.join(this.cache, `${file}.${randomUUID()}.tmp`)
        try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, path.join(this.cache, file)) }
        finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
        const revised = typeof item.revised_prompt === 'string' ? item.revised_prompt.slice(0, 4000) : ''
        const size = typeof item.size === 'string' ? item.size.slice(0, 40) : ''
        assets.push({ id, prompt: input.prompt, revisedPrompt: revised, model: input.model,
          aspectRatio: input.aspectRatio, area: input.area, format: input.format, size, bytes: bytes.length, createdAt, file })
        images.push(`data:${kind.mime};base64,${bytes.toString('base64')}`)
      } catch (error) {
        if (signal.aborted) throw error
        failures.push(error instanceof Error ? error.message.slice(0, 200) : '该张图片保存失败。')
      }
    }
    if (!assets.length) throw new Error(`本次没有生成可用图片。${failures.join(' ')}`.slice(0, 500))
    await this.locked(async () => {
      const history = await this.read<History>(this.historyFile, { items: [] })
      await this.write(this.historyFile, { items: [...assets, ...(history.items ?? [])].slice(0, HISTORY_LIMIT) })
    })
    return { assets, images, failures }
  }

  async generateTask(taskId: string, raw: unknown): Promise<ImageGenerateResult> {
    if (typeof taskId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(taskId) || this.tasks.has(taskId)) throw new Error('生成任务无效或重复。')
    const input = generateSchema.parse(raw) as ImageGenerateInput
    const controller = new AbortController()
    this.tasks.set(taskId, controller)
    try { return await this.generate(input, controller.signal) }
    catch (error) {
      if (controller.signal.aborted) throw new Error('图片生成已停止。')
      if (error instanceof Error && /^(请先|无法解密|请填写|MiniMax|本次没有|生成图片|下载生成图片|本地图片)/.test(error.message)) throw error
      throw new Error('图片生成请求中断或超时，未自动重试；已发送请求的费用请以官网记录为准。')
    } finally { this.tasks.delete(taskId) }
  }
}
