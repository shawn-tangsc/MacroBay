[English](./popover.md) | [中文](./popover.zh-CN.md) | [← 文档首页](../README.zh-CN.md)

# 浮层说明

需要**读一段**的多行说明挂在触发器上时，用 `@platform/ui/components/popover` 的 `Popover`。
不要手写浮层，也不要直接 import antd 的 `Popover`——两种写法都会丢掉下面这套焦点与关闭规则。

`Tooltip` 管的是一行提示：扫一眼就走。这里管的是另一种情况：一段需要读的说明，或者读者想把它
**钉住**、边看边对照下面的页面。

## 组件与类型

| 导出 | 用途 |
| --- | --- |
| `Popover` | 一块说明浮层，挂在一个可聚焦的触发器上。 |
| `PopoverProps` | props 类型。 |

```tsx
import { Popover } from '@platform/ui/components/popover'
```

**基础是 antd `Popover`。** 定位、翻转、视口夹取都是它的；本组件加的是开合模型、宽度上限和焦点归还。

### props

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `labelKey` | `K extends string` | 二选一 | 说明文案的**单个键**。`K` 从 `resolveText` 推断，解析器绑了键联合时只收联合内的键。 |
| `lines` | `readonly { labelKey, params? }[]` | 二选一 | 多行说明，**每行自带参数**；代替 `labelKey`。首行是主题，会被强调。 |
| `labelParams` | `Record<string, string>` | 仅单行 | 单行分支里填 `{name}` 的值，**只收已经格式化好的字符串**；多行分支没有这个字段，传了编译不过，参数进 `lines[].params`。 |
| `resolveText` | `(key: K) => string` | 是 | 调用方的解析入口；未知键返回空串。 |
| `trigger` | `(props: PopoverTriggerProps) => ReactElement` | 是 | 自己渲染触发器，把这组属性摊上去。不留裸 children：裸元素会诱使组件去注入处理器，而组合失败正是从那里来的。 |

没有 `placement`、没有 `open`、没有 `onOpenChange`、也不收任意 `content` 节点：开合模型与位置是
组件固定的行为，不是调用点的选项。

## 组件自己保证的几条

- **触发器是组合出来的，不是被接管的**：组件把 `{ onSelect, onMouseEnter, onMouseLeave, onFocus,
  onBlur, expanded }` 交给调用方，由调用方摊到真控件上（`IconButton` 收 `onSelect`/`expanded`；
  普通元素把 `onSelect` 映射到 `onClick`、`expanded` 映射到 `aria-expanded`）。组件**不 cloneElement、
  不替调用方注入处理器**——旧形状遇到自己已经绑了点击的控件就组合不了，卡面那颗「?」正是这么失效的。
- **缺文案是缺陷，不是运行态**：开发期句子解析成空，组件**当场抛错**，让缺口在写它的地方现形；
  生产期**触发器与浮层都不渲染**——一个点了什么都不开的按钮，正是这一轮要清掉的假控件。
  缺文案就修文案，不要用交互去掩盖它。
- **「名字就是说明」的控件不算缺文案**：带 `ariaLabelKey` 的刷新按钮没有浮层是正常的——
  判据是读者有没有被告知，不是有没有 `Popover`。
- **悬停与聚焦都打开**：读者用 Tab 指过来就该看到，不用回去拿鼠标。
- **点击触发器钉住**：只靠悬停撑不住「边看边对照」；而直接给 antd 传 `['hover','focus','click']`
  会在鼠标移开时关掉，等于钉不住。
- **点别处关闭，且不抢焦点**：读者点的那个地方就是他要去的，把焦点抢回触发器是在跟他作对。
- **Esc 关闭并把焦点还给触发器**：否则焦点掉到 `body`，键盘读者就丢了位置。
- **最大宽度 320px**，长句换行，不把页面撑开。
- **句子为空就不渲染浮层**：把键名念出来比什么都不说更糟，与 `Tooltip` 同一条。用 `lines` 时，
  解析为空的某一行会被丢掉；每一行都空则整块不存在，绝不出现空框。
- **多行只来自键数组，不来自 `\n`**：换行是排版巧合，翻译会合并或吃掉它，而「哪一行是主题」
  只有数组能表达。把 `\n` 塞进 `labelKey` 或 `lines` 里的调用点会在 `popoverCallSiteGuard.test.ts` 里变红。
- **占位符只从 `labelParams` 填，组件不在这里做第二次格式化**：数字、单位、时刻归调用方，
  传进来的就是 `10–2`、`289/289`。组件再格式化一次，就是同一个数两处写法。缺参时占位符原样保留，
  不安静地少一个数字。
- **首行承担强调**（`600`），其余是细节。没有这层区分，三行会被读成三件并列的事实。

## 调用点规矩

新代码用本组件。现存的 7 处 `import { Popover } from 'antd'` 是迁移欠账，记在
`popoverCallSiteGuard.test.ts` 里，**只减不增**；切一处就必须同笔删掉对应那一行——守卫会因过期条目
变红，这份清单才不会退化成永久豁免。

```tsx
// 对：键控文案、一个可聚焦触发器。
<Popover labelKey="pages.intelligence.sources.help" resolveText={t}>
  <IconButton ariaLabelKey="pages.intelligence.sources.helpLabel" icon={HelpCircle} size="sm"
    onSelect={() => undefined} resolveText={t} />
</Popover>

// 错：手写浮层，或者直接写一句中文。
<div className="my-popover">先检查来源，再重新采集……</div>
```

## 用了它之后怎么验

1. **键盘**：Tab 到触发器即打开，Esc 关闭且焦点回到触发器。
2. **钉住**：点一下触发器再移开鼠标，浮层还在；点别处才关，且焦点留在你点的位置。
3. **宽度**：长句子在 320px 内换行，页面不被撑宽。
4. **文案**：显示的是键解析出来的句子；写死一句中文过不了守卫。
