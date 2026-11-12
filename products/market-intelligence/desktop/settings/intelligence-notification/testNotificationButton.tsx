import { useEffect, useRef, useState } from 'react'

import { Info } from 'lucide-react'
import { Button } from 'antd'

import { IconButton } from '@platform/ui/components/icon-button'
import { useSingleFlightSend } from '@platform/ui/async/useSingleFlightSend'
import { LoadingSpinner } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'

import type {
  IntelligenceTestKind,
  IntelligenceTestReceipt
} from '../../../contracts/intelligenceNotificationTest'
import { sendIntelligenceTestNotification } from '../../shared/ipc/intelligenceNotificationTestClient'
import { openChannelSettings } from '../../shared/navigation/productShellNavigation'

/**
 * 通知配置项后面的「发一条…」测试按钮（需求 v4 §5、技术方案 §3、原型 `2026-11-08-notification-test-buttons-v1`）。
 *
 * 三条写死的规矩：
 * 1. **0 条可用通道 → 整组不渲染**（不是禁用）。`push-unavailable` 是配置事实，不是可重试的瞬时失败；
 *    一个点了必然以配置原因失败的按钮，正是「没接线的入口」。判据在父层（`channelReady`），本组件只认这个布尔。
 * 2. **多通道是合法状态**：按钮在不在只取决于「有没有可投递目标」，不取决于「唯一不唯一」；
 *    点下去若一条就绪的都没有，说的是**配置事实**（「已启用的通道都没有连上」），不是投递失败，
 *    也**不印条数**——渲染层读不到通道列表，数出来的条数会与主进程互相矛盾。
 * 3. **原因码只在失败折叠区**：主句、ⓘ 都不出现码；失败时给一个默认收起的 `<details>`，展开后恰好一处。
 *
 * 超时（10 秒）按失败处理，但**不编一个码**：超时不是主进程返回的结论，硬塞 `read-failed` 之类就是把
 * 「没拿到」写成「读失败」。这条失败句只有人话，没有折叠区。
 */
/** kind 与回执都来自产品自己的契约（`contracts/intelligenceNotificationTest.ts`），本组件不另定义一份。 */
export type TestNotificationKind = IntelligenceTestKind

const TEST_TIMEOUT_MS = 10_000

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; channelName: string }
  | { kind: 'no-data' }
  | { kind: 'failed'; reasonCode: string | null; requestedCount: number | null }
  /** 冷却期内又点了一次：不发，只就地说明。 */
  | { kind: 'cooldown'; seconds: number }

