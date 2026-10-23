type DescriptorId = 'macro-calendar-0xrouter-economic-data'

export type ZeroXRouterProviderIndicatorLink = Readonly<{
  descriptorId: DescriptorId
  indicatorId: string
  countryCode: 'US'
  period: 'monthly' | 'quarterly'
  unit: 'percent' | 'thousands'
  evidenceHash: string
}>

export const zeroXRouterProviderIndicatorLinks: readonly ZeroXRouterProviderIndicatorLink[] = Object.freeze([])

export function findZeroXRouterProviderIndicatorLink(input: Readonly<{
  descriptorId: string
  indicatorId: string
  countryCode: string
  period: string
  unit: string
}>): ZeroXRouterProviderIndicatorLink | undefined {
  return zeroXRouterProviderIndicatorLinks.find((link) =>
    link.descriptorId === input.descriptorId && link.indicatorId === input.indicatorId &&
    link.countryCode === input.countryCode && link.period === input.period && link.unit === input.unit)
}
