import { StatusPill } from '@platform/ui/components/status-pill'

import { SettingsInfo } from '../settingsInfo'
import { healthStateBadge } from './sourceHealthTone'
import { SOURCE_ROW_TEMPLATES, sourceRowAttributes, sourceRowView } from './sourceSettingRows'
import type { ProviderDetailLabels } from './ProviderDetail'
import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import type { SourceHealthState, SourceView } from '../../../service/intelligence/application/sourceProjection'

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
  labels: Pick<ProviderDetailLabels, 'badges' | 'jobRegistered' | 'jobNotRegistered' | 'status'>
  resolveText: (key: string) => string
  /** 读者配过自定义代理时不再提示「需要代理」。 */
  proxyConfigured: boolean
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
    ...(needsJob(source) ? [source.jobRegistered ? labels.jobRegistered : labels.jobNotRegistered] : [])
  ]
  const proxyPart = labels.badges.proxy
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
    {props.credentialMissing === true
      ? <SettingsInfo
        ariaLabelKey="settings.intelligenceSources.credentialRequiredToEnableAria"
        labelKeys={['settings.intelligenceSources.credentialRequiredToEnable']}
        resolveText={resolveText} />
      : null}
    {/* 行尾是**文字状态**，不是开关（用户 2026-11-12）：这一屏的启停唯一编辑入口是页头那颗
        组开关，行上再画一颗点不动的开关就是假控件——「假控件比没有更坏」。
        文字不带交互语义、读屏按正文读出；只说这个源开没开，不写解释（解释进 ⓘ，这里不需要）。
        **颜色也不走这里**：要颜色就用药丸，别给这一行染色（守卫在 `settingsRowValues.test.ts`）。 */}
    <span
      className="source-provider-detail__row-state"
      data-source-enabled={enabled ? 'true' : 'false'}
    >
      {enabled ? labels.status.enabled : labels.status.disabled}
    </span>
  </div>
}
