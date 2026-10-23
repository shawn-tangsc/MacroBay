/**
 * Which trigger-status reasons read as a moment rather than an ongoing condition.
 *
 * "结论已超过 8 小时" is a condition the gate keeps re-observing, so the panel says "since <time>".
 * "你手动触发" and "进程重启后补跑" are events with a time, where that wording would be wrong.
 *
 * The service owns the list (`triggerStatusPolicy.oneOffReasonCodes`). It is mirrored here rather
 * than imported because that policy chain pulls in test-only imports, which must not enter the
 * renderer bundle; `triggerStatusCopy.test.ts` asserts the two lists are identical.
 */
export const oneOffTriggerReasons: ReadonlySet<string> = new Set([
  'manual-request',
  'severity-confirmed',
  'medium-score-confirmed',
  'market-reaction-confirmed',
  'restart-initial-compensated',
  'restart-review-compensated'
])
