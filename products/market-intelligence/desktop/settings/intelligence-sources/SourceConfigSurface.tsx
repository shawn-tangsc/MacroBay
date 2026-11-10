import { ProviderDetail, type ProviderDetailLabels } from './ProviderDetail'
import type { CollectionPolicyLabels } from './CollectionPolicySection'
import type { SourceRunOutcome } from './intelligenceSourceProfileEditor'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 「一个来源的配置面」——**唯一一处**把事实与文案组装成 `ProviderDetail` 组件的地方。
 *
 * 设置页（E1）与日历/看板那一侧必须显示**同一组字段与状态**：行、药丸、四格、采集策略、
 * 立即运行、失败提示。以前两个宿主各自手写一大段 `labels` 与回调，谁的顺手就少传一项
 * （日历那侧曾经连 `policy` 都没有）。现在两个宿主只交「读到的事实 + 文案 + 写回调」，
 * 组装留在这里；哪一项该出现，由这个组件说了算。
 *
 * 组装规则：
 * - `labels` 就是设置页文案本身（`text`），不再逐字段挑——逐字段挑的写法漏一个不会有人发现；
 * - 写回调保持**一条路径**：启用走 `onToggleSource`，跑一次走 `onRunNow`；组件不自己调数据层；
 * - `onDraftChange` 只上报「有没有草稿」，内容不出这一层。
 */
export type SourceConfigText = {
  sourceNames: ProviderDetailLabels['sourceNames']
  providerNames: ProviderDetailLabels['providerNames']
  panelNames: ProviderDetailLabels['panelNames']
  status: ProviderDetailLabels['status']
  toggleSource: ProviderDetailLabels['toggleSource']
  /** 文案表里叫 `credentialsRequired`；`ProviderDetail` 那一格叫 `credentials`。 */
  credentialsRequired: ProviderDetailLabels['credentials']
  website: ProviderDetailLabels['website']
  signup: ProviderDetailLabels['signup']
  inviteNote: ProviderDetailLabels['inviteNote']
  testConnection: ProviderDetailLabels['testConnection']
  jobRegistered: ProviderDetailLabels['jobRegistered']
  jobNotRegistered: ProviderDetailLabels['jobNotRegistered']
  connectionSucceeded: ProviderDetailLabels['connectionSucceeded']
  connectionFailed: ProviderDetailLabels['connectionFailed']
  connectionUnsupported: ProviderDetailLabels['connectionUnsupported']
  apiKey: ProviderDetailLabels['apiKey']
  unavailableReasonCode: ProviderDetailLabels['unavailableReasonCode']
  unavailableReasonCodeAria: ProviderDetailLabels['unavailableReasonCodeAria']
  automaticSyncStopped: ProviderDetailLabels['automaticSyncStopped']
  lastSuccessfulSync: ProviderDetailLabels['lastSuccessfulSync']
  health: ProviderDetailLabels['health']
  /** 设置页文案里的药丸词表与「N 项能力 · 已启用 M」模板。 */
  sourceBadges: { pending: string; advanced: string; calendar: string; proxy: string }
}

export type SourceConfigPolicy = NonNullable<Parameters<typeof ProviderDetail>[0]['policy']>

