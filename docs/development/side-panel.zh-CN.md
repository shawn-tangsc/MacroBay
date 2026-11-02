[English](./side-panel.md) | [中文](./side-panel.zh-CN.md) | [← 文档](../README.md)

# 常驻侧面板

**与主内容并排、让内容变窄**的面板用 `@platform/ui/components/side-panel` 的 `SidePanel`；
盖住内容并带遮罩的是 `Drawer`。

一句话判据：**面板打开时，读者还能看到并点到主内容吗？** 能 → `SidePanel`；不能 → `Drawer`。

| 导出 | 用途 |
| --- | --- |
| `SidePanel` | 一个常驻面板，两档尺寸，一个收起键。 |
| `SIDE_PANEL_SIZES` | `['rail', 'flex']`。 |
| `PANEL_COLLAPSE_KEY` | `ui.panel.close`，收起键的读屏名。 |

### props

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `open` | `boolean` | 是 | 关着时什么都不渲染。 |
| `onClose` | `() => void` | 是 | 收起键调用；焦点回到触发元素是调用方的事。 |
| `size` | `'rail' \| 'flex'` | 是 | `rail` 固定 282；`flex` `min(480px, 46vw)`——比例写在组件里。 |
| `titleKey` | `string` | 是 | 面板标题，收键。 |
| `footer` | `ReactNode` | 否 | 底部动作；不传就不渲染这一行。 |
| `children` | `ReactNode` | 是 | 正文，唯一滚动区。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方解析入口，用于 `titleKey`。 |
| `focusPolicy` | `'move-in' \| 'stay'` | 否，默认 `move-in` | 读者按按钮打开用 `move-in`；面板只跟着列表选中换内容用 `stay`。 |
| `contentId` | `string` | `focusPolicy="stay"` 时必填 | 当前内容的稳定标识。**这一支必填**：没有它，组件分不清「重渲染」和「真的换了」。 |
| `when` | `string` | `focusPolicy="stay"` 时必填 | 播报句里用来区分同名条目的值（格式化好的时刻）。**必填**：`stay` 就是给「同名会出现两次」的列表用的。 |

## 组件自己保证的几条

- **没有遮罩、不锁焦点、不监听全局 Esc**：读者本来就该在面板与页面之间来回走，抢 Esc 会和页面打架。
- **只有两档，调用点不传像素**；`flex` 的 `46vw` 上限收在组件内部。
- **收起键归组件**，名字取自组件自己的文案表——解析器遇到未知键可能返回空串，空串就是没有名字的按钮。
- **宽度不做过渡**；进场淡入读 `--motion-enter`，组件里没有时长字面量。降级只有一处：
  `tokens.css` 在 `prefers-reduced-motion` 下把 `--motion-*` 全部归零。
- **焦点跟读者意图走，不跟布尔走**：`move-in` 把焦点送进正文、收起时还原；`stay` 什么都不动——
  读者正在列表里连着看，每选一个就被拽进面板，三个事件根本比不了。
- **`stay` 要播报，因为不动的焦点等于没说话**：焦点停在列表上时，读屏用户选下一项什么都听不到；
  面板用 `aria-live="polite"` 播一句新标题，400ms 去抖、**按 `contentId` 判重（不是标题）**——同一时段两场同名事件标题一样、id 不同，
按标题判重就会漏播；连点几下是一句话，不是三条。
  `move-in` 档**没有** live region：焦点本就会播报。
- **焦点从哪来回哪去**：组件记住打开前持有焦点的元素，收起时还原——不让三个调用点各写一份。
