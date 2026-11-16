import { useMemo } from 'react'

import { Button } from 'antd'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { Info } from 'lucide-react'

import { productText } from '../../shared/i18n/productText'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import './AiInterpretationSection.css'

/**
 * 「AI 解读」小节：**舆情详情与日历事件详情共用一份**（R37）。
 *
 * 结构（界面设计定稿）：标题 + 常驻 ⓘ → 元信息一行 → 正文 / 状态。四态：
 * - `idle`：**整节不渲染**（不留标题占位）；
 * - `pending`：标题 + ⓘ + `LoadingState`(inline, sm) + 「正在生成」；
 * - `failed`：标题 + ⓘ + 一句原因 + `.text-action`「再试一次」（`canRetry` 为假时不给按钮）；
 * - `ready`：标题 + ⓘ + 可见元信息（生成时刻 + 「N 条证据」，N = `evidenceRefCount`）+ 正文；
 *   运行 id / 快照 / 事实条数 / 时点 / 覆盖域进审计折叠。
 *
 * 三条硬规矩：
 * - 只要节存在，就必须有标题 + 至少一态内容；**空节不画**；
 * - 元信息那行**只`evidenceRefCount`**，`factCount` 只在审计折叠里（两者不是一个数，不许互换）；
 * - 展示件：不接 IPC、不读客户端；触发与读取由宿主传状态进来。
 */
export type AiInterpretationState = 'idle' | 'pending' | 'failed' | 'ready'

export type AiInterpretationSectionProps = Readonly<{
  state: AiInterpretationState
  /** `ready` 时必填：生成时刻（ISO，由组件统一格式化）+ 快照里的证据引用条数。 */
  meta?: Readonly<{ generatedAt: string; evidenceRefCount: number }>
  /** 审计折叠里的内容；不进可见正文。 */
  audit?: Readonly<{
    asOf: string
    dataCutoff: string
    domains: readonly string[]
    factCount: number
    runId?: string
    snapshotHash?: string
  }>
  paragraphs?: readonly string[]
  failure?: Readonly<{ sentence: string; canRetry: boolean }>
  onRetry?: () => void
}>

export function AiInterpretationSection(props: AiInterpretationSectionProps): React.ReactElement | null {
  const language = useShellLanguage()
  const copy = productText[language].mi.aiInterpretation
  const formatTime = useShellTimeFormat()
  // 表解析器：键 → 句子，不在调用点拿字面量比较（读屏名守卫）。
  const resolveText = useProductTextKey()

  const metaLine = useMemo(() => {
    if (props.state !== 'ready' || props.meta === undefined) return undefined
    return fillLabelParams(copy.meta, {
      time: formatTime(props.meta.generatedAt, 'minute'),
      count: String(props.meta.evidenceRefCount)
    })
  }, [copy.meta, formatTime, props.meta, props.state])

  if (props.state === 'idle') return null

  return <section className="mi-ai-interpretation" data-ai-interpretation data-state={props.state}>
    <div className="mi-ai-interpretation__head">
      <h3 className="mi-ai-interpretation__title">{copy.title}</h3>
      {/* 常驻：成功、失败、提交中三态都在（它解释“这节是什么”，不是“这次结果如何”）；
          说明只进浮层，正文一个字不加。标题行内同一行只许这一颗。 */}
      <Popover
        content={<span>{copy.info}</span>}
        trigger={(triggerProps) => (
          <IconButton
            {...triggerProps}
            ariaLabelKey="mi.aiInterpretation.infoAria"
            icon={Info}
            onSelect={() => undefined}
            resolveText={resolveText}
            size="sm"
            variant="plain" />
        )} />
    </div>

    {props.state === 'pending' ? (
      <LoadingState label={copy.generating} layout="inline" size="sm" />
    ) : null}

    {props.state === 'failed' && props.failure !== undefined ? (
      <p className="mi-ai-interpretation__failure">
        <span>{props.failure.sentence}</span>
        {props.failure.canRetry && props.onRetry !== undefined
          ? <Button className="text-action" onClick={props.onRetry} size="small" type="text">{copy.retry}</Button>
          : null}
      </p>
    ) : null}

    {props.state === 'ready' && metaLine !== undefined ? <>
      <p className="mi-ai-interpretation__meta" data-ai-interpretation-meta>{metaLine}</p>
      <div className="mi-ai-interpretation__body">
        {(props.paragraphs ?? []).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>)}
      </div>
      {props.audit === undefined ? null : <details className="mi-ai-interpretation__audit">
        <summary>{copy.audit.summary}</summary>
        <dl>
          <div><dt>{copy.audit.asOf}</dt><dd>{formatTime(props.audit.asOf, 'second')}</dd></div>
          <div><dt>{copy.audit.dataCutoff}</dt><dd>{formatTime(props.audit.dataCutoff, 'second')}</dd></div>
          <div><dt>{copy.audit.factCount}</dt><dd>{props.audit.factCount}</dd></div>
          <div><dt>{copy.audit.evidenceRefCount}</dt><dd>{props.meta?.evidenceRefCount ?? ''}</dd></div>
          <div><dt>{copy.audit.domains}</dt><dd>{props.audit.domains.join(' · ')}</dd></div>
          {props.audit.runId === undefined ? null : <div><dt>{copy.audit.runId}</dt><dd>{props.audit.runId}</dd></div>}
          {props.audit.snapshotHash === undefined ? null : <div><dt>{copy.audit.snapshotHash}</dt><dd>{props.audit.snapshotHash}</dd></div>}
        </dl>
      </details>}
    </> : null}
  </section>
}
