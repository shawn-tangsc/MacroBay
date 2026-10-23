import { Select, Switch } from 'antd'

import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'

export function CollectionPolicySection(props: {
  draftProfile: IntelligenceSourceProfile
  supportsSentiment: boolean
  configurable?: boolean
  /**
   * A product-owned collector stores the enable preference on the profile while the generic
   * collection policy (preset, scope) does not apply to it, so the switch is usable on its own.
   */
  enabledConfigurable?: boolean
  labels: {
    title: string
    enabled: string
    collectionPreset: string
    manualPresetNote: string
    includeInSentiment: string
    scopePolicy: string
    plannedNotConfigurable?: string
    productOwnedNote?: string
    presets: Record<string, string>
    scopePolicies: Record<string, string>
  }
  onEnabledChange: (enabled: boolean) => void
  onChange: (patch: Partial<IntelligenceSourceProfile>) => void
}): React.ReactElement {
  const configurable = props.configurable ?? true
  const enabledConfigurable = props.enabledConfigurable ?? configurable
  return (
    <section className="intelligence-section">
      <div className="intelligence-section-title">{props.labels.title}</div>
      {!enabledConfigurable && props.labels.plannedNotConfigurable ? (
        <p className="intelligence-source-note">{props.labels.plannedNotConfigurable}</p>
      ) : null}
      {enabledConfigurable && !configurable && props.labels.productOwnedNote ? (
        <p className="intelligence-source-note">{props.labels.productOwnedNote}</p>
      ) : null}
      <div className="intelligence-setting-grid">
        <SettingRow label={props.labels.enabled}>
          <Switch
            size="small"
            checked={props.draftProfile.enabled}
            disabled={!enabledConfigurable}
            onChange={(enabled) => props.onEnabledChange(enabled)}
          />
        </SettingRow>
        <SettingRow label={props.labels.collectionPreset}>
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
        <SettingRow label={props.labels.scopePolicy}>
          <Select
            className="intelligence-select intelligence-select-wide"
            value={props.draftProfile.scopePolicy}
            disabled={!configurable}
            options={Object.entries(props.labels.scopePolicies).map(([value, label]) => ({ value, label }))}
            onChange={(scopePolicy) => props.onChange({ scopePolicy })}
          />
        </SettingRow>
      {props.supportsSentiment ? (
          <SettingRow label={props.labels.includeInSentiment}>
            <Switch
              size="small"
              checked={props.draftProfile.includeInSentiment}
              disabled={!configurable}
              onChange={(includeInSentiment) => props.onChange({ includeInSentiment })}
            />
          </SettingRow>
      ) : null}
      </div>
    </section>
  )
}

function SettingRow(props: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="intelligence-setting-row">
      <span className="intelligence-setting-label">{props.label}</span>
      <div className="intelligence-setting-control">{props.children}</div>
    </div>
  )
}
