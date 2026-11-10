import type { ReactElement } from 'react'

import type { SettingsView } from '../../../service/intelligence/application/sourceProjection'
import { SettingsSourceTree, type SourceFilter } from './SettingsSourceTree'
import { SourceConfigSurface, type SourceConfigSurfaceProps } from './SourceConfigSurface'

/**
 * 「来源与采集」的两栏：**左侧源树 + 右侧单源配置**。
 *
 * 抽出来的原因：设置页与产品内「配置」抽屉要显示同一块东西。抄外观不是复用——两处各画一遍，
 * 迟早一边加了四格健康、另一边没加。所以把**同一块实现**交出去，参数就是数据与回调。
 *
 * 边界写死：**提示条（「别处改了、保留草稿」这类）不进来**——它是页面的语气，属于页面；
 * 这里只管树、详情两栏与它们的选择状态。加载态与读不到也归页面（页面知道该整屏给哪个状态）。
 */
export type SourcesSettingsPaneProps = {
  view?: SettingsView
  selectedProviderId?: string
  onSelectProvider: (providerId: string) => void
  filter: SourceFilter
  onFilterChange: (filter: SourceFilter) => void
  /** 左栏标题与分类名等文案。 */
  treeLabels: Parameters<typeof SettingsSourceTree>[0]['labels']
  /** 右栏那份「事实 + 文案」组装件需要的全部入参（由调用方原样给）。 */
  surface: Omit<SourceConfigSurfaceProps, 'provider'> & { providerId?: string }
}

export function SourcesSettingsPane(props: SourcesSettingsPaneProps): ReactElement {
  const provider = props.view?.groups
    .flatMap((group) => group.providers)
    .find((entry) => entry.providerId === props.selectedProviderId)
  const { providerId: _selected, ...surface } = props.surface

  return <>
    <SettingsSourceTree
      filter={props.filter}
      labels={props.treeLabels}
      selectedProviderId={props.selectedProviderId}
      view={props.view}
      onFilterChange={props.onFilterChange}
      onSelectProvider={props.onSelectProvider}
    />
    <div className="settings-detail-pane intelligence-detail-pane">
      {provider === undefined
        ? null
        : <div className="intelligence-detail-scroll"><SourceConfigSurface {...surface} provider={provider} /></div>}
    </div>
  </>
}
