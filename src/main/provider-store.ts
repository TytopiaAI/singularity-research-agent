import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import { z } from 'zod'
import type { AppPaths } from './paths'
import { redact } from './redaction'
import type { VoiceMessage } from '../shared/voice'
import type { ProviderConfig, ProviderConfigInput, ProviderTestResult } from '../shared/types'

const providerSchema = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(['deepseek', 'openai-compatible']),
  displayName: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().refine((url) => /^https?:\/\//i.test(url), '仅支持 HTTP(S) 地址'),
  modelId: z.string().trim().min(1).max(160),
  apiKey: z.string().trim().optional(),
  maxOutputTokens: z.number().int().min(128).max(131_072),
})

interface StoredProvider extends Omit<ProviderConfig, 'hasCredential'> {}

interface ProviderFile {
  activeId: string | null
  providers: StoredProvider[]
}

interface SecretFile {
  [id: string]: string
}

export class ProviderStore {
  private readonly metadataPath: string
  private readonly secretPath: string

  constructor(private readonly paths: AppPaths, private readonly request: typeof fetch = fetch) {
    this.metadataPath = path.join(paths.config, 'providers.json')
    this.secretPath = path.join(paths.config, 'provider-secrets.json')
  }

  async list(): Promise<ProviderConfig[]> {
    const [data, secrets] = await Promise.all([this.readMetadata(), this.readSecrets()])
    return data.providers.map((provider) => ({
      ...provider,
      active: provider.id === data.activeId,
      hasCredential: Boolean(secrets[provider.id]),
    }))
  }

  async save(raw: ProviderConfigInput): Promise<ProviderConfig> {
    const input = providerSchema.parse(raw)
    const metadata = await this.readMetadata()
    const secrets = await this.readSecrets()
    const id = input.id ?? crypto.randomUUID()
    const previous = metadata.providers.find((item) => item.id === id)
    const updatedAt = new Date().toISOString()
    const stored: StoredProvider = {
      id,
      kind: input.kind,
      displayName: input.displayName,
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      modelId: input.modelId,
      maxOutputTokens: input.maxOutputTokens,
      active: metadata.activeId ? metadata.activeId === id : true,
      updatedAt,
    }
    metadata.providers = [...metadata.providers.filter((item) => item.id !== id), stored]
    metadata.activeId ??= id
    if (input.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 密钥加密当前不可用。')
      const encrypted = await safeStorage.encryptStringAsync(input.apiKey)
      secrets[id] = encrypted.toString('base64')
    } else if (!previous && !secrets[id]) {
      throw new Error('新模型配置需要 API Key。')
    }
    await Promise.all([this.writeJson(this.metadataPath, metadata), this.writeJson(this.secretPath, secrets)])
    return { ...stored, active: metadata.activeId === id, hasCredential: Boolean(secrets[id]) }
  }

  async remove(id: string): Promise<void> {
    const [metadata, secrets] = await Promise.all([this.readMetadata(), this.readSecrets()])
    metadata.providers = metadata.providers.filter((item) => item.id !== id)
    delete secrets[id]
    if (metadata.activeId === id) metadata.activeId = metadata.providers[0]?.id ?? null
    await Promise.all([this.writeJson(this.metadataPath, metadata), this.writeJson(this.secretPath, secrets)])
  }

  async activate(id: string): Promise<void> {
    const metadata = await this.readMetadata()
    if (!metadata.providers.some((item) => item.id === id)) throw new Error('模型配置不存在。')
    metadata.activeId = id
    await this.writeJson(this.metadataPath, metadata)
  }

