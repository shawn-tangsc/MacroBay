import { Calendar } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { helpTrigger } from '@platform/ui/components/popover'

import type { ClockCardModel, ClockCenterFace, ClockPlaque, ClockPlaqueStacked } from './clockCardModel'
import { clockCardCenter, clockCardGeometry, clockPlaqueRaisedZ } from './clockCardModel'
import { clockSvgGeometry, clockSvgMarks, clockTickRadius } from './clockCardSvg'
import './clockCard.css'

/**
 * 宏观时钟卡。
 *
 * 唯一依据：`docs-private/05-desktop/ui-audit/prototypes/FINAL-时钟卡-实现依据.html`。
 * 形状、颜色、字体、过渡、流光参数全部照搬；只有这些位置接数据：四块牌的角度与坐标、
 * 牌的不透明度、主位的指标/天数/值、没上环那几行的说明。
 *
 * 圆心只有一处来源：`clockCardGeometry`（CARD 252×248、PAD 9），组件里不写第二份。
 * 环与刻度环的路径在 `clockCardSvg` 里：照原型逐字搬，再按 A 方案的系数等比缩一次
 * （用户 2026-11：整体小四分之一），组件里不写死任何一个坐标。
 */
/** 刻度：按 30° 布置 12 个位置，240° 那个已删（它在 8 点断口上）→ 实画 11 根。 */
const TICK_ANGLES = [0, 30, 60, 90, 120, 150, 180, 210, 270, 300, 330] as const
const TICK_INNER = clockTickRadius.inner
const TICK_OUTER = clockTickRadius.outer

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
  /**
   * 政策利率那一格：值来自盘口**主推档**的概率，标签必须按主推档生成
   * （写死「维持不变」在 2026-11-20 那天就是错的：主推档其实是加息 25bp）。
   */
  policyOutcomeLabel: string
  policyOutcomeNames: Readonly<Record<string, string>>
  /** 预期拿不到时的那一行（绝不拿示例值顶）。 */
  expectationMissing: string
  /** 前值那一行的前缀。 */
  previous: string
  /** 主位倒计时：`{days} 天后`。 */
  daysUntil: string
  /** 过去牌的距离：`{days} 天前`。 */
  daysAgo: string
  /** 当天发布不写「0 天后」，写这个。 */
  today: string
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
  /** 每个发布日一块牌；同一天没被选上的发布在这行里（`{count}` 个），点 ⓘ 列全。 */
  overflowLine: string
  /** 溢出逐条：`{name} · {date} · {days} 天后`。 */
  overflowItem: string
  /* ── 中央两张面（用户 2026-11-21 拍板，42 号文件）── */
  /** 平时的面名：`利率路径`。 */
  facePath: string
  /** 档名：`{month} 月{outcome}`，月份来自会议日，动作名按主推档生成。 */
  policyOutcomeLead: string
  /** 会议那一行：`{date} · {days} 天`。 */
  meetingLine: string
  probabilityMissing: string
  pathUnreadable: string
  pathDisabled: string
  actualLabel: string
  waitingResult: string
  /** 窗口内读不到：`{name}暂时读不到`。 */
  metricUnreadable: string
  /** 窗口内没有盘口预期：`暂无预期（盘未开）`。 */
  expectationNotOpen: string
  /** 倒计时胶囊：`{hours} 小时前` / `{hours} 小时后发布` / `已过 {hours} 小时`。 */
  pillHoursAgo: string
  pillReleasesIn: string
  pillOverdue: string
  /** 已发布那态的副行：`预期 {expected} · 前值 {previous}`。 */
  expectPrevShort: string
  prevOnly: string
  deltaAbove: string
  deltaBelow: string
  retry: string
  enableSource: string
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
  /**
   * 抬起来的那块牌（鼠标悬停）：环上一组牌会互相叠住，抬到最前的那块必须整块可读
   * （用户 2026-11：「鼠标移动到对应的卡片就会到前面来」）。层级只在抬起的这一块上用行内给，
   * 其余牌子的层级仍由模型按「离现在近的在上」排好——两套规矩不混在 CSS 里。
   *
   * 不给牌子 `tabIndex`：它们不点击、不展开，做成可聚焦就是假控件（读屏会以为这里能操作）。
   */
  const [raised, setRaised] = useState<string | undefined>(undefined)
  const center = model.center
  /**
   * 没上环的发布清单（`not-selected`）：逐条写「名字 · 日期 · 几天后」。
   * 每个发布日只上一块牌；同一天其余的一级指标在这里列全——不在一行里堆 12 个名字。
   */
  const overflowItems = model.unplaced
    .filter((entry) => entry.reason === 'not-selected')
    .map((entry) => text.overflowItem
      .replace('{name}', text.names[entry.nameKey] ?? entry.nameKey)
      .replace('{date}', entry.date ?? '—')
      .replace('{days}', String(entry.daysUntil ?? 0)))
  // 中央是利率路径面时，环上没有「中央那一块」可沉底（政策牌与中央不同源），只有指标面才有。
  const centerPlaqueId = center?.kind === 'metric' ? `${center.metricKey}:future` : undefined

  // 卡本体就是这个 section（原型也是 `<section class="n">`）：多包一层会让 min-width/flex 计算值变化。
  // 用户 2026-11 拍板 A 方案后卡是 252×248（几何常量一处来源），仍**不用 transform 缩放**：
  // `transform` 为单位矩阵，只由外层容器决定它放在哪、旁边是谁。
  /**
   * 环上那道流光的圆心：**从几何常量来**，CSS 里不存第二份。
   * 它曾经写死过 `transform-origin: 156px 153px`——卡一缩小，旋转轴就偏出去 39px，光斑转到环外，
   * 用户看到的只是「流光不见了」。现在两个变量由这里给，改尺寸只改几何常量。
   */
  return <section className="mi-clock" aria-label={text.ariaLabel}
    style={{ '--mi-clock-center-x': `${clockCardCenter.svgX}px`, '--mi-clock-center-y': `${clockCardCenter.svgY}px` } as React.CSSProperties}>
      <svg className="mi-clock__svg" viewBox={`0 0 ${clockCardGeometry.svgWidth} ${clockCardGeometry.svgHeight}`} aria-hidden="true">
        <defs>
          <filter id="miClockFlowGlow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="2.5" /></filter>
          <clipPath id="miClockGlowClip" clipPathUnits="userSpaceOnUse">
            <path d={clockSvgGeometry.glowClipA} fill="#fff" /><path d={clockSvgGeometry.glowClipB} fill="#fff" />
          </clipPath>
          <clipPath id="miClockFlowClip" clipPathUnits="userSpaceOnUse">
            <path d={clockSvgGeometry.flowClipA} fill="#fff" /><path d={clockSvgGeometry.flowClipB} fill="#fff" />
          </clipPath>
          <linearGradient id="miClockFlowGrad" gradientUnits="userSpaceOnUse" x1="65.93" y1="153.00" x2="246.07" y2="153.00">
            <stop className="mi-clock__flowStart" offset="0" /><stop className="mi-clock__flowEnd" offset="1" />
          </linearGradient>
        </defs>
        <circle className="mi-clock__ring" cx={clockCardCenter.svgX} cy={clockCardCenter.svgY} r={clockCardGeometry.orbitRadius} strokeWidth="1" opacity=".9" />
        <path className="mi-clock__zone-future" d={clockSvgGeometry.zoneFuture} />
        <path className="mi-clock__zone-past" d={clockSvgGeometry.zonePast} />
        <path d={clockSvgGeometry.scaleArcA} fill="none" stroke="currentColor" strokeWidth="1" />
        <path d={clockSvgGeometry.scaleArcB} fill="none" stroke="currentColor" strokeWidth="1" />
        {TICK_ANGLES.map((angle) => {
          const line = tick(angle)
          return <line key={angle} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="currentColor" strokeWidth="1" />
        })}
        <g clipPath="url(#miClockGlowClip)"><g className="mi-clock__orbit">
          <path className="mi-clock__glow" d={clockSvgGeometry.flowFan} fill="url(#miClockFlowGrad)" />
        </g></g>
        {/* 内圈那块静态渐变扇：仍用旧遮罩（半径 102.5~105.5），与高光无关。 */}
        <g clipPath="url(#miClockFlowClip)"><g className="mi-clock__orbit">
          <path d={clockSvgGeometry.flowFan} fill="url(#miClockFlowGrad)" clipPath="url(#miClockFlowClip)" />
        </g></g>

        {/* 12 点「现在点」：环连着，这是位置标记，不是断口收口。 */}
        <circle className="mi-clock__nowmark" cx={clockCardCenter.svgX} cy={clockSvgMarks.nowMarkY} r="3.5" />
        <circle className="mi-clock__zoneend" cx={clockSvgMarks.zoneEndA.x} cy={clockSvgMarks.zoneEndA.y} r="3.5" />
        <circle className="mi-clock__zoneend" cx={clockSvgMarks.zoneEndB.x} cy={clockSvgMarks.zoneEndB.y} r="3.5" />
        <path className="mi-clock__now" d={clockSvgGeometry.pointer} />
        <text className="mi-clock__now" x={clockCardCenter.svgX} y={clockSvgMarks.nowLabelY} textAnchor="middle" fontSize="11">{text.now}</text>
      </svg>

      {/* 中央两张面（用户 2026-11-21 拍板，42 号文件）：平时利率路径，±24 小时内切成指标。
          几何不动：还是这个 `mi-clock__core`，只换里面的行（最多 5 行，界面设计实测）。 */}
      {center === undefined ? null : <div className="mi-clock__core" data-clock-center={center.kind}>
        <ClockFace center={center} text={text}
          {...(policyState === undefined ? {} : { policyState })}
          {...(notice === undefined ? {} : { notice })} />
      </div>}

      {/* 指标牌：位置、透明度和层级都由模型算（`z` 按「离现在近的在上」排好）。
          原型是 <button> 但没有动作，故渲染成不可点的节点（规范：行容器不是按钮）；
          悬停恢复 100% 的视觉保留。
          牌上三样：名字、值（有才显示）、**距离**（用户 2026-11：「距离时间呢？」）。
          距离并进值那一行，牌高仍在 37–44px，不为它改时钟几何。
          近了不合并：两块各自一块牌、各写自己的名字与天数，允许叠住（上限在布局里），
          鼠标移到哪块，哪块就抬到最前并整块可读（用户 2026-11）。
          **只对鼠标抬，不给牌子 tabIndex**：牌不点击也不展开，给它焦点就是假控件。
          遮挡只是视觉问题——牌上的名字与天数是**真实文本**，读屏照读，被盖住的那块信息不丢。 */}
      {model.plaques.map((plaque: ClockPlaqueStacked) => {
        const distance = plaqueDistance(plaque, text)
        return <div
          key={plaque.id}
          className={`mi-clock__node${plaque.zone === 'past' ? ' mi-clock__node--past' : ''}`}
          data-clock-plaque={plaque.zone}
          data-clock-metric={plaque.metricKey}
          {...(plaque.id === centerPlaqueId ? { 'data-center': true } : {})}
          onMouseEnter={() => setRaised(plaque.id)}
          onMouseLeave={() => setRaised(undefined)}
          style={{
            left: plaque.x, top: plaque.y, '--o': plaque.opacity, '--mi-clock-z': plaque.z,
            ...(raised === plaque.id ? { zIndex: clockPlaqueRaisedZ } : {})
          } as React.CSSProperties}>
          <span className="mi-clock__node-name">{plaqueName(plaque.nameKey, text)}</span>
          {plaque.value === undefined && distance === undefined ? null : <span className="mi-clock__node-meta">
            {plaque.value === undefined ? null : <b>{plaque.value}</b>}
            {distance === undefined ? null : <span className="mi-clock__node-when">{distance}</span>}
          </span>}
        </div>
      })}

      {/* 叠在右上角：绝对定位，不挤动卡内任何计算值。点击复用「请求序号 → 打开抽屉」那条路。 */}
      <div className="mi-clock__action">
        <IconButton ariaLabelKey={actionLabelKey} icon={Calendar} size="sm" variant="overlay" resolveText={resolveText} onSelect={onOpenCalendar} />
      </div>

      {/* 每个发布日一块牌（用户 2026-11-21 更正）：同一天没被选上的其余发布在这行里，
          点 ⓘ 列全（名字 · 日期 · 几天后）。计数为 0 时整行不渲染——不写「还有 0 个」。 */}
      {overflowItems.length === 0 ? null : <p className="mi-clock__overflow" data-clock-overflow>
        <span>{text.overflowLine.replace('{count}', String(overflowItems.length))}</span>
        {helpTrigger({ text: overflowItems.join('；') })}
      </p>}

      {/* 政策块的降级说明：**看得见**的一行（不是只藏在 ⓘ 里），未启用时还带一条去设置的路。
          只在政策那一块表达：主位与另外三块牌照常画。 */}
      {notice === undefined ? null : <div className="mi-clock__policy-note" data-clock-policy={policyState ?? (notice.actionLabel === undefined ? 'unreadable' : 'disabled')}>
        <span>{notice.sentence}</span>
        {notice.onAction === undefined || notice.actionLabel === undefined
          ? null
          : <button type="button" className="mi-clock__policy-action" onClick={notice.onAction}>{notice.actionLabel}</button>}
      </div>}

      {/* 状态行（用户 2026-11-15）：只留 ⓘ——「● 实时 · 详细 ↗」删掉；ⓘ 不能删，
          里面装着来源说明、撞牌让位与其他没上环的原因（`not-selected` 那条在上一行的溢出行里，
          不重复搬到这里——两处各说一半，读者会以为漏了）。容器保留（它是 ⓘ 的定位上下文）。 */}
      <div className="mi-clock__foot">
        {/* 底部这格也是 ⓘ，与溢出行那颗**同一套交互**（`helpTrigger` → Popover）：一张卡上不留两种
            交互（原生 `title` 在键盘/触屏上唤不出来，且与上面的浮层不一致）。
            内容只放这里该说的：来源说明 + 撞牌让位 + 其他没上环的原因；`not-selected`（同一天没被选为代表）由上面那行溢出行单独表达，**两处不重复**。 */}
        <span className="mi-clock__info">
          {helpTrigger({ text: [text.sourceNote, ...unplacedLines(model, text, policyState)].join('｜') })}
        </span>
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
  // `not-selected`（同一天没被选为代表）由卡片下沿那行单独表达，不混进 ⓘ。
  const lines = model.unplaced
    .filter((entry) => entry.reason !== 'crowded' && entry.reason !== 'not-selected')
    .map((entry) => text.unplacedLine
      .replace('{name}', text.names[entry.nameKey] ?? entry.nameKey)
      .replace('{reason}', text.unplaced[entry.reason as keyof typeof text.unplaced]))
  const policy = policyState === undefined ? [] : [policyState === 'disabled' ? text.policyDisabled : text.policyUnreadable]
  return [...policy, ...(crowdedLine === undefined ? [] : [crowdedLine]), ...lines]
}

