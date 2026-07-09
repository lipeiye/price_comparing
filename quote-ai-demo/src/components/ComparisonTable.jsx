import { BadgeCheck, AlertTriangle } from 'lucide-react'
import { formatPrice } from '../utils/formatters.js'

// 比价表：按项目号把同一项目跨家对齐成一行，逐家显示总价 + 成本拆分，
// 最低价高亮，漏报价显式标"漏报"，总价量级差异大的整行标"口径存疑"。
function ComparisonTable({ result }) {
  const snapshot = makeProcurementSnapshot(result)

  return (
    <>
      <div className="procurement-snapshot" aria-label="采购速览">
        <div className="snapshot-card snapshot-leader">
          <span>采购优先</span>
          <strong>{snapshot.orderLeader.name}</strong>
          <small>{snapshot.orderLeader.note}</small>
        </div>
        <div className="snapshot-card">
          <span>已知首单金额</span>
          <strong>{formatPrice(snapshot.orderLeader.knownTotal)}</strong>
          <small>{snapshot.orderLeader.amountNote}</small>
        </div>
        <div className="snapshot-card snapshot-saving">
          <span>相对次优节省</span>
          <strong>{snapshot.knownSavings != null ? formatPrice(snapshot.knownSavings) : '待补数量'}</strong>
          <small>{snapshot.comparableItems}/{result.items.length} 项可直接比较</small>
        </div>
        <div className="snapshot-card snapshot-review">
          <span>优先核实</span>
          <strong>{snapshot.reviewItems}</strong>
          <small>漏报、规格或价格口径</small>
        </div>
      </div>
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
              const priceRanks = makePriceRanks(item.quotes)
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
                    const priceRank = priceRanks.get(supplier.id)
                    const isLowest = priceRank === 1

                    return (
                      <td
                        key={supplier.id}
                        className={`quote-cell ${isLowest ? 'is-lowest' : ''} ${
                          !quote?.matched ? 'is-missing' : ''
                        }`}
                      >
                        {quote?.matched ? (
                          <QuoteDetail quote={quote} priceRank={priceRank} />
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
        绿色为最低价，蓝色为次低价，灰色为第三低价；总价差距 ≥ 2 倍标为「口径存疑」，需核实含税/分摊口径。
      </div>
    </>
  )
}

// 单家报价单元格：总价 + 前三价格位次 + 成本拆分明细。
function QuoteDetail({ quote, priceRank }) {
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
        {priceRank === 1 ? (
          <span className="tag green">
            <BadgeCheck size={13} />
            最低
          </span>
        ) : priceRank === 2 ? (
          <span className="tag blue">次低</span>
        ) : priceRank === 3 ? (
          <span className="tag gray">第三低</span>
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
  const rankedQuotes = rankQuotes(item.quotes)
  const lowestIds = rankedQuotes.filter((q) => q.rank === 1).map((q) => q.supplierId)
  const lowestName = suppliers
    .filter((s) => lowestIds.includes(s.id))
    .map((s) => s.name)
    .join('、')
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

function makePriceRanks(quotes = []) {
  return new Map(rankQuotes(quotes).map((quote) => [quote.supplierId, quote.rank]))
}

function rankQuotes(quotes = []) {
  const priced = quotes
    .filter((quote) => quote?.matched && quote.totalPrice != null)
    .slice()
    .sort((a, b) => a.totalPrice - b.totalPrice)

  let lastPrice = null
  let rank = 0
  return priced.map((quote) => {
    if (quote.totalPrice !== lastPrice) {
      rank += 1
      lastPrice = quote.totalPrice
    }
    return { ...quote, rank }
  })
}

function makeProcurementSnapshot(result) {
  const wins = new Map(result.suppliers.map((supplier) => [supplier.id, 0]))
  let comparableItems = 0
  let reviewItems = 0

  for (const item of result.items) {
    const ranks = rankQuotes(item.quotes)
    const isComparable =
      ranks.length >= 2 &&
      item.lowestPrice != null &&
      item.highestPrice != null &&
      item.highestPrice / item.lowestPrice < 2

    if (isComparable) comparableItems += 1
    if (!isComparable || item.missingCount > 0) reviewItems += 1
    for (const quote of ranks.filter((quote) => quote.rank === 1)) {
      wins.set(quote.supplierId, (wins.get(quote.supplierId) || 0) + 1)
    }
  }

  const priceLeader = result.suppliers
    .map((supplier) => ({ name: supplier.name, wins: wins.get(supplier.id) || 0 }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))[0] || { name: '—', wins: 0 }

  const totals = result.procurementSummary?.supplierTotals || []
  const orderLeaderTotal = totals.find(
    (total) => total.supplierId === result.procurementSummary?.orderLeaderSupplierId,
  )
  const priceLeaderTotal = totals.find(
    (total) => total.supplierId === result.procurementSummary?.priceLeaderSupplierId,
  )
  const orderLeaderSupplier = result.suppliers.find(
    (supplier) => supplier.id === orderLeaderTotal?.supplierId,
  )
  const orderLeader = orderLeaderTotal
    ? {
      name: orderLeaderSupplier?.name || '—',
      knownTotal: orderLeaderTotal.knownFirstOrderTotal,
      note: '按已知首单总额领先',
      amountNote: `${orderLeaderTotal.knownAmountItems} 项含数量${orderLeaderTotal.missingQuantityItems ? ` · ${orderLeaderTotal.missingQuantityItems} 项待补数量` : ''}`,
    }
    : {
      name: priceLeader.name,
      knownTotal: priceLeaderTotal?.knownFirstOrderTotal ?? null,
      note: `${priceLeader.wins} 项最低价`,
      amountNote: priceLeaderTotal?.knownAmountItems
        ? `仅 ${priceLeaderTotal.knownAmountItems} 项可算，暂不可横向比较`
        : '首单数量待补齐',
    }

  return {
    orderLeader,
    knownSavings: result.procurementSummary?.knownOrderSavings ?? null,
    comparableItems,
    reviewItems,
  }
}

export default ComparisonTable