  async environment(): Promise<Record<string, string>> {
    const [metadata, secrets] = await Promise.all([this.readMetadata(), this.readSecrets()])
    const active = metadata.providers.find((item) => item.id === metadata.activeId)
    if (!active || !secrets[active.id]) return {}
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(secrets[active.id], 'base64'))
    if (!decrypted.result) throw new Error('无法解密 API Key。')
    if (active.kind === 'deepseek') {
      return {
        DEEPSEEK_API_KEY: decrypted.result,
        DEEPSEEK_BASE_URL: active.baseUrl,
        DSH_MODEL: active.modelId,
      }
    }
    return {
      [this.envName(active.id)]: decrypted.result,
      DSH_MODEL: `${this.providerSlug(active.id)}/${active.modelId}`,
    }
  }

  async test(raw: ProviderConfigInput): Promise<ProviderTestResult> {
    const input = providerSchema.parse(raw)
    let key = input.apiKey
    if (!key && input.id) key = await this.readSecret(input.id)
    if (!key) return { ok: false, latencyMs: 0, status: null, message: '请先填写 API Key。' }
    const started = performance.now()
    let status: number | null = null
    try {
      const response = await this.request(`${input.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: input.modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 2,
          stream: false,
        }),
        signal: AbortSignal.timeout(20_000),
      })
      status = response.status
      if (!response.ok) {
        const body = redact(await response.text())
        return { ok: false, latencyMs: Math.round(performance.now() - started), status, message: body || `HTTP ${status}` }
      }
      return { ok: true, latencyMs: Math.round(performance.now() - started), status, message: '连接正常' }
    } catch (error) {
      return { ok: false, latencyMs: Math.round(performance.now() - started), status, message: redact(error) }
    }
  }

  async voiceReply(messages: VoiceMessage[], signal: AbortSignal, context = ''): Promise<string> {
    const metadata = await this.readMetadata()
    const active = metadata.providers.find((item) => item.id === metadata.activeId)
    if (!active) throw new Error('请先在设置中配置并启用模型。')
    const key = await this.readSecret(active.id)
    if (!key) throw new Error('当前模型尚未配置 API Key。')
    const response = await this.request(`${active.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: active.modelId, stream: false, max_tokens: active.maxOutputTokens,
        messages: [{ role: 'system', content: '你是 Singularity 的语音助手，和用户自然交谈。默认用中文简洁回答，通常不超过 200 字。避免 Markdown、表格、代码块和冗长列表，适合直接朗读。不要输出思考过程。你没有执行电脑操作的工具，不要声称执行了操作。' + (context || '你没有收到论文资料，不要声称读过没有提供的文件。') }, ...messages],
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    })
    if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}），请在设置中检查连接。`)
    const body = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> }
    const choice = body.choices?.[0]
    const content = choice?.message?.content?.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    if (!content) throw new Error(choice?.finish_reason === 'length' ? '模型输出预算已用尽，尚未返回可朗读的回答。' : '模型没有返回文字回答，请重试。')
    if (content.length > 6000) throw new Error('回答过长，请缩小问题范围后重试。')
    return content
  }

  async researchReply(system: string, prompt: string, image?: string, signal?: AbortSignal): Promise<string> {
    const metadata = await this.readMetadata()
    const active = metadata.providers.find((item) => item.id === metadata.activeId)
    if (!active) throw new Error('请先在设置中启用模型。')
    const key = await this.readSecret(active.id)
    if (!key) throw new Error('当前模型缺少 API Key。')
    const response = await this.request(`${active.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: active.modelId, stream: false, max_tokens: active.maxOutputTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: image ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] : prompt }] }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    })
    if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}）。${image ? '请确认当前模型支持图像输入，或关闭视觉分析后重试。' : '请检查模型配置后重试。'}`)
    const result = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> }
    const content = result.choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    if (!content || content.length > 30000) throw new Error('模型未返回有效结果，请重试。')
    return content
  }

  private async readSecret(id: string): Promise<string | undefined> {
    const encrypted = (await this.readSecrets())[id]
    if (!encrypted) return undefined
    const result = await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))
    return result.result || undefined
  }

  private async readMetadata(): Promise<ProviderFile> {
    return this.readJson<ProviderFile>(this.metadataPath, { activeId: null, providers: [] })
  }

  private async readSecrets(): Promise<SecretFile> {
    return this.readJson<SecretFile>(this.secretPath, {})
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
      throw error
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    const temporary = `${file}.${process.pid}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await fs.rename(temporary, file)
  }

  private providerSlug(id: string): string {
    return `singularity-${id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 24)}`
  }

  private envName(id: string): string {
    return `SINGULARITY_PROVIDER_${id.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_KEY`
  }

  /**
   * Model entries for the Harness profile patch (Harness 0.2+ no longer reads settings.yaml).
   * Secrets are referenced by environment variable only; see environment().
   */
  async harnessEntries(): Promise<HarnessPatchEntry[]> {
    const metadata = await this.readMetadata()
    const custom = metadata.providers.filter((provider) => provider.kind === 'openai-compatible')
    const active = metadata.providers.find((provider) => provider.id === metadata.activeId)
    const deepseek = metadata.providers.find((provider) => provider.kind === 'deepseek')
    const entries: HarnessPatchEntry[] = []
    if (deepseek) entries.push({ id: 'llm-deepseek', name: '@deepseek-ai/dsh-llm-deepseek-api-key', config: {
      baseURL: deepseek.baseUrl,
      maxTokens: deepseek.maxOutputTokens,
      models: [{ id: deepseek.modelId, name: deepseek.displayName, maxTokens: deepseek.maxOutputTokens }],
    } })
    entries.push({ id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: {
      providers: Object.fromEntries(custom.map((provider) => [this.providerSlug(provider.id), {
        displayName: provider.displayName,
        apiKeyEnv: this.envName(provider.id),
        api: 'openai-completions',
        baseURL: provider.baseUrl,
        models: [{ id: provider.modelId, name: provider.displayName, maxTokens: provider.maxOutputTokens }],
      }])),
    } })
    if (active) entries.push({ id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', config: {
      provider: active.kind === 'deepseek' ? 'deepseek-official' : this.providerSlug(active.id),
      model: active.modelId,
    } })
    return entries
  }
}

export interface HarnessPatchEntry {
  id: string
  name: string
  config: Record<string, unknown>
}
