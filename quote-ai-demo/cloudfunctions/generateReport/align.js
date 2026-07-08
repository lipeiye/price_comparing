// 结构化比价对齐引擎（纯逻辑，零依赖）。
// 设计目标：三家"同一模板但列布局不同"的报价单（有的供应商合并/左移列），
// 靠「表头文字」识别字段列，再按项目号（如 26-0221_01）把同一项目跨家对齐到一行。
// 这是比价表「永不为空」的保证——不依赖 AI 心情，纯代码算出最低/最高/均价、漏报、量级异常。

// 归一化表头文字：去括号注释、去换行、小写、压缩空白。
function normalizeHeader(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/[（(][^)）]*[)）]/g, '') // 去掉中英文括号注释
    .replace(/\s+/g, ' ')
    .trim()
}

// 字段 -> 候选表头文字（已归一化）。按优先级排列，用于按表头识别列。
// 这些候选取自真实模板的表头行（JOM/LBB/Granda 的第 10 行）。
const FIELD_HEADERS = {
  projectNo: ['lz project no', 'project no'],
  supplierRef: ['supplier reference no'],
  itemName: ['lamp type'],
  functionDesc: ['function'],
  rawLamp: ['raw lamp', 'raw lamp (exw)', 'raw lamp (exw)+led module'],
  driver: ['driver'],
  ledModule: ['led module'],
  controller: ['controller'],
  remotePrice: ['remote control', 'remote'],
  feltPrice: ['felt price', 'felt'],
  emcFilter: ['emc filter (if needed)', 'emc filter'],
  totalPrice: ['total price exw', 'total price'],
  toolingExisting: ['tooling exisiting yes/ no', 'tooling exisiting', 'tooling existing'],
  toolingCost: ['tooling cost'],
  quantity: ['1st order quantity', 'order quantity'],
}

// 价格相关字段（用于界定"价格区域"和成本拆分）
const PRICE_FIELDS = [
  'rawLamp',
  'driver',
  'ledModule',
  'controller',
  'remotePrice',
  'feltPrice',
  'emcFilter',
  'totalPrice',
]

// 找到表头行：第一个同时含有"项目号"和"灯型"类关键词的行。
function detectHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const joined = normalizeHeader(rows[i].join(' '))
    if (
      (joined.includes('project no') || joined.includes('lz project')) &&
      (joined.includes('lamp type') || joined.includes('total price'))
    ) {
      return i
    }
  }
  // 兜底：第一个含 'total price' 的行
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    if (normalizeHeader(rows[i].join(' ')).includes('total price')) return i
  }
  return 0
}

// 按表头文字识别每个字段所在列下标。
// 价格字段额外约束：必须落在"价格区域"内（第一个价格列 ~ totalPrice 列之间），
// 防止把规格列（如 Granda 第 50 列 'LED module (LUMEN)' 流明值）误当成价格列。
function detectColumns(headerRow) {
  const headers = headerRow.map((h, idx) => ({ text: normalizeHeader(h), idx }))

  // 先锁定 totalPrice 列，作为价格区域的右边界
  const totalIdx = findMatch(headers, FIELD_HEADERS.totalPrice, new Set())
  // 价格区域左边界：项目/名称/规格之后的第一个价格列。保守取 totalPrice-12 到 totalPrice。
  const priceLo = totalIdx >= 0 ? Math.max(2, totalIdx - 12) : -1
  const priceHi = totalIdx // 含 totalPrice

  const used = new Set()
  if (totalIdx >= 0) used.add(totalIdx)

  const map = { totalPrice: totalIdx }

  for (const field of Object.keys(FIELD_HEADERS)) {
    if (field === 'totalPrice') continue
    let found = -1
    // 非价格字段：全域匹配
    if (!PRICE_FIELDS.includes(field)) {
      found = findMatch(headers, FIELD_HEADERS[field], used)
    } else if (totalIdx >= 0) {
      // 价格字段：只接受落在价格区域内的列
      const candidate = findMatch(headers, FIELD_HEADERS[field], used)
      if (candidate >= priceLo && candidate <= priceHi) found = candidate
    }
    if (found >= 0) used.add(found)
    map[field] = found
  }

  return map
}

function findMatch(headers, candidates, used) {
  for (const cand of candidates) {
    const cn = normalizeHeader(cand)
    const hit = headers.find(
      (h) => !used.has(h.idx) && (h.text === cn || h.text.startsWith(cn)),
    )
    if (hit) return hit.idx
  }
  return -1
}

