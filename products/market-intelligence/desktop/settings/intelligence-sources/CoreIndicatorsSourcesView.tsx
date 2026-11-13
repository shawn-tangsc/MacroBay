import { Switch } from 'antd'

/* 只从**纯模块**取键的拼法：store 里有 `node:fs`，渲染层导入它会整页加载失败（2026-11-14）。 */
import { coreIndicatorSourcePreferenceKey } from '../../../service/intelligence/macro-calendar/coreIndicatorSourcePreferenceKey'
import {
  coreIndicatorMetricKeys,
  valueSourcesForMetric,
  type CoreIndicatorValueSource
} from '../../../service/intelligence/macro-calendar/coreIndicatorValueSources'

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

  return <div className="core-indicator-sources" data-core-indicator-sources="true">
    {coreIndicatorMetricKeys.map((metricKey) => {
      /* 名字取不到就不渲染这一行——绝不把 provider id 印给读者。 */
      const rows: readonly Readonly<{ source: CoreIndicatorValueSource; name: string }>[] =
        valueSourcesForMetric(metricKey).flatMap((source) => {
          const name = props.sourceNameOf(source.providerId)
          return name === undefined ? [] : [{ source, name }]
        })
      const keyOf = (providerId: string): string => coreIndicatorSourcePreferenceKey(metricKey, providerId)
      const enabledCount = rows.filter((row) => props.disabled[keyOf(row.source.providerId)] !== true).length

      return <section className="core-indicator-sources__metric" data-core-indicator={metricKey} key={metricKey}>
        <h3 className="core-indicator-sources__title">
          {t(`settings.intelligenceSources.coreIndicators.metrics.${metricCopyKeys[metricKey] ?? ''}`)}
        </h3>
        {rows.length === 0
          ? <p className="core-indicator-sources__empty">{t('settings.intelligenceSources.coreIndicators.valueSourceEmpty')}</p>
          : rows.map(({ source, name }) => {
            const preferenceKey = keyOf(source.providerId)
            /* 总闸关掉：这一行的细分设置没有意义，置灰并给去处。 */
            const gateOff = props.sourceEnabled(source.providerId) === false
            return <div
              className="core-indicator-sources__row"
              data-core-source-row={preferenceKey}
              data-gate-off={gateOff ? 'true' : undefined}
              key={preferenceKey}>
              <span className="core-indicator-sources__name">{name}</span>
              <span className="core-indicator-sources__type">
                {t(`settings.intelligenceSources.coreIndicators.valueSourceType.${source.kind}`)}
              </span>
              <Switch
                checked={props.disabled[preferenceKey] !== true}
                disabled={gateOff}
                onChange={(next) => props.onToggle(preferenceKey, next)}
                size="small" />
              {gateOff && props.onOpenSource !== undefined
                ? <button
                  className="core-indicator-sources__open"
                  onClick={() => props.onOpenSource?.(source.providerId)}
                  type="button">
                  {t('settings.intelligenceSources.coreIndicators.valueSourceOpenSource')}
                </button>
                : null}
            </div>
          })}
        {rows.length > 0 && enabledCount === 0
          ? <p className="core-indicator-sources__closed">{t('settings.intelligenceSources.coreIndicators.valueSourceAllClosed')}</p>
          : null}
      </section>
    })}
  </div>
}
