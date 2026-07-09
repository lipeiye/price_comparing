# AI 交接上下文（读这份最快）

> 给后续 AI / 协作者的**压缩真相源**。先读本文件，再按需打开 `quote-ai-demo/README.md`。  
> 最后更新：2026-07-09（本聊天窗口落地的全部改动）

---

## 30 秒现状

| 项 | 值 |
|----|-----|
| 产品 | 灯具采购 Excel 报价比价（单用户 Web） |
| 路径 | `quote-ai-demo/`（React + Vite + CloudBase 双云函数） |
| 环境 ID | `price-comparing-demo-d2adc62c70c` |
| 前端 | https://price-comparing-demo-d2adc62c70c-1451548054.tcloudbaseapp.com |
| 网关 | `https://price-comparing-demo-d2adc62c70c-1451548054.ap-shanghai.app.tcloudbase.com` |
| analyzeQuotes | `…/api/analyzeQuotes` → version **`v6-cache-hash-30d`** |
| generateReport | `…/api/generateReport` → version **`v3-report-cache-hash`** |
| AI 模型 | **全程 `deepseek-v4-flash`**（禁止 Pro；代码会强制降级 pro/reasoner） |
| 上传上限 | **2–8** 份 xlsx |
| 缓存 | 云库集合 **`quote_cache`**，contentHash=SHA-256(表格内容)，TTL 30 天 |
| 多用户 / 小程序 | **未做**；产品决策：先 Web；小程序若做只读历史即可 |

```bash
# 健康检查（部署后必跑）
curl -sS "https://price-comparing-demo-d2adc62c70c-1451548054.ap-shanghai.app.tcloudbase.com/api/analyzeQuotes?ping=1"
# → {"success":true,"pong":true,"version":"v6-cache-hash-30d","cache":true}

curl -sS "https://price-comparing-demo-d2adc62c70c-1451548054.ap-shanghai.app.tcloudbase.com/api/generateReport?ping=1"
# → {"success":true,"pong":true,"version":"v3-report-cache-hash","cache":true}
```

---

## 架构（不要推翻的不变量）

1. **浏览器解析 Excel**（`read-excel-file`）→ 只传 JSON，不传原文件。
2. **代码对齐**（`align.js`）负责价格/最低价/漏报/量级；**AI 只写叙述 + 规格篡改**。AI 挂了比价表仍返回。
3. **两云函数拆开**：`analyzeQuotes` 快出表；`generateReport` 按需出精简双语报告。
4. **缓存优先于 AI**：相同表格内容 hash 命中 → `cacheHit:true`，0 token。
5. 两函数各有一份 `align.js` / `cache.js`（独立部署，无 monorepo 共享包）。

```
Browser: parse xlsx → workbooks JSON
       → POST analyzeQuotes
CF: hash(workbooks) → quote_cache hit? return : align + Flash → set cache
       → optional POST generateReport(contentHash, aligned, raw)
CF: cache.report hit? return : Flash → update cache.report
```

---

## 本聊天窗口做了什么（按时间）

### A. 产品/架构咨询（未写代码）

- 讨论工业化多职工 → 用户明确 **先只做单用户**。
- 讨论小程序 → 结论：**网站为主**；小程序仅在有「微信内看历史」需求时再做只读壳；**缓存比小程序更优先**。

### B. Flash only + 精简双语报告 + 上限 8 + 部署

| 改动 | 要点 |
|------|------|
| 模型 | `generateReport` 去掉 Pro/思考模式；默认 Flash；`AI_REPORT_MODEL` 含 pro 时强制 flash |
| 报告形态 | 废弃七章长文 → `verdict/ranking/keyGaps/specIssues/nextSteps/risks` 表格化中英 |
| Prompt/Schema | 两个函数的 prompt/schema 重写为「短、硬、双语」 |
| 上传上限 | 前端 `MAX_FILES=8` + 后端 `MAX_WORKBOOKS=8` + 文案 |
| 导出 | Word 长文 → **Excel（SpreadsheetML .xls 多 sheet）** + PDF |
| 建议 summary | `{ zh, en }` 对象（兼容旧 string） |
| 部署 | 静态托管 + 两云函数已上线 |

**踩坑（必须知道）：**

- `tcb fn code update --deployMode zip` 曾 **Update failed**；改用 **`--deployMode cos`** 成功。
- `tcb config update fn` 选 **Override** 会清空其它环境变量；曾短暂清掉 `generateReport` 的 `AI_API_KEY`，已用 **Merge** 恢复。**以后改 env 务必 Merge。**
- 健康检查用 `FUNCTION_VERSION` 字符串确认线上版本，不要只看 CLI「updated successfully」。

