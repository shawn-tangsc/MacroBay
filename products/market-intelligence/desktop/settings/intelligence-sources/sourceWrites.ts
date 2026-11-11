import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { notifySettingsRevision } from '../../shared/events/settingsRevision'
import { setSourceEnabled } from '../../shared/intelligenceSourceToggle'

/**
 * 「改一个源的启用状态」——**两个宿主共用这一条写路径**（设置页与看板抽屉）。
 *
 * 抽屉不能自己再写一份 `client.setEnabled`：日历源与通用源走的是不同命令，两处各判一次，
 * 迟早一处能改、一处报错。路由只在 `setSourceEnabled` 一处，这里负责另外两件所有宿主都必须做的事：
 * 发一次「来源域已变」的信号，让**另一个开着的界面**重读——带 `origin`，发出方自己忽略。
 * （旧的 `intelligenceSourcesChanged` 广播已删：它最后一个订阅方 `useCryptoActivation`
 * 早改订阅这条域信号，旧事件 0 订阅方。）
 *
 * 写得成不成功由调用方决定怎么显示；这个函数不吞错，也不自己重读（各宿主读的是自己的读命令）。
 */
export async function writeSourceEnabled(
  source: Readonly<{ sourceId: string; kind: string }>,
  enabled: boolean,
  origin: string
): Promise<void> {
  await setSourceEnabled(source, enabled)
  notifySettingsRevision('sources', origin)
}

/** 每个界面实例一个 origin；同一次保存不会引来自己那一轮重读。 */
export function createSettingsOrigin(scope: string): string {
  return `${scope}-${Math.random().toString(36).slice(2)}`
}

/**
 * 抽屉里另外两个动作。它们**不发域信号**（不改配置事实），但同样不许让页面自己出现
 * `intelligenceSourcesClient`——`pages/intelligence/**` 有一条守卫禁止在页面里出现 IPC 名，
 * 所以入口放在这里，页面只调函数。
 */
export async function runSourceNowOnce(sourceId: string): Promise<void> {
  await intelligenceSourcesClient.runNow(sourceId)
}

export async function testSourceConnectionOnce(sourceId: string): Promise<void> {
  await intelligenceSourcesClient.testConnection(sourceId)
}