/**
 * 中央两张面（用户 2026-11-21 拍板，42 号文件 §四）：
 * 平时是**利率路径面**；只在某条一级指标发布前后各 24 小时内切成**指标面**。
 *
 * 行数上限 5（界面设计实测：最高组合态 100.9，离刻度内沿 r=92 只剩 2.7px）。
 * 数值态走 `--font-metric-md`，句子态走 `--font-body`——同一槽位不许两种字号混用。
 */
function ClockFace({ center, text, policyState, notice }: Readonly<{
  center: ClockCenterFace
  text: ClockCardText
  policyState?: 'disabled' | 'unreadable'
  notice?: Readonly<{ sentence: string; actionLabel?: string; onAction?: () => void }>
}>): React.ReactElement {
  return center.kind === 'metric'
    ? <MetricFace face={center} text={text} />
    : <PolicyFace face={center} text={text}
        {...(policyState === undefined ? {} : { policyState })}
        {...(notice === undefined ? {} : { notice })} />
}

/** 平时的利率路径面（版本一）：档名 + 概率大字 + 会议日 · 天数。 */
function PolicyFace({ face, text, policyState, notice }: Readonly<{
  face: Extract<ClockCenterFace, { kind: 'policy' }>
  text: ClockCardText
  policyState?: 'disabled' | 'unreadable'
  notice?: Readonly<{ sentence: string; actionLabel?: string; onAction?: () => void }>
}>): React.ReactElement {
  const head = <span className="mi-clock__row1"><span className="mi-clock__name">{text.facePath}</span></span>
  if (policyState === 'disabled') {
    return <>{head}
      <p className="mi-clock__sentence">{text.pathDisabled}</p>
      {faceAction(notice?.actionLabel ?? text.enableSource, notice?.onAction)}
    </>
  }
  if (policyState === 'unreadable') {
    // 原因句由宿主给（哪一格没开 / 源自己关着 / 读失败）；没有就不写，不编一句。
    return <>{head}
      <p className="mi-clock__sentence">{text.pathUnreadable}</p>
      {notice === undefined ? null : <span className="mi-clock__sub">{notice.sentence}</span>}
      {faceAction(notice?.actionLabel ?? text.retry, notice?.onAction)}
    </>
  }
  const outcomeName = face.outcome === undefined ? undefined : text.policyOutcomeNames[face.outcome]
  // 档名按主推档生成：hike-25 → 「12 月加息 25bp」。取不到档位就不写这一行，不编一个。
  const lead = outcomeName === undefined || face.meetingDate === undefined ? undefined
    : text.policyOutcomeLead
      .replace('{month}', String(Number(face.meetingDate.slice(5, 7))))
      .replace('{outcome}', outcomeName)
  return <>{head}
    {lead === undefined ? null : <span className="mi-clock__label">{lead}</span>}
    {face.probability === undefined
      ? <p className="mi-clock__sentence">{text.probabilityMissing}</p>
      : <p className="mi-clock__value">{face.probability}</p>}
    {face.meetingDate === undefined || face.daysUntil === undefined ? null : <span className="mi-clock__sub">
      {text.meetingLine.replace('{date}', shortMonthDay(face.meetingDate)).replace('{days}', String(face.daysUntil))}
    </span>}
  </>
}

