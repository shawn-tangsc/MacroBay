import type {
  NotificationPosterEvidence,
  NotificationRecord
} from '../contracts/notificationContracts'

/**
 * 海报这一行（#46）：**把记录上的两格事实变成详情的形状**，不做任何投递判断。
 *
 * 三条口径，每一条都能在别处读到出处：
 * - 那是**推送那一刻**的事实（记录上冻结的海报表行），不是「现在去看一眼海报表」：
 *   保留期删行不该把「当时失败过」改写成「这一版没有图」（`notificationContracts.ts`
 *   的 `EditionPosterRow`）。
 * - `edition: null`（没有行）与「整块缺席」（不知道）是两件事：前者是陈述，后者是没事实。
 * - **不读 `delivery.pushImage.state` 那个聚合**：自动推送会给不支持图片的通道发一次图并记
 *   failed，聚合因此可能是 failed，而真正该进分母的只有 `supportsImage` 的那些通道。
 */

/** 通道侧的两个读时事实：显示名（ⓘ 逐通道一行要用）与图片能力（分母只数 true）。 */
export type PosterChannelCapability = (channelId: string) => Readonly<{ channelName?: string; supportsImage: boolean }> | null

/** 出图侧的原因档：三档，对应界面那三个短词。认不出的原码一律算「出图失败」，不新增第四档。 */
function editionReasonKind(code: string | null): 'render-timeout' | 'render-failed' | 'too-large' | null {
  if (code === null) return null
  if (code === 'poster-render-timeout') return 'render-timeout'
  if (code === 'poster-too-large') return 'too-large'
  return 'render-failed'
}

/**
 * 通道侧四档，与界面设计那张码→短词表一一对应：
 * - 目标没了（没绑定 / 被停用 / 解析不出）＝「通道不可用」，不是通道的错；
 * - 图拿不到（文件不在 / 来源不许）＝「图没能取到」，更不是通道的错——「没有」与「拿不到」分开；
 * - 超限＝「图太大」，发之前就判出来的；
 * - 其余（拒收 / 限流 / 上游报错）＝「通道未收下」。
 */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'delivery-no-target-bound',
  'delivery-target-disabled',
  'delivery-target-invalid'
])
const IMAGE_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'delivery-image-unavailable',
  'delivery-image-source-not-allowed'
])

function channelReasonKind(
  state: NotificationPosterEvidence['channels'][number]['state'],
  reason: string | undefined
): 'channel-refused' | 'channel-unavailable' | 'too-large' | 'image-unavailable' | null {
  if (state !== 'failed') return null
  // `delivery-image-unsupported` 不在这里：那是「这条通道发不了图」，读侧已经按 `supportsImage:false`
  // 把它摘出分母了，不需要再给它一个值里的短词。
  if (reason === 'delivery-image-too-large') return 'too-large'
  if (reason !== undefined && IMAGE_UNAVAILABLE_CODES.has(reason)) return 'image-unavailable'
  if (reason !== undefined && UNAVAILABLE_CODES.has(reason)) return 'channel-unavailable'
  return 'channel-refused'
}

/**
 * 这一版的海报行。
 *
 * - 记录上写了 `editionPosterRow`（对象或 `null`）＝产出方查过，按它；
 * - 没这个字段但带了 `editionPoster.contentHash`（字段上线前的老记录）＝当时确实出了图，
 *   只有 `ready` 才会带 hash，按 ready 读；
 * - 两样都没有＝**不知道**，返回 `undefined`，界面整行不出现（不许编成「没有图」）。
 */
function editionOf(record: NotificationRecord): NotificationPosterEvidence['edition'] | undefined {
  if (record.editionPosterRow !== undefined) {
    if (record.editionPosterRow === null) return null
    return { ...record.editionPosterRow, reasonKind: editionReasonKind(record.editionPosterRow.failureCode) }
  }
  if (record.editionPoster !== undefined) {
    return { status: 'ready', contentHash: record.editionPoster.contentHash, failureCode: null, reasonKind: null }
  }
  return undefined
}

export function posterEvidenceOf(
  record: NotificationRecord,
  capability: PosterChannelCapability | undefined
): NotificationPosterEvidence | undefined {
  const push = record.delivery.push
  const pushImage = record.delivery.pushImage
  // 没有推送对象就没有「发没发」这件事：`push-unavailable` 那一行是「一条可用通道都没有」的
  // 配置事实（不是一次尝试），照它画「未发送」会把「没有」说成「失败」。
  if (push === undefined && pushImage === undefined) return undefined
  if (pushImage === undefined && push?.state === 'failed' && push.reason === 'push-unavailable') return undefined
  const edition = editionOf(record)
  if (edition === undefined) return undefined

  // 分母是**这一次推送时启用着的**通道里支持图片的那些：`delivery.push.channels` 就是那一次的
  // 目标快照（正文一条行一条）。能力是读时问注册表的——通道能力变了，这一行跟着变，不改历史账。
  // 老记录没有 `push.channels` 时退回 `pushImage.channels`（至少把这些算进去）。
  const targets = push?.channels ?? pushImage?.channels ?? []
  const capabilities = targets.map((row) => ({
    channelId: row.channelId,
    supportsImage: capability === undefined ? false : capability(row.channelId)?.supportsImage === true
  }))
  const enabledImageChannelCount = capabilities.filter((entry) => entry.supportsImage).length
  // 一条支持图片的通道都没有：没有接收方，就没有「发没发」这件事——整块不给（界面整行不出现）。
  if (enabledImageChannelCount === 0) return undefined

  const channels = (pushImage?.channels ?? []).flatMap((row): NotificationPosterEvidence['channels'][number][] => {
    // 纯导读降级（`kind: 'text'`）不是发图：它属于「读者选了只发文字」或该通道发不了图，
    // 那些行不进这一行的分母，也当不成失败。
    if (row.kind === 'text') return []
    const info = capability === undefined ? null : capability(row.channelId)
    const channelName = row.channelName ?? info?.channelName
    return [{
      channelId: row.channelId,
      ...(channelName === undefined || channelName.length === 0 ? {} : { channelName }),
      supportsImage: info?.supportsImage === true,
      state: row.state,
      ...(row.reason === undefined ? {} : { reasonCode: row.reason }),
      reasonKind: channelReasonKind(row.state, row.reason),
      at: row.at
    }]
  })
  return {
    edition,
    enabledImageChannelCount,
    unsupportedImageChannelCount: capabilities.length - enabledImageChannelCount,
    channels
  }
}