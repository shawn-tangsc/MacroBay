import { Calendar } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'

import type { ClockCardModel, ClockPlaque } from './clockCardModel'
import { clockCardCenter, clockCardGeometry } from './clockCardModel'
import './clockCard.css'

/**
 * 宏观时钟卡。
 *
 * 唯一依据：`docs-private/05-desktop/ui-audit/prototypes/FINAL-时钟卡-实现依据.html`。
 * 形状、颜色、字体、过渡、流光参数全部照搬；只有这些位置接数据：四块牌的角度与坐标、
 * 牌的不透明度、主位的指标/天数/值、没上环那几行的说明。
 *
 * 圆心只有一处来源：`clockCardGeometry`（CARD 336×330、PAD 12），组件里不写第二份。
 * 下面是**原型冻结的几何路径**（环 r135 / 刻度环 r104 / 8 点 7° 断口 / 12 点连续），
 * 搬过来是为了计算值一模一样；它们不含任何会随数据变的东西。
 */
/**
 * **环流高光的裁剪带**（Chief 2026-11-20 找出的真凶：亮斑画在 r=135，遮罩却只覆盖 r≈104，
 * 所以整条被裁掉，屏幕上从来没出现过它）。
 *
 * 这里按**角度**生成两条路径，不手写字面量：旧 `flowClip` 的角度端点由它的端点反算得出
 * （12 点 −90° 起，顺时针到 8 点断口 146.5°，断口宽 7°，再回到 12 点），
 * 半径取 `orbitRadius ± 1.5`——3px 描边正好落在带子里。
 */
const RING_CLIP = Object.freeze({ startAngle: -90, gapStart: 146.5, gapEnd: 153.5, halfWidth: 1.5 })

function ringPoint(angleDeg: number, radius: number): Readonly<{ x: number; y: number }> {
  const radians = angleDeg * Math.PI / 180
  return { x: clockCardCenter.svgX + radius * Math.cos(radians), y: clockCardCenter.svgY + radius * Math.sin(radians) }
}

/** 一段环带：外沿顺时针画到终点，再沿内沿逆时针画回来。 */
function ringBand(innerRadius: number, outerRadius: number, fromAngle: number, toAngle: number): string {
  const outerFrom = ringPoint(fromAngle, outerRadius)
  const outerTo = ringPoint(toAngle, outerRadius)
  const innerTo = ringPoint(toAngle, innerRadius)
  const innerFrom = ringPoint(fromAngle, innerRadius)
  const large = Math.abs(toAngle - fromAngle) > 180 ? 1 : 0
  const round = (value: number): string => value.toFixed(2)
  return `M${round(outerFrom.x)} ${round(outerFrom.y)} A${outerRadius} ${outerRadius} 0 ${large} 1 ${round(outerTo.x)} ${round(outerTo.y)}`
    + ` L${round(innerTo.x)} ${round(innerTo.y)} A${innerRadius} ${innerRadius} 0 ${large} 0 ${round(innerFrom.x)} ${round(innerFrom.y)} Z`
}

/** 高光所在那一圈（r=135）的裁剪带：两段，中间留出 8 点那个 7° 断口。 */
const RING_CLIP_PATHS = Object.freeze({
  inner: clockCardGeometry.orbitRadius - RING_CLIP.halfWidth,
  outer: clockCardGeometry.orbitRadius + RING_CLIP.halfWidth,
  a: ringBand(clockCardGeometry.orbitRadius - RING_CLIP.halfWidth,
    clockCardGeometry.orbitRadius + RING_CLIP.halfWidth, RING_CLIP.startAngle, RING_CLIP.gapStart),
  b: ringBand(clockCardGeometry.orbitRadius - RING_CLIP.halfWidth,
    clockCardGeometry.orbitRadius + RING_CLIP.halfWidth, RING_CLIP.gapEnd, RING_CLIP.startAngle + 360)
})

