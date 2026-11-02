import { isAllowedUpdateLinkUrl, isUpdateLinkId, updateLinkUrl } from '../updateSource'

/**
 * 关于页 / 更新块「去某一个地方」的主进程一侧。
 *
 * 三条都是定死的，写在这里而不是散在 IPC 处理器里：
 * - **只收封闭的 id**（五个字面量），不收地址——渲染层连网址字符串都没有；
 * - **地址由常量拼出**，再用两层校验核一遍（主机 + 仓库路径段、id 与地址严格相等）；
 * - **失败回 `{ ok: false }`，不 throw**：界面靠结果判断有没有打开，不靠异常。
 *
 * 边界如实记下（技术方案 §12.1）：Windows 上没有默认浏览器时，系统可能弹「选择应用」框而
 * 调用**正常返回**。那种情况我们拿不到信号，也就不补一句——只保证「调用失败一定说」。
 */

export type UpdateLinkLog = (level: 'info' | 'warn', event: string, fields?: Record<string, unknown>) => void

export type OpenUpdateLinkPorts = Readonly<{
  openExternal: (url: string) => Promise<void>
  log: UpdateLinkLog
}>

export type OpenUpdateLinkResult = { ok: boolean }

export async function openUpdateLink(destination: unknown, ports: OpenUpdateLinkPorts): Promise<OpenUpdateLinkResult> {
  if (!isUpdateLinkId(destination)) {
    // 运行期塞对象（例如 `{ url }`）走到这里：拒掉，并且**一次 `openExternal` 都不调**。
    ports.log('warn', 'update.open-link.rejected', { reason: 'unknown-destination' })
    return { ok: false }
  }

  const url = updateLinkUrl(destination)
  if (!isAllowedUpdateLinkUrl(destination, url)) {
    ports.log('warn', 'update.open-link.rejected', { reason: 'not-allowed', destination })
    return { ok: false }
  }

  try {
    await ports.openExternal(url)
    return { ok: true }
  } catch (error) {
    ports.log('warn', 'update.open-link.failed', {
      destination,
      message: error instanceof Error ? error.message : String(error)
    })
    return { ok: false }
  }
}
