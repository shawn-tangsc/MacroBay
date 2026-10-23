import type { EvidenceSnapshot } from './marketAnalysisContracts'

const profileId: EvidenceSnapshot['profileId'] = 'crypto-market-analysis-v1'
void profileId

// @ts-expect-error The data-access profile is a fixed V1 contract, not any string.
const unsupportedProfileId: EvidenceSnapshot['profileId'] = 'another-profile'
void unsupportedProfileId
