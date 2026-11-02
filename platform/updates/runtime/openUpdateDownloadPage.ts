import { updateDownloadAllowedHosts, updateDownloadPageUrl } from '../updateSource'

/**
 * 「打开下载页」的主进程一侧：地址由常量拼出、协议与域名在这里校验、失败只回结果不抛异常。
 *
 * 三条都是需求里定死的，写在这里而不是散在 IPC 处理器里：
 * - **不接受入参地址**：渲染层只发「打开」这个动作。地址若能传，界面就等于能决定打开哪个页面。
 * - **只放行 https + 白名单域名**：判据来自 `updateSource` 那一份，不在调用点各写一遍。
 * - **失败回 `{ ok: false }`，不 throw**：界面要能知道「没打开」，而抛异常会变成渲染层猜。
 *
 * 还有一个如实记下的边界（见技术方案 §12.1）：Windows 上没有默认浏览器时，系统可能弹出
 * 「选择应用」框而调用**正常返回**。那种情况我们拿不到信号，也就不补一句——只保证「调用失败一定说」。
 */

export type UpdateDownloadLog = (level: 'info' | 'warn', event: string, fields?: Record<string, unknown>) => void

export type OpenUpdateDownloadPagePorts = Readonly<{
  openExternal: (url: string) => Promise<void>
  log: UpdateDownloadLog
}>

export type OpenUpdateDownloadPageResult = { ok: boolean }

export function isAllowedUpdateDownloadUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && (updateDownloadAllowedHosts as readonly string[]).includes(parsed.host)
}

export async function openUpdateDownloadPage(
  ports: OpenUpdateDownloadPagePorts
): Promise<OpenUpdateDownloadPageResult> {
  const url = updateDownloadPageUrl()
  if (!isAllowedUpdateDownloadUrl(url)) {
    // 常量本身不合格属于代码错误，不许交给系统打开，也不许静默——记一条 warn 就够了，界面只看到失败。
    ports.log('warn', 'update.open-download.rejected', { reason: 'not-allowed' })
    return { ok: false }
  }

  try {
    await ports.openExternal(url)
    return { ok: true }
  } catch (error) {
    ports.log('warn', 'update.open-download.failed', {
      message: error instanceof Error ? error.message : String(error)
    })
    return { ok: false }
  }
}
