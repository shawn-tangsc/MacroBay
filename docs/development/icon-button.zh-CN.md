[English](./icon-button.md) | [中文](./icon-button.zh-CN.md) | [← 文档首页](../README.zh-CN.md)

# 图标按钮

只放一个图标的触发器——问号、关闭、更多、刷新——一律用
`@platform/ui/components/icon-button` 的 `IconButton`，不要手写 `<button class="…">`。

这个组件存在的理由很具体：同一种触发器长出了五种尺寸（18 / 20 / 22 / 24 / 26）和三种焦点样式，
其中一种还把焦点环删掉且没有替代。现在两件事都收在一处。

## 组件与类型

| 导出 | 用途 |
| --- | --- |
| `IconButton` | 一个图标 + 一个读屏名。 |
| `ICON_BUTTON_SIZES` | 闭集：`['sm', 'md']`。 |
| `IconButtonSize` | `'sm' \| 'md'`——和 `StateView` 共用一套尺寸词。 |
| `IconButtonVariant` | `'plain' \| 'solid'`。 |
| `IconButtonProps` | props 类型。 |

```tsx
import { IconButton } from '@platform/ui/components/icon-button'
```

源码：`platform/ui/components/icon-button/`。外观规格：
`docs-private/05-desktop/ui-audit/prototypes/2026-11-01-1b-stateview-iconbutton-statuspill.html` ②。

### props

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `ariaLabelKey` | `string` | 是 | 读屏名，**收键不收句子**。传一句话就绕过了 i18n。 |
| `icon` | `LucideIcon` | 是 | lucide 图标组件。组件负责给它 `aria-hidden`；不许传 `<img>` 或文字当图标。 |
| `size` | `'sm' \| 'md'` | 是 | `sm` 行内 22、`md` 卡片头与工具栏 24。 |
| `onSelect` | `() => void` | 是 | 点击回调。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方的文案解析入口；组件内零文案、不 import i18n。 |
| `disabled` | `boolean` | 否 | 原生 `disabled`：不进 Tab 序列、点了不触发。 |
| `tooltipKey` | `string` | 否 | 悬停**和聚焦**都出现的解释，同样只收键。不用原生 `title`。 |
| `variant` | `'plain' \| 'solid'` | 否，默认 `plain` | `solid` 给工具栏一排加边框与底色。 |

### 尺寸

| `size` | 像素 | 图形 | 位置 |
| --- | --- | --- | --- |
| `sm` | 22 | 14 | 列表行内、紧挨文字 |
| `md` | 24 | 16 | 卡片头、工具栏 |

像素值只有组件里一张表，写进元素的行内 `style`，验收直接量元素本身。调用点不许传像素值，
`18` / `20` / `26` 不存在。

## 组件自己保证的几条

- **`aria-label` 必填且来自键**：图标是装饰性的、带 `aria-hidden`，所以名字只念一遍。
- **焦点环只有一处**：`:focus-visible` 2px accent 描边、offset 2；样式表里没有任何 `outline: none`。
- **`type="button"`**：放在表单里不会顺手提交。
- **不承载语义色**：图标按钮一律中性色。危险动作是带文字的按钮，不是红色图标。

```tsx
// 对：一个图标、一个键、一个尺寸词。
<IconButton
  ariaLabelKey="ui.icon.close"
  icon={X}
  size="md"
  onSelect={close}
  resolveText={t}
/>

// 对：工具栏那一排。
<IconButton ariaLabelKey="ui.icon.refresh" icon={RefreshCw} size="md" variant="solid" onSelect={reload} resolveText={t} />

// 错：字面文案、像素尺寸、字符串当图标、原生 tooltip。
<IconButton aria-label="关闭" icon="✕" size={22} title="关闭" />
```

## 用了它之后怎么验

1. **尺寸**：DevTools 里按钮的 `width` / `height` 是 22 或 24。别的值说明这一处绕过了组件。
2. **名字**：开着读屏聚焦按钮，念出来的是解析后的句子，不是键、也不是图标。
3. **焦点**：Tab 能到、环看得见；禁用状态被 Tab 跳过。
4. **提示**：聚焦就会出现解释；出现原生 `title` 小黄条说明走错了路。
