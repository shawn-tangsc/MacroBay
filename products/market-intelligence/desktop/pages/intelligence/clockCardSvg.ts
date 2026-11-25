/**
 * 时钟卡的 SVG 形状：**照着原型搬，只按 A 方案（卡 336×330 → 252×248）等比重算**。
 *
 * 原型的弧、指针、8 点断口那三颗点、刻度短线的坐标都是按 312×306 画布、圆心 (156,153)、
 * 轨道 r135 手写的。用户 2026-11 拍板「整体小四分之一」（A 方案）后，这些数字不能手改一遍
 * ——手改最容易抄错一位，而且下次再调尺寸还得重来。所以这里只存**原型那一份字符串**，
 * 按同一个系数（`clockCardSvgScale`）与圆心平移一次算出来。
 *
 * 判据：等比缩放下圆心不动（靠近环形变），所以「一个点在新坐标里到新圆心的距离」
 * 必须等于「原型里到旧圆心的距离 × 系数」。用例按这条断，不逐字比对字符串。
 */
import { clockCardCenter, clockCardGeometry, clockCardSvgScale } from './clockPlaqueLayout'

/** 原型画布：336×330 卡、内距 12 → SVG 312×306，圆心 (156,153)。 */
const PROTOTYPE_CENTER = Object.freeze({ x: 156, y: 153 })

/** 原型里那几条弧（逐字搬自 `FINAL-时钟卡-实现依据.html`，一个数都没改）。 */
const PROTOTYPE_GEOMETRY = Object.freeze({
  zoneFuture: 'M156.00 46.00 A107 107 0 1 1 66.77 212.06 L60.94 215.92 A114 114 0 1 0 156.00 39.00 Z',
  zonePast: 'M60.24 200.74 A107 107 0 0 1 156.00 46.00 L156.00 39.00 A114 114 0 0 0 53.98 203.87 Z',
  scaleArcA: 'M156.00 49.00 A104 104 0 1 1 69.28 210.40',
  scaleArcB: 'M62.93 199.40 A104 104 0 0 1 156.00 49.00',
  glowClipA: 'M156.00 53.50 A99.5 99.5 0 1 1 73.03 207.92 L65.52 212.89 A108.5 108.5 0 1 0 156.00 44.50 Z',
  glowClipB: 'M66.95 197.40 A99.5 99.5 0 0 1 156.00 53.50 L156.00 44.50 A108.5 108.5 0 0 0 58.90 201.41 Z',
  flowClipA: 'M156.00 50.50 A102.5 102.5 0 1 1 70.53 209.57 L68.03 211.23 A105.5 105.5 0 1 0 156.00 47.50 Z',
  flowClipB: 'M64.27 198.74 A102.5 102.5 0 0 1 156.00 50.50 L156.00 47.50 A105.5 105.5 0 0 0 61.58 200.07 Z',
  flowFan: 'M156.0 153.0 L17.44 73.00 A160.0 160.0 0 0 1 294.56 73.00 Z',
  /** 12 点的指针：起点 (156,37)、两边各 4.5 宽、高 10，底边闭合。 */
  pointer: 'M156.0 37.0 l-4.5 -10 h9 z'
} as const)

export type ClockSvgGeometry = Readonly<Record<keyof typeof PROTOTYPE_GEOMETRY, string>>

/** 一个原型坐标 → 这张卡的坐标（同心等比）。 */
export function scaleClockPoint(x: number, y: number): Readonly<{ x: number; y: number }> {
  return {
    x: clockCardCenter.svgX + (x - PROTOTYPE_CENTER.x) * clockCardSvgScale,
    y: clockCardCenter.svgY + (y - PROTOTYPE_CENTER.y) * clockCardSvgScale
  }
}

/** 原型里的半径 → 这张卡上的半径。 */
export function scaleClockRadius(radius: number): number {
  return radius * clockCardSvgScale
}

/**
 * 把一条原型路径搬到这张卡上：坐标按 `scaleClockPoint` 平移缩放，弧的半径乘系数，
 * 弧的标志位（large-arc / sweep）与旋转角原样保留——形状不变，只是变小。
 *
 * 只认原型里出现过的命令（M / L / A，以及指针那条的相对 l / h / z）：别的命令出现就抛错，
 * 免得将来有人塞一条曲线进来、被悄悄搬歪。
 */
export function scaleClockPath(path: string): string {
  const tokens = path.match(/[MLAZlhz]|-?\d+(?:\.\d+)?/g) ?? []
  const out: string[] = []
  let command: string | undefined
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]!
    if (/^[MLAZlhz]$/u.test(token)) {
      command = token
      out.push(token)
      index += 1
      continue
    }
    if (command === 'A') {
      const numbers = tokens.slice(index, index + 7).map(Number)
      const [rx, ry, rotation, largeArc, sweep, x, y] = numbers
      const point = scaleClockPoint(x!, y!)
      out.push(format(scaleClockRadius(rx!)), format(scaleClockRadius(ry!)),
        String(rotation), String(largeArc), String(sweep), format(point.x), format(point.y))
      index += 7
      continue
    }
    if (command === 'l' || command === 'h') {
      // 相对坐标只乘系数，不平移（指针那两个偏移）。
      const numbers = command === 'h' ? tokens.slice(index, index + 1).map(Number) : tokens.slice(index, index + 2).map(Number)
      out.push(...numbers.map((value) => format(value * clockCardSvgScale)))
      index += numbers.length
      continue
    }
    if (command === 'M' || command === 'L') {
      const point = scaleClockPoint(Number(tokens[index]), Number(tokens[index + 1]))
      out.push(format(point.x), format(point.y))
      index += 2
      continue
    }
    throw new Error(`unexpected path command in clock svg: ${String(command)}`)
  }
  return out.join(' ')
}

function format(value: number): string {
  return Number(value.toFixed(2)).toString()
}

/** 这张卡要画的几何：原型路径按系数搬过来。 */
export const clockSvgGeometry: ClockSvgGeometry = Object.freeze(
  Object.fromEntries(Object.entries(PROTOTYPE_GEOMETRY).map(([key, path]) => [key, scaleClockPath(path)]))
) as ClockSvgGeometry

/**
 * 三颗小圆点与「现在」的字位，同样按系数搬。
 * 点的半径保持 3.5（点跟描边一样不跟着缩，否则小卡上几乎看不见）；字仍是 11px 档，只挪位置。
 */
export const clockSvgMarks = Object.freeze({
  nowMarkRadius: 110.5,
  nowMarkY: scaleClockPoint(156, 42.5).y,
  zoneEndA: scaleClockPoint(63.86, 213.99),
  zoneEndB: scaleClockPoint(57.11, 202.30),
  nowLabelY: scaleClockPoint(156, 67.0).y
})

/**
 * 刻度短线的内外半径：外圈就是刻度环本身（`clockCardGeometry.scaleRadius`），内圈按原型 92/104 的比例。
 *
 * 原型里那条刻度弧的半径 104 缩过来是 77.81，而常量取整成 78——两者差 0.19px，
 * 肉眼与 1px 描边都看不出来；**刻度必须贴着常量那圈**，否则线头会和弧错开。
 */
export const clockTickRadius = Object.freeze({
  inner: clockCardGeometry.scaleRadius * (92 / 104),
  outer: clockCardGeometry.scaleRadius
})
