import { Package } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { ProductAgentToolPackageEditorView } from '@platform/ai/agent-platform/productTools/productAgentToolViewModel'
import type { LocalizedText } from '@platform/product-manifest'

import type { AgentText } from '../../../agentText'
import { useAgentLanguage } from '../../../agentTextProvider'
import { EmptyCatalog } from './EmptyCatalog'
import { ProductToolPackageCard } from './ProductToolPackageCard'
import { filterProductToolPackages } from './productToolPackageFilter'

type ProductToolPackagePermissionMode = ProductAgentToolPackageEditorView['permissionMode']

type ProductToolPackagesCatalogProps = {
  text: AgentText
  agentId: string
  search: string
}

export function ProductToolPackagesCatalog({
  text,
  agentId,
  search
}: ProductToolPackagesCatalogProps): React.ReactElement {
  const language = useAgentLanguage()
  const [packages, setPackages] = useState<ProductAgentToolPackageEditorView[]>([])
  const [productNames, setProductNames] = useState<Readonly<Record<string, LocalizedText>>>({})

  useEffect(() => {
    if (!agentId) {
      setPackages([])
      return
    }

    let cancelled = false
    void window.platform.agents.productTools.listPackages(agentId).then((rows) => {
      if (cancelled) return
      setPackages((rows as ProductAgentToolPackageEditorView[]) ?? [])
    })

    return () => {
      cancelled = true
    }
  }, [agentId])

  // 产品显示名来自产品清单；拿不到时回退到 productId，不影响其余信息。
  useEffect(() => {
    const getSummaries = window.platform.app?.getProductSummaries
    if (typeof getSummaries !== 'function') return

    let cancelled = false
    void Promise.resolve()
      .then(() => getSummaries.call(window.platform.app))
      .then((summaries: ReadonlyArray<{ id: string; name?: LocalizedText }>) => {
        if (cancelled || !Array.isArray(summaries)) return
        setProductNames(
          Object.fromEntries(summaries.filter((item) => item.name).map((item) => [item.id, item.name as LocalizedText]))
        )
      })
      .catch(() => {
        if (!cancelled) setProductNames({})
      })

    return () => {
      cancelled = true
    }
  }, [])

  const visiblePackages = useMemo(
    () => filterProductToolPackages(packages, productNames, search),
    [packages, productNames, search]
  )

  function changePermission(productId: string, permissionMode: ProductToolPackagePermissionMode): void {
    const previous = packages.find((pkg) => pkg.productId === productId)?.permissionMode
    setPackages((current) =>
      current.map((pkg) => (pkg.productId === productId ? { ...pkg, permissionMode } : pkg))
    )
    void window.platform.agents.productTools
      .updatePackageBinding(agentId, productId, permissionMode)
      .catch(() => {
        // 写入失败时回滚，避免界面停在一个没有真正生效的权限上。
        if (!previous) return
        setPackages((current) =>
          current.map((pkg) => (pkg.productId === productId ? { ...pkg, permissionMode: previous } : pkg))
        )
      })
  }

  if (visiblePackages.length === 0) {
    return (
      <EmptyCatalog
        icon={<Package size={17} />}
        title={text.editor.tools.noProductToolPackagesTitle}
        description={text.editor.tools.noProductToolPackagesDescription}
      />
    )
  }

  return (
    <div className="agent-product-packages">
      {visiblePackages.map((row) => (
        <ProductToolPackageCard
          key={row.package.productId}
          text={text}
          language={language}
          package={row.package}
          productName={row.productName}
          tools={row.tools}
          filtered={row.filtered}
          onPermissionChange={(permissionMode) => changePermission(row.package.productId, permissionMode)}
        />
      ))}
    </div>
  )
}
