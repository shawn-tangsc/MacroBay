/**
 * 量到的尺寸要不要写回 state —— 图与卡之间那个尺寸反馈环的唯一闸门。
 *
 * 三条规则，每条都对应一次真实的自激：
 * - **量不到（0 或负数）就不动**：首帧还没有布局，clientWidth 是 0；写回去等于把图缩成 0，
 *   下一帧量到 0 又写 0。
 * - **只接受量到的值，不给地板**：量到 340 写回 380，图就比容器宽，横向溢出 → 出现滚动条 →
 *   滚动条占掉高度 → 再量又是新的数。要最小可读宽度由版式保证，不许用溢出换。
 * - **同一个值写回同一个值**：让调用方拿到同一个数字，`setState` 就不会产生新 state。
 */
export function nextMeasuredSize(current: number, measured: number): number {
  if (!Number.isFinite(measured) || measured <= 0) return current
  return measured
}
