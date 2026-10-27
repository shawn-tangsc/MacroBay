[English](./loading-standard.md) | [中文](./loading-standard.zh-CN.md) | [← 文档首页](../README.zh-CN.md)

# Loading 规范

应用里只有一种 loading：居中的旋转环，等待的文案在环下方。页面、面板、卡片、抽屉、列表区域、
以及正在执行的控件都复用它。任何页面都不再自己写 loading。

这是规则，不是建议。以前 loading 是一页一页长出来的——这里一行灰色 `loading…`，那里一个 AntD
`Spin`，还有三种不同的旋转 keyframe——读者已经分不清「在加载」「空数据」和「坏了」。统一的组件、
仓库守卫和这份文档就是为了避免重演。

## 组件

| 导出 | 用在哪 |
| --- | --- |
| `LoadingState` | 还没有内容可显示的区域：页面、面板、卡片、抽屉体、列表区。在自己的盒子里居中环。 |
| `LoadingSpinner` | 控件内部、文案已由控件承担时的环：胶囊按钮、图标按钮、行内状态标记。装饰性（`aria-hidden`）。 |

```tsx
import { LoadingSpinner, LoadingState } from '@platform/ui/components/loading'
```

源码：`platform/ui/components/loading/`（`LoadingState.tsx`、`loadingState.css`、组件测试和仓库守卫）。

### 属性

| 属性 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `label` | `string` | — | 环下方的可见文案。除非给了 `ariaLabel`，否则必填。 |
| `ariaLabel` | `string` | — | 区域标题已经说明等待内容时，只给无障碍名称。 |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | `sm` 用于控件内，`md` 用于区域，`lg` 用于整页槽位。 |
| `layout` | `'block' \| 'inline'` | `'block'` | block 居中一块区域；inline 用于状态条或列表行。 |
| `fill` | `boolean` | `false` | 撑满父级高度（父级本身是 flex/grid 且有高度）。 |
| `minHeight` | `number` | 样式表 `96` | 矮区块的最小高度（px）。`fill` 时忽略。 |
| `className` | `string` | — | 只用于区域定位，不要改环本身。 |

根节点渲染 `role="status"`、`aria-live="polite"`、`aria-busy="true"` 和 `data-loading-state`；
环本身是 `aria-hidden`。视觉规格：环线宽 `2px`（`lg` 为 `3px`），每 `720ms` 转一圈，环用
`--muted-strong`、文案用 `--muted`（12px）；block 最小高度 `96px`，inline 间距 `6px`。深浅主题
无需逐页配色，`prefers-reduced-motion` 下减速而不是隐藏。

## 选哪种形态

| 场景 | 形态 |
| --- | --- |
| 区域还没有内容可显示 | `<LoadingState label={...} />` |
| 同上，但区域自己拥有高度 | `<LoadingState label={...} fill />` |
| 表单 / 设置里的矮区块 | `<LoadingState label={...} minHeight={120} />` |
| 状态条、列表行、行内元信息 | `<LoadingState layout="inline" size="sm" label={...} />` |
| 控件自己已经有文案 | `<LoadingSpinner size="sm" />` |
| 按钮执行动作 | AntD `Button loading` / `confirmLoading` |
| 已结束的状态：空、不可用、权限关闭 | 专门的空态/错误态，绝不用转圈 |
| 静态状态图标（步骤标记、徽标） | 静态 lucide 图标，绝不用转圈 |

```tsx
// 区域首次读取
<LoadingState label={text.loading} />

// 自带高度的抽屉体
<LoadingState label={text.loading} fill />

// 状态条
<LoadingState layout="inline" size="sm" label={text.status.loading} />

// 控件内部的环，名字由控件自己的文案承担
<button className="model-service-pill" aria-busy={running}>
  {running ? <LoadingSpinner size="sm" /> : null}
  {running ? `${labels.detectModels} ${done}/${total}` : labels.detectModels}
</button>
```

## 禁止

```tsx
<p>loading…</p>                      // 用一句话冒充 loading 区域
<div aria-busy="true" />             // 空盒子
<Spin />                             // 第二套 spinner 实现
<Loader2 className="spin" />         // 静态 loader 图标 + 本地动画
```

```css
@keyframes my-page-spin { to { transform: rotate(360deg); } }   /* 全应用只允许一个旋转动画 */
```

## 文案与无障碍

- 文案一律走 i18n：shell 用 `platformText`，产品用 `productText`。
- 一行说清在读什么，不写道歉、不写预计耗时。
- 文案里不放诊断信息——重试次数、失败码、id、时间戳都属于错误态。
- 标题或状态条已经说明等待内容时，只传 `ariaLabel`，不要在环下面重复同一句话。

## 新增一个 loading 区域

1. 先确认这里是「等待且暂无内容」。如果原有内容还在屏幕上，用控件级指示器，不要替换整个区域。
2. 从上面的表格选形态，不要发明第三种布局。
3. 保留负责布局、边框、滚动的容器，只替换里面的占位。
4. 从 `@platform/ui/components/loading` 引入；文案由所属层提供。
5. 用 `minHeight` 或 `fill` 给它一个真实高度，让环在盒子里居中。
6. 同一次改动里删掉旧的本地样式（`__state` 的 loading 规则、`.spin`、keyframes）。
7. 跑改动页面的测试，再跑 `pnpm typecheck` 和 `pnpm build`。

## 守卫

`platform/ui/components/loading/loadingStandard.test.ts` 扫描仓库，以下情况直接失败：

- `loadingState.css` 之外出现第二个 `rotate(360deg)` 动画；
- 组件从 lucide 引入 `Loader2` / `LoaderCircle`；
- 任何样式表定义 `.spin` 动画类。

如果守卫挡住了合理需求，就连同组件、CSS、测试和这份文档一起扩展标准，而不是加例外。
