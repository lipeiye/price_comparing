// AI 只返回：补充异常（重点规格被改）+ 精炼双语采购建议。
// 比价表/价格/最低价/漏报/量级/模具费全部由代码计算。
exports.quoteAnalysisSchema = {
  warnings: [
    {
      id: 'warning-101',
      type: 'SPEC_CHANGED',
      severity: 'high',
      title: '规格被供应商擅自修改',
      message: '写明项目号、哪家、改了什么、原要求是什么',
    },
  ],
  summary: {
    zh: '2-3 句中文：谁整体最低、异常数、下一步',
    en: '2-3 English sentences: overall lowest, issue count, next step',
  },
}
