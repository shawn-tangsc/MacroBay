import { Drawer, Input, InputNumber, Select, Switch } from 'antd'
import { useEffect, useState } from 'react'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import { agentPermissionModes } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { AppSettings, ChatSettings } from '@platform/settings/schema/appSettings'

import {
  bindSessionAgent,
  renameSession,
  setAgentHeartbeatEnabled,
  setAgentPermissionMode,
  setAgentSoulMode
} from '../agentStateActions'
import {
  setAgentHeartbeatEnabledViaApi,
  setAgentPermissionModeViaApi,
  setAgentSoulModeViaApi,
  setSessionAgentViaApi,
  updateSessionViaApi
} from '../agentSessionDataApi'
import { useAgentText } from '../agentTextProvider'

type AgentChatSettingsDrawerProps = {
  open: boolean
  state: AgentStoreState
  agent: AgentEntity
  session: AgentSessionEntity
  onClose: () => void
  onChatSettingsChange: (settings: ChatSettings) => void
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
}

export default function AgentChatSettingsDrawer({
  open,
  state,
  agent,
  session,
  onClose,
  onChatSettingsChange,
  onStateChange
}: AgentChatSettingsDrawerProps): React.ReactElement {
  const t = useAgentText()
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null)
  const [sessionNameDraft, setSessionNameDraft] = useState(session.name)

  useEffect(() => {
    if (!open) return
    void window.platform.settings.get().then((settings) => setChatSettings((settings as AppSettings).chat))
  }, [open])

  useEffect(() => {
    if (!open) return
    setSessionNameDraft(session.name)
  }, [open, session.name])

  async function updateChatSettings(patch: Partial<ChatSettings>): Promise<void> {
    if (!chatSettings) return
    const next = { ...chatSettings, ...patch }
    const settings = (await window.platform.settings.update({ chat: next })) as AppSettings
    setChatSettings(settings.chat)
    onChatSettingsChange(settings.chat)
  }

  function commitSessionName(): void {
    const nextName = sessionNameDraft.trim()
    if (!nextName || nextName === session.name) {
      setSessionNameDraft(session.name)
      return
    }
    void updateSessionViaApi(window.platform, session.id, { name: nextName }).catch(() => {
      onStateChange((current) => renameSession(current, session.id, nextName))
    })
  }

  return (
    <Drawer open={open} width={420} title={t.settingsDrawer.title} onClose={onClose} className="agent-chat-settings-drawer">
      <div className="agent-settings-form">
        <label>
          <span>{t.settingsDrawer.sessionName}</span>
          <Input
            value={sessionNameDraft}
            onChange={(event) => setSessionNameDraft(event.target.value)}
            onBlur={commitSessionName}
            onPressEnter={commitSessionName}
          />
        </label>

        <label>
          <span>{t.settingsDrawer.boundAgent}</span>
          <Select
            value={session.agentId ?? undefined}
            options={state.agents.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(agentId) => {
              void setSessionAgentViaApi(window.platform, session.id, agentId).catch(() => {
                onStateChange((current) => bindSessionAgent(current, session.id, agentId))
              })
            }}
          />
        </label>

        <label>
          <span>{t.settingsDrawer.permissionMode}</span>
          <Select
            value={agent.configuration?.permission_mode ?? 'default'}
            options={agentPermissionModes.map((mode) => ({ value: mode, label: t.permissionMode[mode] }))}
            onChange={(value) => {
              if (!(agentPermissionModes as readonly string[]).includes(value)) return
              void setAgentPermissionModeViaApi(window.platform, agent, value).catch(() => {
                onStateChange((current) => setAgentPermissionMode(current, agent.id, value))
              })
            }}
          />
        </label>

        <div className="agent-settings-switch-row">
          <span>
            <strong>{t.settingsDrawer.soulMode}</strong>
            <small>{t.settingsDrawer.soulModeDescription}</small>
          </span>
          <Switch
            checked={agent.configuration?.soul_enabled === true}
            onChange={(checked) => {
              void setAgentSoulModeViaApi(window.platform, agent, checked).catch(() => {
                onStateChange((current) => setAgentSoulMode(current, agent.id, checked))
              })
            }}
          />
        </div>

        <div className="agent-settings-switch-row">
          <span>
            <strong>{t.settingsDrawer.heartbeat}</strong>
            <small>{t.settingsDrawer.heartbeatDescription}</small>
          </span>
          <Switch
            checked={agent.configuration?.heartbeat_enabled !== false}
            onChange={(checked) => {
              void setAgentHeartbeatEnabledViaApi(window.platform, agent, checked).catch(() => {
                onStateChange((current) => setAgentHeartbeatEnabled(current, agent.id, checked))
              })
            }}
          />
        </div>

        {chatSettings ? (
          <>
            <label>
              <span>{t.settingsDrawer.messageStyle}</span>
              <Select
                value={chatSettings.messageStyle}
                options={[
                  { value: 'plain', label: t.messageStyle.plain },
                  { value: 'bubble', label: t.messageStyle.bubble }
                ]}
                onChange={(value) => void updateChatSettings({ messageStyle: value })}
              />
            </label>

            <label>
              <span>{t.settingsDrawer.messageNavigation}</span>
              <Select
                value={chatSettings.messageNavigation}
                options={[
                  { value: 'none', label: t.messageNavigation.none },
                  { value: 'buttons', label: t.messageNavigation.buttons },
                  { value: 'anchor', label: t.messageNavigation.anchor }
                ]}
                onChange={(value) => void updateChatSettings({ messageNavigation: value })}
              />
            </label>

            <div className="agent-settings-switch-row">
              <span>
                <strong>{t.settingsDrawer.narrowMode}</strong>
              </span>
              <Switch checked={chatSettings.narrowMode} onChange={(checked) => void updateChatSettings({ narrowMode: checked })} />
            </div>

            <label>
              <span>{t.settingsDrawer.fontSize}</span>
              <InputNumber
                min={12}
                max={22}
                value={chatSettings.fontSize}
                onChange={(value) => {
                  if (typeof value === 'number') void updateChatSettings({ fontSize: value })
                }}
              />
            </label>

            <label>
              <span>{t.settingsDrawer.sendShortcut}</span>
              <Select
                value={chatSettings.sendShortcut}
                options={[
                  { value: 'enter', label: 'Enter' },
                  { value: 'mod-enter', label: 'Cmd/Ctrl + Enter' }
                ]}
                onChange={(value) => void updateChatSettings({ sendShortcut: value })}
              />
            </label>

            <div className="agent-settings-switch-row">
              <span>
                <strong>{t.settingsDrawer.confirmDeleteMessage}</strong>
                <small>{t.settingsDrawer.confirmDeleteMessageDescription}</small>
              </span>
              <Switch
                checked={chatSettings.confirmDeleteMessage}
                onChange={(checked) => void updateChatSettings({ confirmDeleteMessage: checked })}
              />
            </div>
          </>
        ) : null}

        <button
          type="button"
          className="agent-settings-link-button"
          onClick={() => {
            void setSessionAgentViaApi(window.platform, session.id, agent.id).catch(() => {
              onStateChange((current) => bindSessionAgent(current, session.id, agent.id))
            })
          }}>
          {t.settingsDrawer.useCurrentAgent}
        </button>
      </div>
    </Drawer>
  )
}
