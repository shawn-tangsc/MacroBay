import { useState } from 'react'
import type { ReactElement } from 'react'

import { CollapsibleGroup } from '@platform/ui/components/collapsible-group'

/**
 * 来源列表的五维筛选条（左侧条件区）。
 *
 * 三件事只在这里做，宿主只管数据：
 * 1. **同一维取或、跨维取且**——「加上这个值之后还剩几条」由宿主算好传进来（`remainingCount`），
 *    组件不比数据，所以「还剩 N」和实际结果永远同源；
 * 2. **命中 0 的值不隐藏、只置灰**（`data-empty`），点下去进空态——隐藏会让人以为没有这个值；
 * 3. **没有结果时「清空筛选」不渲染**（不是 `visibility: hidden`、不是禁用）：空态里那颗动作归
 *    `StateView(filtered-out)`，同一动作不许同时有两颗，更不许留一颗看不见但能 Tab 进去的按钮。
 *
 * 行本身用平台 `CollapsibleGroup`：头行与箭头归壳，这里只放内容（标题 / 已选值 / 命中数），
 * 所以头行里没有任何可聚焦元素。
 */

/** 五维的固定顺序；标签与取值由宿主按注册表给（顺序以宿主传进来的 `dimensions` 为准）。 */
export const SOURCE_FILTER_DIMENSION_KEYS = ['panel', 'category', 'collection', 'readiness', 'status'] as const

export type SourceFilterDimensionKey = string

export type SourceFilterOption = Readonly<{
  value: string
  /** 读者看到的词（标签或状态词），宿主解析好再传。 */
  label: string
}>

export type SourceFilterDimension = Readonly<{
  key: SourceFilterDimensionKey
  label: string
  options: readonly SourceFilterOption[]
}>

/**
 * 文案全部由宿主给（键与解析归 i18n，组件里零字面量）。
 *
 * 带 `{name}` 的模板由组件按参数填，规则与平台 `fillLabelParams` 一致——不在这里拼句子。
 */
export type SourceFilterBarText = Readonly<{
  /** 与平台 `ui.state.action.clear-filter` 同字同形，空态里那颗动作也是它。 */
  clearFilter: string
  /** `{option} · 还剩 {count}`——数字必须带词，读者不能猜它是总数还是剩余。 */
  optionRemaining: string
  /** `{count} 条`：收起态右侧的命中数。 */
  rowCount: string
  /** `{dimension} 的取值`：展开区这组值的可访问名。 */
  valuesAriaLabel: string
  /** 一个值都没选时，行上显示的那个词。 */
  allValues: string
  /** 选了超过两个值时折叠成 `{count} 个`。 */
  pickedMany: string
  /** 多个已选值之间的分隔。 */
  valueJoiner: string
  /** `{total} 个来源`：没有任何条件时。 */
  summaryAll: string
  /** `已选 {picked} 个条件 · {matched} / {total}`：有条件时。 */
  summaryFiltered: string
}>

export type SourceFilterBarProps = Readonly<{
  dimensions: readonly SourceFilterDimension[]
  /** 每维已选的值；没有的维度返回空数组或不给都算「全部」。 */
  selection: Readonly<Record<SourceFilterDimensionKey, readonly string[] | undefined>>
  totalSourceCount: number
  /** 当前条件下剩几条；为 0 即空态，左侧那颗清空按钮**不渲染**。 */
  resultCount: number
  /** 其它条件都生效、本维不算时剩几条（收起态右侧显示的那个数）。 */
  rowMatchCount: (dimensionKey: SourceFilterDimensionKey) => number
  /** 把该值加上去之后剩几条（同维取或）。 */
  remainingCount: (dimensionKey: SourceFilterDimensionKey, value: string) => number
  onToggleValue: (dimensionKey: SourceFilterDimensionKey, value: string) => void
  onClear: () => void
  text: SourceFilterBarText
}>

/**
 * 折叠头这一组用 `header` 内容槽，壳不会向解析器要任何键（`titleKey` / `metaKey` / `rows` 都不传），
 * 所以这里没有句子可解析；函数保留只为满足组件的必填参数，回显键名而不是吃掉它。
 */
function resolveNoKey(key: string): string {
  return key
}

/** 模板填充：只认 `{name}`，找不到的参数原样留着（缺参在用例里现形，不静默变空串）。 */
function fill(template: string, params: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? (params[key] as string) : match
  )
}

export function SourceFilterBar(props: SourceFilterBarProps): ReactElement {
  const { dimensions, selection, text } = props
  const [openKey, setOpenKey] = useState<string | null>(null)

  const pickedCount = dimensions.reduce((sum, dimension) => sum + (selection[dimension.key] ?? []).length, 0)
  const isEmpty = props.resultCount === 0

  return (
    <div className="source-filter-bar">
      <div className="source-filter-bar__conditions">
        {dimensions.map((dimension) => {
          const picked = selection[dimension.key] ?? []
          const labelById = new Map(dimension.options.map((option) => [option.value, option.label]))
          const pickedLabels = picked.map((value) => labelById.get(value) ?? value)
          const pickedText =
            pickedLabels.length === 0
              ? text.allValues
              : pickedLabels.length <= 2
                ? pickedLabels.join(text.valueJoiner)
                : fill(text.pickedMany, { count: String(pickedLabels.length) })
          return (
            <CollapsibleGroup
              key={dimension.key}
              maxBodyHeight={null}
              onOpenChange={(open) => setOpenKey(open ? dimension.key : null)}
              open={openKey === dimension.key}
              resolveText={resolveNoKey}
              header={
                <>
                  <span className="source-filter-bar__dimension-label">{dimension.label}</span>
                  <span className="source-filter-bar__dimension-picked">{pickedText}</span>
                  <span className="source-filter-bar__dimension-count">
                    {fill(text.rowCount, { count: String(props.rowMatchCount(dimension.key)) })}
                  </span>
                </>
              }>
              <div
                aria-label={fill(text.valuesAriaLabel, { dimension: dimension.label })}
                className="source-filter-bar__values"
                role="group">
                {dimension.options.map((option) => {
                  const selected = picked.includes(option.value)
                  const remaining = props.remainingCount(dimension.key, option.value)
                  return (
                    <button
                      aria-pressed={selected}
                      className="source-filter-bar__value"
                      data-empty={remaining === 0 && !selected ? 'true' : 'false'}
                      data-selected={selected ? 'true' : 'false'}
                      key={option.value}
                      onClick={() => props.onToggleValue(dimension.key, option.value)}
                      type="button">
                      {fill(text.optionRemaining, { option: option.label, count: String(remaining) })}
                    </button>
                  )
                })}
              </div>
            </CollapsibleGroup>
          )
        })}
      </div>

      <div className="source-filter-bar__foot">
        <span className="source-filter-bar__summary">
          {pickedCount === 0
            ? fill(text.summaryAll, { total: String(props.totalSourceCount) })
            : fill(text.summaryFiltered, {
                picked: String(pickedCount),
                matched: String(props.resultCount),
                total: String(props.totalSourceCount)
              })}
        </span>
        {/* 空态里这里不渲染：同一动作只给一颗，空态那颗归 `StateView(filtered-out)`。
            用「不渲染」而不是 `hidden` / `visibility: hidden`——后者会留一颗看不见却能 Tab 进去的按钮。 */}
        {isEmpty ? null : (
          <button
            className="source-filter-bar__clear"
            disabled={pickedCount === 0}
            onClick={props.onClear}
            type="button">
            {text.clearFilter}
          </button>
        )}
      </div>
    </div>
  )
}
