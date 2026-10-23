/**
 * The lifecycle of a 0xRouter calendar event, as this product reads it.
 *
 * The provider route does not publish a lifecycle state: it publishes values. An event is therefore
 * released exactly once a value exists for it, and upcoming until then. It never reports `cancelled` —
 * the route cannot distinguish a withdrawn event from a missing one, and inventing a state it cannot
 * know would be worse than not showing one.
 *
 * The rule lives here, on the product's shared shelf, because two surfaces now read the same route
 * and must agree: the dashboard's calendar card, and the cross-asset chart's event lines. A second
 * copy of "has it been published?" is how one surface starts calling a release upcoming while the
 * other draws it solid.
 */
export const marketCalendarEventLifecyclePolicy = Object.freeze({
  version: 'marketIntelligenceMarketCalendarEventLifecycle.v1',
  releasedWhenValuePublished: true
})

export function providerLifecycleState(event: Readonly<{ providerActual?: unknown }>): 'scheduled' | 'released' {
  return marketCalendarEventLifecyclePolicy.releasedWhenValuePublished && event.providerActual ? 'released' : 'scheduled'
}

/**
 * 已到计划时刻、但还没有值。
 *
 * provider 路线的发布节奏与我们的采集节奏不是一件事：时间到了、值没到，既不是「未到时间」也不是
 * 「已公布」。这一格把它说出来，并且**落在该事件自己那一行**上——读者要知道的是「哪一个在等」，
 * 不是一句全局的「有东西在等」。
 */
export function providerAwaitingData(
  event: Readonly<{ scheduledAt?: string | null; actual?: unknown }>,
  nowIso: string
): boolean {
  return !!event.scheduledAt && event.scheduledAt <= nowIso && !event.actual
}
