const DEFAULT_MAX_BYTES = 20 * 1024 * 1024

export type DownloadedBase64 = {
  data: string
  mimeType: string
  size: number
}

export async function downloadUrlAsBase64(
  url: string,
  options: {
    fetchImpl?: typeof fetch
    headers?: Record<string, string>
    maxBytes?: number
    fallbackMimeType?: string
  } = {}
): Promise<DownloadedBase64 | null> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  try {
    const response = await fetchImpl(url, {
      headers: options.headers
    })
    if (!response.ok) return null

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) return null

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) return null

    const contentType = response.headers.get('content-type') || options.fallbackMimeType || 'application/octet-stream'
    return {
      data: buffer.toString('base64'),
      mimeType: contentType.split(';')[0]?.trim() || 'application/octet-stream',
      size: buffer.length
    }
  } catch {
    return null
  }
}

export const MAX_CHANNEL_ATTACHMENT_BYTES = DEFAULT_MAX_BYTES
