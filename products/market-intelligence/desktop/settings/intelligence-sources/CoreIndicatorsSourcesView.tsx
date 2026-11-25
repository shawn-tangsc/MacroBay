import { cellRow } from './BusinessSettingsView'

import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'

/* 只从**纯模块**取键的拼法：store 里有 `node:fs`，渲染层导入它会整页加载失败（2026-11-14）。 */
import { coreIndicatorSourcePreferenceKey } from '../../../service/intelligence/macro-calendar/coreIndicatorSourcePreferenceKey'
import { MACRO_INDICATOR_GROUPS, type MacroIndicatorGroupRow } from '../../../service/intelligence/macro-calendar/macroIndicatorCardGroups'
/* M3（2026-11-14）：这一屏的源腿**只从 catalog 读**，不再自己去派生——腿的出处只有一处。 */
import { metricCatalog } from '../../../service/intelligence/macro-calendar/marketCalendarMetricCatalog'

import type { CoreIndicatorValueSource } from '../../../service/intelligence/macro-calendar/coreIndicatorValueSources'

import type { SourceCadenceReadout } from './sourceCadence'


/**
 * 「核心指标」那一屏：**看板那一屏换个内容**（用户 2026-11-14 定，不另设计）。
 *
 * 结构照抄看板：外层 `business-module-grid`，组就是看板的「模块卡」（组标题 + 组内数据卡），
 * 组内每张 `business-cell` 是一个指标，卡里是它的源行（`business-card__row`）。
 * 列的规则也照抄：`--cell-span = min(源行数, 3)`，一行放不下由网格自己折，不设最小卡宽、不加断点、
 * 不做卡高开关——**这一屏没有任何一条看板没有的布局规则**。
 *
 * 分组与顺序的唯一出处是 `MACRO_INDICATOR_GROUPS`（三组 × 四行）：这里不自己列指标、不写死数量。
 *
 * 四条行为写死：
 * - 行来自**只读合成索引** `metricCatalog()`（腿的派生仍在 `coreIndicatorValueSources`，这里只读结果）：
 *   组件不自己拼清单，几行源就画几行，不补空行；
 * - 缺配置 = 开（默认全开，读者第一次进来不会看到所有指标都空）；
 * - **总闸关掉时这一行置灰**，并给一个去数据源的入口——不然读者点了一个灰开关，不知道该去哪儿开；
 * - 一个指标的腿**全被读者关掉**时，说「所有源已关闭（你可调整）」，不是「暂无数据」。
 */
export type CoreIndicatorsSourcesViewProps = Readonly<{
  resolveText: (key: string) => string
  /** 源名的显示（provider id → 名字）；缺了就不渲染这一行，绝不印 id。 */
  sourceNameOf: (providerId: string) => string | undefined
  /** 源自己的总闸（来自投影）：`false` = 这个源整体没开。 */
  sourceEnabled: (providerId: string) => boolean | undefined
  /** 读者按指标关掉的那些（`{ "<metric>|<provider>": true }`）。 */
  disabled: Readonly<Record<string, boolean>>
  onToggle: (preferenceKey: string, enabled: boolean) => void
  /** 总闸关掉时那一行的去处：跳到「数据源」并定位这个源。 */
  onOpenSource?: (providerId: string) => void
  /**
   * 频率这一格与其它业务页**同一套**来源（用户 2026-11-14：同一颗源在两页显示的节奏必须一致）：
   * 档位读 profile、间隔读 `listSchedules()` 的投影；只有真的没有独立排期、由产品内置作业驱动的源
   * 才写「内置频率」。三个口都按 **providerId** 查，映射由宿主给。
   */
  presetOf?: (providerId: string) => string | undefined
  cadenceOf?: (providerId: string) => SourceCadenceReadout | undefined
  /** 这一批排期整批读不到（不是「没有排期」）。 */
  cadenceAvailable?: boolean
  builtinCadenceOf?: (providerId: string) => boolean
}>

