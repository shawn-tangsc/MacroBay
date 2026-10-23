[English](./platform-and-products.md) | [中文](./platform-and-products.zh-CN.md)

# 平台与产品

MacroBay 的拆分目标是：即使删掉内置的 market-intelligence 产品，桌面 shell 和 AI 平台仍然可用。

## 规则

```text
platform 不得 import products
products 可以 import platform
apps/desktop-shell 通过 manifest 加载 products
```

这是依赖规则，不是目录习惯。平台一旦开始 import 产品，产品就不再可拆卸。

## 产品贡献什么

产品通过 manifest 声明自己的贡献，可能包括：

- 侧栏菜单项；
- 设置面板；
- service bootstrap 和 IPC 契约；
- 工作区页面；
- 智能体 seed 和产品工具。

shell 读取生成的产品注册表：

```bash
pnpm generate:products
```

生成器写出 `products/generated/*`。这些文件被忽略，并由标准脚本重新生成。

## 删除产品

1. 删除 `products/<product-id>`。
2. 执行 `pnpm generate:products`。
3. 启动应用。

shell 仍应能启动。属于该产品的页面、菜单和设置会一起消失。如果 `platform` 或
`apps/desktop-shell` 里还有硬编码 import，说明边界已经破了。

## 新增产品

一个最小产品需要：

- `product.manifest.ts`：id、显示名、页面、设置、智能体、服务；
- 如果拥有后台工作，需要 service bootstrap；
- 如果有 UI，需要桌面页面；
- 针对契约和投影的测试。

可以参考现有产品理解契约，但不要复制领域逻辑。产品专属的提示词、数据源和工作流留在产品内。

## 共享代码

只有当一个能力被至少一个产品真正需要、并且领域中立时，才放进 `platform`。不要为了避免循环依赖
而把产品词汇搬进平台。

## 生成文件

不要手改 `products/generated/*`。它是构建产物。注册表看起来过期时，重新运行生成器并重启开发服务器。

## 下一步

- [架构](./architecture.zh-CN.md)
- [开发环境](../development/setup.zh-CN.md)
- [新增产品](../development/adding-a-product.zh-CN.md)
