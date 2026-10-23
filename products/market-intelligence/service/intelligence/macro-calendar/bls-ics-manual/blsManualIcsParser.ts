import ical, { type VEvent } from 'node-ical'

import { getMacroCalendarOfficialSourceDescriptor } from '../macroCalendarOfficialSourceRegistry'
import type { MacroCalendarScheduleDraft } from '../parsers/verifiedScheduleParserContracts'
import { manualBlsIcsParserPolicy, type ManualBlsIcsParserResult } from './blsManualIcsContracts'

type RawProperty = { name: string; parameters: ReadonlyMap<string, string>; value: string }
type RawEvent = { properties: RawProperty[] }
type RawTimeZone = { properties: RawProperty[]; transitions: Array<{ kind: 'DAYLIGHT' | 'STANDARD'; properties: RawProperty[] }> }

export function parseManualBlsIcs(body: unknown): ManualBlsIcsParserResult {
  if (!isAcceptedBody(body)) return failed('invalid-file')
  const raw = readCalendar(body)
  if (!raw) return failed('invalid-file')
  if (!hasExpectedCalendarIdentity(raw)) return failed('unsupported-calendar')
  if (raw.events.length > manualBlsIcsParserPolicy.maximumCalendarEvents) return failed('invalid-file')
  const descriptor = getMacroCalendarOfficialSourceDescriptor(manualBlsIcsParserPolicy.descriptorId)
  if (!descriptor) return failed('invalid-file')

  const rawEvents = validateRawEvents(raw.events)
  if (!rawEvents) return failed('invalid-file')
  const parsed = parseEvents(withParserTimeZoneAlias(body))
  if (!parsed) return failed('invalid-file')
  const drafts = rawEvents.flatMap((event) => toDrafts(event, parsed, descriptor))
  if (drafts.some((draft) => draft === undefined)) return failed('invalid-file')
  if (drafts.length === 0) return failed('no-supported-events')

  const supportedReleaseGroups = rawEvents.filter((event) => event.mapping !== undefined).length
  return {
    state: 'parsed', totalEvents: raw.events.length, supportedReleaseGroups, generatedEvents: drafts.length,
    unsupportedEvents: raw.events.length - supportedReleaseGroups, drafts: drafts as MacroCalendarScheduleDraft[]
  }
}

function isAcceptedBody(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0') && !value.includes('\uFFFD') &&
    Buffer.byteLength(value, 'utf8') <= manualBlsIcsParserPolicy.maximumBodyBytes
}

function readCalendar(body: string): { headers: RawProperty[]; timeZones: RawTimeZone[]; events: RawEvent[] } | undefined {
  const lines = body.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const stack: string[] = []
  const headers: RawProperty[] = []
  const timeZones: RawTimeZone[] = []
  const events: RawEvent[] = []
  let event: RawEvent | undefined
  let timeZone: RawTimeZone | undefined
  let transition: { kind: 'DAYLIGHT' | 'STANDARD'; properties: RawProperty[] } | undefined

  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('BEGIN:')) {
      const component = line.slice('BEGIN:'.length)
      if (!component) return undefined
      stack.push(component)
      if (component === 'VEVENT') {
        if (stack.length !== 2 || event) return undefined
        event = { properties: [] }
      }
      if (component === 'VTIMEZONE') {
        if (stack.length !== 2 || timeZone) return undefined
        timeZone = { properties: [], transitions: [] }
      }
      if (component === 'DAYLIGHT' || component === 'STANDARD') {
        if (stack.length !== 3 || !timeZone || transition) return undefined
        transition = { kind: component, properties: [] }
      }
      continue
    }
    if (line.startsWith('END:')) {
      const component = line.slice('END:'.length)
      if (stack.pop() !== component) return undefined
      if (component === 'VEVENT') {
        if (!event) return undefined
        events.push(event)
        event = undefined
      }
      if (component === 'DAYLIGHT' || component === 'STANDARD') {
        if (!timeZone || !transition || transition.kind !== component) return undefined
        timeZone.transitions.push(transition)
        transition = undefined
      }
      if (component === 'VTIMEZONE') {
        if (!timeZone) return undefined
        timeZones.push(timeZone)
        timeZone = undefined
      }
      continue
    }
    if (stack.length === 0) return undefined
    const property = readProperty(line)
    if (!property) return undefined
    if (stack.length === 1 && stack[0] === 'VCALENDAR') headers.push(property)
    if (stack.length === 2 && stack[0] === 'VCALENDAR' && stack[1] === 'VTIMEZONE') timeZone?.properties.push(property)
    if (stack.length === 3 && stack[0] === 'VCALENDAR' && stack[1] === 'VTIMEZONE' && (stack[2] === 'DAYLIGHT' || stack[2] === 'STANDARD')) transition?.properties.push(property)
    if (stack.length === 2 && stack[0] === 'VCALENDAR' && stack[1] === 'VEVENT') event?.properties.push(property)
  }
  return stack.length === 0 && !event && !timeZone && !transition && headers.length > 0 ? { headers, timeZones, events } : undefined
}

