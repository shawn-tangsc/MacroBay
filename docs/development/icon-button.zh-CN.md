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

**基础：antd `Button`。** 组件是封装层，不是手写 `<button>`：键盘、禁用、`type="button"` 由库提供，
外观仍是我们的规格（内边距 0、圆角 5、透明底，hover/active 也归我们）。它的点击波纹属装饰性动效，
在 `platform/ui/theme` 一处关掉，主窗与分离窗两个 `ConfigProvider` 都读那一份——不许逐按钮关。

### props

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `ariaLabelKey` | `string` | 是 | 读屏名，**收键不收句子**。传一句话就绕过了 i18n。 |
| `ariaLabelParams` | `Record<string, string>` | 否 | 读屏名模板里的实体名（事件、来源、模型）。句子骨架在文案表里，如「在日历中打开「{name}」」；缺少的参数**原样留下 `{name}`**，不静默删掉半句。 |
| `icon` | `LucideIcon` | 是 | lucide 图标组件。组件负责给它 `aria-hidden`；不许传 `<img>` 或文字当图标。 |
| `size` | `'sm' \| 'md'` | 是 | `sm` 行内 22、`md` 卡片头与工具栏 24。 |
| `onSelect` | `(event: React.MouseEvent) => void` | 是 | 点击回调，**带事件**。图标按钮大量出现在可点击的行里，处理器要靠 `event.stopPropagation()` 挡住整行；写成必填参数而不是可选，新站点才不会再忘记。零参处理器照样编译、照样触发（少写参数是合法的）。 |
| `className` | `string` | 否 | 调用方自己的类，用于定位与状态。**改不动尺寸**：尺寸写在行内，行内优先于任何类规则。 |
| `style` | `CSSProperties` | 否 | 只用于定位。组件在**你的样式之后**写 `width`/`height`，所以调用方逃不出 22/24 这个闭集。 |
| `dataAttributes` | `Record<\`data-${string}\`, …>` | 否 | 测试钩子与状态属性（`data-redock-tab`）。用独立 prop 而不是任意属性透传，`width` 之类的键就混不进来。 |
| `ref` | `Ref<HTMLButtonElement \| HTMLAnchorElement>` | 否 | 真实按钮节点。浮层组件靠它量触发器矩形；不转发时提示会退回 `(0, 0)`，气泡跑到窗口角落。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方的文案解析入口；组件内零文案、不 import i18n。 |
| `disabled` | `boolean` | 否 | 原生 `disabled`：不进 Tab 序列、点了不触发。与 `tooltipKey` 不能并存，一起传编译不过。 |
| `variant` | `'plain' \| 'solid' \| 'overlay'` | 否，默认 `plain` | `plain` 透明（行内）；`solid` 是工具栏那一排：边框加浅底；`overlay` 给**绝对定位挂在内容之上**的图标按钮——边框、圆角 5、**刻意半透明的底**（透出一点下面的内容才像浮在上面），hover 转不透明。判据：凡是挂在任意内容之上的，一律 `overlay`，不划到透明档。 |
| `tone` | `'danger'` | 否 | 这一下是破坏性的动作。**只换颜色**：22/24 的尺寸与档位都不动，可与 `ariaLabelKey` 及 `plain`/`solid`/`overlay` 并存。危险色**静止可见**——红字，有边框的档位同时给红边——不靠 hover 才出现：只在悬停时才变红的破坏性动作，对键盘和触屏读者等于没有提示。闭集：`danger` 以外的值编译不过。 |
| `loading` | `boolean` | 否 | 这次点击还在等结果：按钮 disabled、图形换成平台唯一的转圈（`LoadingSpinner`，`sm` 档）、不再触发 `onSelect`。**读屏名与 22/24 尺寸不变**——用户要知道是哪个按钮在忙。它不是第三个尺寸，也不是新变体。 |
| `tooltipKey` | `string` | 否 | 悬停**和聚焦**都出现的解释，同样只收键。不用原生 `title`；禁用时不许传。 |
| `variant` | `'plain' \| 'solid'` | 否，默认 `plain` | `solid` 给工具栏一排加边框与底色。 |
| `expanded` | `boolean` | 否 | 这是个展开/收起触发器时传（铃铛打开抽屉）。映射到 `aria-expanded`；不传时输出里没有这个属性。 |
| `controls` | `string` | 否 | 被展开区域的 `id`。映射到 `aria-controls`；不传时不输出。 |
| `pressed` | `boolean` | 否 | 开关类按钮的当前状态（按下/开启）。映射到 `aria-pressed`；不传时不输出。读屏名在两种状态下保持恒定——状态不在名字里重复。**外观不变**：按下态由图标本身或它控制的面板表达。 |