export function CoreIndicatorsSourcesView(props: CoreIndicatorsSourcesViewProps): React.ReactElement {
  const t = props.resolveText
  /* 间隔/下次里的时刻按读者设置时区显示，格式化只在这里取一次。 */
  const timeZone = useShellTimeZone()
  /* 一次建索引，整屏共用：每个指标的腿都从这张索引取，组件自己不派生。 */
  const catalog = metricCatalog()

  const cellFor = (row: MacroIndicatorGroupRow): React.ReactElement | null => {
    const metricKey = row.metricKey
    /* 名字（设置页显示名）不按「组名 + 行名」拼：拼出来是「CPI 核心年率」，产品口径是「核心 CPI 年率」。
       文案键跟着分组行走（`metricNameKey`），这里不另列表——12 个码在本文件里一个字都不出现。 */
    const name = t(`settings.intelligenceSources.coreIndicators.metricNames.${row.metricNameKey}`)
    /* 解析器对未知键返回空串（不回退成键名）：取不到名字就**整张不出**，
       读者看到的会是一张「没有名字的卡」（用户 2026-11-14 截图里的那 7 张）。 */
    if (name === '') return null
    /* 名字取不到就不渲染这一行——绝不把 provider id 印给读者。 */
    const rows: readonly Readonly<{ source: CoreIndicatorValueSource; name: string }>[] =
      (catalog.get(metricKey)?.sources ?? []).flatMap((source) => {
        const sourceName = props.sourceNameOf(source.providerId)
        return sourceName === undefined ? [] : [{ source, name: sourceName }]
      })
    /* 一条腿都没有：整张卡也不出。留一张带边框的空白卡，读者只会以为它坏了。 */
    if (rows.length === 0) return null
    const keyOf = (providerId: string): string => coreIndicatorSourcePreferenceKey(metricKey, providerId)
    const enabledCount = rows.filter((row) => props.disabled[keyOf(row.source.providerId)] !== true).length
    /* 卡片跨几列 / 项容器几列：与其它业务页同一套变量（漏设就走默认 1 列，
       两条腿会上下叠起来——用户 2026-11-14 截图）。列数就是这张卡的源行数，最多 3。 */
    const columns = Math.min(rows.length, 3)
    return <div
      className="business-cell"
      data-core-indicator={metricKey}
      key={metricKey}
      style={{ ['--cell-span' as string]: columns }}>
      <div className="business-cell__title">
        {name}
      </div>
      <div className="business-cell__items" style={{ ['--cell-items' as string]: columns }}>
        {rows.map(({ source, name }) => {
          const preferenceKey = keyOf(source.providerId)
          /* 总闸关掉：这一行的细分设置没有意义，置灰并给去处。 */
          const gateOff = props.sourceEnabled(source.providerId) === false
          /* 节奏由产品内置作业定（没有独立排期）才写「内置频率」；其余一律读真实的档位与间隔。 */
          const builtin = props.builtinCadenceOf?.(source.providerId) === true
          /* **这一行由看板那份渲染函数生成**（整行可点、源没开不画频率行、开关不冒泡都写在里面）：
             两页各写一遍时，这三件必错一处——用户已经就这件事问过三次。 */
          return cellRow({
            cellId: preferenceKey,
            enabled: props.disabled[preferenceKey] !== true,
            label: name,
            siblings: [],
            sourceId: source.providerId,
            ...(props.sourceEnabled === undefined ? {} : { sourceEnabled: props.sourceEnabled(source.providerId) }),
            onCellToggle: (id, enabled) => props.onToggle(id, enabled),
            ...(props.onOpenSource === undefined ? {} : { onOpenSourceConfig: props.onOpenSource }),
            ...(builtin
              ? { builtinCadence: true }
              : {
                ...(props.presetOf?.(source.providerId) === undefined ? {} : { preset: props.presetOf!(source.providerId) })
              }),
            ...(props.cadenceOf?.(source.providerId) === undefined ? {} : { cadence: props.cadenceOf(source.providerId) }),
            ...(props.cadenceAvailable === false ? { cadenceUnavailable: true } : {}),
            resolveText: t,
            timeZone
          })
        })}
        {rows.length > 0 && enabledCount === 0
          ? <p className="core-indicator-sources__closed">{t('settings.intelligenceSources.coreIndicators.valueSourceAllClosed')}</p>
          : null}
      </div>
    </div>
  }

  return <div className="intelligence-detail-scroll" data-core-indicator-sources="true">
    <div className="business-settings__content">
      {/* 内容区页头：与其它业务页同一句「只写当前业务名」的规矩。 */}
      <h3 className="intelligence-section-title">{t('settings.intelligenceSources.coreIndicators.title')}</h3>
      {/* 外层用看板那一套：组 = 看板的模块卡，组内每张 `business-cell` 是一个指标。 */}
      <div className="business-module-grid" data-core-indicator-groups="true">
        {MACRO_INDICATOR_GROUPS.map((group) => {
          /* 组占几列与看板的模块卡同算法：组内各卡占列之和，上限 3。 */
          const span = Math.min(
            group.rows.reduce((sum, row) =>
              sum + Math.min(catalog.get(row.metricKey)?.sources.length ?? 0, 3), 0),
            3
          )
          /* 组卡必须是 `.business-module-grid` 的**直接子元素**：占几列由
             `.business-module-grid > .business-card { grid-column: span var(--module-span) }` 决定。
             中间再包一层，组卡就退化成 1 列，组内三列再分给每张指标卡，频率读数会被压成一字一行
             （用户 2026-11-22 截图）。守卫在 `CoreIndicatorsSourcesView.test.tsx`。 */
          return <section
            className="business-card"
            data-core-indicator-group={group.id}
            key={group.id}
            style={{ ['--module-span' as string]: span }}>
            <div className="business-card__title">
              {t(`settings.intelligenceSources.coreIndicators.groups.${group.titleKey}`)}
            </div>
            <div className="business-cell-grid">
              {group.rows.map((row) => cellFor(row))}
            </div>
          </section>
        })}
      </div>
    </div>
  </div>
}
