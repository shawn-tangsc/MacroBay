export const externalAppIds = ['vscode', 'cursor', 'zed'] as const

export type ExternalAppId = (typeof externalAppIds)[number]
export type ExternalAppTag = 'code-editor'

export type ExternalAppConfig = {
  id: ExternalAppId
  name: string
  protocol: string
  tags: readonly ExternalAppTag[]
}

export type ExternalAppInfo = ExternalAppConfig & {
  path: string
}

export type ExternalAppView = {
  id: ExternalAppId
  name: string
  protocol: string
  tags: readonly ExternalAppTag[]
  installed: boolean
  path?: string
}

export const EXTERNAL_APPS = [
  { id: 'vscode', name: 'Visual Studio Code', protocol: 'vscode://', tags: ['code-editor'] },
  { id: 'cursor', name: 'Cursor', protocol: 'cursor://', tags: ['code-editor'] },
  { id: 'zed', name: 'Zed', protocol: 'zed://', tags: ['code-editor'] }
] as const satisfies readonly ExternalAppConfig[]

export function isExternalAppId(value: unknown): value is ExternalAppId {
  return typeof value === 'string' && (externalAppIds as readonly string[]).includes(value)
}

export function getExternalAppConfig(appId: ExternalAppId): ExternalAppConfig {
  const config = EXTERNAL_APPS.find((app) => app.id === appId)
  if (!config) throw new Error(`Unknown external app id: ${appId}`)
  return config
}

export function toExternalAppView(app: ExternalAppInfo): ExternalAppView {
  return {
    id: app.id,
    name: app.name,
    protocol: app.protocol,
    tags: app.tags,
    installed: true,
    path: app.path
  }
}
