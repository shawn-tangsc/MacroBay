/**
 * 海报这一行的契约（#46，2026-11-25）：推送记录上冻结的「那一版海报表的行」，以及它给
 * 详情页的证据形状。
 *
 * 从 `notificationContracts.ts` 抽出来：那份文件贴着 500 行硬线，而这一段是完整概念——
 * 「这一版有没有图、发到哪几条通道」，与记录本身的字段是两件事。纯类型搬运，行为零改动。
 */

/** 一条投递路径的四档（契约 §8）。闭集：多通道聚合也不许出现第五档。 */
export type NotificationDeliveryPathState = 'queued' | 'sent-accepted' | 'sent-unconfirmed' | 'failed'

/**
 * 推送那一刻**这一版海报在海报表里的行**（#46，2026-11-25）。
 *
 * 为什么冻结到记录上，而不是详情页按 `edition.editionId` 反查：
 * - 海报表主键带 `edition_generated_at`，同一期重生成会有多行，反查只能猜「最新那一行」；
 * - 保留期会删行，反查会把「当时失败过」读成「这一版没有图」——那正是 #46 要防的
 *   「拿不到说成没有」。历史上发生过的事不该被清理任务改写。
 *
 * 记录字段写成 `null` 表示「那一刻表里没有行」（这一版没有图，不是失败），字段整个缺席
 * ＝不知道（老记录）。两者**不许合并**。
 */
export type EditionPosterRow = {
  status: 'ready' | 'failed' | 'timeout'
  /** 只有 `ready` 有：推送那一刻按它取图。 */
  contentHash: string | null
  /** `failed` / `timeout` 的原始码（`poster-render-timeout` 等）；只作审计，不上屏。 */
  failureCode: string | null
}

/**
 * 值里那颗短词要的原因档（闭集）：界面按它选一句话，不许自己看原始码猜。
 * 三档出图侧 + 四档通道侧，与界面设计 `2026-11-25-notification-poster-row-v1.md` §5 的
 * 码→短词表一一对应（码不进值，只在 `reasonCode` 里留审计）。
 */
export type NotificationPosterReasonKind =
  | 'render-timeout'
  | 'render-failed'
  | 'too-large'
  | 'channel-refused'
  | 'channel-unavailable'
  | 'image-unavailable'

/**
 * 海报这一行给渲染层的证据（#46）：**只给事实，不给句子**。
 *
 * - `edition: null` ＝ 这一版海报表没有行（不是失败）；整个 `poster` 缺席 ＝ 没有这件事
 *   （老记录 / 没有推送对象），界面整行不出现。两种「没有」不是一回事。
 * - `channels` 只含**真的试过发图**的通道（正文被受理的那些）；纯导读降级的行（`kind:'text'`）
 *   不进来——那不是发图。
 * - 分母由界面数 `supportsImage` 得出。自动推送今天仍会给不支持图片的通道发一次图并记一条
 *   failed（`delivery-image-unsupported`），那类行留在数组里但不进分母（归通道线的账，另记）。
 * - **别读 `delivery.pushImage.state` 那个聚合**：上一条会让聚合变成 `failed`。
 */
export type NotificationPosterEvidence = {
  edition: (EditionPosterRow & { reasonKind: 'render-timeout' | 'render-failed' | 'too-large' | null }) | null
  /**
   * 这一次推送时**启用着的支持图片通道**总数 ＝ 界面那一行的分母 N。停用 / 没起来的不算
   * （算进去这行会永远是 M/N）；正文没到、图按规则没发的那些**算**——它没试过，读者要知道。
   * `N = 0` 时整个 `poster` 缺席：没有接收方就没有「发没发」这件事。
   */
  enabledImageChannelCount: number
  /** 启用着但**不支持**图片的通道数：不进分母，ⓘ 里那一句用它。 */
  unsupportedImageChannelCount: number
  channels: readonly {
    channelId: string
    /** failed 行必须有显示名：ⓘ 的多原因面板逐通道一行 `{channel}：{reason}`，缺名字只能印内部 id。 */
    channelName?: string
    /** 通道今天支不支持图片（读时按通道注册表判；查不到＝false）。分母只数 true。 */
    supportsImage: boolean
    state: NotificationDeliveryPathState
    /** 原始原因码，审计用，不上屏。 */
    reasonCode?: string
    /**
     * 只有 `failed` 非空。四档而不是两档：`delivery-image-unavailable` 是「图拿不到」，
     * 报成「通道未收下」就冤枉了通道（本项目的红线：没有与拿不到分开）。
     */
    reasonKind: 'channel-refused' | 'channel-unavailable' | 'too-large' | 'image-unavailable' | null
    at: string
  }[]
}


