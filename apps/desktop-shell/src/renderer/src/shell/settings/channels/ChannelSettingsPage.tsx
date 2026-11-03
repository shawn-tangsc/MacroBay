import { Button } from 'antd'
import type { ChannelManagementResult } from '@platform/ai/agent-platform/channels/ChannelManagementContracts'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Modal } from '@platform/ui/components/modal'
import { StateView } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'
import { platformText } from '../../../i18n/platformText'

import './channelSettings.css'
import { ChannelCreateDialog, submitNewChannelCredential } from './ChannelCreateDialog'
import { ChannelEditDialog } from './ChannelEditDialog'
import type { ChannelPolicyPresence } from './ChannelFields'
import { ChannelLogsPanel } from './ChannelLogsPanel'
import { encryptChannelHandoff } from './secureCredentialHandoff'
import { ChannelRow } from './ChannelRow'
import { CHANNEL_PLATFORM_LOGOS } from './channelPlatformLogos'
import { enableFailureSentence, mutationFailureSentence, readAgents, toCatalog, toChannel } from './channelSettingsPresentation'
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
  /** 现场检查没过时按频道就地显示原因（开关回弹，不把用户赶去别的页面）。 */
  const [enableFailures, setEnableFailures] = useState<Readonly<Record<string, string>>>({})
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; channel: Channel } | null>(null)
  // 编辑弹层里「空列表」到底是不是「允许所有」，取决于这个频道有没有显式放行名单。
  const [policyPresence, setPolicyPresence] = useState<ChannelPolicyPresence>('unknown')
  const [savingEdit, setSavingEdit] = useState(false)
  /** 保存弹层里的就地报错：页面级那句在弹层后面，读者根本看不见。 */
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Channel | null>(null)
  const [logsFor, setLogsFor] = useState<Channel | null>(null)

  const reload = async (): Promise<void> => {
    try {
      const [nextCatalog, nextChannels, agentState] = await Promise.all([
        window.platform.channels.catalog(),
        window.platform.channels.list(),
        window.platform.agents.listAgents({})
      ])
      setCatalog(nextCatalog.map(toCatalog))
      setChannels(nextChannels.map(toChannel))
      setAgents(readAgents(agentState))
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
  // 只要能实现（有适配器）就允许添加与管理；「有没有真机验收记录」不再挡用户使用。
  const notConnectable = platform === undefined || !platform.implemented
  const rows = channels.filter((channel) => channel.type === selectedType)


  const runAction = async (channel: Channel, action: () => Promise<ChannelManagementResult>): Promise<void> => {
    setBusyId(channel.id)
    setError(null)
    try {
      // 这些接口失败时**正常返回** `{ ok:false, code }`，不抛错：不看 `ok` 就会把「没停成」
      // 显示成成功。删除也一样——用户现在库里有一堆重复频道，正靠这一步逐条删。
      const result = await action()
      if (result.ok !== true) setError(mutationFailureSentence(result, labels))
      await reload()
    } catch {
      setError(labels.channelOperationFailed)
    } finally {
      setBusyId(null)
    }
  }

  const toggle = (channel: Channel, next: boolean): void => {
    if (!next) {
      void runAction(channel, () => window.platform.channels.disable({ id: channel.id, actorId: 'settings-user' }))
      return
    }
    void enableWithSelfCheck(channel)
  }

  /**
   * 点启用 → 主进程用已存凭据现场检查 → 通过就开。
   * 失败时后台已经写过审计行，**界面不再重复写**；只在行内说一句人话，开关回弹。
   */
  const enableWithSelfCheck = async (channel: Channel): Promise<void> => {
    setBusyId(channel.id)
    setError(null)
    setEnableFailures((current) => {
      const next = { ...current }
      delete next[channel.id]
      return next
    })
    try {
      const result = await window.platform.channels.requestEnable({
        id: channel.id,
        actorId: 'settings-user'
      })
      const sentence = enableFailureSentence(result, labels)
      if (sentence !== null) {
        setEnableFailures((current) => ({ ...current, [channel.id]: sentence }))
      }
      await reload()
    } catch {
      setError(labels.channelOperationFailed)
    } finally {
      setBusyId(null)
    }
  }

  const workspacePayload = (workspaceId: string | null): { type: 'system' } | { type: 'user'; workspaceId: string } =>
    workspaceId === null ? { type: 'system' } : { type: 'user', workspaceId }

  /** 打开编辑弹层时先看有没有显式放行名单：查不到就记「未知」，不默认成任何一种。 */
  const openEditor = async (channel: Channel): Promise<void> => {
    setSaveError(null)
    setEditor({ mode: 'edit', channel })
    setPolicyPresence('unknown')
    try {
      const policies = await window.platform.channels.listPolicies({ id: channel.id, limit: 1 })
      setPolicyPresence(policies.length > 0 ? 'present' : 'none')
    } catch {
      setPolicyPresence('unknown')
    }
  }

  /**
   * 保存凭据后**回读一次**：库里必须真的变成「已配置」。
   *
   * 「请求没报错」不等于「存进了库」。这条回读是用户上一次那件事的直接教训：界面显示存好了，
   * 库里 `credential_health` 却是 `missing`，于是点启用时变成「没得检查」。
   * 三种结果必须分开说：`true` 存上了、`false` 确定没存上、`null` 读不到（读不到 ≠ 没存上）。
   */
  const readCredentialConfigured = async (channelId: string): Promise<boolean | null> => {
    try {
      const view = await window.platform.channels.get(channelId)
      return view?.credential.hasCredential === true && view.credential.status === 'configured'
    } catch {
      return null
    }
  }

  const createChannel = async (input: {
    name: string
    agentId: string
    token: string
    workspaceId: string | null
    permissionMode: ChannelPermissionMode | null
    allowedChatIds: readonly string[]
  }): Promise<void> => {
    setSavingEdit(true)
    setError(null)
    setSaveError(null)
    let createdId: string | null = null
    try {
      // 返回形状是 `{ ok, code, channel }`——**id 在 `channel.id` 里，不在顶层**。
      // 上一版按 `{ id }` 取，于是「建成了」也被判成「操作失败」，用户再点一次就多一条频道。
      const created = (await window.platform.channels.create({
        type: selectedType,
        name: input.name,
        agentId: input.agentId,
        workspace: workspacePayload(input.workspaceId),
        // `null` 就是继承助手；不传 `'default'`，两者必须分得开。
        permissionMode: input.permissionMode,
        allowedChatIds: input.allowedChatIds,
        actorId: 'settings-user'
      }))
      const createdIdValue = created.ok === true ? created.channel?.id : undefined
      if (typeof createdIdValue !== 'string') {
        // 失败码要说人话（助手不在了、凭据不对……），不许一律「操作失败，请重试」。
        setSaveError(mutationFailureSentence(created, labels))
        return
      }
      createdId = createdIdValue
      const submitted = await submitNewChannelCredential(createdIdValue, input.token)
      // 返回 `ok: false` 也是失败（它不抛错），一样不许当成存好了。
      const stored = submitted?.ok === false ? false : await readCredentialConfigured(createdIdValue)
      // 建好了也要回读：频道的存在不等于凭据落库。两种结局分开说，且都关掉弹层——
      // 留着弹层让用户再点一次「创建」只会建出第二条重复频道。
      setError(
        stored === true
          ? null
          : stored === null
            ? labels.channelCredentialUnverified
            : labels.channelCreatedWithoutCredential
      )
      setEditor(null)
      setSaveError(null)
      await reload()
    } catch {
      if (createdId === null) {
        // 连频道都没建出来：留在弹层里说，页面那句在遮罩后面读者看不见。
        setSaveError(labels.channelOperationFailed)
        return
      }
      // 频道已经建好，只是凭据没落库：关掉弹层并把话说清（再点一次「创建」会建出重复频道）。
      setError(labels.channelCreatedWithoutCredential)
      setEditor(null)
      await reload()
    } finally {
      setSavingEdit(false)
    }
  }

  const saveEdit = async (input: {
    name: string
    agentId: string
    workspaceId: string | null
    permissionMode: ChannelPermissionMode | null
    allowedChatIds: readonly string[]
    token: string
  }): Promise<void> => {
    if (editor === null || editor.mode !== 'edit') return
    setSavingEdit(true)
    setError(null)
    setSaveError(null)
    const tokenProvided = input.token.trim().length > 0
    try {
      const updated = await window.platform.channels.update({
        id: editor.channel.id,
        name: input.name,
        agentId: input.agentId,
        workspace: workspacePayload(input.workspaceId),
        permissionMode: input.permissionMode,
        allowedChatIds: input.allowedChatIds,
        actorId: 'settings-user'
      })
      // 改都没改成（频道不在了、助手不在了）：就地报错，别继续往下写凭据。
      if (updated.ok !== true) {
        setSaveError(mutationFailureSentence(updated, labels))
        await reload()
        return
      }
      // 空串＝不修改旧 Token；非空＝整串替换（旧值全程不可读，走同一套加密交接）。
      let tokenWrite: { ok?: boolean } | undefined
      if (tokenProvided) {
        const begin = await window.platform.channels.beginCredential({ id: editor.channel.id })
        const handoff = await encryptChannelHandoff(
          begin as Parameters<typeof encryptChannelHandoff>[0],
          editor.channel.id,
          'credential',
          { bot_token: input.token }
        )
        tokenWrite = await window.platform.channels.rotateCredential({
          id: editor.channel.id,
          actorId: 'settings-user',
          handoff
        })
      }
      // 回读确认后再关弹层：没存上就不许显示「保存成功」。
      // 写接口返回 `ok: false` 也算没写成——回读这时仍会读到**旧**凭据，只看回读会被骗。
      const stored = tokenWrite?.ok === false ? false : await readCredentialConfigured(editor.channel.id)
      if (stored !== true) {
        // 填了还没存上 → 没存上；没填且库里本来就没有 → 先告诉他「需要填一个」；
        // 读不到 → 说读不到，但不许说成「没存」。
        setSaveError(
          stored === null
            ? labels.channelCredentialUnverified
            : tokenProvided
              ? labels.channelCredentialSaveFailed
              : labels.channelCredentialRequired
        )
        await reload()
        return
      }
      setEditor(null)
      await reload()
    } catch {
      // 弹层还开着：错误必须写在弹层里，页面级那句在遮罩后面读者看不见。
      setSaveError(labels.channelOperationFailed)
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
        {/* 原型里中列最上方有一行「频道」，与左导航的分组标题同一级：小号、次要色。 */}
        <p className="channel-platform-heading">{labels.channels}</p>
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
          <p className="channel-inline-error" role="alert">
            {error}
          </p>
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
              {notConnectable ? null : (
                <Button
                  className="channel-add-button"
                  icon={<Plus size={14} />}
                  onClick={() => {
                    setSaveError(null)
                    setEditor({ mode: 'create' })
                  }}
                  type="primary"
                >
                  {labels.channelAdd}
                </Button>
              )}
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
                action={{
                  labelKey: STATE_VIEW_ACTION_KEYS.create,
                  onSelect: () => {
                    setSaveError(null)
                    setEditor({ mode: 'create' })
                  }
                }}
                reasonCode="never-created"
                state="empty"
              />
            ) : (
              <div role="list">
                {rows.map((channel) => (
                  <ChannelRow
                    busy={busyId === channel.id}
                    channel={channel}
                    enableFailure={enableFailures[channel.id] ?? null}
                    key={channel.id}
                    labels={labels}
                    onDelete={setDeleting}
                    onEdit={(channel) => void openEditor(channel)}
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
          saveError={saveError}
          saving={savingEdit}
        />
      ) : null}

      {editor !== null && editor.mode === 'edit' ? (
        <ChannelEditDialog
          agents={agents}
          channel={editor.channel}
          labels={labels}
          policyPresence={policyPresence}
          onCancel={() => setEditor(null)}
          onSave={(input) => void saveEdit(input)}
          saveError={saveError}
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

      {logsFor === null ? null : (
        <ChannelLogsPanel
          channelId={logsFor.id}
          client={{
            // 日志面板只认一种形状（`{ rows }`）：三个读口在这里收窄一次，
            // 面板里就不需要「数组或 { rows}」的兼容层，上游漂移也不会被它掩盖。
            listAudits: async (input) => ({ rows: await window.platform.channels.listAudits(input) }),
            listDeliveryAudits: async (input) => ({ rows: await window.platform.channels.listDeliveryAudits(input) }),
            listRuntimeAudits: (input) => window.platform.channels.listRuntimeAudits(input)
          }}
          labels={labels}
          onClose={() => setLogsFor(null)}
          platformName={labels.channelPlatformName[selectedType]}
        />
      )}
    </section>
  )
}