/** 窗口内的指标面：四态按 42 号文件 §四——有结果 / 未到发布 / 已过时刻无结果 / 该指标读不到。 */
function MetricFace({ face, text }: Readonly<{
  face: Extract<ClockCenterFace, { kind: 'metric' }>
  text: ClockCardText
}>): React.ReactElement {
  const name = text.names[face.nameKey] ?? face.nameKey
  const hours = Math.max(1, Math.round(Math.abs(face.hoursFromNow)))
  const pill = face.phase === 'upcoming' ? text.pillReleasesIn.replace('{hours}', String(hours))
    : face.phase === 'released' ? text.pillHoursAgo.replace('{hours}', String(hours))
      : text.pillOverdue.replace('{hours}', String(hours))
  const head = <span className="mi-clock__row1">
    <span className="mi-clock__name">{name}</span>
    <span className="mi-clock__badge">{pill}</span>
  </span>
  // 预期、前值、结果全取不到：说这条暂时读不到，不拿别的数顶。
  if (face.expected === undefined && face.previous === undefined && face.result === undefined) {
    return <>{head}<p className="mi-clock__sentence">{text.metricUnreadable.replace('{name}', name)}</p></>
  }
  if (face.phase === 'upcoming') {
    return <>{head}
      <span className="mi-clock__label">{text.expectation}</span>
      <p className="mi-clock__value">{face.expected ?? text.expectationNotOpen}</p>
      {face.previous === undefined ? null : <span className="mi-clock__sub">{text.prevOnly.replace('{previous}', face.previous)}</span>}
    </>
  }
  if (face.phase === 'overdue') {
    return <>{head}
      <p className="mi-clock__sentence">{text.waitingResult}</p>
      {face.previous === undefined ? null : <span className="mi-clock__sub">{text.prevOnly.replace('{previous}', face.previous)}</span>}
    </>
  }
  // 已发布：大字是实际值；「高于/低于预期」只在两个值都齐时才写。
  const delta = face.delta === undefined ? undefined
    : (face.deltaDirection === 'below' ? text.deltaBelow : text.deltaAbove).replace('{delta}', face.delta)
  const sub = face.consensus !== undefined && face.previous !== undefined
    ? text.expectPrevShort.replace('{expected}', face.consensus).replace('{previous}', face.previous)
    : face.previous === undefined ? undefined : text.prevOnly.replace('{previous}', face.previous)
  return <>{head}
    <span className="mi-clock__label">{text.actualLabel}</span>
    <p className="mi-clock__value">{face.result ?? text.waitingResult}</p>
    {delta === undefined ? null : <span className="mi-clock__delta">{delta}</span>}
    {sub === undefined ? null : <span className="mi-clock__sub">{sub}</span>}
  </>
}