const GEOMETRY = {
  zoneFuture: 'M156.00 46.00 A107 107 0 1 1 66.77 212.06 L60.94 215.92 A114 114 0 1 0 156.00 39.00 Z',
  zonePast: 'M60.24 200.74 A107 107 0 0 1 156.00 46.00 L156.00 39.00 A114 114 0 0 0 53.98 203.87 Z',
  scaleArcA: 'M156.00 49.00 A104 104 0 1 1 69.28 210.40',
  scaleArcB: 'M62.93 199.40 A104 104 0 0 1 156.00 49.00',
  glowClipA: 'M156.00 53.50 A99.5 99.5 0 1 1 73.03 207.92 L65.52 212.89 A108.5 108.5 0 1 0 156.00 44.50 Z',
  glowClipB: 'M66.95 197.40 A99.5 99.5 0 0 1 156.00 53.50 L156.00 44.50 A108.5 108.5 0 0 0 58.90 201.41 Z',
  flowClipA: 'M156.00 50.50 A102.5 102.5 0 1 1 70.53 209.57 L68.03 211.23 A105.5 105.5 0 1 0 156.00 47.50 Z',
  flowClipB: 'M64.27 198.74 A102.5 102.5 0 0 1 156.00 50.50 L156.00 47.50 A105.5 105.5 0 0 0 61.58 200.07 Z',
  flowFan: 'M156.0 153.0 L17.44 73.00 A160.0 160.0 0 0 1 294.56 73.00 Z',
  pointer: 'M156.0 37.0 l-4.5 -10 h9 z'
} as const

/** 刻度：按 30° 布置 12 个位置，240° 那个已删（它在 8 点断口上）→ 实画 11 根。 */
const TICK_ANGLES = [0, 30, 60, 90, 120, 150, 180, 210, 270, 300, 330] as const
const TICK_INNER = 92
const TICK_OUTER = 104

function tick(angle: number): Readonly<{ x1: number; y1: number; x2: number; y2: number }> {
  const radians = angle * Math.PI / 180
  return {
    x1: Number((clockCardCenter.svgX + TICK_INNER * Math.sin(radians)).toFixed(1)),
    y1: Number((clockCardCenter.svgY - TICK_INNER * Math.cos(radians)).toFixed(1)),
    x2: Number((clockCardCenter.svgX + TICK_OUTER * Math.sin(radians)).toFixed(1)),
    y2: Number((clockCardCenter.svgY - TICK_OUTER * Math.cos(radians)).toFixed(1))
  }
}

export type ClockCardText = Readonly<{
  ariaLabel: string
  /** 指标缩写：牌上第一行。 */
  names: Readonly<Record<string, string>>
  /** 主位第一行的全名（原型：中央写全名，环上那块写缩写）。 */
  centerNames: Readonly<Record<string, string>>
  /** 主位：预期那一行（现在放在数值**上方**，否则读者会把数值当成实际值）。 */
  expectation: string
  /** 政策利率那一格：值来自盘口主推档概率，名字必须带「维持不变概率」。 */
  policyProbabilityName: string
  /** 预期拿不到时的那一行（绝不拿示例值顶）。 */
  expectationMissing: string
  /** 前值那一行的前缀。 */
  previous: string
  /** 主位倒计时：`{days} 天后`。 */
  daysUntil: string
  /** 12 点位置标记。 */
  now: string
  /** 底部状态行。 */
  live: string
  detail: string
  calendarAction: string
  /** ⓘ 里那句来源说明。 */
  sourceNote: string
  /** 没上环的指标那一行：`{name} 未上环：{reason}`。 */
  unplaced: Readonly<Record<'no-period' | 'period-out-of-range' | 'no-next-release' | 'crowded', string>>
  unplacedLine: string
  /** 政策块的两种降级（只在政策那块表达，整张卡不降级）。 */
  policyDisabled: string
  policyUnreadable: string
  /** 政策未启用时那条去开启数据源的路（复用宿主现有的设置入口，不新造）。 */
  openSources: string
  /** 撞牌让位那条：`{name} {days} 天后`。 */
  crowdedLine: string
  /** 交代行头：`另有 {count} 项未上环：{items}`。 */
  crowdedLead: string
  /** 超过 3 项时的尾巴：`另有 {count} 项`。 */
  crowdedMore: string
}>

