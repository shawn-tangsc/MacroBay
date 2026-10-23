import { describe, expect, it } from 'vitest'

import { platformText } from '../i18n/platformText'

import {
  formatModelSyncFailureText,
  resolveModelSyncFailureDetail,
  resolveModelSyncReasonText,
  sanitizeIpcErrorMessage
} from './modelServiceSyncError'

const models = platformText['en-US'].models

describe('PLAT-61 model sync friendly errors', () => {
  it('strips the Electron IPC prefix, channel names and URLs', () => {
    const raw = new Error(
      "Error invoking remote method 'platform:model-providers-preview-model-sync': Error: request to https://api.example.test/v1/models failed"
    )
    const text = sanitizeIpcErrorMessage(raw)

    expect(text).not.toContain('Error invoking remote method')
    expect(text).not.toContain('platform:')
    expect(text).not.toContain('https://')
    expect(text).toContain('failed')
  })

  it('returns null for an empty message instead of leaking a prefix', () => {
    expect(sanitizeIpcErrorMessage(new Error("Error invoking remote method 'platform:x': Error: "))).toBeNull()
    expect(sanitizeIpcErrorMessage(null)).toBeNull()
  })

  it('maps every structured reason code to a human sentence', () => {
    const cases: Array<[string, string]> = [
      ['provider_disabled', models.connectionCheckReasonProviderDisabled],
      ['missing_api_key', models.connectionCheckReasonMissingApiKey],
      ['invalid_base_url', models.modelSyncReasonInvalidBaseUrl],
      ['unauthorized', models.connectionCheckReasonUnauthorized],
      ['timeout', models.connectionCheckReasonTimeout],
      ['network', models.modelSyncReasonNetwork],
      ['provider_not_found', models.modelSyncReasonProviderNotFound],
      ['http_500', models.connectionCheckReasonHttp(500)],
      ['model_list_unsupported', models.modelSyncReasonModelListUnsupported],
      ['something-else', models.modelSyncReasonUnknown]
    ]

    for (const [code, expected] of cases) {
      const text = resolveModelSyncReasonText(code, models)
      expect(text, code).toBe(expected)
      expect(text, code).not.toContain('platform:')
    }
    expect(formatModelSyncFailureText('unauthorized', models)).toBe(
      `${models.fetchModelsFailed}${models.connectionCheckReasonUnauthorized}`
    )
    // PLAT-66：「不支持模型列表」是能力说明，不是失败 ⇒ 不加「获取模型列表失败」前缀。
    expect(formatModelSyncFailureText('model_list_unsupported', models))
      .toBe(models.modelSyncReasonModelListUnsupported)
    // 「未知错误」必须附原始信息；可归类失败不重复展示通用兜底串。
    expect(resolveModelSyncFailureDetail({ reasonCode: 'unknown', message: 'Model sync failed.' }, models))
      .toBe('Model sync failed.')
    expect(resolveModelSyncFailureDetail({ reasonCode: 'http_401', message: 'Model sync failed.' }, models)).toBeNull()
  })
})
