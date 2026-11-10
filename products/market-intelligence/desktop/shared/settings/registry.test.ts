import { describe, expect, it } from 'vitest'

import { intelligenceNotificationText } from '../../settings/intelligence-notification/text'
import { productText } from '../i18n/productText'
import { IpcChannels } from '@platform/desktop/ipc/channels'
import type { SettingDescriptor, SettingMenuId, SettingWrite } from './registry'
import { PLATFORM_COMMANDS, SETTING_MENUS, SETTING_OPTION_SETS, settingRegistry, validateSettingRegistry } from './registry'

type Registry = Readonly<Record<SettingMenuId, readonly SettingDescriptor[]>>

const PUSH_THRESHOLD = settingRegistry.notifications.find(
  (row) => row.key === 'setting:notifications.push-threshold'
) as SettingDescriptor
const CHANNEL_SWITCH = settingRegistry.notifications.find(
  (row) => row.key === 'setting:notifications.channel-event.signal-triggered'
) as SettingDescriptor
const LEAD = settingRegistry.notifications.find(
  (row) => row.key === 'setting:notifications.calendar.lead'
) as SettingDescriptor
const COUNTRY_CODES = settingRegistry.notifications.find(
  (row) => row.key === 'setting:notifications.calendar.landed-countries.codes'
) as SettingDescriptor

function withRow(replacement: SettingDescriptor): Registry {
  return {
    ...settingRegistry,
    notifications: [
      ...settingRegistry.notifications.filter((row) => row.key !== replacement.key),
      replacement
    ]
  }
}