### C. contentHash 服务端缓存 + 关页恢复

| 文件 | 作用 |
|------|------|
| `cloudfunctions/*/cache.js` | hash / get / save analyze / save report；DB 失败静默降级 |
| `analyzeQuotes/index.js` | hash → 命中直接返回；miss 后 align+AI 再 `set`；支持 `{action:'lookup', contentHash}` |
| `generateReport/index.js` | 按 contentHash 或 rawWorkbooks hash 查 `report`；命中跳过 AI |
| `src/utils/sessionStore.js` | localStorage 上次会话快照 |
| `src/App.jsx` | 「本机恢复 / 云端恢复 / 清除」+ cacheHit 绿条 |
| 依赖 | 两函数 `package.json` 增加 `@cloudbase/node-sdk`（云端 installDependency） |
| 集合 | `quote_cache`（CLI insert bootstrap 创建） |

**Hash 规则：** 只哈希各 workbook 的 `sheets[].sheetName + rows`（**不含文件名**），供应商顺序排序后 SHA-256。改名仍命中。

**文档字段（逻辑）：**  
`contentHash, fileNames, suppliers, items, warnings, summary, report, reportGeneratedAt, rawWorkbooks?, createdAt, updatedAt, expiresAt, schemaVersion`

---

## 关键文件地图

```
quote-ai-demo/
  cloudbaserc.json          # envId + 函数 timeout/handler（无密钥）
  package.json              # deploy:static, deploy:fn
  src/App.jsx               # 主流程 + 会话恢复
  src/utils/fileValidation.js   # MAX_FILES=8
  src/utils/sessionStore.js     # 本机快照
  src/utils/bilingual.js        # {zh,en} 兼容
  src/utils/exportReport.js     # Excel/PDF
  src/components/ReportPanel.jsx
  src/services/analyzeQuotes.js # + restoreByContentHash
  src/services/generateReport.js
  cloudfunctions/analyzeQuotes/
    index.js, align.js, cache.js, prompt.js, schema.js
  cloudfunctions/generateReport/
    index.js, align.js, cache.js, prompt.js, schema.js  # 与上面对齐的副本
```

---

## 部署命令（当前正确姿势）

```bash
cd quote-ai-demo

# 前端
npm run deploy:static

# 云函数（COS；zip 曾失败）
npm run deploy:fn
# 或：
# tcb fn code update analyzeQuotes  -e price-comparing-demo-d2adc62c70c --deployMode cos --dir ./cloudfunctions/analyzeQuotes
# tcb fn code update generateReport -e price-comparing-demo-d2adc62c70c --deployMode cos --dir ./cloudfunctions/generateReport
```

环境变量（控制台，**Merge 更新**）：

| Key | 函数 | 值 |
|-----|------|-----|
| `AI_API_KEY` | 两个 | DeepSeek key |
| `AI_API_ENDPOINT` | 两个 | `https://api.deepseek.com/chat/completions` |
| `AI_MODEL` | analyze | `deepseek-v4-flash` |
| `AI_REPORT_MODEL` | report | `deepseek-v4-flash` |

---

## 明确没做 / 不要擅自做的

- 多用户登录、任务队列、权限
- 微信小程序
- 恢复 Pro 模型或七章长文报告
- 把密钥写进 git（`cloudbaserc.json` 不含 secret；`.env.production` 勿提交密钥）

---

## 验收清单

1. ping 两函数 version 字符串如上。
2. 上传 2 份 xlsx → 比价 → 第一次 `cacheHit:false`。
3. 相同文件再比价 → 秒回、`cacheHit:true`、绿条「未再次调用 AI」。
4. 关页再开 → 「本机恢复」出表；「云端恢复」走 lookup。
5. 报告点两次 → 第二次 cacheHit。
6. 强制刷新前端（避免旧 bundle）。

---

## 文档分工

| 文件 | 给谁 | 内容 |
|------|------|------|
| **本文件 `docs/AI_CONTEXT.md`** | **AI / 快速接手** | 现状、本会话改动、雷区、命令 |
| `README.md`（根） | GitHub 访客 | 一句话产品 + 本地/部署入口 |
| `quote-ai-demo/README.md` | 人读技术细节 | 架构、对齐引擎、字段、部署、环境变量 |

历史聊天决策若与本文件冲突，**以本文件 + 线上 `FUNCTION_VERSION` 为准**。
