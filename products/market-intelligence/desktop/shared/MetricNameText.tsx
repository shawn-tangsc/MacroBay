import './styles/metricName.css'

/**
 * 「主名 + 小一号灰字次名 + 归属小字」的**唯一写法**（用户 2026-11-17 定形，2026-11-20 按界面语言分叉）。
 *
 * 三处共用：日历事件行、事件表、映射规则的名称列。三处各写一套，迟早会有一处漏了「英文缺失时
 * 不留半句」——今晚已经因为「半份名字」踩过一次。
 *
 * **按界面语言取主名**（用户 2026-11-20：「英文主题还是有中文写死」）：
 * - `zh-CN`：中文名为主语、正文大小，英文名小字灰字跟在后面——**与 11-17 的实现逐字一致，一个像素不动**；
 * - `en-US`：**只显示英文名**（不显示中文），英文缺失时才回退中文名。
 *
 * 回退链（Chief 2026-11-20 按真库定的）：码表 `enShort`（3430 行里 510 行可得）→ 源侧
 * `source_label_en` → **中文名**。标准表 3430 行里有 2042 行连源侧英文名都没有：
 * 不给名字等于把这条发布藏起来，比显示中文名更糟，所以这是**唯一的回退**，且不额外加「中文」之类的说明字。
 * 那 2042 行是一个已知的数据缺口（英文名待补），不是渲染层的临时办法。
 *
 * 其余规则：
 * - 次名小字灰字跟在后面（**不单独占一列**：那一列已经够挤）；
 * - 归属小字（`母指标名 · 子项`）也小字灰字，只给子项；母项自己的名字就是主语，不再重复一遍；
 * - 英文为 `null` / 空 → **只显示中文**，不留 `·`、不留空括号、不留尾随空格；
 * - 只有英文 → 显示英文（好过整格空白）；
 * - 两个都没有 → 什么都不画（「没有名表条目就空着」由这里统一给出，各调用点不再各判一次）。
 *
 * `owner` 是**已经拼好的整句**（`费城联储制造业指数 · 子项`）：`子项` 这样的字必须来自文案表，
 * 组件里不写可见文案。
 */
export function MetricNameText({ zh, en, owner, locale }: Readonly<{
  zh: string | null | undefined
  en: string | null | undefined
  owner?: string | null
  /**
   * 界面语言。**必填**：默认写成中文会让英文界面继续「中文写死」，而漏传时组件无从判断
   * （这里没有全局语言上下文可用，调用点已经拿得到）。
   */
  locale: 'zh-CN' | 'en-US'
}>): React.ReactElement | null {
  const zhText = (zh ?? '').trim()
  const enText = (en ?? '').trim()
  const ownerText = (owner ?? '').trim()
  if (zhText === '' && enText === '' && ownerText === '') return null
  const ownerSpan = ownerText === '' ? null : <span className="mi-name__owner">{ownerText}</span>
  if (locale === 'en-US') {
    // 有英文就**只显示英文**（不把中文当主语）；两个都没有名字时才什么都没有。
    if (enText !== '') return <>{enText}{ownerSpan}</>
    return zhText === '' ? ownerSpan : <>{zhText}{ownerSpan}</>
  }
  // 中文界面：与 11-17 的实现逐字一致——没有中文名时英文就是主语，不能再缩小。
  if (zhText === '') return <>{enText}{ownerSpan}</>
  const enSpan = enText === '' || enText === zhText ? null : <span className="mi-name__en">{enText}</span>
  return <>{zhText}{enSpan}{ownerSpan}</>
}