export function ClockCard({ model, text, actionLabelKey, onOpenDetail, onOpenCalendar, resolveText, policyState, onOpenPolicySources, policyNotice }: Readonly<{
  model: ClockCardModel
  /** 政策那一块的状态：读到就正常画牌；未启用/读不到都只影响这一块，别的牌照旧。 */
  policyState?: 'disabled' | 'unreadable'
  /** 未启用时点「去启用数据源」：走宿主原来的打开设置那条路。 */
  onOpenPolicySources?: () => void
  /**
   * 政策那一块的说明句：由宿主按**原来那三支判断**给出（未启用哪一格 / 源自己关着 / 读不到），
   * 这里只负责显示——句子怎么来的不搬到卡里，否则两处各判一次必然长歪。
   */
  policyNotice?: Readonly<{ sentence: string; actionLabel?: string; onAction?: () => void }>
  text: ClockCardText
  /** 日历图标的读屏名（`IconButton` 只收键）。 */
  actionLabelKey: string
  onOpenDetail: () => void
  onOpenCalendar: () => void
  resolveText: (key: string) => string
}>): React.ReactElement {
  const notice = policyNotice
    ?? (policyState === undefined ? undefined : {
      sentence: policyState === 'disabled' ? text.policyDisabled : text.policyUnreadable,
      ...(policyState === 'disabled' && onOpenPolicySources !== undefined
        ? { actionLabel: text.openSources, onAction: onOpenPolicySources } : {})
    })
  const center = model.center
  const centerPlaqueId = center === undefined ? undefined : `${center.metricKey}:future`

  // 卡本体就是这个 section（原型也是 `<section class="n">`）：多包一层会让 min-width/flex 计算值变化。
  // 用户 2026-11-15：**不再缩放**。卡保持 336×330、`transform` 为单位矩阵，
  // 只由外层容器决定它放在哪、旁边是谁；内部尺寸与 537 项计算值一项不动。
  return <section className="mi-clock" aria-label={text.ariaLabel}>
      <svg className="mi-clock__svg" viewBox={`0 0 ${clockCardGeometry.svgWidth} ${clockCardGeometry.svgHeight}`} aria-hidden="true">
        <defs>
          <filter id="miClockFlowGlow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="2.5" /></filter>
          <clipPath id="miClockGlowClip" clipPathUnits="userSpaceOnUse">
            <path d={GEOMETRY.glowClipA} fill="#fff" /><path d={GEOMETRY.glowClipB} fill="#fff" />
          </clipPath>
          <clipPath id="miClockFlowClip" clipPathUnits="userSpaceOnUse">
            <path d={GEOMETRY.flowClipA} fill="#fff" /><path d={GEOMETRY.flowClipB} fill="#fff" />
          </clipPath>
          {/* 高光那一圈（r=135）的遮罩：与旧 flowClip 同一组角度端点，只是半径对齐轨道。 */}
          <clipPath id="miClockRingClip" clipPathUnits="userSpaceOnUse">
            <path d={RING_CLIP_PATHS.a} fill="#fff" /><path d={RING_CLIP_PATHS.b} fill="#fff" />
          </clipPath>
          <linearGradient id="miClockFlowGrad" gradientUnits="userSpaceOnUse" x1="65.93" y1="153.00" x2="246.07" y2="153.00">
            <stop className="mi-clock__flowStart" offset="0" /><stop className="mi-clock__flowEnd" offset="1" />
          </linearGradient>
        </defs>
        <circle className="mi-clock__ring" cx={clockCardCenter.svgX} cy={clockCardCenter.svgY} r={clockCardGeometry.orbitRadius} strokeWidth="1" opacity=".9" />
        <path className="mi-clock__zone-future" d={GEOMETRY.zoneFuture} />
        <path className="mi-clock__zone-past" d={GEOMETRY.zonePast} />
        <path d={GEOMETRY.scaleArcA} fill="none" stroke="currentColor" strokeWidth="1" />
        <path d={GEOMETRY.scaleArcB} fill="none" stroke="currentColor" strokeWidth="1" />
        {TICK_ANGLES.map((angle) => {
          const line = tick(angle)
          return <line key={angle} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="currentColor" strokeWidth="1" />
        })}
        <g clipPath="url(#miClockGlowClip)"><g className="mi-clock__orbit">
          <path className="mi-clock__glow" d={GEOMETRY.flowFan} fill="url(#miClockFlowGrad)" />
        </g></g>
        {/* 内圈那块静态渐变扇：仍用旧遮罩（半径 102.5~105.5），与高光无关。 */}
        <g clipPath="url(#miClockFlowClip)"><g className="mi-clock__orbit">
          <path d={GEOMETRY.flowFan} fill="url(#miClockFlowGrad)" clipPath="url(#miClockFlowClip)" />
        </g></g>
        {/* 环流高光：单独用同轨道的遮罩（r=135±1.5），否则会被内圈那份裁掉、在屏幕上根本看不见。 */}
        <g clipPath="url(#miClockRingClip)"><g className="mi-clock__orbit">
          {/*
            **环流高光**（界面设计 2026-11-20，全仓唯一一条装饰动画）：
            沿轨道推进一段亮斑，头亮尾透明，8s 线性无限循环。
            用 `stroke-dasharray` / `stroke-dashoffset` 推进描边，**不用 `transform: rotate`**——
            旋转只归 `loadingState`（转圈＝正在加载），这里一动就会和加载信号撞。
            `r=135` 周长 ≈ 848，亮斑取 1/3（283）；起点在 12 点，所以静置偏移 848/4 ≈ 212。
          */}
          <circle className="mi-clock__sweep" cx={clockCardCenter.svgX} cy={clockCardCenter.svgY}
            r={clockCardGeometry.orbitRadius} fill="none" stroke="url(#miClockFlowGrad)"
            strokeWidth="3" strokeDasharray="283 565" strokeDashoffset="212" />
        </g></g>
        {/* 12 点「现在点」：环连着，这是位置标记，不是断口收口。 */}
        <circle className="mi-clock__nowmark" cx={clockCardCenter.svgX} cy={42.5} r="3.5" />
        <circle className="mi-clock__zoneend" cx="63.86" cy="213.99" r="3.5" />
        <circle className="mi-clock__zoneend" cx="57.11" cy="202.30" r="3.5" />
        <path className="mi-clock__now" d={GEOMETRY.pointer} />
        <text className="mi-clock__now" x={clockCardCenter.svgX} y="67.0" textAnchor="middle" fontSize="11">{text.now}</text>
      </svg>

      {center === undefined ? null : <div className="mi-clock__core">
        <span className="mi-clock__row1">
          <span className="mi-clock__name">{plaqueName(center.metricKey, center.nameKey, text, true)}</span>
          <span className="mi-clock__badge">{text.daysUntil.replace('{days}', String(center.daysUntil))}</span>
        </span>
        {/* 标签在数值**上方**（用户 2026-11-20 报「预期（市场共识）」像空的）：写在下面时，
            读者会把大号数值当成实际值、把下面那行当成一个没有值的标签。 */}
        {center.expected === undefined ? null : <p className="mi-clock__unit">{text.expectation}</p>}
        <p className="mi-clock__value">{center.expected ?? text.expectationMissing}</p>
        {center.previous === undefined ? null : <span className="mi-clock__tier">
          {text.previous} <b>{center.previous}</b>
        </span>}
      </div>}

      {/* 指标牌：位置与 --o 都由模型算。原型是 <button> 但没有动作，故渲染成不可点的节点
          （规范：行容器不是按钮）；悬停恢复 100% 的视觉保留。 */}
      {model.plaques.map((plaque: ClockPlaque) => <div
        key={plaque.id}
        className={`mi-clock__node${plaque.zone === 'past' ? ' mi-clock__node--past' : ''}`}
        data-clock-plaque={plaque.zone}
        data-clock-metric={plaque.metricKey}
        {...(plaque.id === centerPlaqueId ? { 'data-center': true } : {})}
        style={{ left: plaque.x, top: plaque.y, '--o': plaque.opacity } as React.CSSProperties}>
        <span>{plaqueName(plaque.metricKey, plaque.nameKey, text)}</span>
        {plaque.value === undefined ? null : <b>{plaque.value}</b>}
      </div>)}

      {/* 叠在右上角：绝对定位，不挤动卡内任何计算值。点击复用「请求序号 → 打开抽屉」那条路。 */}
      <div className="mi-clock__action">
        <IconButton ariaLabelKey={actionLabelKey} icon={Calendar} size="sm" variant="overlay" resolveText={resolveText} onSelect={onOpenCalendar} />
      </div>

      {/* 政策块的降级说明：**看得见**的一行（不是只藏在 ⓘ 里），未启用时还带一条去设置的路。
          只在政策那一块表达：主位与另外三块牌照常画。 */}
      {notice === undefined ? null : <div className="mi-clock__policy-note" data-clock-policy={policyState ?? (notice.actionLabel === undefined ? 'unreadable' : 'disabled')}>
        <span>{notice.sentence}</span>
        {notice.onAction === undefined || notice.actionLabel === undefined
          ? null
          : <button type="button" className="mi-clock__policy-action" onClick={notice.onAction}>{notice.actionLabel}</button>}
      </div>}

      {/* 状态行（用户 2026-11-15）：只留 ⓘ——「● 实时 · 详细 ↗」删掉；ⓘ 不能删，里面装着
          「另有 N 项未上环」那条交代。容器保留（它是 ⓘ 的定位上下文），卡高仍 330。 */}
      <div className="mi-clock__foot">
        {/* 原型这一格就是 `<span title>`（不是浮层组件）：来源说明 + 没上环那几行的交代都放在这里。 */}
        <span className="mi-clock__info" tabIndex={0}
          title={[text.sourceNote, ...unplacedLines(model, text, policyState)].join('｜')}
          data-clock-unplaced={model.unplaced.length}>ⓘ</span>
      </div>
  </section>
}

