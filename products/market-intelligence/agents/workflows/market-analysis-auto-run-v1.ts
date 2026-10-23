export const marketAnalysisAutoRunWorkflowV1 = Object.freeze({
  id: 'market-analysis-auto-run-v1',
  version: 1,
  trigger: 'market-intelligence.change',
  writes: ['market-analysis.snapshot', 'market-analysis.run', 'market-analysis.timeline'],
  ordinaryChatMessages: false
})
