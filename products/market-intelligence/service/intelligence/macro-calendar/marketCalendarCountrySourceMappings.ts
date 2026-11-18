import type { ZeroXRouterPeriodRule } from './marketCalendarMetricIdentity'
import { mapping_AU } from './marketCalendarCountrySourceMappings-byCountry/au'
import { mapping_CA } from './marketCalendarCountrySourceMappings-byCountry/ca'
import { mapping_CH } from './marketCalendarCountrySourceMappings-byCountry/ch'
import { mapping_CN } from './marketCalendarCountrySourceMappings-byCountry/cn'
import { mapping_DE } from './marketCalendarCountrySourceMappings-byCountry/de'
import { mapping_EMU } from './marketCalendarCountrySourceMappings-byCountry/emu'
import { mapping_FR } from './marketCalendarCountrySourceMappings-byCountry/fr'
import { mapping_GB } from './marketCalendarCountrySourceMappings-byCountry/gb'
import { mapping_HK } from './marketCalendarCountrySourceMappings-byCountry/hk'
import { mapping_IT } from './marketCalendarCountrySourceMappings-byCountry/it'
import { mapping_JP } from './marketCalendarCountrySourceMappings-byCountry/jp'
import { mapping_PH } from './marketCalendarCountrySourceMappings-byCountry/ph'
import { mapping_TH } from './marketCalendarCountrySourceMappings-byCountry/th'
import { mapping_RU } from './marketCalendarCountrySourceMappings-byCountry/ru'
import { mapping_KR } from './marketCalendarCountrySourceMappings-byCountry/kr'
import { mapping_NZ } from './marketCalendarCountrySourceMappings-byCountry/nz'
import { mapping_SG } from './marketCalendarCountrySourceMappings-byCountry/sg'
import { mapping_TW } from './marketCalendarCountrySourceMappings-byCountry/tw'
import { mapping_US } from './marketCalendarCountrySourceMappings-byCountry/us'
import { mapping_VN } from './marketCalendarCountrySourceMappings-byCountry/vn'

/**
 * **源内 id → 新建码**（第二笔：映射）。数据按国家拆到 `…-byCountry/` 下，本文件只做合并：
 * 国家一多，单个文件很快越过体积红线；拆开之后新增一个国家只碰它自己那个文件。
 *
 * 三条口径（拆开后仍然成立）：只收期次可定的（`MOM`/`YOY`→月、`QOQ`→季、族名带 `_WEEK`→`week_end`）；
 * 只收测度一致的（不拿宽松匹配凑数）；目标码必须在码表里。
 */
export const marketCalendarCountrySourceMappings: Readonly<Record<string,
  Readonly<{ metricKey: string; periodRule: ZeroXRouterPeriodRule }>>> = Object.freeze({
  ...mapping_AU,
  ...mapping_CA,
  ...mapping_CH,
  ...mapping_CN,
  ...mapping_DE,
  ...mapping_EMU,
  ...mapping_FR,
  ...mapping_GB,
  ...mapping_HK,
  ...mapping_IT,
  ...mapping_JP,
  ...mapping_PH,
  ...mapping_TH,
  ...mapping_RU,
  ...mapping_KR,
  ...mapping_NZ,
  ...mapping_SG,
  ...mapping_TW,
  ...mapping_US,
  ...mapping_VN,
})
