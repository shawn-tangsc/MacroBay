import { StatusPill } from '@platform/ui/components/status-pill'

import { calendarFeedRegistry } from '../../../service/intelligence/macro-calendar/calendarFeedRegistry'
import { SettingsInfo } from '../settingsInfo'
import { healthStateBadge } from './sourceHealthTone'
import { staleReasonLines } from './staleReasonLines'
import { SOURCE_ROW_TEMPLATES, sourceRowAttributes, sourceRowView } from './sourceSettingRows'
import type { ProviderDetailLabels } from './ProviderDetail'
import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import type { SourceHealthState, SourceView } from '../../../service/intelligence/application/sourceProjection'

/** 这条源是否由另一条 feed 的作业覆盖（Narwhal 三类的形状）。只读注册表字段。 */
function coverageOwnerOf(sourceId: string): string | undefined {
  return (calendarFeedRegistry as Readonly<Record<string, { coveredBy?: string }>>)[sourceId]?.coveredBy
}

/**
 * 菜单 1 的三行：**行长什么样住在这里，行的值/可见性/写入来自 `menus/sources.ts` 的声明**。
 *
 * 为什么不用通用设置行组件：来源行有自己的形状（列表行、状态药丸、行尾开关、条件 ⓘ、下拉下方的
 * 手动模式注解），塞进通用组件就得替它加一批形状开关——那是把特例装进通用件。所以这里是
 * 「自己的行组件 + 声明是唯一事实源」：值走 `read.select(view)`、可见性走 `visibleWhen`、
 * 行键走 `keyedBy` 模板；页面不再按 key 手写 if，也不再自己读字段。
 *
 * 写入仍只有一条路：三个回调都来自宿主（页面 hook），本文件零 IPC。
 */

/** 一个源要不要报「自动任务」那一格（没有自动采集能力的源不谈任务）。 */
export function needsJob(source: SourceView): boolean {
  return source.collection === 'adapter'
    || source.collection === 'job'
    || source.kind === 'official-calendar'
    || source.kind === 'market-calendar'
}

function SourceHealthPill({ state, resolveText, unavailable }: {
  state?: SourceHealthState
  resolveText: (key: string) => string
  unavailable: boolean
}): React.ReactElement | null {
  if (unavailable) {
    return <StatusPill labelKey="settings.intelligenceSources.unavailableShort" resolveText={resolveText} tone="muted" />
  }
  const badge = state === undefined ? undefined : healthStateBadge(state)
  if (badge === undefined) return null
  return <StatusPill labelKey={badge.labelKey} resolveText={resolveText} tone={badge.tone} />
}

export type SourceEnabledRowProps = Readonly<{
  /**
   * 需要 API Key 但还没配好：旁边一颗 ⓘ 说「先配置 API Key」。
   * 读者配好并验证通过后由上级把这个值变掉，提示自动消失。
   */
  credentialMissing?: boolean
  source: SourceView
  /** 已解析好的来源名（`sourceNames` 有的用文案，没有的用投影里的名字）。 */
  name: string
  /** 归属与看板（` · ` 串起来的那一行）。 */
  tags: readonly string[]
  /** 「这个源现在取不到」：药丸换 `unavailableShort`，与行尾那颗标同词。 */
  unavailable: boolean
  labels: Pick<ProviderDetailLabels, 'badges' | 'jobRegistered' | 'jobNotRegistered' | 'status'
    | 'rowTest' | 'rowTesting' | 'rowTestOk' | 'rowTestFailed' | 'rowTestUnsupported'>
  resolveText: (key: string) => string
  /** 读者配过自定义代理时不再提示「需要代理」。 */
  proxyConfigured: boolean
  /** 这一行那颗「测试」按钮：没有可测探针的源不传，行上就不出现按钮。 */
  onTest?: () => void
  /** 最近一次行内测试的结果；没有测过就不传（不画空壳）。 */
  testState?: 'testing' | 'ok' | 'failed' | 'unsupported'
  /**
   * 这一行**自己的**动作节点（目前只有「BLS 官方日程」的导入 ICS）。
   * 与「测试」同一组、排在它前面：两者都是「对这个源做一件事」，不该一个在行尾、一个漂在别处。
   */
  extraAction?: React.ReactNode
}>

/**
 * 一个源的**启用行**：名字 · 状态药丸 · 归属标签行 —— 开关。
 * 行名取声明的 `labelText(view)`，开关的值取声明的 `read.select(view)`。
 */
