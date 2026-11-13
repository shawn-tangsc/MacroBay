import { Switch } from 'antd'

/* 只从**纯模块**取键的拼法：store 里有 `node:fs`，渲染层导入它会整页加载失败（2026-11-14）。 */
import { coreIndicatorSourcePreferenceKey } from '../../../service/intelligence/macro-calendar/coreIndicatorSourcePreferenceKey'
import {
  coreIndicatorMetricKeys,
  valueSourcesForMetric,
  type CoreIndicatorValueSource
} from '../../../service/intelligence/macro-calendar/coreIndicatorValueSources'

import './coreIndicators.css'

/**
 * 「核心指标」那一屏：**每个指标用哪些源、各开不开**（Chief 2026-11-14）。
 *
 * 与卡片上那个「预期设置」齿轮是两件事：这里管「数据从哪来」，齿轮管「预期从哪取」。
 * 两层开关也不合并：源 profile 那颗是总闸（这个源采不采），这里这颗是**按指标的取舍**
 * ——源照采，只是这个指标不再从它取数。
 *
 * 四条写死：
 * - 行来自**唯一派生点** `valueSourcesForMetric()`，组件不自己拼清单；
 * - 缺配置 = 开（默认全开，读者第一次进来不会看到四个指标全空）；
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
}>

export function CoreIndicatorsSourcesView(props: CoreIndicatorsSourcesViewProps): React.ReactElement {
  const t = props.resolveText
  const metricCopyKeys: Readonly<Record<string, string>> = {
    'US.CPI.NSA.YOY': 'cpiYoy',
    'US.CORE_CPI.NSA.YOY': 'coreCpiYoy',
    'US.NONFARM.SA.CHANGE': 'nonfarmPayrolls',
    'US.CORE_PCE.NSA.YOY': 'corePceYoy'
  }

  return <div className="business-cell-grid" data-core-indicator-sources="true">
    {coreIndicatorMetricKeys.map((metricKey) => {
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
      /* 一个腿都没有：整张卡也不出。留一张带边框的空白卡，读者只会以为它坏了。 */
      if (rows.length === 0) return null
      const keyOf = (providerId: string): string => coreIndicatorSourcePreferenceKey(metricKey, providerId)
      const enabledCount = rows.filter((row) => props.disabled[keyOf(row.source.providerId)] !== true).length

      return <div className="business-cell" data-core-indicator={metricKey} key={metricKey}>
        <div className="business-cell__title">
          {t(`settings.intelligenceSources.coreIndicators.metrics.${copyKey}`)}
        </div>
        <div className="business-cell__items">
          {rows.length === 0
            ? <p className="core-indicator-sources__empty">{t('settings.intelligenceSources.coreIndicators.valueSourceEmpty')}</p>
            : rows.map(({ source, name }) => {
              const preferenceKey = keyOf(source.providerId)
              /* 总闸关掉：这一行的细分设置没有意义，置灰并给去处。 */
              const gateOff = props.sourceEnabled(source.providerId) === false
              return <div
                className="business-card__row"
                data-core-source-row={preferenceKey}
                data-gate-off={gateOff ? 'true' : undefined}
                key={preferenceKey}>
                <div className="business-card__line">
                  {gateOff && props.onOpenSource !== undefined
                    ? <button
                      className="business-card__label business-card__label--action"
                      onClick={() => props.onOpenSource?.(source.providerId)}
                      type="button">{name}</button>
                    : <span className="business-card__label">{name}</span>}
                  <span className="business-card__toggle">
                    <Switch
                      checked={props.disabled[preferenceKey] !== true}
                      disabled={gateOff}
                      onChange={(next) => props.onToggle(preferenceKey, next)}
                      size="small" />
                  </span>
                </div>
                {/* 第二行与其它业务页同形：只读的「频率 内置频率」+ 这一条腿的类型。
                    频率归源设置，这里不给控件（与「日历」「舆情」两页一样只是占位）。 */}
                <div className="business-card__preset" data-preset-builtin="true">
                  <span className="business-card__preset-label-group">
                    <span className="business-card__preset-label">{t('settings.intelligenceSources.collectionPolicy.frequency')}</span>
                  </span>
                  <span className="business-card__preset-value">
                    {t(`settings.intelligenceSources.coreIndicators.valueSourceType.${source.kind}`)}
                    {' · '}
                    {t('settings.intelligenceSources.collectionPolicy.builtinCadence')}
                  </span>
                </div>
              </div>
            })}
          {rows.length > 0 && enabledCount === 0
            ? <p className="core-indicator-sources__closed">{t('settings.intelligenceSources.coreIndicators.valueSourceAllClosed')}</p>
            : null}
        </div>
      </div>
    })}
  </div>
}
