import { useEffect, useState } from 'react'

import { testSourceConnection } from '../../shared/intelligenceSourceTest'
import type { SourceView } from '../../../service/intelligence/application/sourceProjection'

export type SourceRowTestState = 'testing' | 'ok' | 'failed' | 'unsupported'

/**
 * 行内连通性测试的状态机（读者 2026-11-12：每个已经接了的源都要能测）。
 *
 * 一个源一格：测 A 不影响 B；换来源（providerId 变）时整块清空，免得上一个来源的
 * 「通 / 不通」跟到下一个来源的行上。
 *
 * 单独成文件是因为 `ProviderDetail.tsx` 已经贴着 500 行上限——门禁是「只减不增」，
 * 新逻辑不往里塞，抽成聚焦的 hook。
 */
export function useSourceRowTests(providerId: string): Readonly<{
  stateOf: (sourceId: string) => SourceRowTestState | undefined
  run: (source: SourceView) => Promise<void>
}> {
  const [states, setStates] = useState<Record<string, SourceRowTestState>>({})

  useEffect(() => {
    setStates({})
  }, [providerId])

  async function run(source: SourceView): Promise<void> {
    setStates((current) => ({ ...current, [source.sourceId]: 'testing' }))
    let outcome: SourceRowTestState = 'failed'
    try {
      const result = await testSourceConnection(source)
      outcome = result.ok ? 'ok' : result.unsupported === true ? 'unsupported' : 'failed'
    } catch {
      outcome = 'failed'
    }
    setStates((current) => ({ ...current, [source.sourceId]: outcome }))
  }

  return {
    stateOf: (sourceId) => states[sourceId],
    run
  }
}
