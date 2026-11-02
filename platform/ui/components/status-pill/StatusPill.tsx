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

/**
 * 每档的圆点形状（界面设计 2026-11-02 定，Chief 批准）。
 *
 * 为什么五档都要形状、不再只靠颜色：浅色主题下 `ok`（`--success`）与 `info`（`--accent`）的色值
 * 只差色相，灰度或红绿色盲下几乎分不开——而点就是读者最先扫到的那个东西。形状是**第二通道**，
 * 颜色照旧保留，两者并存；去掉颜色的那个是错的，只靠颜色的那个也是错的。
 *
 * 三件「让它成立」的细节：点从 5px 调到 6px（`muted` 3px）——5px 上 1.5px 描边的空心环内孔只剩
 * 2px，灰度和实心圆一样，形状编码就成了假的；方块带 1px 圆角，与圆一眼分开；横条是 6×2。
 *
 * 这张表是**闭集**：新增一档必须同时给出形状，否则 `Record` 直接编译不过——形状不能是"没想过就算了"。
 */
export const STATUS_PILL_DOT_SHAPES: Record<StatusPillTone, 'circle' | 'ring' | 'square' | 'bar' | 'small'> = {
  ok: 'circle',
  warn: 'ring',
  bad: 'square',
  info: 'bar',
  muted: 'small'
}

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
      {/*
        灰度可分：关掉颜色、或者读者本来就不区分颜色时，五档靠**形状**分开（见 STATUS_PILL_DOT_SHAPES）。
        字始终在，点只是辅助。形状写在 `data` 上而不是在组件里判色，是为了让 CSS 那一份规则成为唯一出口。
      */}
      <i className="status-pill__dot" data-dot-shape={STATUS_PILL_DOT_SHAPES[tone]} aria-hidden="true" />
      <span className="status-pill__label">{resolveText(labelKey)}</span>
    </span>
  )
}
