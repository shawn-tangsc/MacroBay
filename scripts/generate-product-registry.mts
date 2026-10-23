import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateProductRegistryArtifacts } from '../platform/product-registry/generate'
import { ProductRegistryValidationError } from '../platform/product-registry/validate'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

void generateProductRegistryArtifacts({ workspaceRoot }).catch((error: unknown) => {
  if (error instanceof ProductRegistryValidationError) {
    console.error(error.message)
    process.exit(1)
  }

  console.error(error)
  process.exit(1)
})
