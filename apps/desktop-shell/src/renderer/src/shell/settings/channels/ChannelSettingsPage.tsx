import { Button, Input, Popconfirm, Select, Switch, Tag } from 'antd'
import { Plus, RefreshCw, RotateCw, ShieldOff, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { platformText } from '../../../i18n/platformText'
import { clearSensitiveDraft, encryptChannelHandoff } from './secureCredentialHandoff'

type Channel = {
  id: string
  type: 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat'
  name: string
  agentId: string
  state: 'credential-missing' | 'configuration-ready' | 'disabled' | 'deleting' | 'runtime-ready'
  credential: { status: 'configured' | 'missing' | 'unavailable'; hasCredential: boolean }
}

type Conversation = { id: string; kind: string; targetEnabled: boolean }
type RuntimeStatus = { channelId: string; generation: number; lifecycle: string; updatedAt: string | null }
type Candidate = { id: string; kind: 'direct' | 'group' | 'channel'; displayLabel: string | null; firstSeenAt: string; lastSeenAt: string; hitCount: number; status: 'pending' | 'allowed' | 'ignored' }
type Policy = { id: string; subjectType: 'user' | 'conversation'; conversationKind: string | null }
type Agent = { id: string; name: string }
type Catalog = { type: string; status: 'planned' | 'blocked' | 'supported'; reason: string; implemented: boolean }

export function ChannelSettingsPage({ language }: { language: 'zh-CN' | 'en-US' }): React.ReactElement {
  const labels = platformText[language].settings
  const [catalog, setCatalog] = useState<Catalog[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [agentId, setAgentId] = useState<string | undefined>()
  const [createType, setCreateType] = useState<'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat'>('telegram')
  const [editName, setEditName] = useState('')
  const [editAgentId, setEditAgentId] = useState<string | undefined>()
  const [credentialDraft, setCredentialDraft] = useState('')
  const [appCredentialDraft, setAppCredentialDraft] = useState('')
  const [policyDraft, setPolicyDraft] = useState('')
  const [policies, setPolicies] = useState<Policy[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [candidateTargets, setCandidateTargets] = useState<Record<string, boolean>>({})
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)

  const current = useMemo(() => channels.find((channel) => channel.id === selected) ?? null, [channels, selected])
  const currentCatalog = current ? catalog.find((entry) => entry.type === current.type) : undefined
  const currentSupported = current ? catalog.some((entry) => entry.type === current.type && entry.status === 'supported') : false
  const currentImplemented = currentCatalog?.implemented === true

  const reload = async (): Promise<void> => {
    const [nextCatalog, nextChannels, agentState] = await Promise.all([
      window.platform.channels.catalog(),
      window.platform.channels.list(),
      window.platform.agents.listAgents({})
    ])
    setCatalog(nextCatalog as Catalog[])
    setChannels(nextChannels as Channel[])
    setAgents((agentState as { agents?: Agent[] }).agents ?? [])
    setSelected((previous) => previous ?? (nextChannels as Channel[])[0]?.id ?? null)
  }

  const reloadDetails = async (channelId: string): Promise<void> => {
    const [nextPolicies, nextConversations, nextCandidates, nextRuntime] = await Promise.all([
      window.platform.channels.listPolicies({ id: channelId, limit: 100 }),
      window.platform.channels.listConversations({ id: channelId, limit: 100 }),
      window.platform.channels.listCandidates({ id: channelId, limit: 100 }),
      window.platform.channels.runtimeStatus({ id: channelId })
    ])
    setPolicies(nextPolicies as Policy[])
    setConversations(nextConversations as Conversation[])
    setCandidates(nextCandidates as Candidate[])
    setRuntimeStatus(nextRuntime as RuntimeStatus)
  }

  useEffect(() => {
    void reload()
  }, [])

  useEffect(() => {
    if (current) void reloadDetails(current.id)
    else {
      setPolicies([])
      setConversations([])
      setCandidates([])
      setRuntimeStatus(null)
    }
  }, [current?.id])

  useEffect(() => {
    setEditName(current?.name ?? '')
    setEditAgentId(current?.agentId)
  }, [current?.id, current?.name, current?.agentId])

  const create = async (): Promise<void> => {
    if (!agentId) return
    await window.platform.channels.create({ type: createType, name, agentId, actorId: 'settings-user' })
    setName('')
    await reload()
  }

  const saveCredential = async (): Promise<void> => {
    if (!current || !currentImplemented || !credentialDraft || ((current.type === 'slack' || current.type === 'feishu' || current.type === 'qq') && !appCredentialDraft)) return
    try {
      const begin = await window.platform.channels.beginCredential({ id: current.id })
      const handoff = await encryptChannelHandoff(begin as Parameters<typeof encryptChannelHandoff>[0], current.id, 'credential',
        current.type === 'slack'
          ? { bot_token: credentialDraft, app_token: appCredentialDraft }
          : current.type === 'feishu'
            ? { app_id: credentialDraft, app_secret: appCredentialDraft }
            : current.type === 'qq'
              ? { app_id: credentialDraft, client_secret: appCredentialDraft }
              : current.type === 'discord'
                ? { bot_token: credentialDraft }
            : { bot_token: credentialDraft })
      const submit = current.credential.hasCredential
        ? window.platform.channels.rotateCredential
        : window.platform.channels.submitCredential
      await submit({ id: current.id, actorId: 'settings-user', handoff })
      await reload()
    } finally {
      clearSensitiveDraft(setCredentialDraft)
      clearSensitiveDraft(setAppCredentialDraft)
    }
  }

  const update = async (): Promise<void> => {
    if (!current || !editAgentId) return
    await window.platform.channels.update({ id: current.id, name: editName, agentId: editAgentId, actorId: 'settings-user' })
    await reload()
  }

  const createPolicy = async (): Promise<void> => {
    if (!current || !policyDraft) return
    try {
      const begin = await window.platform.channels.beginPolicy({ id: current.id })
      const handoff = await encryptChannelHandoff(begin as Parameters<typeof encryptChannelHandoff>[0], current.id, 'policy', {
        subjectType: 'user',
        key: policyDraft
      })
      await window.platform.channels.createPolicy({ id: current.id, actorId: 'settings-user', handoff })
      await reloadDetails(current.id)
    } finally {
      clearSensitiveDraft(setPolicyDraft)
    }
  }

  return (
    <section className="settings-workspace channel-settings">
      <aside className="channel-settings-rail">
        <header>
          <strong>{labels.channels}</strong>
          <Button size="small" icon={<RefreshCw size={14} />} onClick={() => void reload()}>
            {labels.channelRefresh}
          </Button>
        </header>
        {channels.length === 0 ? <p>{labels.channelNoInstances}</p> : null}
        {channels.map((channel) => (
          <button
            key={channel.id}
            type="button"
            className={channel.id === selected ? 'active' : ''}
            onClick={() => setSelected(channel.id)}
          >
            <strong>{channel.name}</strong>
            <small>{labels.channelState[channel.state]}</small>
          </button>
        ))}
        <section>
          <Select
            aria-label={labels.channels}
            value={createType}
            options={catalog.filter((entry) => entry.type === 'telegram' || entry.type === 'slack' || entry.type === 'feishu' || entry.type === 'qq' || entry.type === 'discord' || entry.type === 'wechat').map((entry) => ({ value: entry.type, label: entry.type }))}
            onChange={setCreateType}
          />
          <Input value={name} aria-label={labels.channelName} placeholder={labels.channelName} onChange={(event) => setName(event.target.value)} />
          <Select
            aria-label={labels.channelAgentId}
            placeholder={labels.channelAgentId}
            value={agentId}
            options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
            onChange={setAgentId}
          />
          <Button disabled={!name.trim() || !agentId} icon={<Plus size={14} />} onClick={() => void create()}>
            {labels.channelCreate}
          </Button>
        </section>
        {catalog.filter((entry) => entry.type !== 'telegram').map((entry) => (
          <p key={entry.type}>
            <Tag>{labels.channelCatalogStatus[entry.status]}</Tag>
            {entry.type}
          </p>
        ))}
      </aside>
      <main className="channel-settings-detail">
        {current ? (
          <>
            <header>
              <strong>{current.name}</strong>
              <Tag>{current.state === 'runtime-ready' ? labels.channelRunning : labels.channelPlanned}</Tag>
            </header>
            <p>{credentialStatusLabel(current.credential.status, labels)}</p>
            <Input value={editName} aria-label={labels.channelName} onChange={(event) => setEditName(event.target.value)} />
            <Select
              aria-label={labels.channelAgentId}
              value={editAgentId}
              options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
              onChange={setEditAgentId}
            />
            <Button disabled={!editName.trim() || !editAgentId} onClick={() => void update()}>{labels.channelUpdate}</Button>
            {current.type === 'wechat' ? <p>{labels.channelWechatEnrollment}</p> : !currentImplemented ? <p>{labels.channelAdapterUnavailable}</p> : <>
              <Input.Password
                aria-label={current.type === 'feishu' ? labels.channelLarkAppId : current.type === 'qq' ? labels.channelQqAppId : current.type === 'discord' ? labels.channelDiscordBotToken : labels.channelCredential}
                value={credentialDraft}
                onChange={(event) => setCredentialDraft(event.target.value)}
                autoComplete="off"
              />
              {current.type === 'slack' || current.type === 'feishu' || current.type === 'qq' ? <Input.Password aria-label={current.type === 'feishu' ? labels.channelLarkAppSecret : current.type === 'qq' ? labels.channelQqClientSecret : labels.channelAppCredential} value={appCredentialDraft} onChange={(event) => setAppCredentialDraft(event.target.value)} autoComplete="off" /> : null}
              <Button disabled={!credentialDraft || ((current.type === 'slack' || current.type === 'feishu' || current.type === 'qq') && !appCredentialDraft)} onClick={() => void saveCredential()}>{labels.channelSaveCredential}</Button>
            </>}
            <p>{labels.channelState[current.state]}</p>
            <p>{labels.channelRuntimeGeneration}: {runtimeStatus?.generation ?? 0} · {labels.channelRuntimeLifecycle}: {runtimeStatus?.lifecycle ?? 'missing'}</p>
            <section>
              <strong>{labels.channelCandidates}</strong>
              {candidates.length === 0 ? <p>{labels.channelCandidatesEmpty}</p> : candidates.map((candidate) => (
                <div key={candidate.id} className="channel-target-row">
                  <span>{candidate.displayLabel ?? labels.channelCandidateUnknown} · {labels.channelConversationKind[candidate.kind]}</span>
                  <Switch
                    aria-label={labels.channelCandidateAlsoTarget}
                    checked={candidateTargets[candidate.id] ?? true}
                    onChange={(checked) => setCandidateTargets((previous) => ({ ...previous, [candidate.id]: checked }))}
                  />
                  <small>{labels.channelCandidateAlsoTarget}</small>
                  <Button
                    size="small"
                    onClick={() => void window.platform.channels.allowCandidate({
                      channelId: current.id,
                      candidateId: candidate.id,
                      enableTarget: candidateTargets[candidate.id] ?? true
                    }).then(() => reloadDetails(current.id))}
                  >
                    {labels.channelCandidateAllow}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => void window.platform.channels.ignoreCandidate({ channelId: current.id, candidateId: candidate.id }).then(() => reloadDetails(current.id))}
                  >
                    {labels.channelCandidateIgnore}
                  </Button>
                </div>
              ))}
            </section>
            {current.type !== 'wechat' ? <section>
              <strong>{labels.channelPolicy}</strong>
              <Input
                aria-label={labels.channelPolicy}
                value={policyDraft}
                onChange={(event) => setPolicyDraft(event.target.value)}
                autoComplete="off"
              />
              <Button disabled={!policyDraft.trim()} onClick={() => void createPolicy()}>{labels.channelPolicyCreate}</Button>
              {policies.map((policy) => (
                <Button
                  key={policy.id}
                  size="small"
                  onClick={() => void window.platform.channels.deletePolicy({ channelId: current.id, policyId: policy.id, actorId: 'settings-user' }).then(() => reloadDetails(current.id))}
                >
                  {labels.channelPolicySubject[policy.subjectType]} {labels.channelDelete}
                </Button>
              ))}
            </section> : null}
            {current.type !== 'wechat' ? <section>
              <strong>{labels.channelTarget}</strong>
              {conversations.map((conversation) => (
                <div key={conversation.id} className="channel-target-row">
                  <span>{labels.channelConversationKind[conversation.kind as keyof typeof labels.channelConversationKind]}</span>
                  <Switch
                    aria-label={labels.channelTarget}
                    checked={conversation.targetEnabled}
                    onChange={(enabled) => void window.platform.channels.setTarget({
                      channelId: current.id,
                      conversationId: conversation.id,
                      enabled,
                      actorId: 'settings-user'
                    }).then(() => reloadDetails(current.id))}
                  />
                </div>
              ))}
            </section> : null}
            <Button icon={<ShieldOff size={14} />} onClick={() => void window.platform.channels.disable({ id: current.id, actorId: 'settings-user' }).then(reload)}>
              {labels.channelDisable}
            </Button>
            {current.state !== 'runtime-ready' ? <p>{labels.channelEnableBlocked}</p> : null}
            <Button disabled={!currentSupported || current.credential.status !== 'configured' || current.state === 'deleting'} onClick={() => void window.platform.channels.requestEnable({ id: current.id, actorId: 'settings-user' }).then(reload)}>
              {labels.channelEnable}
            </Button>
            <Button disabled={current.state !== 'runtime-ready'} icon={<RotateCw size={14} />} onClick={() => void window.platform.channels.restart({ id: current.id, actorId: 'settings-user' }).then(reload)}>
              {labels.channelRestart}
            </Button>
            <Popconfirm
              title={labels.channelDeleteConfirm}
              okText={labels.channelDelete}
              cancelText={labels.channelCancel}
              onConfirm={() => void window.platform.channels.remove({ id: current.id, actorId: 'settings-user' }).then(reload)}
            >
              <Button danger icon={<Trash2 size={14} />}>{labels.channelDelete}</Button>
            </Popconfirm>
          </>
        ) : null}
      </main>
    </section>
  )
}

function credentialStatusLabel(
  status: Channel['credential']['status'],
  labels: typeof platformText['en-US']['settings']
): string {
  if (status === 'configured') return labels.channelCredentialConfigured
  if (status === 'unavailable') return labels.channelCredentialUnavailable
  return labels.channelCredentialMissing
}
