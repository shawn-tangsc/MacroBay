import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

/**
 * 来源列表的条件行（C5 第一笔：**只做壳，不接数据**）。
 *
 * 宿主传的是「已经算好的条件」：每颗胶囊一个值、一个维度（同维或、跨维且由宿主算），
 * 以及这一颗松掉之后还剩多少个源。这里只负责画、以及把点击交回宿主。
 *
 * 三条行为判据（写在这里，因为最容易在下一笔被改坏）：
 * 1. **没有条件时整块不渲染**——不是 `visibility:hidden`、也不是 `opacity:0`：隐形按钮仍会进 Tab 序，
 *    读者会 Tab 到一个点不动的按钮上。
 * 2. 胶囊上的数字**必须带单位语义**：「营销类 · 还剩 3」，不许出现裸数字「3」。
 * 3. 空态的唯一面是 `StateView(filtered-out)`，它的动作是「清空筛选」；条件胶囊排在状态块**下方**，
 *    点一颗只松一格（宿主按 `onDrop` 处理，这里不连带清空）。
 */
export type SourceFilterChip = Readonly<{
  /** 维度：同维取或、跨维取且。宿主用它分组，组件不重排。 */
  dimension: string
  /** 这一格的值（人话，如「看板」「高重要性」）。 */
  value: string
  /** 松掉这一颗之后还剩下几个源；宿主算好传进来。 */
  remaining: number
}>

export type SourceFilterBarProps = Readonly<{
  chips: readonly SourceFilterChip[]
  /** 命中 0 个源：这时才出现空态块（`StateView(filtered-out)`），并把清空按钮交给它。 */
  empty: boolean
  onClear: () => void
  /** 点一颗胶囊：只松这一格。 */
  onDrop: (chip: SourceFilterChip) => void
  /**
   * 「平铺 / 列表」切换（宿主给的节点：两种布局只是排版不同，条件与清空由这里画）。
   * **空态时不给渲染**——空结果里切布局没有意义，多一颗控件只是多一个 Tab 停靠点。
   */
  modeSwitch?: React.ReactNode
  resolveText: (key: string) => string
}>

/** 文案键：宿主解析。`{value}` 与 `{remaining}` 由这里替换，调用点不拼句子。 */
const CHIP_KEY = 'settings.intelligenceSources.filter.chip'

function chipText(chip: SourceFilterChip, resolveText: (key: string) => string): string {
  return resolveText(CHIP_KEY).replace('{value}', chip.value).replace('{remaining}', String(chip.remaining))
}

export function SourceFilterBar(props: SourceFilterBarProps): React.ReactElement | null {
  // 判据 1：没有条件就什么都不画。空态下「清空筛选」只活在 StateView 的动作里，不再有一份重复入口。
  if (props.chips.length === 0) return null

  const chips = <div className="intelligence-source-filter__chips">
    {props.chips.map((chip) => <button
      className="intelligence-source-filter__chip"
      data-filter-dimension={chip.dimension}
      data-filter-remaining={chip.remaining}
      key={`${chip.dimension}:${chip.value}`}
      onClick={() => props.onDrop(chip)}
      type="button"
    >{chipText(chip, props.resolveText)}</button>)}
  </div>

  if (props.empty) {
    // 判据 3：空态只这一处；条件胶囊在状态块下方，点一颗只松一格。
    return <div className="intelligence-source-filter" data-source-filter="empty">
      <StateView
        action={{ labelKey: STATE_VIEW_ACTION_KEYS.clear_filter, onSelect: props.onClear }}
        reasonCode="filtered-out"
        size="md"
        state="empty"
      />
      {chips}
    </div>
  }

  return <div className="intelligence-source-filter" data-source-filter="active">
    {/* 三样同位置：清空 → 模式切换 → 条件（两种布局只换条件的排法，不换这三样的位置）。 */}
    <button
      className="intelligence-source-filter__clear"
      data-source-filter-clear="true"
      onClick={props.onClear}
      type="button"
    >{props.resolveText('settings.intelligenceSources.filter.clear')}</button>
    {props.modeSwitch === undefined ? null : <div className="intelligence-source-filter__mode">{props.modeSwitch}</div>}
    {chips}
  </div>
}
