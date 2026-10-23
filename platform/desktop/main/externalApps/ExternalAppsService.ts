import {
  EXTERNAL_APPS,
  toExternalAppView,
  type ExternalAppId,
  type ExternalAppInfo,
  type ExternalAppView
} from './externalAppRegistry'
import {
  launchExternalAppWorkspace,
  type LaunchExternalAppRequest,
  type LaunchExternalAppResult,
  type OpenExternalUrl
} from './externalAppLauncher'

export type ProtocolApplicationInfo = {
  name?: string
  path?: string
}

export type ExternalAppsServiceDependencies = {
  getApplicationInfoForProtocol: (protocol: string) => Promise<ProtocolApplicationInfo>
  openExternal: OpenExternalUrl
  now?: () => number
  cacheDurationMs?: number
}

const DEFAULT_CACHE_DURATION_MS = 5 * 60 * 1000

export class ExternalAppsService {
  private cache: { apps: ExternalAppInfo[]; timestamp: number } | null = null
  private readonly cacheDurationMs: number
  private readonly now: () => number

  constructor(private readonly deps: ExternalAppsServiceDependencies) {
    this.cacheDurationMs = deps.cacheDurationMs ?? DEFAULT_CACHE_DURATION_MS
    this.now = deps.now ?? Date.now
  }

  async detectInstalledApps(): Promise<ExternalAppInfo[]> {
    if (this.cache && this.now() - this.cache.timestamp < this.cacheDurationMs) {
      return this.cache.apps
    }

    const results = (
      await Promise.all(
        EXTERNAL_APPS.map(async (appConfig): Promise<ExternalAppInfo | null> => {
          try {
            const info = await this.deps.getApplicationInfoForProtocol(appConfig.protocol)
            const path = typeof info.path === 'string' ? info.path.trim() : ''
            const name = typeof info.name === 'string' ? info.name.trim() : ''
            if (!path && !name) return null
            return {
              id: appConfig.id,
              name: appConfig.name,
              protocol: appConfig.protocol,
              tags: appConfig.tags,
              path: path || name
            }
          } catch {
            return null
          }
        })
      )
    ).flatMap((result) => (result ? [result] : []))

    this.cache = { apps: results, timestamp: this.now() }
    return results
  }

  async listInstalledAppViews(): Promise<ExternalAppView[]> {
    const installed = await this.detectInstalledApps()
    return installed.map(toExternalAppView)
  }

  async findInstalledApp(appId: ExternalAppId): Promise<ExternalAppInfo | null> {
    const installed = await this.detectInstalledApps()
    return installed.find((app) => app.id === appId) ?? null
  }

  clearCache(): void {
    this.cache = null
  }

  async launchWorkspace(input: LaunchExternalAppRequest): Promise<LaunchExternalAppResult> {
    return launchExternalAppWorkspace(input, {
      openExternal: this.deps.openExternal,
      resolveInstalledApp: (appId) => this.findInstalledApp(appId)
    })
  }
}
