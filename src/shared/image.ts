/** MiniMax H3-Image generation contract. Images are billed per successful output. */
export type ImageModel = 'MiniMax-H3-Image' | 'MiniMax-H3-Image-Highspeed'
export type ImageArea = '1K' | '2K' | '4K'
export type ImageFormat = 'jpeg' | 'png' | 'webp'

export interface ImageGenerateInput {
  prompt: string
  model: ImageModel
  aspectRatio: string
  area: ImageArea
  count: number
  format: ImageFormat
}

export interface ImageAsset {
  id: string
  prompt: string
  revisedPrompt: string
  model: ImageModel
  aspectRatio: string
  area: ImageArea
  format: ImageFormat
  /** Width x height as reported by the model. */
  size: string
  bytes: number
  createdAt: string
  /** Basename inside <data>/cache/image-gen. */
  file: string
}

export interface ImageGenerateResult {
  assets: ImageAsset[]
  /** data:image/... URLs, one per successful image. */
  images: string[]
  /** Per-image failures when the API reports a partial success. */
  failures: string[]
}

export interface ImageSettings {
  hasMiniMaxCredential: boolean
  minimaxBaseUrl: string
  model: ImageModel
  aspectRatio: string
  area: ImageArea
  count: number
  format: ImageFormat
}

export interface ImageSettingsInput {
  minimaxKey?: string
  minimaxBaseUrl?: string
  model?: ImageModel
  aspectRatio?: string
  area?: ImageArea
  count?: number
  format?: ImageFormat
}

export const IMAGE_MODELS: Array<{ value: ImageModel; label: string }> = [
  { value: 'MiniMax-H3-Image', label: 'H3-Image · 标准' },
  { value: 'MiniMax-H3-Image-Highspeed', label: 'H3-Image · 极速' },
]

export const IMAGE_AREAS: Array<{ value: ImageArea; label: string }> = [
  { value: '1K', label: '1K · 1024²' },
  { value: '2K', label: '2K · 2048²' },
  { value: '4K', label: '4K · 4096²' },
]

export const IMAGE_ASPECT_RATIOS = ['auto', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'] as const

export const IMAGE_FORMATS: Array<{ value: ImageFormat; label: string }> = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WEBP' },
]

export const IMAGE_DEFAULTS = {
  model: 'MiniMax-H3-Image' as ImageModel,
  aspectRatio: '1:1',
  area: '2K' as ImageArea,
  count: 1,
  format: 'jpeg' as ImageFormat,
}
