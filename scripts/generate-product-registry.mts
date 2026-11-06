import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateProductRegistryArtifacts } from '../platform/product-registry/generate'
import { publishGeneratedArtifacts } from '../platform/product-registry/publishArtifacts'
import { ProductRegistryValidationError } from '../platform/product-registry/validate'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(workspaceRoot, 'products/generated')
const ARTIFACTS = ['productManifests.ts', 'shellRegistry.ts', 'productServices.ts', 'productAgentSeeds.ts'] as const

/**
 * 生成到临时目录，再只把**内容变了**的文件落到 `products/generated`。
 *
 * 直接让生成器写盘，会让一次「内容一字没变」的 `pnpm generate:products` 也刷新 mtime——而全量
 * 关账那轮把运行期间被写过的文件算作污染，mtime 变了就整轮作废。判据不在“跑了几次”，在“第二次
 * 跑完树还是不是原样”：所以先算内容、逐字节比较，相同就一个字节都不写。
 */
async function main(): Promise<void> {
  const stagingDir = mkdtempSync(join(tmpdir(), 'macrobay-product-registry-'))
  try {
    await generateProductRegistryArtifacts({ workspaceRoot, outputDir: stagingDir })
    mkdirSync(outputDir, { recursive: true })
    const { written, unchanged } = publishGeneratedArtifacts(stagingDir, outputDir, ARTIFACTS)
    if (written.length === 0) {
      console.log(`product registry unchanged (${unchanged.length} files untouched)`)
      return
    }
    console.log(
      `product registry written: ${written.join(', ')}` +
        (unchanged.length > 0 ? `; unchanged: ${unchanged.join(', ')}` : '')
    )
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}

void main().catch((error: unknown) => {
  if (error instanceof ProductRegistryValidationError) {
    console.error(error.message)
    process.exit(1)
  }

  console.error(error)
  process.exit(1)
})
