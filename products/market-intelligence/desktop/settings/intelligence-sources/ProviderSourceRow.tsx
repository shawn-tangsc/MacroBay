import type { SourceView } from '../../../service/intelligence/application/sourceProjection'
import type { ProviderDetailLabels } from './ProviderDetail'
import { SourceEnabledRow } from './SourceRows'

/**
 * 「一个源一行」：启用行（只读状态文字）。
 *
 * 「高级」与整个展开区已按用户 2026-11-12「这些都没用了」删除：源行的职责只剩
 * 「这个源开没开」。健康/运行状态改由日志与审计看，界面不再展示。
 * 行尾不再画开关（用户 2026-11-12：点不动的开关是假控件）——启停唯一编辑入口是页头组开关。
 */
export function ProviderSourceRow(props: Readonly<{
  source: SourceView
  labels: ProviderDetailLabels
  /** 需要 API Key 的源，Key 没配好之前行内给一句「先配置 API Key」的 ⓘ。 */
  credentialMissing: boolean
  proxyConfigured: boolean
  resolveText: (key: string) => string
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
      proxyConfigured={props.proxyConfigured}
      resolveText={props.resolveText}
      source={source}
      tags={tags}
      unavailable={Boolean(unavailable)}
    />
  </div>
}
