import { Button } from 'antd'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Modal } from '@platform/ui/components/modal'
import { StateView } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'
import { platformText } from '../../../i18n/platformText'

import './channelSettings.css'
import { ChannelCreateDialog, submitNewChannelCredential } from './ChannelCreateDialog'
import { ChannelEditDialog } from './ChannelEditDialog'
import { ChannelRow } from './ChannelRow'
import { CHANNEL_PLATFORM_LOGOS } from './channelPlatformLogos'
import type { Agent, Catalog, Channel, ChannelPermissionMode } from './channelSettingsPresentation'

type CatalogType = 'telegram' | 'feishu' | 'qq' | 'wechat' | 'discord' | 'slack'

// 顺序照设计固定：飞书 → Telegram → QQ → 微信 → Discord → Slack（不按接入状态重排）。
const PLATFORM_ORDER: readonly CatalogType[] = ['feishu', 'telegram', 'qq', 'wechat', 'discord', 'slack']

/**
 * 设置 → 频道（原型 A：列表与行）。
 *
 * 这一屏只回答一件事：**哪些频道存在、各自什么状态**。它不再画详情面板——运行代际、请求启用、
 * 适配器证据、待授权会话、访问策略都不上屏：那些要么是内部账，要么是这次改版明确不做的。
 *
 * 两处口径与旧实现一致，别在重构里丢掉：
 * - 列表**读失败**与「还没有频道」是两句话：前者给重试，后者给加号；已经有旧数据时只标一句 stale；
 * - 未接入的平台点进去只有一句话，不画添加按钮、不带红字（红字会被读成「你操作错了」）。
 */
