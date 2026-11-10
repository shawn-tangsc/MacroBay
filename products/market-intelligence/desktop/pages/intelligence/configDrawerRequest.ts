import { DRAWER_MENUS, type ConfigDrawerMenu } from '../../settings/config-drawer/drawerPreviewRows'

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
  | { menu: 'processing'; section?: 'translation' | 'scoring' }
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
