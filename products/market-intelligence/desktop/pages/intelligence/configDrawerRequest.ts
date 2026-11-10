import { DRAWER_MENUS, type ConfigDrawerMenu } from '../../settings/config-drawer/drawerPreviewRows'
import type { BusinessFocus } from '../../settings/intelligence-sources/BusinessSettingsView'

/**
 * 「打开配置抽屉」的**唯一入参形状**：菜单 + 屏内定位。
 *
 * 为什么要有它：入口散在各屏（看板卡片、日历、舆情、门户），每个都想「开抽屉并落到我这一项」。
 * 参数一多就有人各拼一套；这里把**菜单**与**定位**收成一个对象，并给出一个纯函数把非法输入**归一**，
 * 保证「永远打开、永不白屏」——点了没反应或停在空白屏，比停在默认位置更糟。
 */
export type ConfigDrawerFocus =
  | { menu: 'sources'; providerId?: string; sourceId?: string }
  | { menu: 'sourcesData'; business?: 'dashboard' | 'calendar' | 'sentiment'; moduleKey?: string; cellId?: string }
  // 两个值就是 DOM 上那两个锚点（`data-processing-section`）：契约与页面共用一套词，不再翻译一次。
  | { menu: 'processing'; section?: 'translation' | 'sentiment' }
  | { menu: 'briefing'; section?: 'generation' | 'ai' | 'model' | 'webSearch' }
  | { menu: 'notifications'; section?: 'events' | 'channels' | 'quietHours' }
  | { menu: 'analysis' }
  | { menu: 'runLog' }

export type OpenConfigDrawerRequest = Readonly<{ menu: ConfigDrawerMenu; focus?: ConfigDrawerFocus }>

const MENUS: readonly string[] = DRAWER_MENUS

/** 旧写法（菜单名 / 菜单名 + 旧 filter）→ 新对象；其余按「未知」处理。 */
export function normalizeConfigDrawerRequest(
  input: ConfigDrawerMenu | OpenConfigDrawerRequest | string | undefined
): OpenConfigDrawerRequest {
  if (typeof input === 'string') {
    return { menu: (MENUS.includes(input) ? input : 'sources') as ConfigDrawerMenu }
  }
  if (input === undefined || !MENUS.includes(input.menu)) return { menu: 'sources' }
  // `focus` 与菜单不匹配 → 丢弃定位（仍然打开菜单默认位置，不白屏）。
  if (input.focus !== undefined && input.focus.menu !== input.menu) return { menu: input.menu }
  return input
}

/**
 * 请求 → 「哪一屏的哪一块」。三屏（内容处理 / 日报 / 通知）共用这一条：
 * 分区只在自己那屏上成立，菜单对不上就不交出来（否则那一屏会去找一个不存在的锚点）。
 */
export function drawerSectionFromRequest(
  request: OpenConfigDrawerRequest
): Readonly<{ menu: ConfigDrawerMenu; section: string }> | undefined {
  const focus = request.focus
  if (focus === undefined || focus.menu !== request.menu) return undefined
  if (!('section' in focus) || focus.section === undefined) return undefined
  return { menu: request.menu, section: focus.section }
}

/**
 * 卡片/按钮手里的位置 → 「打开采集与数据并落到这里」的请求。
 *
 * 入口不自己拼 `{ menu, focus: { menu, ... } }`：那三层几乎一样，拼错一处就是「点了没落在那一项」
 * （漏 `focus.menu` 会让归一化把它当不匹配丢掉）。没有位置时返回不带 `focus` 的请求，不是空对象。
 */
export function sourcesDataRequestFor(focus?: BusinessFocus): OpenConfigDrawerRequest {
  return focus === undefined
    ? { menu: 'sourcesData' }
    : { menu: 'sourcesData', focus: { menu: 'sourcesData', ...focus } }
}

/**
 * 请求 → 「采集与数据」那屏的定位。
 *
 * 只在菜单对得上时交出来：停在别的屏却带着这一屏的坐标，读起来像是「定位失效」，
 * 而真相是这条请求根本没打算落在那一屏。三个字段都空也算没有定位——别把空对象传下去，
 * 那会让组件以为「有定位但什么都没说」。
 */
export function businessFocusFromRequest(request: OpenConfigDrawerRequest): BusinessFocus | undefined {
  if (request.menu !== 'sourcesData' || request.focus?.menu !== 'sourcesData') return undefined
  const { business, moduleKey, cellId } = request.focus
  if (business === undefined && moduleKey === undefined && cellId === undefined) return undefined
  return {
    ...(business === undefined ? {} : { business }),
    ...(moduleKey === undefined ? {} : { moduleKey }),
    ...(cellId === undefined ? {} : { cellId })
  }
}

/**
 * 壳层「去设置」跳转 → 本产品要开的菜单；**不认识就 `undefined`**（什么都不做）。
 *
 * 只认自己的 productId 与登记表里的菜单：猜一个默认屏会让读者点了 A 停在 B。
 */
export function menuFromSettingsDrawer(
  detail: Readonly<{ productId?: string; menuId?: string }> | undefined
): ConfigDrawerMenu | undefined {
  if (detail?.productId !== 'market-intelligence') return undefined
  const menuId = detail.menuId
  return menuId !== undefined && MENUS.includes(menuId) ? (menuId as ConfigDrawerMenu) : undefined
}
