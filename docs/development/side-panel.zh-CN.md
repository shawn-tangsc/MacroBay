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

## 组件自己保证的几条

- **没有遮罩、不锁焦点、不监听全局 Esc**：读者本来就该在面板与页面之间来回走，抢 Esc 会和页面打架。
- **只有两档，调用点不传像素**；`flex` 的 `46vw` 上限收在组件内部。
- **收起键归组件**，名字取自组件自己的文案表——解析器遇到未知键可能返回空串，空串就是没有名字的按钮。
- **宽度不做过渡**，只做 120ms 的 opacity 淡入；`prefers-reduced-motion` 下一律不动。
