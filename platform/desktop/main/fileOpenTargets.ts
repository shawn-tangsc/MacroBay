import { execFile } from 'node:child_process'
import { dirname, isAbsolute } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const fileOpenTargetIds = [
  'vscode',
  'cursor',
  'default',
  'terminal',
  'iterm2',
  'xcode',
  'android-studio',
  'intellij-idea',
  'pycharm',
  'finder'
] as const

export type FileOpenTargetId = (typeof fileOpenTargetIds)[number]

export type OpenFileWithTargetRequest = {
  targetId: FileOpenTargetId
  filePath: string
}

export type OpenFileWithTargetResult = {
  ok: true
  targetId: FileOpenTargetId
  filePath: string
  openedPath: string
}

type OpenFileWithTargetDependencies = {
  openExternal: (url: string) => Promise<void>
  openPath: (path: string) => Promise<string>
  showItemInFolder: (path: string) => void
  openWithSystemApp: (appName: string, targetPath: string) => Promise<void>
}

const EDITOR_PROTOCOLS: Partial<Record<FileOpenTargetId, string>> = {
  vscode: 'vscode://',
  cursor: 'cursor://'
}

const SYSTEM_APP_NAMES: Partial<Record<FileOpenTargetId, string>> = {
  terminal: 'Terminal',
  iterm2: 'iTerm',
  xcode: 'Xcode',
  'android-studio': 'Android Studio',
  'intellij-idea': 'IntelliJ IDEA',
  pycharm: 'PyCharm'
}

export function validateOpenFileWithTargetRequest(input: unknown): OpenFileWithTargetRequest {
  if (!input || typeof input !== 'object') {
    throw new Error('Open file request is required.')
  }

  const candidate = input as Partial<OpenFileWithTargetRequest>
  if (!isFileOpenTargetId(candidate.targetId)) {
    throw new Error('File open target id is not allow-listed.')
  }

  const filePath = typeof candidate.filePath === 'string' ? candidate.filePath.trim() : ''
  if (!filePath) {
    throw new Error('File path is required.')
  }
  if (!isAbsolute(filePath)) {
    throw new Error('File path must be absolute.')
  }

  return {
    targetId: candidate.targetId,
    filePath
  }
}

export function buildFileEditorUrl(targetId: Extract<FileOpenTargetId, 'vscode' | 'cursor'>, filePath: string): string {
  const protocol = EDITOR_PROTOCOLS[targetId]
  if (!protocol) throw new Error(`Unsupported editor target: ${targetId}`)
  if (!isAbsolute(filePath)) throw new Error('File path must be absolute.')
  const encodedPath = filePath.split(/[/\\]/).map(encodeURIComponent).join('/')
  return `${protocol}file/${encodedPath}?windowId=_blank`
}

export async function openFileWithTarget(
  input: OpenFileWithTargetRequest,
  deps: OpenFileWithTargetDependencies
): Promise<OpenFileWithTargetResult> {
  const request = validateOpenFileWithTargetRequest(input)

  if (request.targetId === 'default') {
    const error = await deps.openPath(request.filePath)
    if (error) throw new Error(error)
    return toResult(request, request.filePath)
  }

  if (request.targetId === 'finder') {
    deps.showItemInFolder(request.filePath)
    return toResult(request, request.filePath)
  }

  if (request.targetId === 'vscode' || request.targetId === 'cursor') {
    await deps.openExternal(buildFileEditorUrl(request.targetId, request.filePath))
    return toResult(request, request.filePath)
  }

  const appName = SYSTEM_APP_NAMES[request.targetId]
  if (!appName) throw new Error(`Unsupported file open target: ${request.targetId}`)
  const openedPath = request.targetId === 'terminal' || request.targetId === 'iterm2' ? dirname(request.filePath) : request.filePath
  await deps.openWithSystemApp(appName, openedPath)
  return toResult(request, openedPath)
}

export async function openWithSystemApp(appName: string, targetPath: string): Promise<void> {
  await execFileAsync('open', ['-a', appName, targetPath])
}

function toResult(request: OpenFileWithTargetRequest, openedPath: string): OpenFileWithTargetResult {
  return {
    ok: true,
    targetId: request.targetId,
    filePath: request.filePath,
    openedPath
  }
}

function isFileOpenTargetId(value: unknown): value is FileOpenTargetId {
  return typeof value === 'string' && (fileOpenTargetIds as readonly string[]).includes(value)
}
