import { Tag } from 'antd'

import type { ModelChatProtocol } from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../i18n/platformText'

import type { ModelProtocolChipSource } from './modelProtocolChips'
import { probeReasonLabel } from './modelProbeReason'
import { modelProtocolLabel } from './modelProtocolFilter'
import { ProtocolBrandIcon } from './ProtocolBrandIcon'

/**
 * PLAT-82：模型行里的**一个协议 chip**（只画图标，文字在 title / aria-label 里）。
 *
 * 品牌标单色（随 `currentColor`）：chat/completions 与 responses 都是 OpenAI，
 * 后者带右下角小点区分（与协议 pill 同一套图标口径）。
 *
 * 标红只发生在「厂商声明过 + 本次实测失败」的协议上（`failed` 由行传入，判据在
 * `failedDeclaredProtocols`）；未声明的协议失败不标红，也不改变厂商声明结论。
 *
 * title 按来源区分三种：厂商声明 / 按默认端点推断 / 本次实测通过（实测只补缺，不覆盖前两者）。
 */
export function ModelServiceProtocolChip({
  labels,
  protocol,
  source,
  failed,
  thisRunFailure
}: {
  labels: PlatformText['models']
  protocol: ModelChatProtocol
  /** 该协议支持来自哪里：厂商声明 / 默认端点推断 / 本次实测通过。 */
  source: ModelProtocolChipSource
  /** 厂商声明过且本次实测失败。 */
  failed: boolean
  /**
   * 本次检测该协议**没通**（会话级，不落库）。与 `failed` 的区别只在文案：
   * `failed`（厂商声明过）说"声明支持但实测失败"，这里说"本次检测失败：<原因>"。
   * 两者都**标红** —— 行尾的「协议 1/2」必须能在行内看出是哪条没通。
   */
  thisRunFailure?: string
}): React.ReactElement {
  const label = modelProtocolLabel(labels, protocol)
  const red = failed || thisRunFailure !== undefined
  const title = failed
    ? labels.detectionProtocolFailedTitle(label)
    : thisRunFailure !== undefined
      ? labels.modelProtocolChipThisRunFailed(
        label,
        probeReasonLabel(labels, thisRunFailure as Parameters<typeof probeReasonLabel>[1]),
        sourceLabel(labels, source)
      )
      : labels.modelProtocolChipTitle(label, sourceLabel(labels, source))
  return (
    <Tag
      className={`capability-tag capability-protocol${red ? ' capability-protocol-failed' : ''}`}
      data-model-chip={protocol}
      data-model-protocol-chip={protocol}
      data-model-protocol-source={source}
      {...(failed ? { 'data-model-protocol-failed-chip': protocol } : {})}
      {...(red && !failed ? { 'data-model-protocol-stale-chip': protocol } : {})}
      style={{ paddingInline: 4 }}
      title={title}
      aria-label={title}
      icon={protocolBrandIcon(protocol)}
    />
  )
}

function sourceLabel(labels: PlatformText['models'], source: ModelProtocolChipSource): string {
  if (source === 'declared') return labels.modelProtocolSourceDeclared
  if (source === 'probe') return labels.modelProtocolSourceProbe
  return labels.modelProtocolSourceEndpoint
}

function protocolBrandIcon(protocol: ModelChatProtocol): React.ReactElement {
  if (protocol === 'messages') return <ProtocolBrandIcon brand="anthropic" />
  if (protocol === 'gemini') return <ProtocolBrandIcon brand="google" />
  // chat-completions 与 responses 同属 OpenAI：responses 带点，chat 不带。
  return <ProtocolBrandIcon brand="openai" marked={protocol === 'responses'} />
}
