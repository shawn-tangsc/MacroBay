import { describe, expect, it, vi } from 'vitest'

import { TelegramApiClient } from './TelegramApiClient'

/**
 * 附件下载（0.4.5）：两步都走**注入的平台网络层**——`getFile` 拿路径，再按 `/file/bot<token>/<path>` 取字节。
 *
 * 这条用例守的是「不许在适配器里直连」：`getPlatformFetch` 是唯一出口，测试里把它换成假的就能看见
 * 两次调用；真直连的写法在这里会直接失败（没有 `fetch` 可打桩）。
 */
function clientWith(fetchImpl: typeof fetch) {
  return new TelegramApiClient({ getPlatformFetch: () => fetchImpl, token: async () => 'bot-token' })
}

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

describe('TelegramApiClient.downloadFile', () => {
  it('asks getFile for the path, then downloads through the same platform fetch', async () => {
    const calls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/getFile')) return jsonResponse({ ok: true, result: { file_path: 'photos/file-1.png' } })
      if (url.endsWith('/file/botbot-token/photos/file-1.png')) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      }
      return jsonResponse({ ok: false, description: 'unexpected' }, 500)
    }) as typeof fetch

    const result = await clientWith(fetchImpl).downloadFile('file-abc')
    expect(result).toMatchObject({ ok: true })
    expect(result.ok && Array.from(result.value)).toEqual([1, 2, 3])
    // 两步都在平台网络层：先是 getFile，再是文件本体（同一次注入的 fetch）。
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('/file/botbot-token/photos/file-1.png')
  })

  it('refuses a getFile reply without a usable path, and never requests the file', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, result: { file_path: '../etc/passwd' } })) as unknown as typeof fetch
    await expect(clientWith(fetchImpl).downloadFile('file-abc')).resolves.toMatchObject({ ok: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('maps a failed file request to a failure code instead of returning empty bytes', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/getFile')) return jsonResponse({ ok: true, result: { file_path: 'photos/file-1.png' } })
      return new Response('', { status: 429 })
    }) as typeof fetch
    await expect(clientWith(fetchImpl).downloadFile('file-abc')).resolves.toMatchObject({ ok: false, code: 'telegram-rate-limited' })
  })
})