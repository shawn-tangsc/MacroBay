import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { agentText } from '../shell/agents/agentText'
import { platformText } from './platformText'

/**
 * 壳层「哪些文案表参与读屏名解析」的**唯一清单**。
 *
 * 为什么需要清单：`ariaLabelKey` 的键散落在几张表里——壳层主表、各功能自己的表、平台组件自带的表。
 * 只拿 `platformText` 一张判，会把 34 个合法键打红；只判「属性名存在」，又会放过
 * 「键插在错的父节点下」那种错（平台设置实修时撞到的：`settings.notifications.*` 属性名存在，
 * 运行时读的却是 `notifications.*`，`Popover` 当场抛 no copy）。所以：**键必须在某张登记表里
 * 按完整路径真解析得出句子**。
 *
 * 条目形状：`{ id, module, exportName, tables }`
 * - `module` / `exportName` 是给 `scripts/check-text-tables.mts` 做机械校验用的（文件在不在、
 *   导出名在不在）；表改名或删除而清单没跟上，那条脚本会红。
 * - `tables` 是**两张语言表**：中英各一份，守卫要求两边都能取到非空值。
 *
 * **A 方案的已知边界（写在这里，别让它成为下次事故的盲区）**：本清单只保证「这个键在某张登记表里
 * 存在」，**不保证它属于这颗组件该用的那张表**——名字对、表错，仍然可能绿。要补上这一层，得按
 * 调用点绑表（B 方案），那会引入第二套识别逻辑并在成员表达式/转发 props 处退化成残差；
 * 权衡后选 A，边界写清楚。
 */
export type ShellTextTable = Readonly<{
  id: string
  /**
   * 调用点写的是带前缀的键，表里存的是剥掉前缀的路径（`modelService.requestConfig` → 表内 `requestConfig`）。
   * 这个前缀就是那层「局部解析器」剥的东西，写在清单里，别让它散落在各屏的实现里。
   */
  keyPrefix?: string
  /** 相对本文件的模块路径（脚本据此查文件是否存在）。 */
  module: string
  /** 该模块里承载语言表的导出名。 */
  exportName: string
  /** 中英两张表：守卫对两套各解析一次。 */
  tables: Readonly<Record<AppLanguage, unknown>>
}>

export const SHELL_TEXT_TABLES: readonly ShellTextTable[] = [
  { id: 'platformText', module: './platformText', exportName: 'platformText', tables: platformText },
  { id: 'agentText', module: '../shell/agents/agentText', exportName: 'agentText', tables: agentText },
  {
    id: 'platformText.models',
    module: './platformText',
    exportName: 'platformText',
    keyPrefix: 'modelService.',
    tables: { 'zh-CN': platformText['zh-CN'].models, 'en-US': platformText['en-US'].models }
  }
]
