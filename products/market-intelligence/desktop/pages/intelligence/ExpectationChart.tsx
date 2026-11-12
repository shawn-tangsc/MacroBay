/**
 * 「利率数学期望」曲线。
 *
 * **这段绘制是从 `2026-11-13-K11-b.html` 原样搬过来的**，不是按描述重画：坐标函数 `xs/Y`、
 * 两条 `userSpaceOnUse` 渐变（0 轴 0.02 → 曲线 0.40，红 `#B3362B` / 蓝 `#2E5F9E`）、零轴、
 * 红面积、2px 柠绿曲线、事件虚线 + 圆点 + 贴顶标注、纵轴刻度 `+40/+20/0/−20/−40bp`、
 * 每 7 个点一个日期——逐句对应原型那段 `<script>` 里的绘图部分。
 *
 * 缩放按钮（1x/2x）与图例那一行是早前误加的，设计稿里没有，已删。
 *
 * 只有三处被改写，其余常量一字未动：
 * 1. DOM API（`createElementNS`/`setAttribute`）换成 JSX 属性；
 * 2. 文字宽度用 `getBBox()` 量的地方，改成按 9.5px 字号估算（SVG 里量字要等布局，静态页不必）；
 * 3. 数据数组 `V` / `EV` 由调用方传入，仍是同一组数。
 */
const L = 52
const RM = 12
const T0 = 16
const B = 34

export type ExpectationEvent = Readonly<{ index: number; label: string; impact: number }>

export function ExpectationChart({ values, events, height, width }: Readonly<{
  values: readonly number[]
  events: readonly ExpectationEvent[]
  height: number
  width: number
}>): React.ReactElement {
  const W = Math.max(380, Math.floor(width))
  const H = height
  const max = Math.max(...values.map(value => Math.abs(value)))
  const min = Math.min(...values)
  const positiveOnly = min >= 0
  const span = Math.max(30, Math.ceil((max * 1.25) / 10) * 10)
  const HI = span
  const LO = positiveOnly ? 0 : -span

  const xs = (index: number) => L + (index / (values.length - 1)) * (W - L - RM)
  const Y = (value: number) => T0 + ((HI - value) / (HI - LO)) * (H - T0 - B)

  const line = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${xs(index).toFixed(1)} ${Y(value).toFixed(1)}`).join(' ')
  const area = `M${xs(0).toFixed(1)} ${Y(0).toFixed(1)} ${values.map((value, index) => `L${xs(index).toFixed(1)} ${Y(value).toFixed(1)}`).join(' ')} L${xs(values.length - 1).toFixed(1)} ${Y(0).toFixed(1)} Z`

  const ticks = positiveOnly ? [0, HI / 4, HI / 2, HI * 0.75, HI] : [LO, LO / 2, 0, HI / 2, HI]
  const dates = axisDates(values.length, W)

  // Labels are placed right to left so the later ones keep their leader; the same rule the
  // prototype applies, with the measured width replaced by an estimate.
  let limit = W - RM
  const labels = [...events].sort((left, right) => xs(right.index) - xs(left.index)).map(event => {
    const text = `${event.impact >= 0 ? '↑ +' : '↓ −'}${Math.abs(event.impact).toFixed(1)}bp ${event.label}`
    const approxWidth = text.length * 5.2
    const x = Math.max(L, Math.min(xs(event.index) - approxWidth / 2, limit - approxWidth))
    limit = x - 8
    return { text, x }
  })

  return <div className="mk-plot__scroll">
    <svg className="mk-plot__svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="rate expectation">
      <defs>
        <linearGradient id="mk-g-red" gradientUnits="userSpaceOnUse" x1={0} y1={Y(0)} x2={0} y2={Y(HI)}>
          <stop offset="0" stopColor="#B3362B" stopOpacity="0.02" />
          <stop offset="1" stopColor="#B3362B" stopOpacity="0.40" />
        </linearGradient>
        <linearGradient id="mk-g-blue" gradientUnits="userSpaceOnUse" x1={0} y1={Y(0)} x2={0} y2={Y(LO)}>
          <stop offset="0" stopColor="#2E5F9E" stopOpacity="0.02" />
          <stop offset="1" stopColor="#2E5F9E" stopOpacity="0.40" />
        </linearGradient>
      </defs>
      {positiveOnly ? null : <rect x={L} y={Y(0)} width={W - L - RM} height={Y(LO) - Y(0)} fill="url(#mk-g-blue)" />}
      <path d={area} fill="url(#mk-g-red)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
      {ticks.map(value => {
        const isZero = Math.abs(value) < 1e-9
        return <g key={value}>
          <line x1={L} y1={Y(value)} x2={W - RM} y2={Y(value)} stroke="var(--text-strong)" strokeWidth={1} opacity={isZero ? 0.4 : 0.08} />
          <text x={L - 8} y={Y(value) + 3} fontSize={9} fill={isZero ? 'var(--text)' : 'var(--muted)'} textAnchor="end">
            {(value > 0 ? '+' : '') + Math.round(value) + 'bp'}
          </text>
        </g>
      })}
      <text x={L + 6} y={Y(0) - 5} fontSize={9} fill="var(--muted)">0 · 不加不减</text>
      {events.map(event => <g key={`mark-${event.index}`}>
        <line x1={xs(event.index)} y1={T0} x2={xs(event.index)} y2={H - B} stroke="rgba(255,255,255,0.28)" strokeWidth={1} strokeDasharray="3 3" />
        <circle cx={xs(event.index)} cy={Y(values[event.index] ?? 0)} r={3} fill="var(--accent)" />
      </g>)}
      {labels.map(label => <text key={label.text} x={label.x.toFixed(1)} y={T0 + 10} fontSize={9.5} textAnchor="start" fill="var(--accent)">{label.text}</text>)}
      {dates.map(date => <text key={date.index} x={Math.min(Math.max(xs(date.index), L + 10), W - RM - 10)} y={H - B + 16} fontSize={9} fill="var(--muted)" textAnchor="middle">{date.label}</text>)}
    </svg>
  </div>
}

/**
 * Every 7th point carries a date, from 2026-10-30 to 2026-11-11 — the prototype's own window.
 *
 * 两处必须按实际宽度收：末位那条会被右边界裁掉（原型的 `text-anchor="middle"` 落在 `W-RM` 上），
 * 窄宽度下相邻两条会叠在一起。所以末位夹回绘图区、间隔不足 56px 时丢掉较晚那条。
 */
function axisDates(count: number, width: number): ReadonlyArray<Readonly<{ index: number; label: string }>> {
  const start = Date.parse('2026-10-30')
  const end = Date.parse('2026-11-11')
  const toX = (index: number) => L + (index / (count - 1)) * (width - L - RM)
  const out: Array<{ index: number; label: string }> = []
  let previousX = Number.NEGATIVE_INFINITY
  for (let index = 0; index < count; index += 7) {
    const x = toX(index)
    if (x - previousX < 56) continue
    const at = start + ((end - start) * index) / (count - 1)
    out.push({ index, label: new Date(at).toISOString().slice(5, 10) })
    previousX = x
  }
  return out
}