describe('settings registry self-checks', () => {
  it('ships a self-consistent registry and declares every menu in the type', () => {
    expect(Object.keys(settingRegistry).sort()).toEqual([...SETTING_MENUS].sort())
    expect(validateSettingRegistry(settingRegistry)).toEqual([])
    for (const rows of Object.values(settingRegistry)) {
      for (const row of rows) expect(row.surfaces).toEqual(['settings'])
    }
  })

  it('static keys are unique, and a keyed template is declared exactly once', () => {
    // 静态行重复 → 红。
    expect(validateSettingRegistry({
      ...settingRegistry,
      notifications: [...settingRegistry.notifications, { ...PUSH_THRESHOLD }]
    })).toContain('duplicate-key')

    // 按来源实例化的行：同一模板声明两次 → 红；实例数由视图决定，注册表里只许一条模板。
    const template: SettingDescriptor = { ...PUSH_THRESHOLD, key: 'setting:sources.enabled@<sourceId>', keyedBy: 'sourceId' }
    expect(validateSettingRegistry({ ...settingRegistry, sources: [template, { ...template }] })).toContain('duplicate-key')
    // 一条模板 + 一条静态同名 key 不算撞：两种身份不同。
    expect(validateSettingRegistry({ ...settingRegistry, sources: [template] })).not.toContain('duplicate-key')
  })

  it('an empty or non-settings surface is rejected', () => {
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, surfaces: [] }))).toContain('empty-surfaces')
    // A3 变异之一：把 surfaces 改成本版不许的值。
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, surfaces: ['drawer'] }))).toContain('surface-not-settings')
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, surfaces: ['drawer'] }))).not.toContain('unsupported-surface')
  })

  it('a platform row may use command writes, but never a value write or a default', () => {
    expect(validateSettingRegistry(withRow({ ...CHANNEL_SWITCH, defaultValueFrom: 'calendarReminder.enabled' })))
      .toContain('platform-has-default')
    expect(validateSettingRegistry(withRow({
      ...CHANNEL_SWITCH,
      write: { kind: 'value', command: 'platform:notifications-set-channel-event', toPayload: () => ({}) }
    }))).toContain('platform-has-value-write')
    // 命令写是允许的（通道事件开关今天就要能拨）。
    expect(validateSettingRegistry(settingRegistry)).not.toContain('platform-has-value-write')
  })

  it('an unimplemented row may not carry a write path or a default', () => {
    const issues = validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, availability: 'unimplemented' }))
    expect(issues).toContain('unimplemented-has-write')
    expect(issues).toContain('unimplemented-has-default')
  })

  it('writable product rows need a write, read-only rows forbid one', () => {
    // A3 变异之二：抽掉可写行的写命令。
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, write: undefined })))
      .toContain('writable-requires-write')
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, field: { kind: 'readonly' } })))
      .toContain('readonly-forbids-write')
  })

  it('a default value must come from the server constants, never a literal', () => {
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, defaultValueFrom: 'not-a-server-default' as never })))
      .toContain('unknown-default')

    // 编译期：类型只接受 SERVER_DEFAULTS 的键，写字面量本身编不过。
    // @ts-expect-error defaultValueFrom only accepts keys of SERVER_DEFAULTS
    const literalDefault: SettingDescriptor = { ...PUSH_THRESHOLD, defaultValueFrom: 'medium' }
    expect(literalDefault.defaultValueFrom).toBe('medium')
  })

  it('every command write names a command that the platform actually exports', () => {
    for (const rows of Object.values(settingRegistry)) {
      for (const row of rows) {
        if (row.write?.kind === 'command') {
          expect(PLATFORM_COMMANDS).toContain(row.write.id)
        }
      }
    }
    // 反向：写一个平台清单里没有的命令 → 红。
    const bogus: SettingWrite = { kind: 'command', id: 'platform:notifications-set-channel-event-x' as never }
    expect(validateSettingRegistry(withRow({ ...CHANNEL_SWITCH, write: bogus })))
      .toContain('unknown-platform-command')
    // 清单本身必须来自唯一的平台导出，不许另抄一份。
    expect(PLATFORM_COMMANDS).toEqual(Object.values(IpcChannels))
  })

  it('conditional rows declare visibleWhen instead of always showing', () => {
    // 提前量 / 重要性：只在「开始前」开着时出现；条件只吃视图，一个参数。
    expect(LEAD.visibleWhen?.({ enabled: false })).toBe(false)
    expect(LEAD.visibleWhen?.({ enabled: true })).toBe(true)
    // 国家码：只在「自选国家」时出现。
    expect(COUNTRY_CODES.visibleWhen?.({ landedCountries: { scope: 'us' } })).toBe(false)
    expect(COUNTRY_CODES.visibleWhen?.({ landedCountries: { scope: 'custom', codes: ['US'] } })).toBe(true)
  })

  it('menu 1 declares keyed templates instead of a source list', () => {
    // 模板数量固定；实例数量由视图里的源列表决定，注册表里不许出现源清单。
    expect(settingRegistry.sources.map((row) => row.key).sort()).toEqual([
      'setting:sources.collection-preset@<sourceId>',
      'setting:sources.enabled@<sourceId>',
      'setting:sources.include-in-sentiment@<sourceId>'
    ])
    expect(settingRegistry.sources.every((row) => row.keyedBy === 'sourceId')).toBe(true)
    const row = settingRegistry.sources.find((entry) => entry.key === 'setting:sources.collection-preset@<sourceId>') as SettingDescriptor

    const view = {
      sourceId: 'coindesk-rss',
      profile: { sourceId: 'coindesk-rss', collectionPreset: 'balanced' }
    }
    expect(row.read.command).toBe('intelligenceSources.getPageState')
    expect(row.read.select(view)).toBe('balanced')
    expect(row.visibleWhen?.(view)).toBe(true)
    expect(row.visibleWhen?.({})).toBe(false)
    if (row.write?.kind !== 'value') throw new Error('the preset row must be a value write')
    // 写的是「选中来源的 profile」：sourceId 从视图拿，渲染层不另传第二个参数。
    expect(row.write.toPayload('frequent', view)).toEqual({
      sourceId: 'coindesk-rss',
      collectionPreset: 'frequent'
    })
  })

  it('declares the two rows product keeps: push outlet and the calendar switch, not channel events', () => {
    const byKey = new Map(settingRegistry.notifications.map((row) => [row.key, row]))
    // 舆情提醒：挂 sentimentAlert 的 itemKey，但写的是产品推送水位，不是那条事件的批准位。
    const outlet = byKey.get('setting:notifications.push-outlet') as SettingDescriptor
    expect(outlet.level).toBe('product')
    expect(outlet.read.command).toBe('intelligence.getNewsPushOutletState')
    if (outlet.write?.kind !== 'value') throw new Error('the push outlet row must be a value write')
    expect(outlet.write.command).toBe('intelligence.setNewsPushOutletEnabled')
    expect(outlet.write.toPayload(true, {})).toEqual({ enabled: true })
    expect(outlet.defaultValueFrom).toBeUndefined()

    // 日历事件：产品提醒设置；开关在详情「开始前」里，列表行只有状态徽标。
    const calendar = byKey.get('setting:notifications.calendar.enabled') as SettingDescriptor
    expect(calendar.level).toBe('product')
    expect(calendar.field).toEqual({ kind: 'switch' })
    if (calendar.write?.kind !== 'value') throw new Error('the calendar row must be a value write')
    expect(calendar.write.toPayload(false, {})).toEqual({ enabled: false })

    // 只有两条真正的 channel-event（信号、日报）；那两行不再假装平台事件。
    const channelEventRows = settingRegistry.notifications.filter(
      (row) => row.write?.kind === 'command' && row.write.id === 'platform:notifications-set-channel-event'
    )
    expect(channelEventRows.map((row) => row.key).sort()).toEqual([
      'setting:notifications.channel-event.briefing-ready',
      'setting:notifications.channel-event.signal-triggered'
    ])
    expect(byKey.has('setting:notifications.channel-event.calendar')).toBe(false)
    expect(byKey.has('setting:notifications.channel-event.sentiment-alert')).toBe(false)
  })

  it('labelText only on keyed rows, and the label comes from the view data', () => {
    // 静态行加 labelText → 红（行名会绕开文案表）。
    const staticWithLabel = { ...PUSH_THRESHOLD, labelText: () => 'CoinDesk' }
    expect(validateSettingRegistry(withRow(staticWithLabel))).toContain('label-text-on-static-row')

    const enabled = settingRegistry.sources.find((row) => row.key === 'setting:sources.enabled@<sourceId>') as SettingDescriptor
    // 同一模板的两个实例得到不同标签：证明取的是视图数据，不是写死的句子。
    expect(enabled.labelText?.({ displayName: 'CoinDesk RSS' })).toBe('CoinDesk RSS')
    expect(enabled.labelText?.({ displayName: 'Binance Announcements' })).toBe('Binance Announcements')
    expect(enabled.labelText?.({})).toBe('')
  })

  it('a template must match its instance dimension', () => {
    const wrongTemplate = { ...PUSH_THRESHOLD, key: 'setting:sources.foo@<feedId>', keyedBy: 'sourceId' as const }
    expect(validateSettingRegistry(withRow(wrongTemplate))).toContain('template-key-mismatch')
    const feedTemplate = { ...PUSH_THRESHOLD, key: 'setting:calendar-feeds.enabled@<feedId>', keyedBy: 'feedId' as const }
    expect(validateSettingRegistry(withRow(feedTemplate))).not.toContain('template-key-mismatch')
  })

  it('reads the capability fact from the view, and hides the row when the fact is missing', () => {
    // 能力事实只从视图来（契约 §1 ⑧/G10）：页面算视图时把 `supportsSentiment` 一并给出。
    // 视图里没有这条事实 ⇒ **整行不渲染**，不许默认 true，也不许由渲染层另传一份上下文。
    const row = settingRegistry.sources.find((entry) => entry.key === 'setting:sources.include-in-sentiment@<sourceId>') as SettingDescriptor
    const view = (supportsSentiment?: boolean) => ({
      sourceId: 'coindesk-rss',
      profile: { includeInSentiment: true },
      ...(supportsSentiment === undefined ? {} : { supportsSentiment })
    })
    expect(row.visibleWhen?.(view(true))).toBe(true)
    expect(row.visibleWhen?.(view(false))).toBe(false)
    expect(row.visibleWhen?.(view())).toBe(false)
  })

  it('gives visibleWhen one argument, so nobody can smuggle a second judgement basis', () => {
    // 契约 §1 ⑧ / G10：条件只看 `view`。第二参会变成一个「每行自带判断依据」的口子，
    // 同一份事实就散成多份——这条钉住**形参个数**，把口子关在类型上，也关在用例上。
    const conditional = Object.values(settingRegistry).flat().filter((row) => row.visibleWhen !== undefined)
    expect(conditional.length).toBeGreaterThan(0)
    for (const row of conditional) expect(row.visibleWhen?.length).toBe(1)
  })

  it('names the control primitive where a select is not an antd Select, so the DOM does not change', () => {
    // 设置页现状：推送强度 / 日历提前量 / 落地筛选用平台 `Segmented`，国家范围用 antd `Select`。
    // 同一个 `select` 值形状要能说出「用哪个原语」，否则按注册表渲染就会换掉控件外形（A1 要求逐字不变）。
    const byKey = new Map(Object.values(settingRegistry).flat().map((row) => [row.key, row]))
    const segmented = [
      'setting:notifications.push-threshold',
      'setting:notifications.calendar.lead',
      'setting:notifications.calendar.landed-filter'
    ]
    for (const key of segmented) {
      const row = byKey.get(key)
      expect(row?.field.kind).toBe('select')
      expect(row?.field.kind === 'select' ? row.field.presentation : undefined).toBe('segmented')
    }
    // 国家范围今天就是 antd Select：不声明，走默认。
    const scope = byKey.get('setting:notifications.calendar.landed-countries.scope')
    expect(scope?.field.kind === 'select' ? scope.field.presentation : undefined).toBeUndefined()
  })

  it('rejects a presentation on a control that has no choice of primitive', () => {
    expect(validateSettingRegistry(withRow({ ...PUSH_THRESHOLD, field: { kind: 'switch', presentation: 'segmented' } as never })))
      .toContain('presentation-on-non-select')
  })

  it('lets a row take its options from the view when the page decides them', () => {
    // 形状：`optionsFrom` 可以是 `{ kind: 'view', field }`，注册表只声明去哪儿取、不另留一份列表。
    // 触达面今天仍是静态集合（行与组件要同笔翻），但形状与校验已经就位。
    const fromView = { ...PUSH_THRESHOLD, field: { kind: 'multiSelect', optionsFrom: { kind: 'view', field: 'available' } } as never }
    expect(validateSettingRegistry(withRow(fromView))).toEqual([])
    const noField = { ...PUSH_THRESHOLD, field: { kind: 'multiSelect', optionsFrom: { kind: 'view', field: '  ' } } as never }
    expect(validateSettingRegistry(withRow(noField))).toContain('view-options-without-field')
  })

  it('supports several help lines with their own screen-reader name, without dropping the single form', () => {
    // 形状：一行可以有多条说明（国家范围今天就是两条共用一颗 ⓘ），并可以给那颗 ⓘ 单独的读屏名；
    // 单条 `helpKey` 保留。**行翻不翻由存储缓存那半笔决定**——它的 ⓘ 还没读 `helpKeys`。
    const multi = { ...PUSH_THRESHOLD, copy: { labelKey: 'a', helpKeys: ['b', 'c'], helpAriaKey: 'd' } }
    expect(validateSettingRegistry(withRow(multi))).toEqual([])
    const both = { ...PUSH_THRESHOLD, copy: { labelKey: 'a', helpKey: 'b', helpKeys: ['c'] } }
    expect(validateSettingRegistry(withRow(both))).toContain('help-both-forms')
    const empty = { ...PUSH_THRESHOLD, copy: { labelKey: 'a', helpKeys: [] } }
    expect(validateSettingRegistry(withRow(empty))).toContain('empty-help-keys')
    const ariaOnly = { ...PUSH_THRESHOLD, copy: { labelKey: 'a', helpAriaKey: 'd' } }
    expect(validateSettingRegistry(withRow(ariaOnly))).toContain('help-aria-without-help')
    // 单条形态照旧可用。
    const single = { ...PUSH_THRESHOLD, copy: { labelKey: 'a', helpKey: 'b' } }
    expect(validateSettingRegistry(withRow(single))).toEqual([])
  })

  it('gives each row the help lines its page shows, in one ⓘ with its own screen-reader name', () => {
    // 页面现状：国家范围一颗 ⓘ 里两条说明（范围 + 「全部国家」的含义），读屏名是 `rowInfoAria`；
    // 触达面那张卡的 ⓘ 读屏名是 `calendar.aboutAria`。声明层照抄这两处，迁移后 DOM 不变。
    const flat = Object.values(settingRegistry).flat()
    const scope = flat.find((row) => row.key === 'setting:notifications.calendar.landed-countries.scope')
    expect(scope?.copy?.helpKeys).toEqual([
      'pages.intelligence.notification.countries.scopeNote',
      'pages.intelligence.notification.countries.allNote'
    ])
    expect(scope?.copy?.helpAriaKey).toBe('pages.intelligence.notification.countries.rowInfoAria')
    expect(scope?.copy?.helpKey).toBeUndefined()

    const surfaces = flat.find((row) => row.key === 'setting:notifications.surfaces')
    expect(surfaces?.copy?.helpKeys).toEqual(['pages.intelligence.notification.calendar.surfacesNote'])
    expect(surfaces?.copy?.helpAriaKey).toBe('pages.intelligence.notification.calendar.aboutAria')
  })

  it('keeps the second help line on the push-threshold row, so its ⓘ does not lose the cost sentence', () => {
    // 页面现状：这一行的 ⓘ 是两条说明（怎么算 + 一天可能几十条），读屏名是专用键 `threshold.aria`。
    // 只迁成一条会让读者看不到「代价」那句——DOM 变了，DOM 变了就是行为变了。
    const threshold = Object.values(settingRegistry).flat().find((row) => row.key === 'setting:notifications.push-threshold')
    expect(threshold?.copy?.helpKeys).toEqual([
      'pages.intelligence.notification.threshold.info',
      'pages.intelligence.notification.threshold.cost'
    ])
    expect(threshold?.copy?.helpAriaKey).toBe('pages.intelligence.notification.threshold.aria')
    expect(threshold?.copy?.helpKey).toBeUndefined()
  })

  it('keeps both help lines on the country-codes row, so its ⓘ still says what is not chosen', () => {
    // 页面现状：自选国家那一项的 ⓘ 是两条（只对给出国家的条目生效 + 只有选中的国家会推），
    // 读屏名是专用键 `countries.customInfoAria`。只迁一条就少一句指路。
    const codes = Object.values(settingRegistry).flat().find((row) => row.key === 'setting:notifications.calendar.landed-countries.codes')
    expect(codes?.copy?.helpKeys).toEqual([
      'pages.intelligence.notification.countries.customCost',
      'pages.intelligence.notification.countries.emptyHint'
    ])
    expect(codes?.copy?.helpAriaKey).toBe('pages.intelligence.notification.countries.customInfoAria')
  })

  it('keeps the push-threshold options in the order the page shows them', () => {
    // 页面那颗 `Segmented` 是「高 / 中 / 低」（`03-fields` 同序）。选项顺序不同，DOM 就变了——
    // 迁移后读者看到的三段会左右颠倒，那是可感知的行为变化，不是重构。
    expect(SETTING_OPTION_SETS['news-push-thresholds'].map((option) => option.value)).toEqual(['high', 'medium', 'low'])
  })

  it('declares 触达面 as one multiSelect row and sends only the changed surface', () => {
    const surfaces = settingRegistry.notifications.find(
      (row) => row.key === 'setting:notifications.surfaces'
    ) as SettingDescriptor
    // 选项来自视图：平台返回的 `available` 才是今天的真值（静态四项会把中心画成可勾、还多两项）。
    expect(surfaces.field).toEqual({ kind: 'multiSelect', optionsFrom: { kind: 'view', field: 'available' } })
    expect(surfaces.level).toBe('platform')
    if (surfaces.write?.kind !== 'command') throw new Error('the surfaces row must be a command write')

    const before = { selection: { channel: true, toast: false } }
    // 一次点击只变一个面：只发那一个面的增量，不整份覆盖。
    expect(surfaces.write.toArgs?.({ channel: true, toast: true }, before)).toEqual({
      eventTypeId: 'calendar-events',
      surfaces: { toast: true }
    })
    // 中心恒收：即使有人把 center 变了，也不算增量。
    expect(surfaces.write.toArgs?.({ center: false, channel: true, toast: false }, { selection: { center: true, channel: true, toast: false } })).toEqual({
      eventTypeId: 'calendar-events',
      surfaces: {}
    })
    // 选项不再登记在注册表里：平台返回的 `available` 才是今天的真值（静态四项已删，避免第二份列表）。
  })

  it('every optionsFrom names a set that actually exists, and no set is orphaned', () => {
    const used = new Set<string>()
    for (const rows of Object.values(settingRegistry)) {
      for (const row of rows) {
        if ('optionsFrom' in row.field) {
          const ref = row.field.optionsFrom
          // 视图来源：注册表只声明去哪儿取，不登记静态集合（否则就是第二份列表）。
          if (typeof ref !== 'string') continue
          used.add(ref)
          expect(SETTING_OPTION_SETS[ref].length).toBeGreaterThan(0)
        }
      }
    }
    // 集合只给声明用：多出来的集合是没人读的第二份数据。
    expect(Object.keys(SETTING_OPTION_SETS).sort()).toEqual([...used].sort())
  })

  it('only existing copy keys: every labelKey / helpKey resolves in both locales', () => {
    const descriptors = Object.values(settingRegistry).flat()
    expect(descriptors.length).toBeGreaterThan(0)
    for (const descriptor of descriptors) {
      for (const locale of ['zh-CN', 'en-US'] as const) {
        // 静态行必须能解析行名；按实例化的行行名来自视图，没有 labelKey 是正常的。
        if (descriptor.copy?.labelKey) {
          expect(resolveCopyKey(locale, descriptor.copy.labelKey)).not.toBe('')
        }
        if (descriptor.copy?.helpKey) {
          expect(resolveCopyKey(locale, descriptor.copy.helpKey)).not.toBe('')
        }
      }
      // 每一行都要有行名来源：labelKey 或 labelText，至少一个。
      expect(descriptor.labelText !== undefined || Boolean(descriptor.copy?.labelKey)).toBe(true)
    }
  })
})

/** 两屏的文案表不同：通知页在 `intelligenceNotificationText`，来源页在 `productText.settings.*`。 */
function resolveCopyKey(locale: 'zh-CN' | 'en-US', key: string): string {
  if (!key.startsWith('settings.')) return intelligenceNotificationText[locale][key] ?? ''
  let node: unknown = productText[locale]
  for (const part of key.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined
  }
  return typeof node === 'string' ? node : ''
}
