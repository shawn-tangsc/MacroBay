import { Button, Switch } from 'antd'
import { CircleHelp, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { parseConfiguredModelRef, type ConfiguredModelRef } from '@platform/ai/model-defaults/configuredDefaultModel'
import type { JobScheduleView } from '@platform/jobs'
import { useConfirm } from '@platform/ui/components/confirm'
import { IconButton } from '@platform/ui/components/icon-button'
import { InlineNotice } from '@platform/ui/components/inline-notice'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import { SettingsRow } from '@platform/ui/components/settings-row'
import { SettingsSection } from '@platform/ui/components/settings-section'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { platformText } from '@renderer/i18n/platformText'
import { ModelPicker } from '@renderer/shell/components/ModelPicker/ModelPicker'
import type { ModelPickerCandidate, ModelPickerConstraints } from '@renderer/shell/components/ModelPicker/modelPickerOptions'

import type { BriefingPeriod, BriefingPeriodDraft } from '../../../contracts/dailyBriefingPeriod'
import { dailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { dailyBriefingPeriodClient } from '../../shared/ipc/dailyBriefingPeriodClient'
import { productText } from '../../shared/i18n/productText'
import { openModelSettings, openWebSearchSettings } from '../../shared/navigation/productShellNavigation'
import { BriefingPeriodDialog } from './BriefingPeriodDialog'
import './briefingSettingsScreen.css'
import { useDailyBriefingAiSettings } from './useDailyBriefingAiSettings'
import type { DailyBriefingText } from './dailyBriefingText'

/** 一期一条排期：定义 id = 产品基 id + 期 id；按 productId 与前缀两重认。 */
const BRIEFING_JOB_PREFIX = 'market-intelligence.dailyBriefing.'
const BRIEFING_PRODUCT_ID = 'market-intelligence'
const AI_MODEL_CONSTRAINTS: ModelPickerConstraints = { requireCapabilities: ['chat'] }

const EDIT_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.editRow'
const DELETE_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.deleteRow'
const AUTO_RETRY_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.autoRetry'
const AUTO_REASON_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.autoUnknownReason'
const PERIOD_RETRY_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.retryLoad'
const WEB_SEARCH_CONFIGURE_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.aiSettings.webSearchBannerConfigure'
const WEB_SEARCH_PROVIDERS_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.aiSettings.webSearchBannerProviders'
const WEB_SEARCH_DETAIL_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.aiSettings.webSearchUnsupported'
const WEB_SEARCH_SETUP_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.aiSettings.webSearchNeedsSetup'
const WEB_SEARCH_BOTH_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.aiSettings.webSearchBannerBothDetails'
const EMPTY_HINT_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.emptyHint'
const GENERATION_NOTE_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.generationSettings.note'
const GENERATION_NOTE_LABEL_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.generationSettings.noteLabel'
const MODEL_SERVICE_NOTE_KEY = 'pages.intelligence.portal.dashboard.dailyBriefing.aiSettings.modelServiceNote'

/** 宿主把屏上报的四样交给抽屉的底部保存栏（壳不读数据、不知道保存的是什么）。 */
export type BriefingScreenState = Readonly<{
  dirty: boolean
  saving: boolean
  failure?: string
  save: () => void
}>

type ScheduleRead =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'ready'; registered: boolean }>
  | Readonly<{ state: 'failed' }>

/**
 * 配置抽屉「日报」那一屏（重做版）：三个区块 + 一条只读事实。
 *
 * 版式照 `2026-11-10-drawer-four-screens-redesign.md`：设置页那套区块与行（区块标题 13/650，
 * 行 44，控件**左缘对齐标签列右边界**、不右对齐），保存交给抽屉底部那条统一栏（屏只上报状态）。
 *
 * 数据自己读、自己存：期列表走 `dailyBriefingPeriodClient`（弹框立即写，不进草稿），AI 设置走
 * `useDailyBriefingAiSettings`（**脏只认它的 `dirty` 一处**）。排期注册状态只从
 * `platform.jobs.listSchedules()` 的投影按期比对，不从启用开关推断、不拿「有期」当代理。
 */
export function DailyBriefingSettingsPanel({ onState }: Readonly<{
  /** 把「有没有改动 / 保存中 / 失败句 / 保存动作」报给抽屉壳。 */
  onState: (state: BriefingScreenState) => void
}>): React.ReactElement {
  const language = useShellLanguage()
  const text = productText[language].pages.intelligence.portal.dashboard.dailyBriefing
  const copy = text.settings.periods
  const resolveText = (key: string): string => resolveProductKey(language, key)
  const ai = useDailyBriefingAiSettings({ client: dailyBriefingClient, enabled: true })
  const confirm = useConfirm()

  const [periods, setPeriods] = useState<readonly BriefingPeriod[] | null>(null)
  const [periodsFailed, setPeriodsFailed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<BriefingPeriod | undefined>(undefined)
  const [periodSaving, setPeriodSaving] = useState(false)
  const [periodWriteFailed, setPeriodWriteFailed] = useState<'save' | 'remove' | undefined>(undefined)
  const [schedule, setSchedule] = useState<ScheduleRead>({ state: 'loading' })
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const languageName = (locale: string): string => (text.settings.languageNames as Record<string, string>)[locale] ?? locale

  const loadPeriods = (): void => {
    setPeriodsFailed(false)
    void dailyBriefingPeriodClient.list(language)
      .then((saved) => setPeriods(saved))
      .catch(() => { setPeriodsFailed(true); setPeriods(null) })
  }
  useEffect(loadPeriods, [language])

  // 排期注册：只读投影，按期逐条比对。任何一条对不上（期没有定义、或有孤立定义）都不是「已注册」。
  const loadSchedule = (): void => {
    setSchedule({ state: 'loading' })
    const bridge = (window as unknown as { platform?: { jobs?: { listSchedules?: () => Promise<JobScheduleView[]> } } }).platform?.jobs
    if (bridge?.listSchedules === undefined) { setSchedule({ state: 'failed' }); return }
    void bridge.listSchedules()
      .then((definitions) => {
        const registeredIds = new Set(definitions
          .filter((definition) => definition.productId === BRIEFING_PRODUCT_ID && definition.id.startsWith(BRIEFING_JOB_PREFIX) && definition.registered !== false)
          .map((definition) => definition.id))
        setPeriods((current) => {
          if (current === null) { setSchedule({ state: 'ready', registered: false }); return current }
          const expected = current.map((period) => `${BRIEFING_JOB_PREFIX}${period.id}`)
          const everyPeriodRegistered = expected.length > 0 && expected.every((id) => registeredIds.has(id))
          // 孤立注册（期已删、定义还在）不算已注册：它说明注册没跟上；也不发明第四态。
          const orphan = [...registeredIds].some((id) => !expected.includes(id))
          setSchedule({ state: 'ready', registered: everyPeriodRegistered && !orphan })
          return current
        })
      })
      .catch(() => setSchedule({ state: 'failed' }))
  }
  // 期先到、排期后才算得了：期列表变化时重算一次，别拿「还没有期」当「没注册」。
  useEffect(loadSchedule, [language, periods])

  const write = (draft: BriefingPeriodDraft): void => {
    setPeriodSaving(true)
    setPeriodWriteFailed(undefined)
    const target = editing
    void (target === undefined
      ? dailyBriefingPeriodClient.create(draft, language)
      : dailyBriefingPeriodClient.update(target.id, draft, language))
      .then((result) => {
        if (result.state !== 'saved') { setPeriodWriteFailed('save'); return }
        setAdding(false)
        setEditing(undefined)
        loadPeriods()
      })
      .catch(() => setPeriodWriteFailed('save'))
      .finally(() => setPeriodSaving(false))
  }

  const remove = (period: BriefingPeriod, index: number): void => {
    confirm({
      title: copy.deleteTitle.replace('{index}', String(index + 1)),
      description: copy.deleteBody,
      confirmLabel: copy.deleteConfirm,
      cancelLabel: text.periodDialog.cancel,
      tone: 'danger',
      onConfirm: () => {
        setPeriodWriteFailed(undefined)
        void dailyBriefingPeriodClient.remove(period.id, language)
          .then(() => loadPeriods())
          .catch(() => setPeriodWriteFailed('remove'))
      }
    })
  }

  // 脏只认 AI 编辑那一段的草稿：期列表的弹框立即写，不属于「未保存改动」。
  const dirty = ai.dirty
  const saving = ai.saving

  // 保存要读**最新**的草稿/写入口：屏幕上报的 save 可能是前一次渲染的闭包，但调用时取 ref 里的最新值。
  const latestAi = useRef(ai)
  useEffect(() => { latestAi.current = ai })
  const save = (): void => {
    const current = latestAi.current
    if (!current.draft) return
    // 下一次保存开始时清上一句：失败句只描述刚发生的那一次。
    setFailure(undefined)
    void current.save().then((ok) => {
      if (!ok) setFailure(text.settingsDrawer.saveFailed.replace('{sections}', text.settingsDrawer.sectionFailed.ai))
    })
  }

  const screenState = (): BriefingScreenState => ({
    dirty,
    saving,
    save,
    ...(failure === undefined ? {} : { failure })
  })
  const onStateRef = useRef(onState)
  useEffect(() => { onStateRef.current = onState })
  // 上报用 ref 里最新的一份 + 最新的 setter：cleanup 里读到的 state 会过期。
  const emitted = useRef<BriefingScreenState>(screenState())
  // 只在真实变化时上报；走 ref 调 setter，宿主传内联箭头也不会把这里拖进「渲染→上报→渲染」。
  useEffect(() => {
    const next = screenState()
    emitted.current = next
    onStateRef.current(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, failure])
  // 卸载 = 这一屏不再存在：必须把脏清掉，否则切走后宿主还挂着，关抽屉会误拦。
  useEffect(() => {
    const report = onStateRef.current
    return () => { report({ ...emitted.current, dirty: false }) }
  }, [])

  // 只有确实有期时才显示这一行：没有期时由期列表自己的空态说。
  const showScheduleRow = periods !== null && periods.length > 0
  const scheduleUnknown = schedule.state !== 'ready'
  const scheduleValue = scheduleUnknown
    ? copy.autoUnknown
    : schedule.registered ? copy.autoRegistered : copy.autoNotRegistered

  const modelCandidates: ModelPickerCandidate[] = [...ai.candidates]
  const followsDefault = ai.defaultModel !== null && ai.draft?.providerId === ai.defaultModel.providerId && ai.draft?.modelId === ai.defaultModel.modelId
  const followLabel = ai.defaultModel === null
    ? text.aiSettings.followDefault
    : `${text.aiSettings.followDefault} · ${ai.defaultModel.providerName} / ${ai.defaultModel.modelName}`

  return <div className="briefing-settings-screen" data-briefing-settings-panel="true">
    <SettingsSection
      title={text.settingsDrawer.sections.generation}
      info={<Popover
        labelKey={GENERATION_NOTE_KEY}
        resolveText={resolveText}
        trigger={(triggerProps) => <IconButton
          {...triggerProps}
          ariaLabelKey={GENERATION_NOTE_LABEL_KEY}
          icon={CircleHelp}
          resolveText={resolveText}
          size="sm"
          variant="plain"
        />}
      />}
      action={periodsFailed || periods === null
        ? null
        : <Button data-briefing-period-add="true" onClick={() => setAdding(true)} type="link">{copy.add}</Button>}

    >
        {periodsFailed
          ? <InlineNotice
            action={{ labelKey: PERIOD_RETRY_KEY, onSelect: loadPeriods }}
            resolveText={resolveText}
            tone="danger">
            {copy.loadFailed}
          </InlineNotice>
          : periods === null
            ? <LoadingState label={copy.loading} minHeight={90} />
            : periods.length === 0
              ? <div className="briefing-settings-empty" data-briefing-periods-empty="true">
                <p>{copy.empty}</p>
                {/* 说明句进 ⓘ：正文只留「没有一期」这个事实，不铺解释。 */}
                <Popover
                  labelKey={EMPTY_HINT_KEY}
                  resolveText={resolveText}
                  trigger={(triggerProps) => <IconButton
                    {...triggerProps}
                    ariaLabelKey={EMPTY_HINT_KEY}
                    icon={CircleHelp}
                    resolveText={resolveText}
                    size="sm"
                    variant="plain"
                  />}
                />
              </div>
              : periods.map((period, index) => <SettingsRow
                copyClassName="config-drawer__label"
                controlWrapperClassName="config-drawer__control"
                key={period.id}
                label={<strong>{copy.label.replace('{index}', String(index + 1))}</strong>}
                rowAttributes={{ 'data-period-id': period.id }}
                rowClassName="config-drawer__row">
                <span className="briefing-settings-row__value">
                  {copy.timeValue.replace('{time}', period.generationTime)}
                  {' · '}
                  {copy.windowValue.replace('{hours}', String(period.windowHours))}
                  {' · '}
                  {languageName(period.language)}
                </span>
                <span className="briefing-settings-row__actions">
                  <IconButton
                    ariaLabelKey={EDIT_KEY}
                    ariaLabelParams={{ index: String(index + 1) }}
                    dataAttributes={{ 'data-period-edit': period.id }}
                    icon={Pencil}
                    onSelect={() => { setEditing(period); setPeriodWriteFailed(undefined) }}
                    resolveText={(key) => key === EDIT_KEY ? copy.editRow.replace('{index}', String(index + 1)) : ''}
                    size="sm"
                    variant="plain"
                  />
                  <IconButton
                    ariaLabelKey={DELETE_KEY}
                    ariaLabelParams={{ index: String(index + 1) }}
                    dataAttributes={{ 'data-period-delete': period.id }}
                    icon={Trash2}
                    onSelect={() => remove(period, index)}
                    resolveText={(key) => key === DELETE_KEY ? copy.deleteRow.replace('{index}', String(index + 1)) : ''}
                    size="sm"
                    variant="plain"
                  />
                </span>
              </SettingsRow>)}
        {/* 区块级失败：一句话点名哪一期没写进去，跟这一段走。
            壳在动作栏上方也有一条（AI 编辑未保存）：两条同时在时只留壳那条，同一件事不说两遍。 */}
        {periodWriteFailed === undefined || failure !== undefined
          ? null
          : <InlineNotice tone="danger">
            {periodWriteFailed === 'remove' ? copy.removeFailed : copy.saveFailed}
          </InlineNotice>}
        {showScheduleRow ? <SettingsRow
          copyClassName="config-drawer__label"
          controlWrapperClassName="config-drawer__control"
          label={<strong>{copy.autoLabel}</strong>}
          rowAttributes={{ 'data-briefing-auto': scheduleUnknown ? 'unknown' : schedule.registered ? 'registered' : 'not-registered' }}
          rowClassName="config-drawer__row">
          <span className="briefing-settings-row__value">{scheduleValue}</span>
          {scheduleUnknown ? <>
            <Popover
              labelKey={AUTO_REASON_KEY}
              resolveText={resolveText}
              trigger={(triggerProps) => <IconButton
                {...triggerProps}
                ariaLabelKey={AUTO_REASON_KEY}
                icon={CircleHelp}
                resolveText={resolveText}
                size="sm"
                variant="plain"
              />}
            />
            <IconButton
              ariaLabelKey={AUTO_RETRY_KEY}
              dataAttributes={{ 'data-briefing-auto-retry': 'true' }}
              icon={RefreshCw}
              onSelect={loadSchedule}
              resolveText={(key) => key === AUTO_RETRY_KEY ? copy.autoRetry : ''}
              size="sm"
              variant="plain"
            />
          </> : null}
        </SettingsRow> : null}
    </SettingsSection>

    <SettingsSection
      title={text.settingsDrawer.sections.ai}
    >
        {ai.webSearchBlocked || !ai.webSearchSupported ? <InlineNotice
          action={{
            labelKey: ai.webSearchBlocked ? WEB_SEARCH_CONFIGURE_KEY : WEB_SEARCH_PROVIDERS_KEY,
            onSelect: openWebSearchSettings
          }}
          resolveText={resolveText}
          tone="caution">
          {ai.webSearchBlocked ? text.aiSettings.webSearchNeedsSetup : text.aiSettings.webSearchBannerUnsupported}
          <Popover
            labelKey={ai.webSearchBlocked
              ? (ai.webSearchSupported ? WEB_SEARCH_SETUP_KEY : WEB_SEARCH_BOTH_KEY)
              : WEB_SEARCH_DETAIL_KEY}
            resolveText={resolveText}
            trigger={(triggerProps) => <IconButton
              {...triggerProps}
              ariaLabelKey={ai.webSearchBlocked
                ? (ai.webSearchSupported ? WEB_SEARCH_SETUP_KEY : WEB_SEARCH_BOTH_KEY)
                : WEB_SEARCH_DETAIL_KEY}
              icon={CircleHelp}
              resolveText={resolveText}
              size="sm"
              variant="plain"
            />}
          />
        </InlineNotice> : null}
        {ai.state === 'load-failed'
          ? <InlineNotice tone="danger">{text.aiSettings.loadFailed}</InlineNotice>
          : ai.state === 'loading' || ai.draft === null
            ? <LoadingState label={text.aiSettings.loading} minHeight={90} />
            : <>
              <SettingsRow
                copyClassName="config-drawer__label"
                controlWrapperClassName="config-drawer__control"
                label={<strong>{text.aiSettings.enabled}</strong>}
                rowAttributes={{ 'data-briefing-ai-enabled': ai.draft.editorialEnabled ? 'on' : 'off' }}
                rowClassName="config-drawer__row">
                <Switch
                  checked={ai.draft.editorialEnabled}
                  onChange={(editorialEnabled) => ai.update({ editorialEnabled })}
                />
              </SettingsRow>
              <SettingsRow
                copyClassName="config-drawer__label"
                controlWrapperClassName="config-drawer__control"
                label={<strong>{text.aiSettings.webSearch}</strong>}
                rowClassName="config-drawer__row">
                <Switch
                  checked={ai.draft.webSearchEnabled}
                  onChange={(webSearchEnabled) => {
                    ai.clearWebSearchBlocked()
                    ai.update({
                      webSearchEnabled,
                      ...(webSearchEnabled && !ai.draft?.webSearchAuthorizedAt ? { webSearchAuthorizedAt: new Date().toISOString() } : {})
                    })
                  }}
                />
              </SettingsRow>
              {ai.webSearchSupported ? null : <SettingsRow
                copyClassName="config-drawer__label"
                headClassName="config-drawer__label-head"
                controlWrapperClassName="config-drawer__control briefing-settings-row__control"
                label={<>
                  <strong>{text.aiSettings.researchMode}</strong>
                  <Popover
                    labelKey={WEB_SEARCH_DETAIL_KEY}
                    resolveText={resolveText}
                    trigger={(triggerProps) => <IconButton
                      {...triggerProps}
                      ariaLabelKey={WEB_SEARCH_DETAIL_KEY}
                      icon={CircleHelp}
                      resolveText={resolveText}
                      size="sm"
                      variant="plain"
                    />}
                  />
                </>}
                rowClassName="config-drawer__row">
                <span className="briefing-settings-row__value">{text.aiSettings.researchModePlatform}</span>
                {/* 平台那一半随被说明的项走：跳转让读者去配搜索供应商，不再是屏里单独的「平台设置」块。 */}
                <button
                  className="config-drawer__row-action briefing-settings-jump"
                  data-global-link="web-search"
                  onClick={openWebSearchSettings}
                  type="button">
                  {text.aiSettings.goWebSearchProviders}
                </button>
              </SettingsRow>}

              {ai.draft.editorialEnabled ? <SettingsRow
                copyClassName="config-drawer__label"
                headClassName="config-drawer__label-head"
                controlWrapperClassName="config-drawer__control briefing-settings-row__control"
                label={<>
                  <strong>{text.aiSettings.model}</strong>
                  {/* 这一项属于平台设置：说明进 ⓘ，跳转贴在同一行的行尾。 */}
                  <Popover
                    labelKey={MODEL_SERVICE_NOTE_KEY}
                    resolveText={resolveText}
                    trigger={(triggerProps) => <IconButton
                      {...triggerProps}
                      ariaLabelKey={MODEL_SERVICE_NOTE_KEY}
                      icon={CircleHelp}
                      resolveText={resolveText}
                      size="sm"
                      variant="plain"
                    />}
                  />
                </>}
                rowClassName="config-drawer__row">
                <ModelPicker
                  allowClear
                  constraints={AI_MODEL_CONSTRAINTS}
                  labels={platformText[language].models}
                  models={modelCandidates}
                  onChange={(value: string | null) => {
                    const ref: ConfiguredModelRef | null = parseConfiguredModelRef(value)
                    ai.update({ providerId: ref?.providerId ?? '', modelId: ref?.modelId ?? '' })
                  }}
                  onClear={() => ai.update({ providerId: '', modelId: '' })}
                  pickerId="drawer-briefing-settings"
                  placeholder={followsDefault ? followLabel : text.aiSettings.followDefault}
                  placement="bottomRight"
                  providers={[...ai.providers]}
                  value={ai.draft.providerId && ai.draft.modelId && !followsDefault ? `${ai.draft.providerId}:${ai.draft.modelId}` : null}
                />
                <button
                  className="config-drawer__row-action briefing-settings-jump"
                  data-global-link="model-service"
                  onClick={openModelSettings}
                  type="button">
                  {text.aiSettings.goModelService}
                </button>
              </SettingsRow> : null}
            </>}
    </SettingsSection>

    <BriefingPeriodDialog
      key={editing?.id ?? 'new'}
      open={adding || editing !== undefined}
      text={text}
      periods={periods ?? []}
      {...(editing === undefined ? {} : { editing })}
      saving={periodSaving}
      onSave={write}
      onClose={() => { if (!periodSaving) { setAdding(false); setEditing(undefined); setPeriodWriteFailed(undefined) } }}
    />
  </div>
}

/** 产品文案的点分键解析（本屏多处用；未知键返回空串，绝不回退成键名）。 */
export function resolveProductKey(language: 'zh-CN' | 'en-US', key: string): string {
  let node: unknown = productText[language]
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return ''
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : ''
}

/** 屏自己用的文案类型别名（供测试构造）。 */
export type BriefingScreenText = DailyBriefingText
