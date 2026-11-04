import { useEffect, useState } from 'react'

/**
 * 读者是否已经把「自定义代理」配好。
 *
 * `MI-11-R196`：情报来源页原来只要供应商里有一个 `requiresProxy` 的来源，就断言「这个来源需要
 * 连接 VPN」——读者填好了代理、那条提示还挂着，等于让他去配一个已经配好的东西。
 *
 * 判据只有一条、且是**能读到的事实**：`proxyMode === 'custom'` 且地址非空。**不判「测通了没」**——
 * 仓库里没有代理连通性的持久化状态，造一个「测过才算配好」只会让读者刚保存完继续看到提示，
 * 那正是这次要修的病。填错地址由探测失败那条路径兜（见 `NetworkProxyBanner` 的 failed 档）。
 *
 * 读不到设置按「没配」处理：宁可多显示一条要求，也不假装配好了。
 */
export function readProxyConfigured(settings: unknown): boolean {
  if (typeof settings !== 'object' || settings === null) return false
  if (!('network' in settings)) return false
  const network = settings.network
  if (typeof network !== 'object' || network === null) return false
  if (!('proxyMode' in network) || !('proxyUrl' in network)) return false
  if (network.proxyMode !== 'custom' || typeof network.proxyUrl !== 'string') return false
  return isParsableProxyUrl(network.proxyUrl)
}

/**
 * 「配好」不只是填了字：地址要能解析、要带主机名。只写了个 `127.0.0.1` 或乱输入不算配好——
 * 否则提示会被一段无效配置骗走，又变成撒谎。
 */
export function isParsableProxyUrl(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return false
  try {
    return new URL(trimmed).hostname !== ''
  } catch {
    return false
  }
}

export function useProxyConfigured(): boolean {
  const [configured, setConfigured] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const settings = (await window.platform?.settings?.get()) as unknown
        if (active) setConfigured(readProxyConfigured(settings))
      } catch {
        // 设置读不到：保持「没配」，提示继续显示——它只是少一条帮助，不会误导读者。
      }
    })()
    return () => {
      active = false
    }
  }, [])

  return configured
}
