import { useEffect, useState } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../../shared/i18n/productText'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import { readInterpretationSummary, type NewsInterpretationReadView } from '../../../shared/ipc/newsInterpretationClient'
import { newsInterpretationResultCopy } from '../../../shared/i18n/newsInterpretationResultCopy'
import { AiInterpretationSection } from '../../shared/AiInterpretationSection'

/**
 * 右栏那一节「AI 解读」（R37）：状态由只读接口驱动，不靠内存。
 *
 * 正文按 `summaryId` 去 `marketAnalysis.getSummary` 取——`summaryId` 由只读接口在 `available` 时提供
 * （必填、按 state 收窄）；不要在界面侧另找 summary 或反查时间线。
 */
export function NewsSentimentInterpretation(props: Readonly<{
  view?: NewsInterpretationReadView
  submitting: boolean
  failure?: Readonly<{ itemId: string; sentenceKey: string; retry: boolean }>
  /** 读失败/正文读失败的重试：只重读，不排新分析。 */
  onRetryRead: () => void
  /** 写失败（`failed` 且动作是 retry）的重试：真的重发一次。 */
  onRetrySubmit: () => void
  /** 「读取结果」：催一次读，不排新分析。 */
  onReadResult: () => void
}>): React.ReactElement | null {
  const copy = productText[useShellLanguage()].mi.aiInterpretation
  const resolveText = useProductTextKey()
  const { view } = props
  const summaryId = view?.state === 'available' ? view.summaryId : undefined
  const [paragraphs, setParagraphs] = useState<readonly string[]>()
  const [summaryFailed, setSummaryFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (summaryId === undefined) { setParagraphs(undefined); setSummaryFailed(false); return }
    let active = true
    setSummaryFailed(false)
    void readInterpretationSummary(summaryId).then((next) => {
      if (!active) return
      if (next === undefined) setSummaryFailed(true)
      else setParagraphs(next)
    })
    return () => { active = false }
  }, [summaryId, attempt])

  if (props.failure !== undefined) {
    return <AiInterpretationSection
      failure={{ sentence: resolveText(props.failure.sentenceKey) || copy.readFailed, canRetry: props.failure.retry }}
      {...(props.failure.retry ? { onRetry: props.onRetrySubmit } : {})}
      state="failed" />
  }
  if (props.submitting) return <AiInterpretationSection onReadResult={props.onReadResult} state="pending" />
  if (view === undefined) return null
  if (view.state === 'none') {
    // 跑过但没结果（`lastRun`）：必须显示失败态 + 再试一次，不能退回「从没点过」。
    if (view.lastRun === undefined) return null
    const mapped = newsInterpretationResultCopy({ ...(view.lastRun.failureCode === null ? {} : { failureCode: view.lastRun.failureCode }) })
    const sentence = mapped.sentenceKey === newsInterpretationResultCopy({}).sentenceKey
      ? copy.runFailed
      : resolveText(mapped.sentenceKey)
    return <AiInterpretationSection
      failure={{ sentence: sentence || copy.runFailed, canRetry: true }}
      onRetry={props.onRetrySubmit}
      state="failed" />
  }
  if (view.state === 'in-flight') return <AiInterpretationSection onReadResult={props.onReadResult} state="pending" />
  if (view.state === 'unreadable') {
    return <AiInterpretationSection failure={{ sentence: copy.readFailed, canRetry: true }} onRetry={props.onRetryRead} state="failed" />
  }
  if (view.generatedAt === undefined || view.evidenceScope === undefined || summaryId === undefined) {
    return <AiInterpretationSection failure={{ sentence: copy.readFailed, canRetry: true }} onRetry={props.onRetryRead} state="failed" />
  }
  if (summaryFailed) {
    return <AiInterpretationSection
      failure={{ sentence: copy.readFailed, canRetry: true }}
      onRetry={() => { setSummaryFailed(false); setAttempt((value) => value + 1) }}
      state="failed" />
  }
  if (paragraphs === undefined) return <AiInterpretationSection onReadResult={props.onReadResult} state="pending" />
  return <AiInterpretationSection
    audit={{
      asOf: view.evidenceScope.asOf,
      dataCutoff: view.evidenceScope.dataCutoff,
      domains: view.evidenceScope.domains,
      factCount: view.evidenceScope.factCount,
      ...(view.runId === undefined ? {} : { runId: view.runId }),
      ...(view.snapshotHash === undefined ? {} : { snapshotHash: view.snapshotHash })
    }}
    meta={{ evidenceRefCount: view.evidenceScope.evidenceRefCount, generatedAt: view.generatedAt }}
    paragraphs={paragraphs}
    state="ready" />
}