export function SourceEnabledRow(props: SourceEnabledRowProps): React.ReactElement | null {
  const { labels, resolveText, source } = props
  const view = { ...source, displayName: props.name }
  const row = sourceRowView(SOURCE_ROW_TEMPLATES.enabled, view)
  if (!row.visible) return null
  const label = row.descriptor.labelText?.(view) || props.name
  const enabled = row.value === true
  const metaParts = [
    ...new Set(props.tags),
    ...(source.requiresProxy && !props.proxyConfigured ? [labels.badges.proxy] : []),
    /* 被别的 feed 的作业覆盖时，这一行**没有自己的任务**：写「由同一次采集覆盖」，不写
       「未注册自动任务」——后者会让读者以为这一类型漏采了（Narwhal 一次调用返回全部 releases，
       三类是我们按 series 自己分的）。覆盖关系读注册表，不按名字或顺序猜。 */
    ...(coverageOwnerOf(source.sourceId) !== undefined
      ? [resolveText('settings.intelligenceSources.coveredBySameCollection')]
      : needsJob(source) ? [source.jobRegistered ? labels.jobRegistered : labels.jobNotRegistered] : [])
  ]
  const proxyPart = labels.badges.proxy
  /* 采集**产出**状态（用户 2026-11-21）。单独一行、在 meta 下方：这里说的是「有没有条目」，
     药丸说的是「采集连不连得上」，两件事都在这一行上，但谁也不许替谁说。两句可能同时为真，
     所以是列表而不是一句话（句子与插值都在 `staleReasonLines` 里，有用例）。 */
  const staleLines = staleReasonLines(source, resolveText)
  /* 这一行是**列表行**，不是设置行：复制列是 `div`、标签是 `strong`（原来就是这样）。
     所以它自己写这两层，不改通用设置行的形状。三列：内容 / 高级 / 开关。 */
  return <div
    className="source-provider-detail__row"
    {...sourceRowAttributes(SOURCE_ROW_TEMPLATES.enabled, source.sourceId)}
  >
    <div className="source-provider-detail__main">
      <strong>{label}</strong>
      {/* 一行药丸：只报**状态**。原因、上次成功、能不能立刻采都收进下面那四格——
          同一个事实两处说，迟早一处新一处旧。 */}
      <span className="source-provider-detail__status">
        <SourceHealthPill
          state={source.collection === 'none' ? undefined : source.healthState}
          resolveText={resolveText}
          unavailable={props.unavailable} />
      </span>
      {/* 第二行：归属与任务状态。纯文本 ` · ` 串起，不再是一排药丸。
          「已启用／未启用」不进这一行：行尾开关就是那个状态本身，同一个事实两个词就是说两遍
          （用户 2026-11-10 又一次确认这条）。 */}
      {/* meta 一行 = 可见性标签 + 代理/任务状态；**一件都没有就整段不渲染**，
          不留空行、空 span，也不留一个孤零零的 `·`。 */}
      {metaParts.length === 0
        ? null
        : <span className="source-provider-detail__tags-line">
          {metaParts.map((part, index) => <span key={part}>
            {index === 0 ? null : <i aria-hidden="true"> · </i>}
            {part === proxyPart ? <em className="source-provider-detail__proxy">{part}</em> : part}
          </span>)}
        </span>}
    </div>
    {staleLines.length === 0
      ? null
      : <span className="source-provider-detail__row-stale">
        {staleLines.map((line) => <span key={line}>{line}</span>)}
      </span>}
    {/* 标准表**写库**失败（用户 2026-11-19）：与「没采到」是两件事，**只进 ⓘ**——行上不加警告色，
        也不把来源标成故障（`healthState` 仍只说采集）。没有失败/还没写过/读不到三种情况不出这一颗。 */}
    {props.source.writeFailure === undefined
      ? null
      : <SettingsInfo
        ariaLabelKey="settings.intelligenceSources.writeFailureAria"
        labelKeys={[`settings.intelligenceSources.writeFailure.${props.source.writeFailure.code}`]}
        resolveText={resolveText} />}
    {props.credentialMissing === true
      ? <SettingsInfo
        ariaLabelKey="settings.intelligenceSources.credentialRequiredToEnableAria"
        labelKeys={['settings.intelligenceSources.credentialRequiredToEnable']}
        resolveText={resolveText} />
      : null}
    {/* 行尾是**文字状态**，不是开关（用户 2026-11-12）：这一屏的启停唯一编辑入口是页头那颗
        组开关，行上再画一颗点不动的开关就是假控件——「假控件比没有更坏」。
        文字不带交互语义、读屏按正文读出；只说这个源开没开，不写解释（解释进 ⓘ，这里不需要）。
        **颜色也不走这里**：要颜色就用药丸，别给这一行染色（守卫在 `settingsRowValues.test.ts`）。
        行上唯一的动作是这颗源自己的「测试」（读者 2026-11-12：每个已接入的源都要能测），
        它排在状态文字左边，测完只追加一个短词，不顶掉「已应用 / 未应用」。 */}
    <span className="source-provider-detail__row-tail">
      {props.extraAction ?? null}
      {props.onTest === undefined || labels.rowTest === undefined ? null : <button
        className="source-provider-detail__row-test"
        disabled={props.testState === 'testing'}
        onClick={props.onTest}
        type="button">
        {props.testState === 'testing' ? labels.rowTesting ?? '' : labels.rowTest}
      </button>}
      {props.testState === 'ok' || props.testState === 'failed' || props.testState === 'unsupported'
        ? <StatusPill
          labelKey={props.testState === 'ok'
            ? 'settings.intelligenceSources.rowTestOk'
            : props.testState === 'unsupported'
              ? 'settings.intelligenceSources.rowTestUnsupported'
              : 'settings.intelligenceSources.rowTestFailed'}
          resolveText={resolveText}
          tone={props.testState === 'ok' ? 'ok' : props.testState === 'unsupported' ? 'muted' : 'bad'} />
        : null}
      <span
        className="source-provider-detail__row-state"
        data-source-enabled={enabled ? 'true' : 'false'}
      >
        {enabled ? labels.status.applied : labels.status.notApplied}
      </span>
    </span>
  </div>
}
