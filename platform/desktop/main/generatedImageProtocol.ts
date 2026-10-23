import { net, protocol } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { generatedImageUrlScheme, parseGeneratedImageUrl } from '../../ui/images/generatedImageUrl'

/**
 * T1：`app-image://generated-images/<hash>.<ext>` 只读协议。
 *
 * 为什么用协议而不是 IPC 读图：消息只存文件名，渲染层 `<img src>` 直接指向协议地址，
 * 不需要为了显示每张图再走一次 IPC / 不把文件内容搬进渲染进程内存，重启后地址仍然有效；
 * 主进程在这里做唯一的路径闸门（`parseGeneratedImageUrl` 只放行 hash 文件名），
 * 因此渲染层拿不到任意路径读取能力。
 *
 * `registerGeneratedImageScheme()` 必须在 app ready **之前**调用；
 * `registerGeneratedImageProtocol()` 必须在 ready 之后调用。
 */
export function registerGeneratedImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: generatedImageUrlScheme,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

export function registerGeneratedImageProtocol(directory: string): void {
  protocol.handle(generatedImageUrlScheme, async (request) => {
    const fileName = parseGeneratedImageUrl(request.url)
    if (!fileName) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(join(directory, fileName)).toString())
  })
}
