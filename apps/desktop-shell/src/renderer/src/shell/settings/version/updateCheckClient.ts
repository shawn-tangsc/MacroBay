import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'
import type { UpdateLinkId } from '@platform/updates/updateSource'

/**
 * 「版本」那一行需要的三个动作，**从外面传进来**。
 *
 * 组件只认这个接口，不认 `window.platform`：这样渲染测试可以塞一个假客户端，把「查到了 / 查不到 /
 * 打不开浏览器」这些路径全跑一遍，不需要真的 Electron。真正读桥的那一份只有下面这一个常量，
 * 桥没落之前，整个功能只有这一处编译不过——别处都不会被拖红。
 */
export type UpdateCheckClient = Readonly<{
  getState: () => Promise<UpdateCheckProjection>
  checkNow: () => Promise<UpdateCheckProjection>
  /** 打开五个目的地之一；主进程回 `{ ok: false }` 表示没交给系统打开。**不 throw** 是契约的一部分。 */
  openUpdateLink: (destination: UpdateLinkId) => Promise<{ ok: boolean }>
  /** 订阅「结论变了」，返回退订函数。壳层只订阅，不轮询、不自己比版本号。 */
  onChanged: (callback: (projection: UpdateCheckProjection) => void) => () => void
}>

/**
 * 生产实现：唯一一处直接读 `window.platform.updates`。
 *
 * 桥不在时**返回 rejected promise，而不是同步抛**：读不到投影的那条路已经有处理（停在「还没检查」），
 * 但同步抛会从 effect 里冒出去、把整个设置页炸掉——「应用可能没重启」这种常见情况不该白屏。
 */
export const platformUpdateCheckClient: UpdateCheckClient = {
  getState: async () => requireBridge().getState(),
  checkNow: async () => requireBridge().checkNow(),
  openUpdateLink: async (destination) => requireBridge().openUpdateLink(destination),
  onChanged: (callback) => {
    // 订阅失败不能把壳层炸掉（应用没重启时桥不在）：拿不到桥就返回一个空退订，小点保持不亮。
    try {
      return requireBridge().onChanged(callback)
    } catch {
      return () => undefined
    }
  }
}

type UpdateCheckBridge = {
  getState: () => Promise<UpdateCheckProjection>
  checkNow: () => Promise<UpdateCheckProjection>
  openUpdateLink: (destination: UpdateLinkId) => Promise<{ ok: boolean }>
  onChanged: (callback: (projection: UpdateCheckProjection) => void) => () => void
}

function requireBridge(): UpdateCheckBridge {
  // `window.platform` 本身可能整个不在（应用没重启、或测试只桩了一半）：这里必须用可选链，
  // 否则抛的是 TypeError「Cannot read properties of undefined」，比一句说清原因的话难排查得多。
  const bridge = (window.platform as { updates?: UpdateCheckBridge } | undefined)?.updates
  if (!bridge) throw new Error('update check bridge is not available; the app may need a restart')
  return bridge
}
