import { Select, Switch } from 'antd'

import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'

export function RetentionReplaySection(props: {
  draftProfile: IntelligenceSourceProfile
  labels: {
    title: string
    rawArchiveEnabled: string
    retentionMode: string
    autoReplayAfterParserUpgrade: string
    retentionModes: Record<string, string>
  }
  onChange: (patch: Partial<IntelligenceSourceProfile>) => void
}): React.ReactElement {
  return (
    <section className="intelligence-section">
      <div className="intelligence-section-title">{props.labels.title}</div>
      <div className="intelligence-setting-grid">
        <SettingRow label={props.labels.rawArchiveEnabled}>
          <Switch
            size="small"
            checked={props.draftProfile.rawArchiveEnabled}
            onChange={(rawArchiveEnabled) => props.onChange({ rawArchiveEnabled })}
          />
        </SettingRow>
        <SettingRow label={props.labels.retentionMode}>
          <Select
            className="intelligence-select"
            value={props.draftProfile.retentionMode}
            options={Object.entries(props.labels.retentionModes).map(([value, label]) => ({ value, label }))}
            onChange={(retentionMode) => props.onChange({ retentionMode })}
          />
        </SettingRow>
        <SettingRow label={props.labels.autoReplayAfterParserUpgrade}>
          <Switch
            size="small"
            checked={props.draftProfile.autoReplayAfterParserUpgrade}
            onChange={(autoReplayAfterParserUpgrade) => props.onChange({ autoReplayAfterParserUpgrade })}
          />
        </SettingRow>
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
