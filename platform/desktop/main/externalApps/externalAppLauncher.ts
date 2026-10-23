import { isAbsolute } from 'node:path'

import {
  getExternalAppConfig,
  isExternalAppId,
  type ExternalAppId,
  type ExternalAppInfo
} from './externalAppRegistry'

export type LaunchExternalAppRequest = {
  appId: ExternalAppId
  workspacePath: string
}

export type LaunchExternalAppResult = {
  ok: true
  url: string
  appId: ExternalAppId
}

export type OpenExternalUrl = (url: string) => Promise<void>

export function buildExternalAppWorkspaceUrl(app: Pick<ExternalAppInfo, 'id' | 'protocol'>, workspacePath: string): string {
  if (!isAbsolute(workspacePath)) {
    throw new Error('External app workspace path must be absolute.')
  }

  const encodedPath = workspacePath.split(/[/\\]/).map(encodeURIComponent).join('/')
  if (app.id === 'zed') {
    // Zed strips the "zed://file" prefix, so keep a single slash after "file".
    return `${app.protocol}file${encodedPath}`
  }
  return `${app.protocol}file/${encodedPath}?windowId=_blank`
}

export function validateLaunchExternalAppRequest(input: unknown): LaunchExternalAppRequest {
  if (!input || typeof input !== 'object') {
    throw new Error('External app launch request is required.')
  }

  const candidate = input as Partial<LaunchExternalAppRequest>
  if (!isExternalAppId(candidate.appId)) {
    throw new Error('External app id is not allow-listed.')
  }

  const workspacePath = typeof candidate.workspacePath === 'string' ? candidate.workspacePath.trim() : ''
  if (!workspacePath) {
    throw new Error('External app workspace path is required.')
  }
  if (!isAbsolute(workspacePath)) {
    throw new Error('External app workspace path must be absolute.')
  }

  return {
    appId: candidate.appId,
    workspacePath
  }
}

export async function launchExternalAppWorkspace(
  input: LaunchExternalAppRequest,
  deps: {
    openExternal: OpenExternalUrl
    resolveInstalledApp: (appId: ExternalAppId) => Promise<ExternalAppInfo | null>
  }
): Promise<LaunchExternalAppResult> {
  const request = validateLaunchExternalAppRequest(input)
  const installed = await deps.resolveInstalledApp(request.appId)
  if (!installed) {
    throw new Error(`External app is not installed: ${request.appId}`)
  }

  const config = getExternalAppConfig(request.appId)
  const url = buildExternalAppWorkspaceUrl(
    { id: config.id, protocol: config.protocol },
    request.workspacePath
  )
  await deps.openExternal(url)
  return {
    ok: true,
    url,
    appId: request.appId
  }
}