export function TestNotificationButton(props: Readonly<{
  kind: TestNotificationKind
  /** 标签按行写「会发什么」，不统一写「测试」：同页三枚同字，读者点之前分不清哪一枚测哪条。 */
  labelKey: string
  /** 这一项自己的开关关着：按钮禁用并说明「打开这一项才能发测试」，不弹「你已关闭」的提醒。 */
  disabled: boolean
  /** 有没有任意可用通道。false → 整组不渲染。 */
  channelReady: boolean
  resolveText: (key: string) => string
}>): React.ReactElement | null {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  if (!props.channelReady) return null

  const sending = phase.kind === 'sending'
  const text = (key: string): string => props.resolveText(key)

  async function sendOnce(): Promise<boolean> {
    setPhase({ kind: 'sending' })
    // 超时只给「失败 + 人话」，不给码：码必须来自主进程的结论。
    const timeout = new Promise<null>((resolve) => {
      timerRef.current = setTimeout(() => resolve(null), TEST_TIMEOUT_MS)
    })
    try {
      // 调的是**产品自己的 IPC**（`intelligence.sendTestNotification`），不是平台的链路自检：
      // 取数、拼句、去重键都在主进程，渲染层只交 kind。
      const result: IntelligenceTestReceipt | null = await Promise.race([sendIntelligenceTestNotification(props.kind), timeout])
      if (result === null) {
        setPhase({ kind: 'failed', reasonCode: null, requestedCount: null })
        return false
      }
      if (result.state === 'sent') {
        setPhase({ kind: 'sent', channelName: result.channelName })
        return true
      }
      if (result.state === 'no-data') {
        setPhase({ kind: 'no-data' })
        return false
      }
      {
        setPhase({
          kind: 'failed',
          reasonCode: result.reasonCode,
          /* 「有没有启用过」看回执的 `requestedCount`（读者请求启用的条数），
             **不从状态直方图反推**：`configuration-ready` 同时装「刚建好」与「启用过没连上」。 */
          requestedCount:
            result.reasonCode === 'push-unavailable' && typeof result.requestedCount === 'number'
              ? result.requestedCount
              : null
        })
        return false
      }
    } catch {
      setPhase({ kind: 'failed', reasonCode: null, requestedCount: null })
      return false
    } finally {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }

  /**
   * 连点守卫（用户 2026-11-09：连点 4 次收到 4 条自检）：同一次只允许一个在飞，成功后冷却 10 秒，
   * 失败不冷却。冷却中再点只就地说明，不发。
   */
  const sendGuard = useSingleFlightSend({ cooldownMs: 10_000, send: sendOnce })

  const onPress = (): void => {
    void sendGuard.run().then((outcome) => {
      if (outcome === 'cooldown') setPhase({ kind: 'cooldown', seconds: sendGuard.cooldownSecondsLeft })
    })
  }

  const note = describePhase(phase, text, props.kind)

  return <span className="intelligence-notification-test-action">
    <button
      className="intelligence-notification-test-button"
      data-test-notification={props.kind}
      disabled={props.disabled || sendGuard.sending}
      onClick={onPress}
      type="button">
      {sendGuard.sending ? <><LoadingSpinner size="sm" />{text('pages.intelligence.notification.test.sending')}</> : text(props.labelKey)}
    </button>
    {/*
      * ⓘ 统一走 `IconButton` + `Popover`（界面 2026-11-08 定的规则：独立站着的说明图标一律按钮化）。
      * 它**有真动作**——点击钉住说明、再点或 Esc 收起——所以不是死按钮；名字念「发送测试说明」，
      * 说明本身由浮层通过 `aria-describedby` 挂在触发件上（读屏先念名字、再念说明）。
      */}
    <Popover
      labelKey="pages.intelligence.notification.test.info"
      resolveText={props.resolveText}
      trigger={(triggerProps) => (
        <IconButton
          {...triggerProps}
          ariaLabelKey="pages.intelligence.notification.test.infoAria"
          icon={Info}
          resolveText={props.resolveText}
          size="sm"
          variant="plain"
        />
      )}
    />
    {props.disabled
      ? <span className="intelligence-notification-test-note">{text('pages.intelligence.notification.test.needEnabled')}</span>
      : null}
    {note === null ? null : <span
      className="intelligence-notification-test-note"
      data-test-result={phase.kind}
      role="status">{note}</span>}
    {phase.kind === 'failed' && phase.reasonCode === 'push-unavailable'
      ? <>
        <Button className="text-action" onClick={openChannelSettings} size="small" type="text">
          {text(channelActionKey(phase.requestedCount))}
        </Button>
        {(phase.requestedCount ?? 0) > 0
          ? <Popover
            labelKey="pages.intelligence.notification.test.channelsNotConnectedDetail"
            /* 占位符走组件那一条 `labelParams`（`fillLabelParams` 是全仓唯一实现），
               不再在调用点比键、拼句子。 */
            labelParams={{ count: String(phase.requestedCount) }}
            resolveText={props.resolveText}
            trigger={(triggerProps) => <IconButton
              {...triggerProps}
              ariaLabelKey="pages.intelligence.notification.test.channelsNotConnectedDetailAria"
              icon={Info}
              resolveText={props.resolveText}
              size="sm"
              variant="plain" />} />
          : null}
      </>
      : null}
    {phase.kind === 'failed' && phase.reasonCode !== null
      ? <details className="intelligence-notification-test-reason">
        <summary>{text('pages.intelligence.notification.test.reasonCode')}</summary>
        <code>{phase.reasonCode}</code>
      </details>
      : null}
  </span>
}

/**
 * 「一条就绪都没有」那两支的**句子**只由回执的 `requestedCount` 决定：
 * - `0`（读者一条都没请求启用）→ ①「还没有启用通道。」；
 * - `> 0`（请求启用了，但没一条连上）→ ②「已启用的通道都没有连上。」。
 *
 * **不许**用状态直方图反推：`configuration-ready` 同时装着「刚建好、还没启用」和「启用过但没连上」，
 * 反推会把刚建好的通道说成「启用过连不上」，读者会去找一个不存在的故障（频道线 2026-11-12 核过）。
 */
export function pushUnavailableSentenceKey(requestedCount: number | null): string {
  return (requestedCount ?? 0) === 0
    ? 'pages.intelligence.notification.test.noChannelEnabled'
    : 'pages.intelligence.notification.test.channelsNotConnected'
}

/** 同一档判据决定动作：没启用 → 去启用；启用了没连上 → 查看通道状态。 */
export function channelActionKey(requestedCount: number | null): string {
  return (requestedCount ?? 0) === 0
    ? 'pages.intelligence.notification.test.enableChannelAction'
    : 'pages.intelligence.notification.test.channelStatusAction'
}

/** 四种结果的一句话。无数据与失败都不出现原因码；成功必须点名发到哪条通道。 */
function describePhase(phase: Phase, text: (key: string) => string, kind: TestNotificationKind): string | null {
  if (phase.kind === 'sent') {
    return text('pages.intelligence.notification.test.sent').replace('{channel}', phase.channelName)
  }
  if (phase.kind === 'cooldown') {
    return text('pages.intelligence.notification.test.cooldown').replace('{seconds}', String(phase.seconds))
  }
  if (phase.kind === 'no-data') return text(`pages.intelligence.notification.test.noData.${kind}`)
  if (phase.kind === 'failed') {
    // 「一条就绪的通道都没有」是**配置状态**，不是投递失败。两种处境分开说：
    // 读者请求启用的条数为 0 → 还没启用；> 0 → 启用了但没一条连上。句子不印条数。
    if (phase.reasonCode === 'push-unavailable') return text(pushUnavailableSentenceKey(phase.requestedCount))
    // 通道那一跳的三种结局各一句：用一个「失败」盖三种处境，读者只能猜。
    if (phase.reasonCode === 'channel-rejected') return text('pages.intelligence.notification.test.channelRejected')
    if (phase.reasonCode === 'unknown-after-send') return text('pages.intelligence.notification.test.unknownAfterSend')
    if (phase.reasonCode === 'not-attempted') return text('pages.intelligence.notification.test.notAttempted')
    return text('pages.intelligence.notification.test.failed')
  }
  return null
}
