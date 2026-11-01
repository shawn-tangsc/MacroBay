import type { ReactElement } from 'react'

import './statusPill.css'

/**
 * 状态药丸（规格：`docs-private/05-desktop/ui-audit/prototypes/2026-11-01-1b-stateview-iconbutton-statuspill.html` ③）。
 *
 * 只做「一行状态字 + 一个辅助圆点」。五个档位是闭集，颜色全部取 token；
 * 药丸里**必须有字**——关掉颜色、转成灰度，五档仍靠读字分辨，圆点只是辅助。
 *
 * 三条写进结构与类型、不靠评审：
 * - `tone` 是五个字面量的联合，第六个档位编译不过，不会出现「自定义颜色」的第六种灰；
 * - 文案只收键（`labelKey`），句子由调用方注入的 `resolveText` 解析——组件内零文案零 i18n；
 * - 渲染成 `<span>` 而不是按钮：药丸是状态，不是动作。放一个动词进去（「点击刷新」）
 *   是这一批要收掉的用法，做成按钮只会让它更像能点。
 */

/** 五档，仅此五档。 */
export const STATUS_PILL_TONES = ['ok', 'warn', 'bad', 'info', 'muted'] as const

export type StatusPillTone = (typeof STATUS_PILL_TONES)[number]

export type StatusPillProps = {
  /** `ok` 正常、`warn` 需要看一眼、`bad` 失败、`info` 进行中或中性提示、`muted` 未启用。 */
  tone: StatusPillTone
  /** 状态文案的 i18n 键；不收字面量，也不收已解析好的句子。 */
  labelKey: string
  /** 文案解析入口，由调用方注入（壳层传 `t` 的包装，测试传键回显）。 */
  resolveText: (key: string) => string
}

export function StatusPill({ tone, labelKey, resolveText }: StatusPillProps): ReactElement {
  return (
    <span className={`status-pill status-pill--${tone}`}>
      <i className="status-pill__dot" aria-hidden="true" />
      <span className="status-pill__label">{resolveText(labelKey)}</span>
    </span>
  )
}
