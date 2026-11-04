/**
 * P8「频道连不上」（契约 §4.1 第 16 行）：**自动重连失败之后提交一次**，重试过程一次都不提交。
 *
 * 为什么单独一条而不是复用 P6a「推送到手机已暂停」：P6a 讲的是**发不出去**（连续三次投递失败才发），
 * 这里讲的是**收不进来**——断线时手机上一条新消息都没有，界面却一切正常，读者无从知道。
 *
 * 三条产品判据（需求 v2.17 §11）落在这里：
 *  1. 键 `channel-lost:{channelId}:{disconnectedAt}`：同一次断开只留一条，重试不刷屏；
 *  2. 正文必须带**频道名 + 原因两档**（`network` / `proxy`），不许只写「连接失败」——
 *     那等于没说，读者不知道该去查网络还是查代理；
 *  3. **不含手机**（批准表只给 center/toast/desktop）：本机状态不该再推到手机。
 *
 * 判定（断多久才算断线：满 30 秒，不按失败次数）在频道线 `channelConnectionOutage.ts`，这里只负责
 * 把一份已经成立的「这次断开了」翻成一条提交请求——两件事分开，判定才测得动。
 */
import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '../contracts/notificationContracts'

const CHANNEL_CONNECTION_LOST_EVENT_ID = 'platform.channel.connection-lost'

export type ChannelConnectionLostInput = {
  channelId: string
  /** 读者自己起的频道名（如 `test`）；读不到时由调用方退回平台显示名，**绝不写频道 id**。 */
  channelName: string
  cause: 'network' | 'proxy'
  /** 这次断开的第一刻（UTC ISO）：键的一部分，同一次断开永远同一个键。 */
  disconnectedAt: string
  /** 提交时刻（UTC ISO）。 */
  occurredAt: string
}

/** 纯函数：同样的断开永远得到同一份请求，便于逐字段断言。 */
export function buildChannelConnectionLostRequest(input: ChannelConnectionLostInput): NotificationSubmitRequest {
  const deeplink = { scope: 'platform' as const, settingsSectionId: 'channels' }
  return {
    eventTypeId: CHANNEL_CONNECTION_LOST_EVENT_ID,
    // 平台自有生产者：用频道 id 当稳定标识，与 P6a / P6b 同一写法（不带产品前缀＝平台发）。
    producerId: input.channelId,
    dedupeVars: {
      builder: 'template',
      vars: { channelId: input.channelId, disconnectedAt: input.disconnectedAt }
    },
    bodyParams: { channel: input.channelName },
    // 原因两档就是正文变体名，与声明里的 `bodyKeyByVariant` 逐字对应；写错会被拒成 unknown-body-variant。
    bodyVariant: input.cause,
    // 读者要动手（查网络或查代理），所以带一个「去设置检查」的落点——落频道页，不是通知设置。
    actions: [{ id: 'open-channel-settings', labelKey: 'notification.channelCheck.action', kind: 'open', deeplink }],
    deeplink,
    occurredAt: input.occurredAt
  }
}

/**
 * 提交；**失败不外抛**：一条通知发不出去不能把「频道已断线」这个事实判成故障，
 * 连接自己会继续重试，状态行与日志另有记录。
 */
export async function notifyChannelConnectionLost(
  submit: ((request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>) | undefined,
  input: ChannelConnectionLostInput
): Promise<NotificationSubmitOutcome | null> {
  if (!submit) return null
  try {
    return await submit(buildChannelConnectionLostRequest(input))
  } catch {
    return null
  }
}
