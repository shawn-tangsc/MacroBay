import type { TestNoticeCandidatePort } from '../contracts/notificationSelfTest'

/**
 * 自测取数端口的**一次性注册槽**（技术方案 §3 的桥）。
 *
 * 为什么要有它：端口只能由产品侧构造（三套句柄都在 `products/.../bootstrap.ts`），而通知运行时在
 * 平台的组合根里被创建、看不到产品模块对象；两边之间**没有共同作用域**。把句柄一路穿到 `app.ts`
 * 等于在最深处开一条通道，所以改成：**产品在启动期主动注册一次，平台只读不写**。
 *
 * 三条硬规矩：
 * 1. **只能注册一次**：第二个产品来注册就是设计错了（哪个产品的数据该进这个按钮说不清），
 *    **报错，不静默覆盖**——静默覆盖会变成「谁后启动谁生效」这种查不出的行为；
 * 2. **只在启动期调用**，不是服务定位器：没有「哪里都能 get」的入口，只有读；
 * 3. **没注册＝没接**：读出来是 `undefined`，调用方回 `read-failed`（界面「暂时读不到」），
 *    与今晚之前的行为一致，不会因为引入这个槽位而假装成功。
 */
let slot: TestNoticeCandidatePort | null = null

export function registerTestNoticeCandidates(port: TestNoticeCandidatePort): void {
  if (slot !== null) throw new Error('notification-test-candidates-already-registered')
  slot = port
}

/** 点按钮那一刻才读：注册可能晚于运行时创建，早读会拿到空。 */
export function readTestNoticeCandidates(): TestNoticeCandidatePort | undefined {
  return slot ?? undefined
}

export function resetTestNoticeCandidatesForTests(): void {
  slot = null
}
