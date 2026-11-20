import type { CredentialProbeFailureCode } from './credentialedProviderProbes'

import {
  cryptoEtfAssetMetadata,
  cryptoEtfSourcePolicy,
  type CryptoEtfAssetKey,
  type CryptoEtfAssetSymbol
} from './cryptoEtfSourcePolicy'

/**
 * 解析 `/api/v1/flows/{asset}/funds`。这个口**只含已定稿交易日**，所以它同时承担三态分离：
 *
 * - 有这一行、逐基金非空、合计 0 → **真的是 0**，落一行 0；
 * - 有这一行、逐基金非空、合计非 0 → 正常交易日；
 * - 没有这一行 → 未定稿或非交易日，**不落行**（读数里没有这一天，不是 0）。
 *
 * 另外两道防线，防的是供应商以后改形状时不声不响地污染序列：
 * 周末行一律丢弃（哪怕它带了基金）；`funds` 为空的行按「不是交易日/占位」丢弃。
 * 读数取 `totalUsdM`；逐基金只用于对账，**绝不自己加总当读数**（实测 11-09 total -201.1、
 * 逐基金四舍五入后 -201.0）。
 */
export type CryptoEtfSettledDay = Readonly<{
  tradingDate: string
  /** 整数美元：`Math.round(netFlowUsdM * 1e6)`。源只有 0.1M 精度。 */
  netFlowUsd: number
  fundCount: number
}>

export type CryptoEtfFundsAudit = Readonly<{
  symbol: CryptoEtfAssetSymbol
  windowDays: number
  rows: number
  settledRows: number
  droppedWeekendRows: number
  droppedRowsWithoutFunds: number
  /** `total = 0` 且逐基金全零/为空：节假日或占位，无法与真 0 区分，不落行。 */
  droppedUndecidableZeroRows: number
  fundSumMismatches: number
  latestTradingDate: string
}>

/** 失败原因同样取自共享闭集；`no-settled-rows` 只在本模块内部流转。 */
export type CryptoEtfFundsParseReason =
  | Extract<CredentialProbeFailureCode, 'response-shape-invalid'>
  | 'no-settled-rows'

export type CryptoEtfFundsParseResult =
  | Readonly<{ state: 'available'; days: readonly CryptoEtfSettledDay[]; audit: CryptoEtfFundsAudit }>
  | Readonly<{ state: 'unavailable'; reason: CryptoEtfFundsParseReason }>

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const topLevelKeys = Object.freeze(['symbol', 'asset', 'windowDays', 'days', 'updatedAt'])
const dayKeys = Object.freeze(['date', 'totalUsdM', 'funds'])
const fundKeys = Object.freeze(['ticker', 'issuer', 'netFlowUsdM'])

export function parseCryptoEtfFundsResponse(body: string, asset: CryptoEtfAssetKey): CryptoEtfFundsParseResult {
  try {
    const parsed = parseEnvelope(body, asset)
    return parsed ?? { state: 'unavailable' as const, reason: 'response-shape-invalid' as const }
  } catch {
    return { state: 'unavailable' as const, reason: 'response-shape-invalid' as const }
  }
}