/**
 * 没上环的指标写成一行说明（ⓘ 的提示文字）：取不到周期、周期不合理、没有下一期，
 * 三种原因各一句。ⓘ 的第一行「来源说明」由入口那行拼，这里只给后面几行。**不许静默消失**。
 */
function unplacedLines(model: ClockCardModel, text: ClockCardText, policyState?: 'disabled' | 'unreadable'): string[] {
  // 撞牌让位的写成「名字 + 还有几天」（最多 3 项，其余折成条数）；其余原因逐条写原因。
  const crowded = model.unplaced.filter((entry) => entry.reason === 'crowded')
  const shown = crowded.slice(0, 3).map((entry) =>
    text.crowdedLine.replace('{name}', text.names[entry.nameKey] ?? entry.nameKey).replace('{days}', String(entry.daysUntil ?? 0)))
  const rest = crowded.length - shown.length
  const crowdedLine = crowded.length === 0 ? undefined : text.crowdedLead
    .replace('{count}', String(crowded.length))
    .replace('{items}', [...shown, ...(rest > 0 ? [text.crowdedMore.replace('{count}', String(rest))] : [])].join('、'))
  const lines = model.unplaced.filter((entry) => entry.reason !== 'crowded').map((entry) =>
    text.unplacedLine
      .replace('{name}', text.names[entry.nameKey] ?? entry.nameKey)
      .replace('{reason}', text.unplaced[entry.reason]))
  const policy = policyState === undefined ? [] : [policyState === 'disabled' ? text.policyDisabled : text.policyUnreadable]
  return [...policy, ...(crowdedLine === undefined ? [] : [crowdedLine]), ...lines]
}

