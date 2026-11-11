import type { SourceView } from '../../../service/intelligence/application/sourceProjection'
import type { ProviderDetailLabels } from './ProviderDetail'
import { SourceEnabledRow } from './SourceRows'

/**
 * 「一个源一行」：启用行（只读状态文字）。
 *
 * 「高级」与整个展开区已按用户 2026-11-12「这些都没用了」删除：源行的职责只剩
 * 「这个源开没开」。健康/运行状态改由日志与审计看，界面不再展示。
 * 行尾不再画开关（用户 2026-11-12：点不动的开关是假控件）——启停唯一编辑入口是页头组开关。
 *
 * 行上唯一的动作是**这颗源自己的连通性测试**（同一读者的要求：每个已经接了的源都要能测）。
 * 它由 `capabilities.testConnection` 决定有没有，不是按来源名写死。
 */
export function ProviderSourceRow(props: Readonly<{
  source: SourceView
  labels: ProviderDetailLabels
  /** 需要 API Key 的源，Key 没配好之前行内给一句「先配置 API Key」的 ⓘ。 */
  credentialMissing: boolean
  proxyConfigured: boolean
  resolveText: (key: string) => string
  /** 这一行那颗「测试」按钮：没有可测探针的源不传，行上就不出现按钮。 */
  onTest?: () => void
  testState?: 'testing' | 'ok' | 'failed' | 'unsupported'
}>): React.ReactElement {
  const { source, labels } = props
  const name = labels.sourceNames[source.sourceId] ?? source.displayName
  const unused = source.panels.length === 0
  const unavailable = source.unavailable
  const tags = [
    unused || source.visibility === 'pending'
      ? labels.badges.pending
      : source.visibility === 'advanced'
        ? labels.badges.advanced
        : null
  ].filter((tag): tag is string => Boolean(tag))
  return <div className="source-provider-detail__block">
    <SourceEnabledRow
      {...(props.credentialMissing ? { credentialMissing: true } : {})}
      labels={labels}
      name={name}
      {...(props.onTest ? { onTest: props.onTest } : {})}
      proxyConfigured={props.proxyConfigured}
      resolveText={props.resolveText}
      source={source}
      {...(props.testState ? { testState: props.testState } : {})}
      tags={tags}
      unavailable={Boolean(unavailable)}
    />
  </div>
}
