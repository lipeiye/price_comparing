exports.quoteAnalysisSchema = {
  success: true,
  suppliers: [{ id: 'supplier-a', name: '供应商 A' }],
  items: [
    {
      id: 'item-001',
      name: '原始商品名',
      normalizedName: '标准商品名',
      specification: '规格',
      brand: '品牌或 null',
      quantity: 1,
      unit: '单位',
      quotes: [
        {
          supplierId: 'supplier-a',
          unitPrice: 0,
          totalPrice: 0,
          taxIncluded: true,
          shippingFee: 0,
          deliveryDays: 0,
          matched: true,
          confidence: 0.95,
          specMismatch: false,
        },
      ],
      lowestSupplierId: 'supplier-a',
      lowestPrice: 0,
      averagePrice: 0,
      warning: '异常说明或空字符串',
    },
  ],
  warnings: [
    {
      id: 'warning-001',
      type: 'PRICE_OUTLIER',
      severity: 'high',
      title: '明显高价',
      message: '面向采购人员的中文说明',
    },
  ],
  summary: '中文采购建议',
}