/** 一格只给一个主动作：再试 或 去启用。没有动作通道就不画按钮（不画一个点不动的）。 */
function faceAction(label: string | undefined, onAction: (() => void) | undefined): React.ReactElement | null {
  if (label === undefined || onAction === undefined) return null
  return <button type="button" className="mi-clock__face-action" onClick={onAction}>{label}</button>
}

/** `2026-12-09` → `12–09`：会议日来自政策读数的日期串，不做时区换算（它是「哪一天开会」）。 */
function shortMonthDay(date: string): string {
  return date.length >= 10 ? `${date.slice(5, 7)}–${date.slice(8, 10)}` : date
}
/**
 * 牌上的距离（用户 2026-11：「距离时间呢？」）：未来牌「N 天后」、过去牌「N 天前」。
 * 当天发布写「今天」，不写「0 天后」——那读着像还没发生。
 */
function plaqueDistance(plaque: ClockPlaque, text: ClockCardText): string | undefined {
  if (plaque.zone === 'past') {
    if (plaque.daysAgo === undefined) return undefined
    return plaque.daysAgo === 0 ? text.today : text.daysAgo.replace('{days}', String(plaque.daysAgo))
  }
  if (plaque.daysUntil === undefined) return undefined
  return plaque.daysUntil === 0 ? text.today : text.daysUntil.replace('{days}', String(plaque.daysUntil))
}

/**
 * 牌上的名字：政策利率那一格的值是**盘口主推档的概率**，不是利率水平——
 * 名字必须带「概率」，否则 90.9% 会被读成利率（用户 2026-11-20 报的就是这个）。
 */
/** 牌上的名字：直接从文案表取。政策牌也是「政策利率」——概率不进牌（中央已经有）。 */
function plaqueName(nameKey: string, text: ClockCardText): string {
  return text.names[nameKey] ?? nameKey
}
