import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ImageService, type ImageCredentialStore } from '../src/main/image-service'

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(96, 7)])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(96, 9)])
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

let config: string
let cache: string
let store: ImageCredentialStore & { saveMiniMaxCredential: ReturnType<typeof vi.fn> }

function makeStore(): typeof store {
  let origin = 'https://api.minimax.cn'
  return {
    settings: vi.fn(async () => ({ hasMiniMaxCredential: true, minimaxBaseUrl: origin })),
    credential: vi.fn(async () => 'sk-minimax-test'),
    saveMiniMaxCredential: vi.fn(async (value: { minimaxBaseUrl?: string }) => {
      if (value.minimaxBaseUrl) origin = value.minimaxBaseUrl
      return {}
    }),
  } as unknown as typeof store
}

const input = {
  prompt: '深色背景下的发光水母',
  model: 'MiniMax-H3-Image' as const,
  aspectRatio: '16:9',
  area: '2K' as const,
  count: 1,
  format: 'jpeg' as const,
}

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'singularity-image-'))
  config = path.join(root, 'config')
  cache = path.join(root, 'cache')
  await fs.mkdir(config, { recursive: true })
  await fs.mkdir(cache, { recursive: true })
  store = makeStore()
})
afterEach(async () => {
  await fs.rm(path.dirname(config), { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('ImageService settings', () => {
  it('starts with local defaults and never exposes the key', async () => {
    const service = new ImageService(config, cache, store)
    const value = await service.settings()
    expect(value).toMatchObject({ hasMiniMaxCredential: true, minimaxBaseUrl: 'https://api.minimax.cn', model: 'MiniMax-H3-Image', area: '2K', aspectRatio: '1:1', count: 1, format: 'jpeg' })
    expect(JSON.stringify(value)).not.toContain('sk-minimax')
  })

  it('shares one MiniMax key with voice settings and persists defaults', async () => {
    const service = new ImageService(config, cache, store)
    await service.saveSettings({ minimaxKey: 'sk-shared', minimaxBaseUrl: 'https://api.minimax.io', area: '4K', count: 2, format: 'png' })
    expect(store.saveMiniMaxCredential).toHaveBeenCalledWith({ minimaxKey: 'sk-shared', minimaxBaseUrl: 'https://api.minimax.io' })
    const saved = JSON.parse(await fs.readFile(path.join(config, 'image-settings.json'), 'utf8'))
    expect(saved).toMatchObject({ area: '4K', count: 2, format: 'png' })
    expect(JSON.stringify(saved)).not.toContain('sk-shared')
    expect((await service.settings()).minimaxBaseUrl).toBe('https://api.minimax.io')
  })

  it('rejects an unsupported service region', async () => {
    const service = new ImageService(config, cache, store)
    await expect(service.saveSettings({ minimaxBaseUrl: 'https://evil.example' })).rejects.toThrow()
  })
})

describe('ImageService.generate', () => {
  it('posts the documented payload, downloads the image and records it locally', async () => {
    const request = vi.fn<typeof fetch>()
    request.mockImplementation(async (url, init) => {
      if (String(url).includes('/v1/images/generations')) {
        expect(init?.method).toBe('POST')
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-minimax-test')
        expect(JSON.parse(String(init?.body))).toEqual({
          model: 'MiniMax-H3-Image', prompt: input.prompt, aspect_ratio: '16:9', area: '2K',
          n: 1, output_format: 'jpeg', response_format: 'url',
        })
        return json({ data: [{ url: 'https://cdn.minimax.io/output-0.jpg', size: '2720x1536', revised_prompt: 'enhanced prompt' }], output_format: 'jpeg', usage: { generated_images: 1 } })
      }
      return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } })
    })
    const service = new ImageService(config, cache, store, request)
    const result = await service.generateTask('task-1', input)
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0][0]).toBe('https://api.minimax.cn/v1/images/generations')
    expect(result.images[0]).toMatch(/^data:image\/jpeg;base64,/)
    expect(result.assets[0]).toMatchObject({ prompt: input.prompt, revisedPrompt: 'enhanced prompt', size: '2720x1536', file: expect.stringMatching(/\.jpg$/) })
    expect(result.failures).toEqual([])
    const history = JSON.parse(await fs.readFile(path.join(config, 'image-history.json'), 'utf8'))
    expect(history.items).toHaveLength(1)
    expect(await fs.readFile(path.join(cache, 'image-gen', result.assets[0].file))).toHaveLength(JPEG.length)
  })

  it('uses the international origin when configured', async () => {
    const international = makeStore()
    international.settings = vi.fn(async () => ({ hasMiniMaxCredential: true, minimaxBaseUrl: 'https://api.minimax.io' }))
    const request = vi.fn<typeof fetch>()
    request.mockResolvedValueOnce(json({ data: [{ b64_json: PNG.toString('base64') }] }))
    const service = new ImageService(config, cache, international, request)
    const result = await service.generateTask('task-2', { ...input, format: 'png' })
    expect(request.mock.calls[0][0]).toBe('https://api.minimax.io/v1/images/generations')
    expect(result.images[0]).toMatch(/^data:image\/png;base64,/)
  })

  it('reports per-image failures without charging a retry', async () => {
    const request = vi.fn<typeof fetch>()
    request.mockImplementation(async url => String(url).includes('generations')
      ? json({ data: [{ b64_json: JPEG.toString('base64') }, { error: { code: '1027', message: 'content safety check' } }] })
      : new Response(JPEG))
    const service = new ImageService(config, cache, store, request)
    const result = await service.generateTask('task-3', { ...input, count: 2 })
    expect(result.assets).toHaveLength(1)
    expect(result.failures).toEqual(['content safety check'])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('maps HTTP failures to readable messages and makes no retry', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ base_resp: { status_code: 1002, status_msg: 'insufficient balance' } }, 402))
    const service = new ImageService(config, cache, store, request)
    await expect(service.generateTask('task-4', input)).rejects.toThrow(/余额不足.*insufficient balance/)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('refuses to call the API without a saved key', async () => {
    const empty = makeStore()
    empty.settings = vi.fn(async () => ({ hasMiniMaxCredential: false, minimaxBaseUrl: 'https://api.minimax.cn' }))
    const request = vi.fn<typeof fetch>()
    const service = new ImageService(config, cache, empty, request)
    await expect(service.generateTask('task-5', input)).rejects.toThrow(/请先.*MiniMax API Key/)
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a private-network image URL and an unknown binary format', async () => {
    const service = new ImageService(config, cache, store, vi.fn<typeof fetch>().mockResolvedValue(json({ data: [{ url: 'https://127.0.0.1/secret.png' }] })))
    await expect(service.generateTask('task-6', input)).rejects.toThrow(/本次没有生成可用图片/)
    const broken = new ImageService(config, cache, store, vi.fn<typeof fetch>().mockResolvedValue(json({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] })))
    await expect(broken.generateTask('task-7', input)).rejects.toThrow(/本次没有生成可用图片/)
  })

  it('validates gallery ids before touching the filesystem', async () => {
    const service = new ImageService(config, cache, store, vi.fn<typeof fetch>())
    await expect(service.assetPath('../voice-settings.json')).rejects.toThrow(/图片编号无效/)
    await expect(service.remove('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/找不到/)
  })
})
