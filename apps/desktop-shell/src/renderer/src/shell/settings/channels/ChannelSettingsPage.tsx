import { Button } from 'antd'
import type { ChannelManagementResult } from '@platform/ai/agent-platform/channels/ChannelManagementContracts'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Modal } from '@platform/ui/components/modal'
import { StateView } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'
import { platformText } from '../../../i18n/platformText'
import { CHANNEL_DISPLAY_NAME } from '@platform/channels/channelDisplayNames'

import './channelSettings.css'
import { ChannelCreateDialog, submitNewChannelCredential } from './ChannelCreateDialog'
import {
  enableChannelWithSelfCheck,
  readCredentialConfigured,
  runChannelAction,
  sendChannelTestMessage
} from './channelSettingsActions'
import { ChannelEditDialog } from './ChannelEditDialog'
import type { ChannelPolicyPresence } from './ChannelFields'
import { ChannelLogsPanel } from './ChannelLogsPanel'
import { encryptChannelHandoff } from './secureCredentialHandoff'
import { ChannelPlatformList, type ChannelPlatformType } from './ChannelPlatformList'
import { ChannelRow } from './ChannelRow'
import { useChannelConversationEntry } from './useChannelConversationEntry'
import { CHANNEL_PLATFORM_LOGOS } from './channelPlatformLogos'
import {
  channelFailureReason,
  mutationFailureSentence,
  readAgents,
  toCatalog,
  toChannel
} from './channelSettingsPresentation'
import type { Agent, Catalog, Channel } from './channelSettingsPresentation'


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
  const [selectedType, setSelectedType] = useState<ChannelPlatformType>('telegram')
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
  /** 正在发测试消息的那一条（发送期间按钮禁用）。 */
  const [testBusyId, setTestBusyId] = useState<string | null>(null)
  /** 每条频道上一次测试消息的回执：同一位置替换，不堆行。 */
  const [testReceipts, setTestReceipts] = useState<
    Readonly<Record<string, { tone: 'muted' | 'bad'; text: string }>>
  >({})
  const [logsFor, setLogsFor] = useState<Channel | null>(null)
  /** 「查看会话」：三态、重试与「还读不到」的 toast 都在 hook 里；页面只传文案与错误出口。 */
  const conversationEntry = useChannelConversationEntry({
    // 具名原因走既有的失败码表；表外的码才用那句兜底。
    failureMessageFor: (code) => channelFailureReason(code, labels) ?? labels.channelOpenConversationFailed,
    onError: setError,
    stillUnreadableMessage: labels.channelConversationUnreadableAgain,
    retryActionLabel: labels.channelConversationRetry
  })

  const reload = async (): Promise<void> => {
    try {
      const [nextCatalog, nextChannels, agentState] = await Promise.all([
        window.platform.channels.catalog(),
        window.platform.channels.list(),
        window.platform.agents.listAgents({})
      ])
      setCatalog(nextCatalog.map(toCatalog))
      const rows = nextChannels.map(toChannel)
      setChannels(rows)
      // 「有没有绑定会话」是另一个口：列表先上屏，这一位后到，读不到就不给入口。
      void conversationEntry.readFlags(rows)
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


  const actionDeps = { labels, setBusyId, setError, reload }
  const enableDeps = { labels, setBusyId, setError, setEnableFailures, reload }
  const testDeps = { labels, language, setTestBusyId, setTestReceipts }

  const toggle = (channel: Channel, next: boolean): void => {
    if (!next) {
      void runChannelAction(
        channel,
        () => window.platform.channels.disable({ channelId: channel.id, actorId: 'settings-user' }),
        actionDeps
      )
      return
    }
    void enableChannelWithSelfCheck(channel, enableDeps)
  }

  /** 打开编辑弹层时先看有没有显式放行名单：查不到就记「未知」，不默认成任何一种。 */
  const openEditor = async (channel: Channel): Promise<void> => {
    setSaveError(null)
    setEditor({ mode: 'edit', channel })
    setPolicyPresence('unknown')
    try {
      const policies = await window.platform.channels.listPolicies({ channelId: channel.id, limit: 1 })
      setPolicyPresence(policies.length > 0 ? 'present' : 'none')
    } catch {
      setPolicyPresence('unknown')
    }
  }

  const createChannel = async (input: {
    name: string
    agentId: string
    token: string
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
      let tokenWrite: ChannelManagementResult | undefined
      if (tokenProvided) {
        const begin = await window.platform.channels.beginCredential({ channelId: editor.channel.id })
        const handoff = await encryptChannelHandoff(
          begin as Parameters<typeof encryptChannelHandoff>[0],
          editor.channel.id,
          'credential',
          { bot_token: input.token }
        )
        tokenWrite = await window.platform.channels.rotateCredential({
          channelId: editor.channel.id,
          actorId: 'settings-user',
          handoff
        })
      }
      // 写接口明确失败：**按它的码说人话**（频道不在了、凭据格式不对、状态没写进去……），
      // 不要用「没存上，请重试」盖掉唯一能说明原因的东西。这条也是回读之前必须判的：
      // 这时回读仍会读到**旧**凭据，只靠回读会被骗成「已配置」。
      if (tokenProvided && tokenWrite !== undefined && tokenWrite.ok !== true) {
        setSaveError(mutationFailureSentence(tokenWrite, labels))
        await reload()
        return
      }
      // 回读确认后再关弹层：没存上就不许显示「保存成功」。
      const stored = await readCredentialConfigured(editor.channel.id)
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
    await runChannelAction(target, () => window.platform.channels.remove({ channelId: target.id, actorId: 'settings-user' }), actionDeps)
  }

  return (
    <section className="channel-settings-page">
      <ChannelPlatformList
        labels={labels}
        selectedType={selectedType}
        onSelect={setSelectedType}
        catalog={catalog}
        language={language}
      />

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
                <h2 className="channel-detail-title">{CHANNEL_DISPLAY_NAME[selectedType][language]}</h2>
                {/* 三样都要：名字、一句用途、以及「为什么现在不能用」——缺用途那版只剩一句原因，
                    读者不知道这个平台是干什么的。 */}
                <p className="channel-detail-purpose">{labels.channelPlatformPurpose[selectedType]}</p>
                {supported ? null : (
                  <p className="channel-detail-reason">
                    {planned ? labels.channelNeedsEvidence : labels.channelUnsupportedPane}
                  </p>
                )}
              </div>
              {notConnectable || rows.length === 0 ? null : (
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
                {/* 句内动作：命令型一律 antd；`.text-action` 是「行内动作」的标记。 */}
                <Button type="text" size="small" className="text-action" onClick={() => void reload()}>
                  {labels.channelRefresh}
                </Button>
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
                    conversationEntry={conversationEntry.entryByChannel[channel.id]}
                    onOpenConversation={(channel) => void conversationEntry.open(channel)}
                    onRetryConversation={(channel) => void conversationEntry.retry(channel)}
                    onSendTest={(channel) => void sendChannelTestMessage(channel, testDeps)}
                    onToggle={toggle}
                    testBusy={testBusyId === channel.id}
                    testReceipt={testReceipts[channel.id] ?? null}
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
          platformName={CHANNEL_DISPLAY_NAME[selectedType][language]}
        />
      )}
    </section>
  )
}
