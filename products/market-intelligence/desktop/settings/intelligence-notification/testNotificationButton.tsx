import { useEffect, useRef, useState } from 'react'

import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingSpinner } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'

import type {
  IntelligenceTestKind,
  IntelligenceTestReceipt
} from '../../../contracts/intelligenceNotificationTest'
import { sendIntelligenceTestNotification } from '../../shared/ipc/intelligenceNotificationTestClient'

/**
 * 通知配置项后面的「发一条…」测试按钮（需求 v4 §5、技术方案 §3、原型 `2026-11-08-notification-test-buttons-v1`）。
 *
 * 三条写死的规矩：
 * 1. **0 条可用通道 → 整组不渲染**（不是禁用）。`push-unavailable` 是配置事实，不是可重试的瞬时失败；
 *    一个点了必然以配置原因失败的按钮，正是「没接线的入口」。判据在父层（`channelReady`），本组件只认这个布尔。
 * 2. **≥2 条通道仍然渲染**：按钮在不在只取决于「有没有可用通道」，不取决于「唯一不唯一」；点下去才拒绝，
 *    并把主进程数出来的条数原样写进句子（**不自己数**——渲染层读不到通道列表，两次数出来会互相矛盾）。
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
  | { kind: 'failed'; reasonCode: string | null; channelCount: number | null }

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

  async function run(): Promise<void> {
    if (sending || props.disabled) return
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
        setPhase({ kind: 'failed', reasonCode: null, channelCount: null })
        return
      }
      if (result.state === 'sent') setPhase({ kind: 'sent', channelName: result.channelName })
      else if (result.state === 'no-data') setPhase({ kind: 'no-data' })
      else {
        setPhase({
          kind: 'failed',
          reasonCode: result.reasonCode,
          channelCount:
            result.reasonCode === 'push-unavailable' && typeof result.enabledChannelCount === 'number'
              ? result.enabledChannelCount
              : null
        })
      }
    } catch {
      setPhase({ kind: 'failed', reasonCode: null, channelCount: null })
    } finally {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }

  const note = describePhase(phase, text, props.kind)

  return <span className="intelligence-notification-test-action">
    <button
      className="intelligence-notification-test-button"
      data-test-notification={props.kind}
      disabled={props.disabled || sending}
      onClick={() => void run()}
      type="button">
      {sending ? <><LoadingSpinner size="sm" />{text('pages.intelligence.notification.test.sending')}</> : text(props.labelKey)}
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
    {phase.kind === 'failed' && phase.reasonCode !== null
      ? <details className="intelligence-notification-test-reason">
        <summary>{text('pages.intelligence.notification.test.reasonCode')}</summary>
        <code>{phase.reasonCode}</code>
      </details>
      : null}
  </span>
}

/** 四种结果的一句话。无数据与失败都不出现原因码；成功必须点名发到哪条通道。 */
function describePhase(phase: Phase, text: (key: string) => string, kind: TestNotificationKind): string | null {
  if (phase.kind === 'sent') {
    return text('pages.intelligence.notification.test.sent').replace('{channel}', phase.channelName)
  }
  if (phase.kind === 'no-data') return text(`pages.intelligence.notification.test.noData.${kind}`)
  if (phase.kind === 'failed') {
    if (phase.channelCount !== null && phase.channelCount >= 2) {
      return text('pages.intelligence.notification.test.multipleChannels').replace('{count}', String(phase.channelCount))
    }
    return text('pages.intelligence.notification.test.failed')
  }
  return null
}