function parseEnvelope(body: string, asset: CryptoEtfAssetKey): CryptoEtfFundsParseResult | undefined {
  const value: unknown = JSON.parse(body)
  if (!isPlainRecord(value) || !hasExactKeys(value, topLevelKeys)) return undefined
  const expected = cryptoEtfAssetMetadata[asset]
  if (value.symbol !== expected.symbol) return undefined
  if (value.asset !== expected.responseAsset) return undefined
  if (!isInteger(value.windowDays) || value.windowDays < 1 || value.windowDays > 365) return undefined
  if (typeof value.updatedAt !== 'string' || value.updatedAt.length === 0) return undefined
  if (!Array.isArray(value.days) || value.days.length === 0 || value.days.length > cryptoEtfSourcePolicy.maximumRowsPerAsset) return undefined

  const seen = new Set<string>()
  const raw: { tradingDate: string; totalUsdM: number; funds: unknown[] }[] = []
  for (const entry of value.days) {
    const day = parseDay(entry)
    if (!day) return undefined
    if (seen.has(day.tradingDate)) return undefined
    seen.add(day.tradingDate)
    raw.push(day)
  }
  raw.sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))

  let droppedWeekendRows = 0
  let droppedRowsWithoutFunds = 0
  let droppedUndecidableZeroRows = 0
  let fundSumMismatches = 0
  const days: CryptoEtfSettledDay[] = []
  for (const day of raw) {
    if (isWeekend(day.tradingDate)) {
      droppedWeekendRows += 1
      continue
    }
    if (day.funds.length === 0) {
      // 未定稿/非交易日：不落行。绝不能把它写成 0。
      droppedRowsWithoutFunds += 1
      continue
    }
    // 按行内容判，不按日期判：合计为零、且逐基金也全零，就是「节假日/占位」与「真 0」不可分的那一档，
    // 不落行（宁可少一天，也不给假 0）。合计为零但有基金非零，是进出抵消的真 0，照常落 0。
    if (day.totalUsdM === 0 && !(day.funds as { netFlowUsdM: number }[]).some((fund) => fund.netFlowUsdM !== 0)) {
      droppedUndecidableZeroRows += 1
      continue
    }
    const netFlowUsd = toUsd(day.totalUsdM)
    if (netFlowUsd === undefined) return undefined
    if (Math.abs(sumFunds(day.funds) - day.totalUsdM) > cryptoEtfSourcePolicy.fundSumToleranceUsdMillions) fundSumMismatches += 1
    days.push(Object.freeze({ tradingDate: day.tradingDate, netFlowUsd, fundCount: day.funds.length }))
  }
  if (days.length === 0) return { state: 'unavailable' as const, reason: 'no-settled-rows' as const }

  return Object.freeze({
    state: 'available' as const,
    days: Object.freeze(days),
    audit: Object.freeze({
      symbol: expected.symbol,
      windowDays: value.windowDays,
      rows: raw.length,
      settledRows: days.length,
      droppedWeekendRows,
      droppedRowsWithoutFunds,
      droppedUndecidableZeroRows,
      fundSumMismatches,
      latestTradingDate: days.at(-1)!.tradingDate
    })
  })
}

function parseDay(value: unknown): { tradingDate: string; totalUsdM: number; funds: unknown[] } | undefined {
  if (!isPlainRecord(value) || !hasExactKeys(value, dayKeys)) return undefined
  if (typeof value.date !== 'string' || !isTradingDate(value.date)) return undefined
  if (!isFiniteNumber(value.totalUsdM) || Math.abs(value.totalUsdM) > cryptoEtfSourcePolicy.maximumAbsoluteUsdMillions) return undefined
  if (!Array.isArray(value.funds) || value.funds.length > cryptoEtfSourcePolicy.maximumFundsPerDay) return undefined
  for (const fund of value.funds) {
    if (!isPlainRecord(fund) || !hasExactKeys(fund, fundKeys)) return undefined
    if (typeof fund.ticker !== 'string' || fund.ticker.trim().length === 0 || fund.ticker.length > 16) return undefined
    if (typeof fund.issuer !== 'string' || fund.issuer.length > 120) return undefined
    if (!isFiniteNumber(fund.netFlowUsdM) || Math.abs(fund.netFlowUsdM) > cryptoEtfSourcePolicy.maximumAbsoluteUsdMillions) return undefined
  }
  return { tradingDate: value.date, totalUsdM: value.totalUsdM, funds: value.funds }
}

function sumFunds(funds: readonly unknown[]): number {
  return (funds as { netFlowUsdM: number }[]).reduce((sum, fund) => sum + fund.netFlowUsdM, 0)
}

function toUsd(millions: number): number | undefined {
  const usd = Math.round(millions * 1_000_000)
  return Number.isSafeInteger(usd) ? usd : undefined
}

function isWeekend(tradingDate: string): boolean {
  const day = new Date(`${tradingDate}T00:00:00.000Z`).getUTCDay()
  return day === 0 || day === 6
}

function isTradingDate(value: string): boolean {
  if (!datePattern.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const allowed = [...keys].sort()
  return actual.length === allowed.length && actual.every((key, index) => key === allowed[index])
}