export function ChannelSettingsPage({ language }: { language: 'zh-CN' | 'en-US' }): React.ReactElement {
  const labels = platformText[language].settings
  const [catalog, setCatalog] = useState<Catalog[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedType, setSelectedType] = useState<CatalogType>('telegram')
  const [initialLoading, setInitialLoading] = useState(true)
  const [readError, setReadError] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; channel: Channel } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleting, setDeleting] = useState<Channel | null>(null)
  const [logsFor, setLogsFor] = useState<Channel | null>(null)

  const reload = async (): Promise<void> => {
    try {
      const [nextCatalog, nextChannels, agentState] = await Promise.all([
        window.platform.channels.catalog(),
        window.platform.channels.list(),
        window.platform.agents.listAgents({})
      ])
      setCatalog(nextCatalog as Catalog[])
      setChannels(nextChannels as Channel[])
      setAgents((agentState as { agents?: Agent[] }).agents ?? [])
      setReadError(false)
      setStale(false)
    } catch {
      // 第一次就没读到：给错误态与重试；已经有列表：保留旧列表并标一句「这是上次读到的」。
      setReadError(true)
      setStale(true)
    } finally {
      setInitialLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const platform = catalog.find((entry) => entry.type === selectedType)
  const implemented = platform?.implemented === true
  // 「能接」= 证据完备（supported），不是「代码里有适配器」：`implemented` 只说明收凭据有意义。
  const supported = platform?.status === 'supported'
  const planned = platform?.status === 'planned'
  // 「还没接」= 没有适配器，或被挡在验收证据之外：这一类的右侧只留三样（名字、一句用途、一句原因），
  // 不画加号、不画频道行、也不画空态块——空态会被读成「这里本来可以有频道」。
  const notConnectable = platform === undefined || platform.status === 'blocked' || !platform.implemented
  const rows = channels.filter((channel) => channel.type === selectedType)


  const runAction = async (channel: Channel, action: () => Promise<unknown>): Promise<void> => {
    setBusyId(channel.id)
    setError(null)
    try {
      await action()
      await reload()
    } catch {
      setError(labels.channelOperationFailed)
    } finally {
      setBusyId(null)
    }
  }

  const toggle = (channel: Channel, next: boolean): void => {
    void runAction(channel, () =>
      next
        ? window.platform.channels.requestEnable({ id: channel.id, actorId: 'settings-user' })
        : window.platform.channels.disable({ id: channel.id, actorId: 'settings-user' })
    )
  }

  const workspacePayload = (workspaceId: string | null): { type: 'system' } | { type: 'user'; workspaceId: string } =>
    workspaceId === null ? { type: 'system' } : { type: 'user', workspaceId }

  const createChannel = async (input: {
    name: string
    agentId: string
    token: string
    workspaceId: string | null
    permissionMode: ChannelPermissionMode | null
  }): Promise<void> => {
    setSavingEdit(true)
    setError(null)
    try {
      const created = (await window.platform.channels.create({
        type: selectedType,
        name: input.name,
        agentId: input.agentId,
        workspace: workspacePayload(input.workspaceId),
        // `null` 就是继承助手；不传 `'default'`，两者必须分得开。
        permissionMode: input.permissionMode,
        actorId: 'settings-user'
      })) as { id?: string } | undefined
      if (typeof created?.id === 'string') await submitNewChannelCredential(created.id, input.token)
      setEditor(null)
      await reload()
    } catch {
      setError(labels.channelOperationFailed)
    } finally {
      setSavingEdit(false)
    }
  }

  const saveEdit = async (input: {
    name: string
    agentId: string
    workspaceId: string | null
    permissionMode: ChannelPermissionMode | null
  }): Promise<void> => {
    if (editor === null || editor.mode !== 'edit') return
    setSavingEdit(true)
    setError(null)
    try {
      await window.platform.channels.update({
        id: editor.channel.id,
        name: input.name,
        agentId: input.agentId,
        workspace: workspacePayload(input.workspaceId),
        permissionMode: input.permissionMode,
        actorId: 'settings-user'
      })
      setEditor(null)
      await reload()
    } catch {
      setError(labels.channelOperationFailed)
    } finally {
      setSavingEdit(false)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return
    const target = deleting
    setDeleting(null)
    await runAction(target, () => window.platform.channels.remove({ id: target.id, actorId: 'settings-user' }))
  }

  return (
    <section className="channel-settings-page">
      <nav aria-label={labels.channels} className="channel-platform-list">
        {PLATFORM_ORDER.map((type) => (
          <button
            aria-current={type === selectedType}
            className="channel-platform-item"
            data-implemented={catalog.find((entry) => entry.type === type)?.implemented === true}
            key={type}
            onClick={() => setSelectedType(type)}
            type="button"
          >
            <span aria-hidden="true" className="channel-platform-logo" data-platform-logo={type}>
              {CHANNEL_PLATFORM_LOGOS[type]()}
            </span>
            <span>{labels.channelPlatformName[type]}</span>
          </button>
        ))}
      </nav>

      <div className="channel-detail">
        {error === null ? null : (
          <p role="alert">{error}</p>
        )}

        {initialLoading ? (
          <StateView size="lg" state="loading" />
        ) : readError && channels.length === 0 ? (
          <StateView
            action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => void reload() }}
            reasonCode="unreadable"
            size="lg"
            state="error"
          />
        ) : (
          <>
            <header className="channel-detail-header">
              <div>
                <h2 className="channel-detail-title">{labels.channelPlatformName[selectedType]}</h2>
                {/* 三样都要：名字、一句用途、以及「为什么现在不能用」——缺用途那版只剩一句原因，
                    读者不知道这个平台是干什么的。 */}
                <p className="channel-detail-purpose">{labels.channelPlatformPurpose[selectedType]}</p>
                {supported ? null : (
                  <p className="channel-detail-reason">
                    {planned ? labels.channelNeedsEvidence : labels.channelUnsupportedPane}
                  </p>
                )}
              </div>
              {supported ? (
                <Button
                  className="channel-add-button"
                  icon={<Plus size={14} />}
                  onClick={() => setEditor({ mode: 'create' })}
                  type="primary"
                >
                  {labels.channelAdd}
                </Button>
              ) : null}
            </header>

            {!notConnectable && stale ? (
              <p className="channel-settings-stale" role="status">
                <span>{labels.channelStaleNotice}</span>
                <button onClick={() => void reload()} type="button">
                  {labels.channelRefresh}
                </button>
              </p>
            ) : null}

            {notConnectable ? null : rows.length === 0 ? (
              // 空态走组件契约：标准两行（通用标题 + 原因句）+ 一个「添加」动作。
              // 不自绘、也不给 StateView 加「只显示一行」的开关——同一件事只说一遍即可。
              <StateView
                action={{ labelKey: STATE_VIEW_ACTION_KEYS.create, onSelect: () => setEditor({ mode: 'create' }) }}
                reasonCode="never-created"
                state="empty"
              />
            ) : (
              <div role="list">
                {rows.map((channel) => (
                  <ChannelRow
                    busy={busyId === channel.id}
                    channel={channel}
                    key={channel.id}
                    labels={labels}
                    onDelete={setDeleting}
                    onEdit={(channel) => setEditor({ mode: 'edit', channel })}
                    onLogs={setLogsFor}
                    onToggle={toggle}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {editor !== null && editor.mode === 'create' ? (
        <ChannelCreateDialog
          agents={agents}
          labels={labels}
          onCancel={() => setEditor(null)}
          onCreate={(input) => void createChannel(input)}
          saving={savingEdit}
        />
      ) : null}

      {editor !== null && editor.mode === 'edit' ? (
        <ChannelEditDialog
          agents={agents}
          channel={editor.channel}
          labels={labels}
          onCancel={() => setEditor(null)}
          onSave={(input) => void saveEdit(input)}
          saving={savingEdit}
        />
      ) : null}

      <Modal
        open={deleting !== null}
        width="compact"
        onClose={() => setDeleting(null)}
        titleKey="settings.channels.delete"
        resolveText={(key) => (key === 'settings.channels.delete' ? labels.channelDelete : '')}
        footer={
          <>
            <Button key="cancel" onClick={() => setDeleting(null)}>
              {labels.channelCancel}
            </Button>
            <Button danger key="delete" onClick={() => void confirmDelete()} type="primary">
              {labels.channelDelete}
            </Button>
          </>
        }
      >
        <p>{labels.channelDeleteConfirm}</p>
      </Modal>

      <Modal
        open={logsFor !== null}
        width="expanded"
        onClose={() => setLogsFor(null)}
        titleKey="settings.channels.logs"
        titleParams={{ name: logsFor?.name ?? '' }}
        resolveText={(key) => (key === 'settings.channels.logs' ? `${labels.channelLogs} · {name}` : '')}
      >
        <p className="channel-logs-empty">{labels.channelLogsEmpty}</p>
      </Modal>
    </section>
  )
}
