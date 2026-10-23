import { Button, Tooltip } from 'antd'
import { RefreshCw, SquareArrowOutUpRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { AgentChannelRuntimeSnapshot } from '@platform/ai/agent-platform/channels/ChannelRuntimeService'
import type { AgentChannelEntity } from '@platform/ai/agent-platform/schemas/channelSchemas'

import { getAgentChannelTypeIconUrl } from '../agentChannelVisuals'
import { buildSessionChannelRuntimeSettingCards } from '../agentChannelRuntimeSettingsViewModel'
import { useAgentText } from '../agentTextProvider'

type AgentChannelRuntimePanelProps = {
  sessionId: string
  channels: readonly AgentChannelEntity[]
  channelRuntimeSnapshot: AgentChannelRuntimeSnapshot
  onRestartChannel: (channelId: string) => Promise<void>
}

export default function AgentChannelRuntimePanel({
  sessionId,
  channels,
  channelRuntimeSnapshot,
  onRestartChannel
}: AgentChannelRuntimePanelProps): React.ReactElement {
  const t = useAgentText()
  const [restartingChannelId, setRestartingChannelId] = useState<string | null>(null)
  const cards = useMemo(
    () =>
      buildSessionChannelRuntimeSettingCards({
        sessionId,
        channels,
        snapshot: channelRuntimeSnapshot,
        runtimeText: t.sessionItem.channelRuntime,
        settingsText: t.settingsDrawer.channelRuntime
      }),
    [channelRuntimeSnapshot, channels, sessionId, t.sessionItem.channelRuntime, t.settingsDrawer.channelRuntime]
  )

  if (cards.length === 0) {
    return (
      <section className="agent-settings-channel-panel">
        <div className="agent-settings-channel-panel-header">
          <strong>{t.settingsDrawer.channelRuntime.title}</strong>
        </div>
        <p className="agent-settings-channel-empty">{t.settingsDrawer.channelRuntime.empty}</p>
      </section>
    )
  }

  return (
    <section className="agent-settings-channel-panel">
      <div className="agent-settings-channel-panel-header">
        <strong>{t.settingsDrawer.channelRuntime.title}</strong>
        <small>{t.settingsDrawer.channelRuntime.boundChannels(cards.length)}</small>
      </div>
      <div className="agent-settings-channel-list">
        {cards.map((card) => {
          const iconUrl = getAgentChannelTypeIconUrl(card.channelType)
          const isRestarting = restartingChannelId === card.channelId
          return (
            <article key={card.channelId} className={`agent-settings-channel-card ${card.runtimeTone}`}>
              <div className="agent-settings-channel-topline">
                <span className="agent-settings-channel-title">
                  {iconUrl ? (
                    <span className="agent-settings-channel-icon-wrap">
                      <img className="agent-settings-channel-icon" src={iconUrl} alt="" aria-hidden="true" />
                      <span className={`agent-settings-channel-dot ${card.runtimeTone}`} aria-hidden="true" />
                    </span>
                  ) : null}
                  <span className="agent-settings-channel-copy">
                    <strong>{card.channelName}</strong>
                    <small>{card.runtimeLabel}</small>
                  </span>
                </span>
                <span className="agent-settings-channel-actions">
                  {card.credentialUrl ? (
                    <Tooltip title={t.settingsDrawer.channelRuntime.openCredentialUrl}>
                      <Button
                        className="ant-shell-icon-button"
                        type="text"
                        size="small"
                        icon={<SquareArrowOutUpRight size={14} />}
                        aria-label={t.settingsDrawer.channelRuntime.openCredentialUrl}
                        onClick={() => void window.platform.app.openExternal(card.credentialUrl!)}
                      />
                    </Tooltip>
                  ) : null}
                  {card.runtimeTone !== 'inactive' ? (
                    <Tooltip title={t.settingsDrawer.channelRuntime.restart}>
                      <Button
                        className="ant-shell-icon-button"
                        type="text"
                        size="small"
                        loading={isRestarting}
                        icon={isRestarting ? undefined : <RefreshCw size={14} />}
                        aria-label={t.settingsDrawer.channelRuntime.restart}
                        onClick={() => {
                          setRestartingChannelId(card.channelId)
                          void onRestartChannel(card.channelId)
                            .catch(() => undefined)
                            .finally(() => {
                              setRestartingChannelId((current) =>
                                current === card.channelId ? null : current
                              )
                            })
                        }}
                      />
                    </Tooltip>
                  ) : null}
                </span>
              </div>
              <div className="agent-settings-channel-summary">
                <span>{card.activeChatsLabel}</span>
                <span>{card.updatedAtLabel}</span>
                {card.lastCheckedAtLabel ? <span>{card.lastCheckedAtLabel}</span> : null}
              </div>
              <div className="agent-settings-channel-details">
                {card.lifecycleLabel ? (
                  <SettingDetailRow label={t.sessionItem.channelRuntime.lifecycle} value={card.lifecycleLabel} />
                ) : null}
                {card.credentialLabel ? (
                  <SettingDetailRow label={t.sessionItem.channelRuntime.credential} value={card.credentialLabel} />
                ) : null}
                {card.sessionLabel ? (
                  <SettingDetailRow label={t.sessionItem.channelRuntime.session} value={card.sessionLabel} />
                ) : null}
                {card.runtimeMessage ? (
                  <SettingDetailRow label={t.sessionItem.channelRuntime.message} value={card.runtimeMessage} multiline />
                ) : null}
                {card.credentialHint ? (
                  <SettingDetailRow label={t.sessionItem.channelRuntime.hint} value={card.credentialHint} multiline />
                ) : null}
                {card.expiresAtLabel ? (
                  <SettingDetailRow label={t.settingsDrawer.channelRuntime.expiresAt} value={card.expiresAtLabel} />
                ) : null}
                {card.credentialQrText ? (
                  <SettingDetailRow label={t.sessionItem.channelRuntime.qr} value={card.credentialQrText} multiline />
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function SettingDetailRow({
  label,
  value,
  multiline = false
}: {
  label: string
  value: string
  multiline?: boolean
}): React.ReactElement {
  return (
    <div className="agent-settings-channel-detail-row">
      <span>{label}</span>
      <strong className={multiline ? 'multiline' : undefined}>{value}</strong>
    </div>
  )
}