function readProperty(line: string): RawProperty | undefined {
  const separator = line.indexOf(':')
  if (separator <= 0) return undefined
  const [name, ...parameterParts] = line.slice(0, separator).split(';')
  if (!name || !/^[A-Z-]+$/.test(name)) return undefined
  const parameters = new Map<string, string>()
  for (const part of parameterParts) {
    const equals = part.indexOf('=')
    if (equals <= 0 || parameters.has(part.slice(0, equals))) return undefined
    parameters.set(part.slice(0, equals), part.slice(equals + 1))
  }
  return { name, parameters, value: line.slice(separator + 1) }
}

function hasExpectedCalendarIdentity(calendar: { headers: RawProperty[]; timeZones: RawTimeZone[] }): boolean {
  return one(calendar.headers, 'VERSION') === manualBlsIcsParserPolicy.calendarHeaders.version &&
    one(calendar.headers, 'PRODID') === manualBlsIcsParserPolicy.calendarHeaders.productId &&
    one(calendar.headers, 'X-WR-CALNAME') === manualBlsIcsParserPolicy.calendarHeaders.calendarName &&
    one(calendar.headers, 'X-WR-TIMEZONE') === manualBlsIcsParserPolicy.legacyTimeZone &&
    calendar.timeZones.length === 1 && isExpectedTimeZone(calendar.timeZones[0]!)
}

function isExpectedTimeZone(timeZone: RawTimeZone): boolean {
  return one(timeZone.properties, 'TZID') === manualBlsIcsParserPolicy.legacyTimeZone &&
    matchesTransition(timeZone.transitions, 'DAYLIGHT', manualBlsIcsParserPolicy.timeZoneTransitions.daylight) &&
    matchesTransition(timeZone.transitions, 'STANDARD', manualBlsIcsParserPolicy.timeZoneTransitions.standard)
}

function matchesTransition(
  transitions: readonly { kind: 'DAYLIGHT' | 'STANDARD'; properties: RawProperty[] }[],
  kind: 'DAYLIGHT' | 'STANDARD',
  expected: { offsetFrom: string; offsetTo: string; startsAt: string; recurrence: string; name: string }
): boolean {
  const matched = transitions.filter((transition) => transition.kind === kind)
  return matched.length === 1 && one(matched[0]!.properties, 'TZOFFSETFROM') === expected.offsetFrom &&
    one(matched[0]!.properties, 'TZOFFSETTO') === expected.offsetTo && one(matched[0]!.properties, 'DTSTART') === expected.startsAt &&
    one(matched[0]!.properties, 'RRULE') === expected.recurrence && one(matched[0]!.properties, 'TZNAME') === expected.name
}

function validateRawEvents(events: readonly RawEvent[]): Array<RawEvent & { uid?: string; mapping?: readonly Mapping[]; startsAt?: RawProperty }> | undefined {
  const uids = new Set<string>()
  const normalized = [] as Array<RawEvent & { uid?: string; mapping?: readonly Mapping[]; startsAt?: RawProperty }>
  for (const event of events) {
    const uid = one(event.properties, 'UID')?.trim()
    const mapping = manualBlsIcsParserPolicy.titleMappings[one(event.properties, 'SUMMARY') as keyof typeof manualBlsIcsParserPolicy.titleMappings]
    if (uid) {
      const normalizedUid = uid.toLowerCase()
      if (uids.has(normalizedUid)) return undefined
      uids.add(normalizedUid)
    }
    if (!mapping) {
      normalized.push(event)
      continue
    }
    const startsAt = single(event.properties, 'DTSTART')
    if (!uid || !manualBlsIcsParserPolicy.uuidPattern.test(uid) || !startsAt || startsAt.parameters.get('TZID') !== manualBlsIcsParserPolicy.legacyTimeZone ||
      startsAt.parameters.get('VALUE') === 'DATE' || !manualBlsIcsParserPolicy.localDateTimePattern.test(startsAt.value)) return undefined
    normalized.push({ ...event, uid: uid.toLowerCase(), mapping, startsAt })
  }
  return normalized
}

