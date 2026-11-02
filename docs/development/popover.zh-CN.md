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
| `labelKey` | `K extends string` | 是 | 说明文案的**键**。`K` 从 `resolveText` 推断，解析器绑了键联合时只收联合内的键。 |
| `resolveText` | `(key: K) => string` | 是 | 调用方的解析入口；未知键返回空串。 |
| `children` | `ReactElement` | 是 | 触发器，必须可聚焦——按钮、链接或带 `tabIndex` 的元素。 |

没有 `placement`、没有 `open`、没有 `onOpenChange`、也不收任意 `content` 节点：开合模型与位置是
组件固定的行为，不是调用点的选项。

## 组件自己保证的几条

- **悬停与聚焦都打开**：读者用 Tab 指过来就该看到，不用回去拿鼠标。
- **点击触发器钉住**：只靠悬停撑不住「边看边对照」；而直接给 antd 传 `['hover','focus','click']`
  会在鼠标移开时关掉，等于钉不住。
- **点别处关闭，且不抢焦点**：读者点的那个地方就是他要去的，把焦点抢回触发器是在跟他作对。
- **Esc 关闭并把焦点还给触发器**：否则焦点掉到 `body`，键盘读者就丢了位置。
- **最大宽度 320px**，长句换行，不把页面撑开。
- **句子为空就不渲染浮层**：把键名念出来比什么都不说更糟，与 `Tooltip` 同一条。

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
