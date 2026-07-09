/**
 * 本机会话缓存：关页后可「一键恢复」上次比价结果。
 * 真源仍是云端 quote_cache（contentHash）；本地只是快照。
 */
const SESSION_KEY = 'quote-last-session-v1'
const MAX_BYTES = 4.5 * 1024 * 1024 // localStorage 常见 5MB 上限，留余量

export function saveSession(session) {
  try {
    const payload = {
      contentHash: session.contentHash || null,
      fileNames: session.fileNames || [],
      result: session.result || null,
      workbooks: session.workbooks || null,
      report: session.report || null,
      cacheHit: Boolean(session.cacheHit),
      savedAt: new Date().toISOString(),
    }
    const text = JSON.stringify(payload)
    if (text.length > MAX_BYTES) {
      // 过大时丢掉 workbooks，恢复后仍可看表；生成报告需重新上传
      payload.workbooks = null
      const slim = JSON.stringify(payload)
      if (slim.length > MAX_BYTES) {
        payload.result = slimResult(payload.result)
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(payload))
      return
    }
    localStorage.setItem(SESSION_KEY, text)
  } catch {
    // quota / 隐私模式
  }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data?.result?.items?.length) return null
    return data
  } catch {
    return null
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

export function patchSessionReport(reportData) {
  const current = loadSession()
  if (!current) return
  saveSession({ ...current, report: reportData })
}

function slimResult(result) {
  if (!result) return null
  return {
    ...result,
    items: (result.items || []).map((item) => ({
      id: item.id,
      projectNo: item.projectNo,
      name: item.name,
      lowestSupplierId: item.lowestSupplierId,
      lowestPrice: item.lowestPrice,
      highestPrice: item.highestPrice,
      averagePrice: item.averagePrice,
      quotes: (item.quotes || []).map((q) => ({
        supplierId: q.supplierId,
        matched: q.matched,
        totalPrice: q.totalPrice,
      })),
    })),
  }
}
