import { Select } from 'antd'

import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import { SettingsInfo } from '../settingsInfo'
import { SettingsRow } from '@platform/ui/components/settings-row'

import { SourceSentimentRow } from './SourceRows'

export type CollectionPolicyLabels = {
  title: string
  collectionPreset: string
  manualPresetNote: string
  includeInSentiment: string
  plannedNotConfigurable?: string
  /** 收起态头行那枚短标（这组现在不能改）；空/没给就不挂。 */
  stoppedBadge?: string
  presets: Record<string, string>
}

/** 「采集预设不适用于这个源」那句说明住在 ⓘ 里，正文只留字段名与控件。 */
const PRODUCT_OWNED_NOTE_KEY = 'settings.intelligenceSources.collectionPolicy.productOwnedNote'
const PRODUCT_OWNED_NOTE_ARIA_KEY = 'settings.intelligenceSources.collectionPolicy.productOwnedNoteAria'

/**
 * 采集策略：频率档 / 是否纳入情绪分析。
 *
 * **这里没有「启用」**：启用状态只有一个归属，就是源那一行末尾的开关。组内再放一颗，
 * 就等于同一个事实存两份副本——组内读页面持有的 profile、行尾读源视图，各写各的，
 * 读者一动就互相打架（2026-11-10 用户实测：动组内那颗，上面整行被关掉）。
 */
export function CollectionPolicySection(props: {
  /** 这一组属于哪个源：按源实例化的设置行要用它派生实例键。 */
  sourceId: string
  draftProfile: IntelligenceSourceProfile
  supportsSentiment: boolean
  configurable?: boolean
  /**
   * Whether this source's enable switch (the one at the end of its row) is usable at all.
   * It only decides which note the group shows; the switch itself lives in the row.
   */
  enabledConfigurable?: boolean
  labels: CollectionPolicyLabels
  resolveText: (key: string) => string
  onChange: (patch: Partial<IntelligenceSourceProfile>) => void
}): React.ReactElement {
  const configurable = props.configurable ?? true
  const enabledConfigurable = props.enabledConfigurable ?? configurable
  // 产品自有采集的源：预设与情绪开关都不适用，读者要看到「为什么这行是灰的」——那句解释进 ⓘ，
  // 不占正文（正文只允许字段名、当前值、控件）。pending 那句是**状态**，留在正文。
  const productOwned = enabledConfigurable && !configurable
  return (
    <section className="intelligence-section">
      <div className="intelligence-section-title">{props.labels.title}</div>
      {!enabledConfigurable && props.labels.plannedNotConfigurable ? (
        <p className="intelligence-source-note">{props.labels.plannedNotConfigurable}</p>
      ) : null}
      <div className="intelligence-setting-grid">
        <SettingRow
          aside={productOwned
            ? <SettingsInfo
              ariaLabelKey={PRODUCT_OWNED_NOTE_ARIA_KEY}
              labelKeys={[PRODUCT_OWNED_NOTE_KEY]}
              resolveText={props.resolveText}
            />
            : undefined}
          label={props.labels.collectionPreset}
        >
          <div className="intelligence-preset-control">
            <Select
              className="intelligence-select"
              value={props.draftProfile.collectionPreset}
              disabled={!configurable}
              options={Object.entries(props.labels.presets).map(([value, label]) => ({ value, label }))}
              onChange={(collectionPreset) => props.onChange({ collectionPreset })}
            />
            {props.draftProfile.collectionPreset === 'manual' ? (
              <p className="intelligence-source-note">{props.labels.manualPresetNote}</p>
            ) : null}
          </div>
        </SettingRow>
      {/* 出现与否由注册表声明的 `visibleWhen` 决定（`view.supportsSentiment`），页面不再另判一次。 */}
      <SourceSentimentRow
        disabled={!configurable}
        onChange={props.onChange}
        profile={props.draftProfile}
        resolveText={props.resolveText}
        sourceId={props.sourceId}
        supportsSentiment={props.supportsSentiment}
      />
      </div>
    </section>
  )
}

function SettingRow(props: {
  label: string
  /** 字段名旁的 ⓘ：整句说明只住在这里。 */
  aside?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  // 结构来自共享组件（类名仍由本页给）：只换来源，DOM 与类名逐字不变。
  return (
    <SettingsRow
      controlWrapperClassName="intelligence-setting-control"
      copyClassName={props.aside === undefined
        ? 'intelligence-setting-label'
        : 'intelligence-setting-label intelligence-setting-label--with-info'}
      label={<>{props.label}{props.aside}</>}
      rowClassName="intelligence-setting-row">
      {props.children}
    </SettingsRow>
  )
}