/**
 * 牌上的名字：政策利率那一格的值是**盘口主推档的概率**，不是利率水平——
 * 名字必须带「维持不变概率」，否则 90.9% 会被读成利率（用户 2026-11-20 报的就是这个）。
 */
function plaqueName(metricKey: string, nameKey: string, text: ClockCardText, center = false): string {
  if (metricKey === 'US.TARGET_RATE.DECISION') return text.policyProbabilityName
  const name = (center ? text.centerNames[nameKey as keyof typeof text.centerNames] : undefined)
    ?? text.names[nameKey as keyof typeof text.names]
    ?? nameKey
  return name
}

// ---------------------------------------------------------------------------
// 临时诊断（Chief 2026-11-20）：「环上有样式但一动不动」，要一次运行时真相。
// 放在**模块级**：热更新会替换模块并重新执行这里，不依赖组件重挂（Fast Refresh 不重挂）。
// 只用 console.warn 输出（渲染层只有 warn/error 进 app.log）。查完整段删掉。
if (import.meta.env.DEV) {
  setTimeout(() => {
    const host = document.querySelector('.mi-clock')
    const el = host?.querySelector('.mi-clock__sweep')
    const cs = el instanceof SVGElement ? getComputedStyle(el) : undefined
    console.warn('[mi-clock-diag]', JSON.stringify({
      path: location.pathname,
      hostFound: host !== null,
      exists: el !== undefined && el !== null,
      animationName: cs?.animationName,
      animationDuration: cs?.animationDuration,
      animationPlayState: cs?.animationPlayState,
      dashoffset: cs?.strokeDashoffset,
      dashoffsetAttr: el?.getAttribute('stroke-dashoffset'),
      reduceNoPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches
    }))
    /**
     * 再采一次：**必须跨帧**。同一帧连取两次永远相同，`moving` 会假阴性（Chief 2026-11-20 实测到过）。
     * 用 `requestAnimationFrame` 拿到下一帧再比。
     */
    requestAnimationFrame(() => {
      const first = getComputedStyle(el instanceof SVGElement ? el : document.body).strokeDashoffset
      requestAnimationFrame(() => {
        const el2 = document.querySelector('.mi-clock__sweep')
        const second = el2 instanceof SVGElement ? getComputedStyle(el2).strokeDashoffset : undefined
        console.warn('[mi-clock-diag]', JSON.stringify({
          path: location.pathname, after: 'cross-frame', dashSamples: [first, second],
          moving: first !== second
        }))
      })
    })
  }, 1500)
}
