import { readableAnalysisName } from '../../../contracts/marketAnalysisReadableText'
import { analysisModelVocabulary } from './analysisModelVocabulary'
import type { SignificanceSignal } from './significanceChangeMatcher'

/**
 * Renders the gate's trigger reasons as the Chinese sentences the model reads.
 *
 * The signal carries a `titleKey` and a metric id, which are machine names; the model must
 * never be handed those to copy (it once quoted `consensus` and `change-1d-usd` straight into
 * a published conclusion). Everything visible here goes through the readable-name registry.
 */

const kindLabels: Readonly<Record<SignificanceSignal['kind'], string>> = Object.freeze({
  'actual-changed': '实际值公布或修正',
  'previous-revised': '前值修正',
  'consensus-changed': '市场预期变化',
  'event-added': '新增高重要性事件',
  // provider 的观测永远不是官方来源，所以这一句里明写"来源未验证"：模型不得把它当官方数值转述。
  'provider-surprise': 'provider 日历的发布显著偏离市场预期（来源未验证，非官方值）'
})

export function describeSignificanceSignal(signal: SignificanceSignal): string {
  const name = readableAnalysisName(analysisModelVocabulary, 'eventName', signal.titleKey)
  const metric = readableAnalysisName(analysisModelVocabulary, 'metric', signal.metric)
  // 偏离说的是"与预期的距离"，只报实际值等于没说出意外在哪，所以这一支把预期一起写出来。
  if (signal.kind === 'provider-surprise') {
    return `${kindLabels[signal.kind]}：${name} 实际值 ${signal.value ?? '（无）'}，市场预期 ${signal.expectedValue ?? '（未公布）'}`
  }
  const movement = signal.kind === 'event-added'
    ? `新增事件「${name}」`
    : `${name} 的${metric}由 ${signal.previousValue ?? '（此前无）'} 变为 ${signal.value ?? '（现无）'}`
  return `${kindLabels[signal.kind]}：${movement}`
}

export function describeSignificanceSignals(signals: readonly SignificanceSignal[]): readonly string[] {
  return signals.map(describeSignificanceSignal)
}
