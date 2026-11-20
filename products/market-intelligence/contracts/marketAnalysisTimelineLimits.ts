/**
 * 时间轴一次传输的**条目上限**（一处定义，服务侧与渲染侧共用）。
 *
 * 为什么需要这个文件：三处各写过自己的一半，拼起来就成了一个必然踩中的坑——
 * - 仓库一页取 50 条发布行；
 * - 服务在**首页**又补进最多 20 条「正在解析 / 失败」的运行（`analysisTimelineService`）；
 * - 渲染侧校验却只认 50 条 → `sanitizePage` 见到 70 条就**整页拒绝**，
 *   页面读到的是 `read-failed`，读者看到「读取失败」，而库里明明有数据。
 *
 * 2026-11-17 实盘复现：真库 389 行、一页 50 条 + 20 条失败运行 = 70 条，整页被拒。
 *
 * 所以上限必须是**同一组数**：页面本身 + 首页注入量。任何一个改了，`maximumItems` 跟着改，
 * `marketAnalysisTimelineLimits.test.ts` 会红——它断言三者自洽，且渲染侧校验接受正好这么多条。
 */
export const marketAnalysisTimelineLimits = Object.freeze({
  /** 一次读一页发布行。仓库的默认页大小就是它。 */
  pageItems: 50,
  /** 首页额外补进来的、还没发布的运行（排队/运行中/跑挂了）。只补第一页。 */
  unpublishedItems: 20,
  /** 传输上限 = 页面 + 首页注入。渲染侧校验只认这个数，不是页面大小。 */
  maximumItems: 70
} as const)

/** 超过它就不再是「一页时间轴」，而是别的东西（校验器拒收）。 */
export function timelineItemsWithinLimit(count: number): boolean {
  return Number.isSafeInteger(count) && count >= 0 && count <= marketAnalysisTimelineLimits.maximumItems
}