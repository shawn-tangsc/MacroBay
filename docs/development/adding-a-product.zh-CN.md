[English](./adding-a-product.md) | [中文](./adding-a-product.zh-CN.md)

# 新增产品

产品是通过 manifest 注册的可拆卸模块。平台不应该知道它的领域。

## 1. 创建模块

```text
products/<product-id>/
  product.manifest.ts
  service/
    bootstrap.ts
  desktop/
    pages/
```

最小产品可以只有 manifest 和一个页面。

## 2. 声明 manifest

manifest 描述 shell 需要加载什么：

- 产品 id 和显示名；
- 菜单项和页面；
- 设置面板；
- service bootstrap；
- 智能体 seed 或产品工具。

贡献 id 要保持稳定。重命名页面或设置面板会改变深链接和已保存的偏好。

## 3. 添加 service bootstrap

如果产品拥有后台工作，通过产品 service seam 注册。定时任务使用平台 job runtime；不要新增本地
interval 或第二个队列。

bootstrap 接收平台依赖（供应商状态、语言、任务、存储），而不是自己构造另一份。

## 4. 添加页面

产品页面放在产品的 `desktop` 目录下。页面应使用平台 UI 约定、主题 token 和产品自己的 i18n 文案。

shell 通过生成注册表加载页面，不直接 import。

## 5. 生成并运行

```bash
pnpm generate:products
pnpm dev
```

确认菜单项、页面和设置贡献只在产品存在时出现。

## 6. 测试删除

1. 删除 `products/<product-id>`。
2. 重新生成注册表。
3. 启动应用。

shell 必须仍能启动。如果失败，说明还有平台或 shell 文件 import 该产品。

## 7. 添加测试

至少覆盖：

- manifest 和生成注册表投影；
- 使用假依赖的 service bootstrap；
- 主路由的页面渲染；
- 如果产品贡献关键接缝，加删除/边界保护。

## 下一步

- [平台与产品](../platform/platform-and-products.zh-CN.md)
- [测试](./testing.zh-CN.md)
- [架构](../platform/architecture.zh-CN.md)
