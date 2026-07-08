import { BadgeCheck, Info } from 'lucide-react'
import { formatCurrency } from '../utils/formatters.js'

function ComparisonTable({ result }) {
  return (
    <>
      <div className="table-scroll">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>商品</th>
              <th>数量</th>
              {result.suppliers.map((supplier) => (
                <th key={supplier.id}>{supplier.name}</th>
              ))}
              <th>结论</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="item-name">{item.normalizedName}</div>
                  <div className="item-sub">
                    {item.brand || '品牌待确认'} · {item.specification}
                  </div>
                </td>
                <td>
                  {item.quantity} {item.unit}
                </td>
                {result.suppliers.map((supplier) => {
                  const quote = item.quotes.find((entry) => entry.supplierId === supplier.id)
                  const isLowest = supplier.id === item.lowestSupplierId
                  const isWarning = quote && (!quote.taxIncluded || quote.specMismatch)

                  return (
                    <td
                      key={supplier.id}
                      className={`quote-cell ${isLowest ? 'is-lowest' : ''} ${!quote?.matched ? 'is-missing' : ''} ${isWarning ? 'is-warning' : ''}`}
                    >
                      {quote?.matched ? (
                        <>
                          <div className="quote-price">
                            {formatCurrency(quote.unitPrice)}
                            {isLowest ? (
                              <span className="tag green">
                                <BadgeCheck size={13} />
                                最低
                              </span>
                            ) : null}
                          </div>
                          <div className="quote-meta">
                            总价 {formatCurrency(quote.totalPrice)}
                            <br />
                            {quote.taxIncluded ? '含税' : '未含税'} · 运费{' '}
                            {formatCurrency(quote.shippingFee)}
                            <br />
                            交期 {quote.deliveryDays} 天 · 置信度{' '}
                            {Math.round(quote.confidence * 100)}%
                            {quote.specMismatch ? (
                              <>
                                <br />
                                <span className="tag amber">规格不一致</span>
                              </>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <strong>漏报</strong>
                      )}
                    </td>
                  )
                })}
                <td>{item.warning || `最低价为 ${formatCurrency(item.lowestPrice)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-note">
        <Info size={15} />
        表格按标准化商品对齐；规格、税费、运费口径不一致时会单独标记。
      </div>
    </>
  )
}

export default ComparisonTable