**自带圆圈的图形固定 `plain`。** `Info`、`CircleHelp`、`HelpCircle` 自己就画了一个圆，再有边框的档位就是两个圈。这类调用点必须显式写 `variant="plain"`——`platform/ui/components/icon-button/iconGlyphVariantGuard.test.ts` 扫调用点，答案缺了即红。

### 尺寸

| `size` | 像素 | 图形 | 位置 |
| --- | --- | --- | --- |
| `sm` | 22 | 14 | 列表行内、紧挨文字 |
| `md` | 24 | 16 | 卡片头、工具栏 |

像素值只有组件里一张表，写进元素的行内 `style`，验收直接量元素本身。调用点不许传像素值，
`18` / `20` / `26` 不存在。

## 组件自己保证的几条

- **`aria-label` 必填且来自键**：图标是装饰性的、带 `aria-hidden`，所以名字只念一遍。
  `ariaLabelKey` / `tooltipKey` 保持开区间（每个站点读屏名都不同，平台枚举不出来），
  代价由守卫补上：`iconButtonKeyGuard.test.ts` 扫源码，写成一句话、中文、或带空白的键即红。
- **提示是可访问描述，不是装饰**：`Tooltip` 用 `aria-describedby` 把解析后的句子挂到触发元素上，
  键盘 Tab 进来也读得到；原生 `title` 不存在。
- **`disabled` 与 `tooltipKey` 不并存**：禁用的按钮不进 Tab、也接不到 focus，它的提示只有鼠标够得着。
  原因重要就写成可见说明——这个组合在类型上就被拒掉。
- **焦点环只有一条，而且必须真的生效**：`:focus-visible` 在**计算样式**里必须是 **2px accent**
  描边、**offset 2**。触发器底层是 antd `Button`，它自带的 `focus-visible` 规则会压过普通的
  `.icon-button:focus-visible`；组件要提高特异性，直到实际生效的是那条 2px accent 环。验收用
  `getComputedStyle` 读描边宽度/颜色（或环的 box-shadow），不看截图；环色对页面底色的对比度
  **≥ 3:1**。没有 `outline: none` 而不给替代环。
- **`type="button"`**：放在表单里不会顺手提交。
- **不承载语义色**：图标按钮一律中性色。危险动作是带文字的按钮，不是红色图标。
- **加载中必须看得见：对比度不低于 3:1。** 禁用态低于非文字控件 3:1 的下限可以豁免，加载态不行——
  读者得看出**哪个**按钮在忙。所以 `loading` 自带 `data-state="loading"` 标记和自己的颜色 token，
  不许继承禁用态那套绘制。加载中转圈若是渲染成禁用灰（实测深色 2.27:1 / 浅色 1.84:1），验收不通过。

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
4. **提示**：聚焦就会出现解释，且触发元素的 `aria-describedby` 解析到那句解释；出现原生 `title`
   小黄条说明走错了路。
5. **不许禁用配 tooltip**：一个灰按钮、解释只在悬停时出现，键盘用户就是死路——它不该编译过，
   也不许用外层包裹绕过去。
