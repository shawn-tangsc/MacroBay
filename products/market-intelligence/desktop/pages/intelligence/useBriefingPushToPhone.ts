import { useEffect, useState } from 'react'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import {
  briefingPushAvailable,
  readBriefingPushChannel,
  redeliverBriefingPush,
  type BriefingPushChannel,
  type BriefingPushEdition
} from './dailyBriefingPushClient'
import { fillBriefingPush, type BriefingPushText } from './dailyBriefingPushText'
import { useBriefingPush, type BriefingPushDisabledReason, type BriefingPushState } from './dailyBriefingPushWiring'

/**
 * 「发布频道」在页面上的那一层：把页面知道的事翻成状态机要的输入，再把状态机的话翻成一句人话。
 *
 * 三件只在这里做的事：
 * - **哪一版能发**：屏幕上这一版（`date + periodId + locale`），不是"最近一期"。取最近一期等于把读者
 *   没在读的一期发到频道里，而他自己看不出来。
 * - **为什么不能发**：五种处境五句话，判定顺序固定：能力 → 正在生成 → 缺这一语言 → 没有版次 →
 *   不是主语言。先判"这个构建根本发不了"，因为其余四种都在说"等一等就有了"，而它不会自己好。
 * - **成功了说什么**：回执那一句由 `{channel}` 填空，通道名来自平台，取不到就用表里的通用词——绝不
 *   印一个 `{channel}` 占位符，也绝不写死任何一个通道品牌。
 *
 * 失败不走这里：失败原样交给按钮内联那一行（带原因、带重试），toast 一消失读者就没了证据。
 */
export type BriefingPushToPhone = Readonly<{
  state: BriefingPushState
  /** The success sentence, already filled; `undefined` outside the two success states. */
  sentence: string | undefined
  onPush: () => void
  onRetry: () => void
}>

export function useBriefingPushToPhone(input: Readonly<{
  /** The edition on screen, or `undefined` when the pane has none to publish. */
  document: DailyBriefingDocument | undefined
  /** A run is in flight — scheduled or started in another window, not only by this page. */
  generating: boolean
  /** The pane says this language has no edition, which is its own sentence. */
  localeMissing: boolean
  /** Which issue of that day this is; the platform keys the notice by all three values. */
  periodId: string
  text: BriefingPushText
  /**
   * Bumped when the channel may have changed elsewhere — the settings drawer closing, the window
   * regaining focus. Without it the answer read at mount is the answer forever: a reader who goes off
   * to configure a channel comes back to a disabled button still claiming this build cannot send.
   */
  refreshKey?: number
}>): BriefingPushToPhone {
  const [channel, setChannel] = useState<BriefingPushChannel>({ wired: undefined, name: undefined })

  useEffect(() => {
    let active = true
    void readBriefingPushChannel().then((answer) => {
      if (active) setChannel(answer)
    })
    return () => { active = false }
  }, [input.refreshKey])

  const document = input.document
  const edition: BriefingPushEdition | undefined = document === undefined
    ? undefined
    : Object.freeze({ date: document.edition.date, periodId: input.periodId, locale: document.edition.locale })

  const blocked: BriefingPushDisabledReason | undefined =
    !briefingPushAvailable() || channel.wired === false ? 'capability'
      : input.generating ? 'generating'
        : input.localeMissing ? 'missing-locale'
          : edition === undefined ? 'no-edition'
            : undefined

  const { state, toast, push, retry } = useBriefingPush({
    edition,
    ...(blocked === undefined ? {} : { blocked }),
    send: redeliverBriefingPush
  })

  const sentence = toast === undefined
    ? undefined
    : fillBriefingPush(
      toast === 'accepted' ? input.text.sentAccepted : input.text.sentUnconfirmed,
      { channel: channel.name ?? input.text.channelUnknown }
    )

  return { state, sentence, onPush: push, onRetry: retry }
}