// 解析单个价格单元格。支持：
// - 数字
// - "Frame ￥100.66 + Felt ￥18.55" → 求和 119.21
// - "n/a" / "na" / 空 → null
function parsePrice(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value).trim()
  if (!text) return null
  if (/^(n\/?a|na|\-|无|\/)$/i.test(text)) return null
  const matches = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/g)
  if (!matches || matches.length === 0) return null
  return matches.reduce((sum, n) => sum + Number.parseFloat(n), 0)
}

// 解析总价单元格。多值（如 "1160\n1175"）视为口径不明，返回 null 并标记需人工复核。
// 返回 { value, ambiguous, raw }
function parseTotal(value) {
  if (value == null || value === '') return { value: null, ambiguous: false, raw: '' }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value, ambiguous: false, raw: String(value) } : { value: null, ambiguous: false, raw: '' }
  }
  const text = String(value).trim()
  if (!text) return { value: null, ambiguous: false, raw: '' }
  if (/^n\/?a$/i.test(text)) return { value: null, ambiguous: false, raw: text }
  const parts = text.split(/[\n\r,;/]+/).map((p) => p.trim()).filter(Boolean)
  const nums = parts.map(parsePrice).filter((n) => n != null)
  if (nums.length === 0) return { value: null, ambiguous: false, raw: text }
  if (nums.length > 1) return { value: null, ambiguous: true, raw: text }
  return { value: nums[0], ambiguous: false, raw: text }
}

// 解析项目号，统一成小写无空格，便于跨家对齐。如 "26-0221_01" / "26-0221_4"。
function normalizeProjectNo(value) {
  if (value == null) return ''
  return String(value).trim().toLowerCase().replace(/\s+/g, '')
}

// 规格号补零：把 "26-0221_4" 标准化成 "26-0221_04"，使 _4 与 _04 能对齐到同一行。
function canonicalProjectKey(projectNo) {
  const norm = normalizeProjectNo(projectNo)
  const match = norm.match(/^(.*?_)(\d+)$/)
  if (!match) return norm
  return match[1] + match[2].padStart(2, '0')
}

// 从一份工作簿提取结构化报价行。
function extractQuoteRows(workbook) {
  // 选数据最多的 sheet 作为报价表
  const quoteSheet = pickQuoteSheet(workbook.sheets)
  const rows = quoteSheet.rows
  if (!rows || rows.length === 0) return { rows: [], columns: {}, sheetName: quoteSheet.sheetName }

  const headerIdx = detectHeaderRow(rows)
  const headerRow = rows[headerIdx] || []
  const columns = detectColumns(headerRow)

  const items = []
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r]
    if (!Array.isArray(row)) continue
    const projectNo = columns.projectNo >= 0 ? row[columns.projectNo] : null
    if (!projectNo || String(projectNo).trim() === '') continue

    const total = parseTotal(columns.totalPrice >= 0 ? row[columns.totalPrice] : null)
    items.push({
      projectNo: normalizeProjectNo(projectNo),
      projectKey: canonicalProjectKey(projectNo),
      name: columns.itemName >= 0 ? String(row[columns.itemName] || '').trim() : '',
      functionDesc: columns.functionDesc >= 0 ? String(row[columns.functionDesc] || '').trim() : '',
      cost: {
        rawLamp: columns.rawLamp >= 0 ? parsePrice(row[columns.rawLamp]) : null,
        driver: columns.driver >= 0 ? parsePrice(row[columns.driver]) : null,
        ledModule: columns.ledModule >= 0 ? parsePrice(row[columns.ledModule]) : null,
        controller: columns.controller >= 0 ? parsePrice(row[columns.controller]) : null,
        remote: columns.remotePrice >= 0 ? parsePrice(row[columns.remotePrice]) : null,
        felt: columns.feltPrice >= 0 ? parsePrice(row[columns.feltPrice]) : null,
        emcFilter: columns.emcFilter >= 0 ? parsePrice(row[columns.emcFilter]) : null,
      },
      totalPrice: total.value,
      totalAmbiguous: total.ambiguous,
      totalRaw: total.raw,
    })
  }

  return { rows: items, columns, sheetName: quoteSheet.sheetName }
}

function pickQuoteSheet(sheets) {
  // 数据最多的 sheet（行×非空列）通常是 Tabelle1
  let best = sheets[0]
  let bestScore = -1
  for (const sheet of sheets) {
    const nonEmpty = (sheet.rows || []).filter(
      (row) => Array.isArray(row) && row.some((c) => c !== null && c !== ''),
    ).length
    const score = nonEmpty
    if (score > bestScore) {
      bestScore = score
      best = sheet
    }
  }
  return best
}

