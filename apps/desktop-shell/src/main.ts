/**
 * Desktop Shell Main 入口。
 *
 * 产品发现规则：
 * - 仅允许 import 生成的 `@products/generated/*` 聚合产物
 * - 禁止直接 import 具体产品实现目录（见 shellProductDiscoveryBoundary.test.ts）
 */
import { installStdioBrokenPipeGuard } from '@platform/desktop/main/stdioBrokenPipeGuard'
import { bootstrapDesktopApp } from '@platform/desktop/main/app'
import { productManifests } from '@products/generated/productManifests'
import { productAgentSeedFactories } from '@products/generated/productAgentSeeds'
import { registerProductServices } from '@products/generated/productServices'

installStdioBrokenPipeGuard()

void bootstrapDesktopApp({ productManifests, productAgentSeedFactories, registerProductServices })
