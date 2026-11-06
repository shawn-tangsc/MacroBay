import type { PlatformText } from '../i18n/platformText'
import {
  formatProviderRuntimeCheckReason,
  type ProviderRuntimeCheckReasonCode
} from './providerRuntimeCheckReason'

import type { PlatformLiveText } from './liveText'

/**
 * 模型连接检查的结论句，按**当前语言**现算（PLAT-61：结论也要把原因说出来）。
 *
 * 这里单独成一个模块，是因为它同时喂两处：抽屉里的结果卡（当场解析）和设置面板里的状态行
 * （`LiveText`，渲染时才解析）。做成纯函数之后，语言切换为什么不该冻结句子这件事可以测。
 */
export function describeConnectionStatus(input: {
  overallOk: boolean
  chatOk: boolean
  /** `null` = 检查通过、没有可说的原因。 */
  reasonCode: ProviderRuntimeCheckReasonCode | null
  /** 引擎给的英文摘要：本语言没有更具体的说法时才用它兜底。 */
  summary: string
}): PlatformLiveText {
  const { overallOk, chatOk, reasonCode, summary } = input
  return (current: PlatformText): string =>
    overallOk
      ? current.models.connectionCheckAgentReady
      : chatOk
        ? current.models.connectionCheckAgentMixed
        : formatProviderRuntimeCheckReason(reasonCode, current.models) ||
          summary ||
          current.models.connectionCheckAgentNotReady
}
