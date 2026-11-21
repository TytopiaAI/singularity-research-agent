import type { SingularityApi } from './types'

declare global {
  interface Window {
    singularity: SingularityApi
  }
}

export {}
