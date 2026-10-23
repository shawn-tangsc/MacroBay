/**
 * T1：生成图片的「引用」契约（渲染层与主进程共用，纯函数、无 node 依赖）。
 *
 * 消息与 IPC 只传 `{ kind: 'image', mime, fileName, byteLength }`，不传 base64；
 * 渲染层用 `buildGeneratedImageUrl()` 拼 `app-image://` 地址，主进程注册同名协议从
 * `userData/generated-images/` 读盘。文件名是内容 hash，因此这里只认 hash 形状的
 * 文件名——任何路径穿越 / 任意扩展名都会在拼 URL 与解析 URL 两处被拒绝。
 */
export const generatedImageUrlScheme = 'app-image'
export const generatedImageUrlHost = 'generated-images'
export const generatedImageFileNamePattern = /^[a-f0-9]{16}\.(?:png|jpg|webp)$/

export const generatedImageMimeByExtension = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp'
} as const

export type GeneratedImageExtension = keyof typeof generatedImageMimeByExtension

export function isGeneratedImageFileName(value: unknown): value is string {
  return typeof value === 'string' && generatedImageFileNamePattern.test(value)
}

export function generatedImageExtension(fileName: string): GeneratedImageExtension | null {
  if (!isGeneratedImageFileName(fileName)) return null
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1)
  return extension in generatedImageMimeByExtension ? (extension as GeneratedImageExtension) : null
}

export function generatedImageMimeType(fileName: string): string | null {
  const extension = generatedImageExtension(fileName)
  return extension === null ? null : generatedImageMimeByExtension[extension]
}

export function buildGeneratedImageUrl(fileName: string): string | null {
  if (!isGeneratedImageFileName(fileName)) return null
  return `${generatedImageUrlScheme}://${generatedImageUrlHost}/${fileName}`
}

export function parseGeneratedImageUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${generatedImageUrlScheme}:`) return null
  if (parsed.hostname !== generatedImageUrlHost) return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length !== 1) return null
  return isGeneratedImageFileName(segments[0]) ? segments[0] : null
}
