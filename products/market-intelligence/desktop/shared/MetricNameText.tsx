import './styles/metricName.css'

/**
 * 「中文名 + 小一号灰字英文名 + 归属小字」的**唯一写法**（用户 2026-11-17）。
 *
 * 三处共用：日历事件行、事件表、映射规则的名称列。三处各写一套，迟早会有一处漏了「英文缺失时
 * 不留半句」——今晚已经因为「半份名字」踩过一次。
 *
 * 规则：
 * - 中文名为主语，永远在前、保持正文大小；
 * - 英文名小字灰字跟在后面（**不单独占一列**：那一列已经够挤）；
 * - 归属小字（`母指标名 · 子项`）也小字灰字，只给子项；母项自己的名字就是主语，不再重复一遍；
 * - 英文为 `null` / 空 → **只显示中文**，不留 `·`、不留空括号、不留尾随空格；
 * - 只有英文 → 显示英文（好过整格空白）；
 * - 两个都没有 → 什么都不画（「没有名表条目就空着」由这里统一给出，各调用点不再各判一次）。
 *
 * `owner` 是**已经拼好的整句**（`费城联储制造业指数 · 子项`）：`子项` 这样的字必须来自文案表，
 * 组件里不写可见文案。
 */
export function MetricNameText({ zh, en, owner }: Readonly<{
  zh: string | null | undefined
  en: string | null | undefined
  owner?: string | null
}>): React.ReactElement | null {
  const zhText = (zh ?? '').trim()
  const enText = (en ?? '').trim()
  const ownerText = (owner ?? '').trim()
  if (zhText === '' && enText === '' && ownerText === '') return null
  const ownerSpan = ownerText === '' ? null : <span className="mi-name__owner">{ownerText}</span>
  // 没有中文名时英文就是主语，不能再缩小——缩小的只有「次要信息」。
  if (zhText === '') return <>{enText}{ownerSpan}</>
  const enSpan = enText === '' || enText === zhText ? null : <span className="mi-name__en">{enText}</span>
  return <>{zhText}{enSpan}{ownerSpan}</>
}
