/**
 * 「这个数从哪来、怎么算的」——给 agent 的只读工具（设计 144）。
 *
 * 与其它只读工具一样，它只读事实与口径，不触发分析、也不要时间边界：口径是**现在**的 owner 值，
 * 不是某个历史时点的快照。不带 `family` 调用时返回**索引**（有哪些族可查），带上族名则返回该族的
 * 来源、观测时刻、算式与这次真正用到的数字。
 */
export const provenanceExplainTool = Object.freeze({
  id: 'explain_figure',
  readOnly: true,
  requiresTemporalBoundary: false,
  handlerId: 'market-intelligence.explain-figure'
})
