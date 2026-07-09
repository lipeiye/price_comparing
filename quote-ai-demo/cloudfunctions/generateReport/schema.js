// 精简双语报告结构：表格字段为主，禁止七章长文。
exports.reportSchema = {
  verdict: {
    zh: '一句话结论：推荐谁、备选谁、最大风险',
    en: 'One-line verdict: recommend / backup / top risk',
  },
  ranking: [
    {
      rank: 1,
      supplier: '供应商名',
      lowestWins: 12,
      note: { zh: '整体最低', en: 'Overall lowest' },
    },
  ],
  keyGaps: [
    {
      projectNo: '26-0221_01',
      lowest: '供应商A',
      highest: '供应商C',
      gapPct: 35,
      note: { zh: '价差过大', en: 'Wide spread' },
    },
  ],
  specIssues: [
    {
      projectNo: '26-0221_02',
      supplier: '供应商B',
      issue: { zh: '毛毡 12→9mm', en: 'Felt 12→9mm' },
    },
  ],
  nextSteps: [{ zh: '让最低价方出样', en: 'Sample from lowest bidder' }],
  risks: [{ zh: '部分项目口径不一', en: 'Mixed quote basis on some items' }],
}
