import { Switch } from 'antd'

import { BusinessCardFrequencyRow } from './BusinessSettingsView'

import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'

/* 只从**纯模块**取键的拼法：store 里有 `node:fs`，渲染层导入它会整页加载失败（2026-11-14）。 */
import { coreIndicatorSourcePreferenceKey } from '../../../service/intelligence/macro-calendar/coreIndicatorSourcePreferenceKey'
import { MACRO_INDICATOR_GROUPS } from '../../../service/intelligence/macro-calendar/macroIndicatorCardGroups'
import {
  valueSourcesForMetric,
  type CoreIndicatorValueSource
} from '../../../service/intelligence/macro-calendar/coreIndicatorValueSources'

import type { SourceCadenceReadout } from './sourceCadence'

import './coreIndicators.css'

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
 * - 行来自**唯一派生点** `valueSourcesForMetric()`，组件不自己拼清单；几行源就画几行，不补空行；
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

/** 指标名 → 文案键：不按「组名 + 行名」拼（拼出来是「CPI 核心年率」，产品口径是「核心 CPI 年率」）。 */
const metricCopyKeys: Readonly<Record<string, string>> = {
  'US.CPI.NSA.YOY': 'cpiYoy', 'US.CPI.SA.MOM': 'cpiMom',
  'US.CORE_CPI.NSA.YOY': 'coreCpiYoy', 'US.CORE_CPI.SA.MOM': 'coreCpiMom',
  'US.NONFARM.SA.CHANGE': 'nonfarm', 'US.UNEMPLOYMENT.SA.RATE': 'unemployment',
  'US.AHE.SA.MOM': 'avgHourlyMom', 'US.AHE.NSA.YOY': 'avgHourlyYoy',
  'US.PCE.SA.YOY': 'pceYoy', 'US.PCE.SA.MOM': 'pceMom',
  'US.CORE_PCE.SA.YOY': 'corePceYoy', 'US.CORE_PCE.SA.MOM': 'corePceMom'
}

export function CoreIndicatorsSourcesView(props: CoreIndicatorsSourcesViewProps): React.ReactElement {
  const t = props.resolveText
  /* 间隔/下次里的时刻按读者设置时区显示，格式化只在这里取一次。 */
  const timeZone = useShellTimeZone()

  const cellFor = (metricKey: string): React.ReactElement | null => {
    /* 标题取不到名字就**整张不出**：拼出一个空键只会渲染成空白标题 + 一行源，
       读者看到的是一张「没有名字的卡」（用户 2026-11-14 截图里的那 7 张）。 */
    const copyKey = metricCopyKeys[metricKey]
    if (copyKey === undefined) return null
    /* 名字取不到就不渲染这一行——绝不把 provider id 印给读者。 */
    const rows: readonly Readonly<{ source: CoreIndicatorValueSource; name: string }>[] =
      valueSourcesForMetric(metricKey).flatMap((source) => {
        const name = props.sourceNameOf(source.providerId)
        return name === undefined ? [] : [{ source, name }]
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
        {t(`settings.intelligenceSources.coreIndicators.metricNames.${copyKey}`)}
      </div>
      <div className="business-cell__items" style={{ ['--cell-items' as string]: columns }}>
        {rows.map(({ source, name }) => {
          const preferenceKey = keyOf(source.providerId)
          /* 总闸关掉：这一行的细分设置没有意义，置灰并给去处。 */
          const gateOff = props.sourceEnabled(source.providerId) === false
          /* 节奏由产品内置作业定（没有独立排期）才写「内置频率」；其余一律读真实的档位与间隔。 */
          const builtin = props.builtinCadenceOf?.(source.providerId) === true
          return <div
            className="business-card__row"
            data-core-source-row={preferenceKey}
            data-gate-off={gateOff ? 'true' : undefined}
            key={preferenceKey}>
            <div className="business-card__line">
              {/* 名字 + 类型小字同一列：类型不再挤进频率那一格（两页同一行必须同形）。 */}
              <span className="core-indicator-sources__label">
                {gateOff && props.onOpenSource !== undefined
                  ? <button
                    className="business-card__label business-card__label--action"
                    onClick={() => props.onOpenSource?.(source.providerId)}
                    /* 名字最多显示两行；**全名**靠 title（悬停）与 DOM 文本（读屏）——
                       被截掉的部分不许在无障碍层也消失。 */
                    title={name}
                    type="button">{name}</button>
                  : <span className="business-card__label" title={name}>{name}</span>}
                {/* 类型微标：跟名字**同一行**（界面设计 2026-11-14）——读者扫行时要用的信息，
                    不另起一行、也不藏进 ⓘ。11/`--muted` 沿用共享的标签档。 */}
                <span aria-hidden="true" className="business-card__preset-label">·</span>
                <span className="business-card__preset-label">
                  {t(`settings.intelligenceSources.coreIndicators.valueSourceType.${source.kind}`)}
                </span>
              </span>
              <span className="business-card__toggle">
                <Switch
                  checked={props.disabled[preferenceKey] !== true}
                  disabled={gateOff}
                  onChange={(next) => props.onToggle(preferenceKey, next)}
                  size="small" />
              </span>
            </div>
            {/* 第二行由**共享组件**渲染（看板同一份）：标签「频率」+ 同一颗 ⓘ + 值。
                核心指标这屏没有档位下拉，所以是只读形态；节奏由产品内置作业定的源才走 builtin。 */}
            <BusinessCardFrequencyRow
              dataRow={{ 'data-preset-row': source.providerId }}
              {...(builtin
                ? { builtinCadence: true }
                : {
                  readOnly: true,
                  ...(props.presetOf?.(source.providerId) === undefined ? {} : { preset: props.presetOf!(source.providerId) })
                })}
              {...(props.cadenceOf?.(source.providerId) === undefined ? {} : { cadence: props.cadenceOf(source.providerId) })}
              {...(props.cadenceAvailable === false ? { cadenceUnavailable: true } : {})}
              resolveText={t}
              timeZone={timeZone} />
          </div>
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
            group.rows.reduce((sum, row) => sum + Math.min(valueSourcesForMetric(row.metricKey).length, 3), 0),
            3
          )
          return <section
            className="business-card"
            data-core-indicator-group={group.id}
            key={group.id}
            style={{ ['--module-span' as string]: span }}>
            <div className="business-card__title">
              {t(`settings.intelligenceSources.coreIndicators.groups.${group.titleKey}`)}
            </div>
            <div className="business-cell-grid">
              {group.rows.map((row) => cellFor(row.metricKey))}
            </div>
          </section>
        })}
      </div>
    </div>
  </div>
}
