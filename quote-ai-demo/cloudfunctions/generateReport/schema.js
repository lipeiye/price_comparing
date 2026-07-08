// 详细分析报告的输出结构。AI 必须返回这些章节。
exports.reportSchema = {
  executiveSummary: '执行摘要：3-5 句，整体结论 + 推荐供应商 + 关键风险',
  priceAnalysis: {
    overallRanking: [
      { supplier: '供应商名', rank: 1, avgPriceLevel: '整体均价水平描述', note: '简评' },
    ],
    spreadInsights: ['价差最大的项目及原因推测，逐条'],
    costPerformance: '结合价格与规格符合度的性价比评价',
  },
  specAudit: [
    {
      projectNo: '26-0221_01',
      findings: [
        {
          supplier: '供应商名',
          issue: '擅自改了什么（如毛毡厚度 12→9mm）',
          originalSpec: '原要求',
          impact: '对可比性的影响',
        },
      ],
    },
  ],
  costBreakdown: '各供应商成本结构分析：原材料/驱动/LED/控制器谁贵、差异与异常',
  toolingAnalysis: '模具费分摊逻辑、单件成本、返还条件、对总成本影响',
  recommendation: {
    selection: '选型建议：推荐哪家、备选哪家及理由',
    negotiation: ['谈判筹码：基于价差和规格差异可施压的具体点，逐条'],
    nextSteps: '下一步行动建议（样品阶段安排等）',
  },
  risks: ['2-4 个风险点，每个一句话，逐条'],
}
