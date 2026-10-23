import type { PlatformApi } from '@platform/desktop/preload'

declare global {
  interface Window {
    platform: PlatformApi
  }
}

export {}