// 从 Tooling Overview sheet 提取模具费明细（如有）。
function extractTooling(workbook) {
  const sheet = workbook.sheets.find(
    (s) => String(s.sheetName || '').toLowerCase().includes('tooling'),
  )
  if (!sheet) return []
  const rows = sheet.rows || []
  // 表头行：同时含 'tooling name'（或 'quotation'）的行。避免误停在标题行"Tooling Cost Breakdown"。
  let headerIdx = -1
  for (let i = 0; i < rows.length; i += 1) {
    const joined = normalizeHeader((rows[i] || []).join(' '))
    if (joined.includes('quotation') || joined.includes('tooling name')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) return []
  const header = rows[headerIdx] || []
  let nameIdx = -1
  let typeIdx = -1
  let qtyIdx = -1
  let priceIdx = -1
  header.forEach((h, idx) => {
    const t = normalizeHeader(h)
    if (nameIdx < 0 && (t.includes('tooling name'))) nameIdx = idx
    else if (typeIdx < 0 && (t.includes('tooling type'))) typeIdx = idx
    else if (qtyIdx < 0 && (t.includes('quality of the tooling') || t.includes('quantity'))) qtyIdx = idx
    else if (priceIdx < 0 && (t.includes('quotation') || t === 'price')) priceIdx = idx
  })
  if (priceIdx < 0 && nameIdx < 0) return []

  const items = []
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r]
    if (!Array.isArray(row)) continue
    const name = nameIdx >= 0 ? row[nameIdx] : null
    const price = priceIdx >= 0 ? parsePrice(row[priceIdx]) : null
    if (!name && price == null) continue
    items.push({
      name: name ? String(name).trim() : '',
      type: typeIdx >= 0 && row[typeIdx] ? String(row[typeIdx]).trim() : '',
      quantity: qtyIdx >= 0 ? parsePrice(row[qtyIdx]) : null,
      price,
    })
  }
  return items.filter((it) => it.name || it.price != null)
}

// 主入口：把 2-3 份工作簿对齐成比价结果。
// 返回 { suppliers, items, warnings } —— items 永远包含所有出现过的项目号（漏报记为 null 报价）。
function alignQuotes(workbooks) {
  const suppliers = workbooks.map((wb, idx) => ({
    id: `supplier-${idx + 1}`,
    name: inferSupplierName(wb),
    filename: wb.filename,
    quoteRows: [],
    tooling: extractTooling(wb),
  }))

  for (let i = 0; i < workbooks.length; i += 1) {
    const extracted = extractQuoteRows(workbooks[i])
    suppliers[i].quoteRows = extracted.rows
    suppliers[i].detectedColumns = extracted.columns
  }

  // 收集所有出现过的项目号（按 projectKey 去重，保持出现顺序）
  const keyOrder = []
  const keyToCanonical = new Map()
  for (const sup of suppliers) {
    for (const row of sup.quoteRows) {
      if (!keyToCanonical.has(row.projectKey)) {
        keyToCanonical.set(row.projectKey, row.projectNo)
        keyOrder.push(row.projectKey)
      }
    }
  }

  const items = keyOrder.map((key, itemIdx) => {
    const quotes = suppliers.map((sup) => {
      const matched = sup.quoteRows.find((r) => r.projectKey === key) || null
      if (!matched) {
        return { supplierId: sup.id, unitPrice: null, totalPrice: null, matched: false, missing: true }
      }
      return {
        supplierId: sup.id,
        unitPrice: matched.totalPrice,
        totalPrice: matched.totalPrice,
        costBreakdown: matched.cost,
        matched: true,
        missing: false,
        ambiguous: matched.totalAmbiguous,
        name: matched.name,
      }
    })

    const priced = quotes
      .filter((q) => q.matched && q.totalPrice != null)
      .map((q) => ({ supplierId: q.supplierId, price: q.totalPrice }))

    const prices = priced.map((p) => p.price)
    const lowestPrice = prices.length > 0 ? Math.min(...prices) : null
    const highestPrice = prices.length > 0 ? Math.max(...prices) : null
    const averagePrice =
      prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null
    const lowestSupplierId =
      priced.length > 0 ? priced.sort((a, b) => a.price - b.price)[0].supplierId : null

    return {
      id: `item-${String(itemIdx + 1).padStart(3, '0')}`,
      projectNo: keyToCanonical.get(key),
      name: quotes.find((q) => q.matched && q.name)?.name || '',
      quotes,
      pricedCount: prices.length,
      missingCount: quotes.length - prices.length,
      lowestSupplierId,
      lowestPrice,
      highestPrice,
      averagePrice,
    }
  })

  const warnings = buildWarnings(suppliers, items)

  // 清理内部字段，不外泄
  const cleanSuppliers = suppliers.map((sup) => ({
    id: sup.id,
    name: sup.name,
    filename: sup.filename,
    tooling: sup.tooling,
    toolingTotal: sup.tooling.reduce((sum, t) => sum + (t.price || 0), 0),
    itemCount: sup.quoteRows.length,
  }))

  return { suppliers: cleanSuppliers, items, warnings, detectedColumns: suppliers.map((s) => s.detectedColumns) }
}

