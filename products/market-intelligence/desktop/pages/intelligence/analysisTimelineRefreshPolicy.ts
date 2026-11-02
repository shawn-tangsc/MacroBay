/** 时间轴读取的节奏策略：轮询上限、首屏重试、读取超时与节点详情的重试间隔。 */
// The product IPC has no push notification for a completed analysis. This
// bounded polling policy is owned by the workspace data hook and is covered by
// the timeline refresh regression test; it stops on a published node or a
// terminal failure.
export const analysisTimelineRefreshPolicy = Object.freeze({
  pollIntervalMs: 1_000,
  /**
   * Bounded, but longer than the run job's own timeout: the job is 600s because one run may spend
   * two model attempts after a contract rejection. The poll stops a minute later, so the job's own
   * cancellation is observed as a terminal run instead of the panel giving up first. A run that is
   * still queued/running at the cap releases the action rather than leaving a disabled button
   * behind — no polling is left that would ever end the spinner.
   */
  maxPollAttempts: 660,
  /**
   * The bounded poll above stops as soon as a node is published — which is precisely when the
   * reader stops watching a spinner and starts expecting new analyses. With no push notification
   * from the product IPC, the list only grew when someone pressed refresh, so a slow background poll
   * (plus a refresh on focus) keeps it live.
   */
  livePollIntervalMs: 60_000,
  /**
   * The first page retries on its own. A read can fail transiently while the
   * product is still starting up, and requiring the user to press refresh for
   * their own timeline is not acceptable.
   */
  initialRetryAttempts: 10,
  initialRetryDelayMs: 500,
  initialRetryMaxDelayMs: 6_000,
  /**
   * A wall-clock cap on the first load's patience, in addition to the attempt count.
   *
   * The attempts alone are not an endpoint: each read may wait up to `readTimeoutMs`, so ten of
   * them could keep a silent service in the loading state for minutes. The reader gets a bounded
   * wait either way — data, or a failure they can retry.
   */
  initialRetryBudgetMs: 30_000,
  /**
   * A timeline read must settle. Local reads are far faster than this, so hitting
   * it means the service is not answering; turning that into a visible failure is
   * better than a spinner that never ends.
   */
  readTimeoutMs: 15_000,
  /**
   * A node detail is a second read of the store the list just answered from, and it can fail on
   * its own: the run, the summary and the snapshot are three separate reads, and the service may be
   * reloading the store behind them. Nothing re-read a node after a failure, so one transient fault
   * pinned the newest conclusion to "暂不可用" until a different node became the newest. These are the
   * wait intervals between the bounded retries; after the last one the failure is final.
   */
  detailRetryDelaysMs: [1_500, 4_000, 10_000] as readonly number[]
})