export type SourceConfigSurfaceProps = {
  /** 设置页那一份文案；两个宿主传同一个来源。 */
  text: SourceConfigText
  provider: ProviderView
  /** 只作初值：打开时把这一源所在行带进视野一次（抽屉的 `focus.sourceId`）。 */
  initialSourceId?: string
  /** 采集策略：每个源常显；不传就是这一端不展示策略组（宿主自行承担可见差异）。 */
  policy?: SourceConfigPolicy
  /** 目录声明的「平台允许立即运行」，按源给。 */
  supportsRunNowById?: Readonly<Record<string, boolean>>
  /** 启用开关的唯一写入点；返回 false = 没存上，组件回滚。 */
  onToggleSource?: (source: Readonly<{ sourceId: string; kind: string }>, enabled: boolean) => Promise<boolean>
  /** 立即运行，返回这一次的结果给行内显示。 */
  onRunNow?: (sourceId: string) => Promise<SourceRunOutcome>
  /* ── 宿主契约（看板/日历抽屉用的那三个）：启用必须走带 origin 的写回调，另两个动作不发域信号。 */
  /** 启用开关的宿主写入口；给了就优先于 `onToggleSource`，由本组件补 origin。 */
  onWriteSourceEnabled?: (source: Readonly<{ sourceId: string; kind: string }>, enabled: boolean, origin: string) => Promise<void> | void
  writeOrigin?: string
  /** 立即运行（宿主只关心「发出去了」）；要行内结果就传 `onRunNow`，它更完整。 */
  onRunSource?: (sourceId: string) => Promise<void>
  /** 测试连接（宿主侧入口；当前 `ProviderDetail` 的探测按钮走平台共享实现，这里留作契约）。 */
  onTestSource?: (sourceId: string) => Promise<void>
  /** 草稿状态（只报有没有）。 */
  onDraftChange?: (dirty: boolean) => void
  translation?: Parameters<typeof ProviderDetail>[0]['translation']
  onChanged?: () => void
  showSourceDetails?: boolean
  /** 这一份渲染在哪个面上；判定本身在 `ProviderDetail` 内部做一次。 */
  surface?: 'settings' | 'panel'
}

export function SourceConfigSurface(props: SourceConfigSurfaceProps): React.ReactElement {
  const onToggleSource = props.onToggleSource ?? (props.onWriteSourceEnabled === undefined
    ? undefined
    : async (source: Readonly<{ sourceId: string; kind: string }>, enabled: boolean): Promise<boolean> => {
      try {
        await props.onWriteSourceEnabled!(source, enabled, props.writeOrigin ?? 'source-config')
        return true
      } catch {
        return false
      }
    })
  const onRunNow = props.onRunNow ?? (props.onRunSource === undefined
    ? undefined
    // 宿主只有「发出去」这一档：不编造结果句子，行内显示空状态。
    : async (sourceId: string): Promise<SourceRunOutcome> => {
      await props.onRunSource!(sourceId)
      return { kind: 'unknown', notice: '' }
    })
  const labels: ProviderDetailLabels = {
    sourceNames: props.text.sourceNames,
    providerNames: props.text.providerNames,
    panelNames: props.text.panelNames,
    status: props.text.status,
    toggleSource: props.text.toggleSource,
    credentials: props.text.credentialsRequired,
    website: props.text.website,
    signup: props.text.signup,
    inviteNote: props.text.inviteNote,
    testConnection: props.text.testConnection,
    jobRegistered: props.text.jobRegistered,
    jobNotRegistered: props.text.jobNotRegistered,
    connectionSucceeded: props.text.connectionSucceeded,
    connectionFailed: props.text.connectionFailed,
    connectionUnsupported: props.text.connectionUnsupported,
    apiKey: props.text.apiKey,
    unavailableReasonCode: props.text.unavailableReasonCode,
    unavailableReasonCodeAria: props.text.unavailableReasonCodeAria,
    automaticSyncStopped: props.text.automaticSyncStopped,
    lastSuccessfulSync: props.text.lastSuccessfulSync,
    health: props.text.health,
    badges: {
      pending: props.text.sourceBadges.pending,
      advanced: props.text.sourceBadges.advanced,
      calendar: props.text.sourceBadges.calendar,
      proxy: props.text.sourceBadges.proxy
    },
  }
  return <ProviderDetail
    {...(props.initialSourceId === undefined ? {} : { initialSourceId: props.initialSourceId })}
    labels={labels}
    provider={props.provider}
    {...(props.policy === undefined ? {} : { policy: props.policy })}
    {...(props.supportsRunNowById === undefined ? {} : { supportsRunNowById: props.supportsRunNowById })}
    {...(onToggleSource === undefined ? {} : { onToggleSource })}
    {...(onRunNow === undefined ? {} : { onRunNow })}
    {...(props.onDraftChange === undefined ? {} : { onDraftChange: props.onDraftChange })}
    {...(props.translation === undefined ? {} : { translation: props.translation })}
    {...(props.onChanged === undefined ? {} : { onChanged: props.onChanged })}
    showSourceDetails={props.showSourceDetails ?? true}
    {...(props.surface === undefined ? {} : { surface: props.surface })}
  />
}