function inferSupplierName(workbook) {
  // 用文件名推断供应商名：取日期与关键字之间的部分
  const base = (workbook.filename || '').replace(/\.xlsx$/i, '').trim()
  // "26-0221 Mute Light Specification 01.07.2026 JOM" -> "JOM"
  const match = base.match(/([A-Za-z]{2,6})$/)
  if (match) return match[1].toUpperCase()
  return base.slice(-12) || '供应商'
}

function buildWarnings(suppliers, items) {
  const warnings = []
  let warnIdx = 1
  const push = (type, severity, title, message) => {
    warnings.push({
      id: `warning-${String(warnIdx).padStart(3, '0')}`,
      type,
      severity,
      title,
      message,
    })
    warnIdx += 1
  }

  // 1. 漏报：某家完全没报某些项目
  for (const sup of suppliers) {
    const missingItems = items.filter((item) => {
      const q = item.quotes.find((x) => x.supplierId === sup.id)
      return q && q.missing
    })
    if (missingItems.length > 0) {
      push(
        'MISSING_QUOTE',
        missingItems.length >= 3 ? 'high' : 'medium',
        `${sup.name} 有 ${missingItems.length} 项漏报`,
        `${sup.name} 未报价的项目：${missingItems.map((i) => i.projectNo).join('、')}。可能未覆盖该型号，建议确认。`,
      )
    }
  }

  // 2. 量级异常：同一项目不同家总价差距过大（疑似口径不一致）
  for (const item of items) {
    if (item.pricedCount >= 2 && item.lowestPrice != null && item.highestPrice != null) {
      const ratio = item.highestPrice / item.lowestPrice
      if (ratio >= 2) {
        const supNames = item.quotes
          .filter((q) => q.totalPrice != null)
          .map((q) => {
            const name = suppliers.find((s) => s.id === q.supplierId)?.name
            return `${name} ${Math.round(q.totalPrice)}`
          })
          .join(' vs ')
        push(
          'PRICE_CALIBER_MISMATCH',
          ratio >= 3 ? 'high' : 'medium',
          `${item.projectNo} 总价量级差异大（${ratio.toFixed(1)} 倍）`,
          `同一项目各家的总价分别为 ${supNames}，差距过大，可能含税/分摊/币种口径不一致，不可直接比，需逐家核实。`,
        )
      }
    }
  }

  // 3. 总价多值/口径不明
  for (const item of items) {
    const ambiguous = item.quotes.filter((q) => q.matched && q.ambiguous)
    for (const q of ambiguous) {
      const name = suppliers.find((s) => s.id === q.supplierId)?.name
      push(
        'AMBIGUOUS_PRICE',
        'medium',
        `${item.projectNo} ${name} 总价含多个数值`,
        `原单元格为「${q.totalRaw ? '' : ''}${item.quotes.find((x) => x.supplierId === q.supplierId)?.costBreakdown ? '' : ''}多值」，需人工确认取哪一个。`,
      )
    }
  }

  // 4. 模具费
  for (const sup of suppliers) {
    if (sup.tooling.length > 0) {
      const total = sup.tooling.reduce((sum, t) => sum + (t.price || 0), 0)
      push(
        'TOOLING_COST',
        'low',
        `${sup.name} 报了模具费 ${Math.round(total)} 元`,
        `${sup.name} 共 ${sup.tooling.length} 项模具，合计约 ${Math.round(total)} 元。模具费通常先支付、达到约定量后返还，并归采购方专用。`,
      )
    }
  }

  return warnings
}

module.exports = {
  alignQuotes,
  detectColumns,
  detectHeaderRow,
  extractQuoteRows,
  extractTooling,
  parsePrice,
  parseTotal,
  normalizeHeader,
  normalizeProjectNo,
  canonicalProjectKey,
}
