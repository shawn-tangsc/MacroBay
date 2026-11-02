[English](./drawer.md) | [中文](./drawer.zh-CN.md) | [← 文档](../README.md)

# 抽屉

盖在页面上的侧面板一律渲染 `@platform/ui/components/drawer` 的 `Drawer`。不要直接 import antd
`Drawer`，也不要自己写宽度。

组件包的是 antd `Drawer`——焦点陷阱、滚动锁、portal、遮罩、Esc 与焦点回位都是它的能力，我们不重写；
我们只收紧 16 个调用点各自长出来的三件事：宽度、头部、关闭键。

## 组件

| 导出 | 用途 |
| --- | --- |
| `Drawer` | 一只抽屉：四档、两种模式、三个槽。 |
| `DRAWER_SIZES` | 闭集：`['narrow', 'large', 'wide', 'full']`。 |
| `DrawerSize` | `'narrow' \| 'large' \| 'wide' \| 'full'`。 |
| `DrawerMode` | `'modal' \| 'inline'`。 |
| `DrawerSide` | `'left' \| 'right'`，只对 `mode="inline"` 有意义。 |
| `DRAWER_CLOSE_KEY` | `ui.drawer.close`：关闭键的平台读屏名。 |

```tsx
import { Drawer } from '@platform/ui/components/drawer'
```

源码：`platform/ui/components/drawer/`。规格图：
`docs-private/05-desktop/ui-audit/prototypes/2026-11-02-drawer-four-sizes.html`。

### props

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `open` | `boolean` | 是 | 是否显示。 |
| `onClose` | `() => void` | 是 | 遮罩点击、Esc（仅 modal）与关闭键共用。 |
| `size` | `DrawerSize` | 是 | `narrow` 420、`large` 640、`wide` 860、`full` 1040。不给默认值：每次调用回答一次。 |
| `mode` | `'modal' \| 'inline'` | 否，默认 `modal` | `modal` 有遮罩、锁焦点、Esc 关；`inline` 在页面流内。 |
| `side` | `'left' \| 'right'` | 否，默认 `right` | 只对 `mode="inline"` 有意义；浮层一律右置。 |
| `header` | `'titled' \| 'none'` | 否，默认 `titled` | 有标题栏，或整块不要。 |
| `titleKey` | `string` | `header="titled"` 时 | 标题，**收键**。 |
| `titleParams` | `Readonly<Record<string, string>>` | 否 | 填标题模板 `{name}` 的值，**只收已经格式化好的字符串**（`3`、`10–2`）。 |
| `ariaLabelKey` | `string` | `header="none"` 时 | 无头抽屉仍然需要的读屏名。 |
| `titleExtra` | `ReactNode` | 否 | 标题旁的徽标或动作，不是自定义标题栏的入口。 |
| `footer` | `ReactNode` | 否 | 底部动作区。**不传就整行不渲染。** |
| `contentPadding` | `'default' \| 'flush'` | 否，默认 `default` | 全出血内容用 `flush`。 |
| `children` | `ReactNode` | 是 | 正文。 |
| `className` | `string` | 否 | 只做定位，不许用它带宽度或布局。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方的文案解析，只用于 `titleKey`。 |

宽度是组件内的 `min(<档位>px, 92vw)`。没有 `width`、`style`、`styles`、`mask`、`closable`、
`placement`、`getContainer`——这些正是同一只抽屉长出十二种宽度的来源。

### 四档

| `size` | 像素 | 用途 |
| --- | --- | --- |
| `narrow` | 420 | 设置面板、单列表单 |
| `large` | 640 | 两列详情、检查器 |
| `wide` | 860 | Agent 配置、看板面板 |
| `full` | 1040 | 最宽的沉浸面板 |

### 透传清单

**只透传改变「内容何时存在」的属性**；改变外观的，一律进规格，不逐条穿透，否则这个包装组件会一直变大。

| 属性 | 为什么需要它 |
| --- | --- |
| `destroyOnHidden` | 有的抽屉里放着详情与筛选状态，关闭后不能留。默认不传，antd 自己的默认生效——不额外加任何隐式行为。 |

`afterOpenChange` **有意不提供**：没有消费者，而且它回答的不是生命周期问题——内容存不存在与它无关。

## 组件自己保证的几条

- **关闭键归组件。** 它渲染 `IconButton` + `ui.drawer.close`，句子取自组件自己的文案表
  （`drawerText.ts`），**不经过**你的 `resolveText`。这是有意的：解析器遇到未知键可能返回空串，
  而空串会让这个按钮没有名字。标题仍然走你的解析器。
- **遮罩与焦点锁定归 `modal`。** 浮层压暗页面、锁焦点、Esc 由 antd 处理；一个布尔参数都不收。
- **`inline` 不进焦点这套。** 打开时**不移动焦点**（读者正在页面上操作，把他拽进面板就是丢位置）、**不锁焦点**、**没有遮罩**；打开期间在文档层听 Esc，焦点在页面别处也能关；关闭后焦点留在原处。这几条按模式写死，同样不开参数。
- **不传页脚就不渲染页脚行**，不是留一个空壳占位。
- **头部只有两档。** `header="none"` 仍然必须给 `ariaLabelKey`：没有名字的对话框，读屏只会念「对话框」。

## 怎么验用了它的页面

1. **宽度**：DevTools 里内容容器的宽度等于该档位的像素，且不是你传进去的值；窄窗口下封顶 `92vw`。
2. **关闭**：右上角关闭键 Tab 可达，念出来是「关闭抽屉」/`Close drawer`，不是键名、也不是空。
3. **模式**：`modal` 会压暗页面、锁焦点、Esc 可关；`inline` 没有遮罩、**打开不动焦点**、焦点在页面别处按 Esc 也能关、关掉后焦点还在原处。
4. **页脚**：不传页脚的抽屉底部没有空条。
