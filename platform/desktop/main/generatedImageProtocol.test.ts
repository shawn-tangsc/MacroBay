import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (request: { url: string }) => Promise<Response>>()
  return {
    handlers,
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn((scheme: string, handler: (request: { url: string }) => Promise<Response>) => {
      handlers.set(scheme, handler)
    }),
    fetch: vi.fn(async (url: string) => new Response(`bytes-of:${url}`, { status: 200 }))
  }
})

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: electron.registerSchemesAsPrivileged,
    handle: electron.handle
  },
  net: { fetch: electron.fetch }
}))

import {
  registerGeneratedImageProtocol,
  registerGeneratedImageScheme
} from './generatedImageProtocol'

/**
 * T1：主进程 `app-image://` 协议。
 * 只接受 `app-image://generated-images/<hash>.<png|jpg|webp>`；其余一律 404 且**不读盘**，
 * 因此渲染层无法用它探测/读取任意文件。
 */
const directory = '/tmp/user-data/generated-images'

describe('generatedImageProtocol', () => {
  beforeEach(() => {
    electron.handlers.clear()
    electron.registerSchemesAsPrivileged.mockClear()
    electron.handle.mockClear()
    electron.fetch.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers app-image as a standard, secure scheme before windows exist', () => {
    registerGeneratedImageScheme()

    expect(electron.registerSchemesAsPrivileged).toHaveBeenCalledTimes(1)
    expect(electron.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: 'app-image',
        privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
      }
    ])
  })

  it('serves an existing generated image file from the images directory only', async () => {
    registerGeneratedImageProtocol(directory)
    const handler = electron.handlers.get('app-image')
    expect(handler).toBeTruthy()

    const response = await handler!({ url: 'app-image://generated-images/0123456789abcdef.png' })

    expect(response.status).toBe(200)
    expect(electron.fetch).toHaveBeenCalledWith(
      pathToFileURL(`${directory}/0123456789abcdef.png`).toString()
    )
  })

  it('answers 404 without touching the disk for anything else', async () => {
    registerGeneratedImageProtocol(directory)
    const handler = electron.handlers.get('app-image')!

    for (const url of [
      'app-image://evil/0123456789abcdef.png',
      'app-image://generated-images/../secrets.png',
      'app-image://generated-images/0123456789abcdef.svg',
      'file:///tmp/0123456789abcdef.png'
    ]) {
      const response = await handler({ url })
      expect(response.status).toBe(404)
    }
    expect(electron.fetch).not.toHaveBeenCalled()
  })
})