function parseEvents(body: string): Map<string, VEvent> | undefined {
  try {
    const parsed = ical.sync.parseICS(body)
    const events = new Map<string, VEvent>()
    for (const value of Object.values(parsed)) {
      if (!value || value.type !== 'VEVENT') continue
      const uid = (value as { uid?: unknown }).uid
      if (typeof uid === 'string') events.set(uid.toLowerCase(), value as VEvent)
    }
    return events
  } catch {
    return undefined
  }
}

function toDrafts(
  event: RawEvent & { uid?: string; mapping?: readonly Mapping[]; startsAt?: RawProperty },
  parsed: ReadonlyMap<string, VEvent>,
  descriptor: NonNullable<ReturnType<typeof getMacroCalendarOfficialSourceDescriptor>>
): Array<MacroCalendarScheduleDraft | undefined> {
  if (!event.mapping || !event.uid || !event.startsAt) return []
  const parsedEvent = parsed.get(event.uid)
  const localDateTime = localDateTimeParts(event.startsAt.value)
  if (!parsedEvent || !localDateTime || parsedEvent.start.tz !== manualBlsIcsParserPolicy.parserTimeZone || !isExactEasternInstant(parsedEvent.start, localDateTime)) return [undefined]
  const scheduledAt = parsedEvent.start.toISOString()
  if (!isCanonicalUtcMillis(scheduledAt)) return [undefined]
  return event.mapping.map((mapping) => ({
    eventKey: `${mapping.eventKeyPrefix}.${event.uid}`,
    releaseGroupKey: `US.BLS.RELEASE.${event.uid}`,
    eventFamily: mapping.eventFamily,
    eventNameKey: mapping.eventNameKey,
    periodKey: `release-${localDateTime.date}`,
    lifecycleState: 'scheduled',
    revisionKind: 'schedule',
    scheduledDate: localDateTime.date,
    scheduledAt,
    providerId: descriptor.providerId,
    descriptorId: descriptor.descriptorId,
    sourceUrl: descriptor.sourceUrl,
    parserVersion: descriptor.parserId,
    caveats: [...manualBlsIcsParserPolicy.caveats]
  }))
}

type Mapping = (typeof manualBlsIcsParserPolicy.titleMappings)[keyof typeof manualBlsIcsParserPolicy.titleMappings][number]

function one(properties: readonly RawProperty[], name: string): string | undefined {
  const property = single(properties, name)
  return property?.value
}

function single(properties: readonly RawProperty[], name: string): RawProperty | undefined {
  const matches = properties.filter((property) => property.name === name)
  return matches.length === 1 ? matches[0] : undefined
}

function withParserTimeZoneAlias(body: string): string {
  return body.replaceAll(`TZID:${manualBlsIcsParserPolicy.legacyTimeZone}`, `TZID:${manualBlsIcsParserPolicy.parserTimeZone}`)
    .replaceAll(`TZID=${manualBlsIcsParserPolicy.legacyTimeZone}:`, `TZID=${manualBlsIcsParserPolicy.parserTimeZone}:`)
}

function localDateTimeParts(value: string): { date: string; time: string } | undefined {
  const match = manualBlsIcsParserPolicy.localDateTimePattern.exec(value)
  if (!match) return undefined
  const [, year, month, day, hour, minute] = match
  const date = `${year}-${month}-${day}`
  const check = new Date(`${date}T00:00:00.000Z`)
  return check.toISOString().slice(0, 10) === date && Number(hour) < 24 && Number(minute) < 60
    ? { date, time: `${hour}:${minute}` }
    : undefined
}

function isExactEasternInstant(value: Date & { tz?: string }, expected: { date: string; time: string }): boolean {
  if (!Number.isFinite(value.getTime())) return false
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: manualBlsIcsParserPolicy.parserTimeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}` === expected.date && `${part('hour')}:${part('minute')}` === expected.time
}

function isCanonicalUtcMillis(value: string): boolean {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function failed(failureCode: Extract<ManualBlsIcsParserResult, { state: 'failed' }>['failureCode']): ManualBlsIcsParserResult {
  return { state: 'failed', failureCode }
}
