import { BadgeCheck, AlertTriangle } from 'lucide-react'
import { formatPrice } from '../utils/formatters.js'

// 比价表：按项目号把同一项目跨家对齐成一行，逐家显示总价 + 成本拆分，
// 最低价高亮，漏报价显式标"漏报"，总价量级差异大的整行标"口径存疑"。
function ComparisonTable({ result }) {
  return (
    <>
      <div className="table-scroll">
        <table className="comparison-table">
          <thead>
            <tr>
              <th className="col-project">项目号</th>
              <th className="col-type">类型</th>
              {result.suppliers.map((supplier) => (
                <th key={supplier.id}>{supplier.name}</th>
              ))}
              <th className="col-verdict">结论</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((item) => {
              const caliberSuspect =
                item.pricedCount >= 2 &&
                item.lowestPrice != null &&
                item.highestPrice / item.lowestPrice >= 2

              return (
                <tr key={item.id} className={caliberSuspect ? 'is-caliber-suspect' : ''}>
                  <td>
                    <div className="item-project">{item.projectNo}</div>
                  </td>
                  <td>
                    <div className="item-type">{item.name || '-'}</div>
                  </td>
                  {result.suppliers.map((supplier) => {
                    const quote = item.quotes.find((entry) => entry.supplierId === supplier.id)
                    const isLowest = supplier.id === item.lowestSupplierId

                    return (
                      <td
                        key={supplier.id}
                        className={`quote-cell ${isLowest ? 'is-lowest' : ''} ${
                          !quote?.matched ? 'is-missing' : ''
                        }`}
                      >
                        {quote?.matched ? (
                          <QuoteDetail quote={quote} isLowest={isLowest} />
                        ) : (
                          <strong className="missing-tag">漏报</strong>
                        )}
                      </td>
                    )
                  })}
                  <td>
                    <VerdictCell item={item} suppliers={result.suppliers} caliberSuspect={caliberSuspect} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="table-note">
        <AlertTriangle size={15} />
        同一项目号跨家对齐；总价差距 ≥ 2 倍的行标为「口径存疑」，需逐家核实含税/分摊口径。
      </div>
    </>
  )
}

// 单家报价单元格：总价（最低则标记）+ 成本拆分明细
function QuoteDetail({ quote, isLowest }) {
  const cost = quote.costBreakdown || {}
  const costParts = [
    cost.rawLamp != null && { label: '毛坯', value: cost.rawLamp },
    cost.driver != null && { label: '驱动', value: cost.driver },
    cost.ledModule != null && { label: 'LED', value: cost.ledModule },
    cost.controller != null && { label: '控制', value: cost.controller },
    cost.felt != null && { label: '毛毡', value: cost.felt },
  ].filter(Boolean)

  return (
    <>
      <div className="quote-price">
        {formatPrice(quote.totalPrice)}
        {isLowest ? (
          <span className="tag green">
            <BadgeCheck size={13} />
            最低
          </span>
        ) : null}
      </div>
      {costParts.length > 0 ? (
        <div className="quote-cost">
          {costParts.map((part) => (
            <span key={part.label} className="cost-chip">
              {part.label} {formatPrice(part.value)}
            </span>
          ))}
        </div>
      ) : null}
    </>
  )
}

function VerdictCell({ item, suppliers, caliberSuspect }) {
  const lowestName =
    suppliers.find((s) => s.id === item.lowestSupplierId)?.name || ''
  const parts = []
  if (item.pricedCount === 0) {
    return <span className="verdict-none">三家均未报价</span>
  }
  parts.push(
    <span key="lowest">
      最低 <strong>{lowestName}</strong>
    </span>,
  )
  if (item.missingCount > 0) {
    parts.push(
      <span key="missing" className="verdict-missing">
        {item.missingCount} 家漏报
      </span>,
    )
  }
  if (caliberSuspect) {
    parts.push(
      <span key="caliber" className="verdict-caliber">
        口径存疑
      </span>,
    )
  }
  return <div className="verdict-list">{parts}</div>
}

export default ComparisonTable
