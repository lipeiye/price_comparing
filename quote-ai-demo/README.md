# 智采 AI 报价比价 Demo

企业采购报价比价网站（面向灯具采购）。支持上传 2-3 份供应商 Excel 报价单，分两步完成比价：

1. **快速比价**：代码按表头识别价格列、按项目号跨家对齐、算最低价、检测漏报/量级异常/模具费，并由轻量 AI（DeepSeek V4 Flash）生成建议。
2. **详细分析报告**（可选）：用更强模型（DeepSeek V4 Pro，思考模式）做多维深度分析（价格分析、规格逐项核对、成本拆解、谈判建议、风险），可导出 Word/PDF。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建产物位于 `dist/`。部署静态托管时请上传 `dist` 目录内部内容，确保托管根目录直接包含 `index.html` 和 `assets/`。

## 架构

```
快速比价（~30s）                          详细报告（~120s，可选）
analyzeQuotes 云函数                     generateReport 云函数
deepseek-v4-flash                        deepseek-v4-pro（思考模式）
┌────────────────────────┐               ┌──────────────────────────┐
│ 前端解析 Excel → 表格JSON │   用户点      │ 接收已对齐结果+原始表格     │
│        ↓                │  「生成报告」  │        ↓                  │
│ 代码对齐引擎 align.js    │ ───────────▶ │ v4-pro 深度分析            │
│   按表头识别价格列       │  （传结果）   │   多维 Analytical Report   │
│   按项目号跨家对齐       │               │        ↓                  │
│   算最低/漏报/量级/模具费│               │ 前端展示 + 导出 Word/PDF   │
│        ↓                │               └──────────────────────────┘
│ V4 Flash 叙述+规格篡改  │
└────────────────────────┘
```

**关键设计：对齐引擎（`align.js`）保证比价表永不为空。** 不再把整张表丢给 AI 让它猜，而是代码按表头文字识别列（robust 到供应商合并/左移列），按项目号对齐跨家报价。AI 只做需要语言理解的部分（叙述、规格篡改检测）。即使 AI 超时，比价报告照常返回。

## 本地 Mock 模式

本地开发默认启用 Mock：

```env
VITE_USE_MOCK=true
VITE_ANALYZE_API_URL=
```

真实 AI 接口必须由后端或 CloudBase 云函数调用，不能把 API Key 写入前端。生产环境 `.env.production` 已配置为调用 CloudBase HTTP 网关。

## 真实 AI 接入准备

前端通过两个环境变量调用后端接口：

```env
VITE_USE_MOCK=false
VITE_ANALYZE_API_URL=https://你的-cloudbase-api-url/api/analyzeQuotes
VITE_REPORT_API_URL=https://你的-cloudbase-api-url/api/generateReport
```

Excel 解析在浏览器端完成（`src/utils/extractWorkbooks.js`，read-excel-file）：保留全部工作表（含 Tooling Overview 模具费表）、全部有数据的列，只上传几十 KB 的表格 JSON。

## 云函数

### analyzeQuotes（快速比价）

`cloudfunctions/analyzeQuotes/`（无第三方依赖）：

1. 接收 2-3 份工作簿的表格 JSON（`{ workbooks }`）。
2. 代码对齐引擎（`align.js`）：按表头识别价格列、按项目号跨家对齐、算最低/最高/均价、检测漏报/量级异常/模具费。
3. AI（V4 Flash）只做叙述：中文采购建议 + 检测供应商擅自改规格。AI 失败不阻断，比价报告照常返回。
4. 全局截止线 185 秒，必须小于函数执行超时（200 秒）。

### generateReport（详细报告）

`cloudfunctions/generateReport/`（无第三方依赖）：

1. 接收已对齐的比价结果 + 原始表格（`{ alignedResult, rawWorkbooks }`），不重复算价格。
2. 调用更强模型（默认 `deepseek-v4-pro`，思考模式默认开启），生成多维 Analytical Report。
3. 超时预算 270 秒，云函数执行超时需设为 300 秒以上。

## 部署

### 一键 CLI 部署前端

```bash
npm run deploy:static
# 等价于 npm run build && tcb hosting deploy ./dist / -e <envId>
```

### 部署云函数（ZIP 模式更可靠）

```bash
# 快速比价
tcb fn code update analyzeQuotes -e <envId> --deployMode zip
# 详细报告（首次需 tcb fn deploy，并配 HTTP 路径）
tcb fn code update generateReport -e <envId> --deployMode zip
```

`--deployMode zip`（ZIP base64 直传）比默认的 COS 上传更可靠。

### 部署后秒级验证版本

函数带健康检查，`?ping=1` 会立即返回版本标记：

```bash
curl "https://<网关>/api/analyzeQuotes?ping=1"
# → {"success":true,"pong":true,"version":"v4-align-engine-185s"}

curl "https://<网关>/api/generateReport?ping=1"
# → {"success":true,"pong":true,"version":"v1-report-pro"}
```

若返回 400（缺少 workbooks）说明线上仍是旧版代码，需重新部署。

### HTTP 访问路径

每个云函数需绑定一条 HTTP 访问路径（网关路由）：

```bash
tcb service create -e <envId> -p /api/generateReport -f generateReport
```

### 云函数环境变量

**analyzeQuotes**：

```env
AI_API_KEY=
AI_API_ENDPOINT=https://api.deepseek.com/chat/completions
AI_MODEL=deepseek-v4-flash
```

**generateReport**：

```env
AI_API_KEY=
AI_API_ENDPOINT=https://api.deepseek.com/chat/completions
AI_REPORT_MODEL=deepseek-v4-pro
```

`AI_API_ENDPOINT` 优先级高于 `AI_API_BASE_URL`。旧模型名 `deepseek-chat`/`deepseek-reasoner` 将于 2026-07-24 下线，请使用 V4 新名。

### 新建 generateReport 时的控制台操作清单

CLI 可完成大部分配置，以下为补充说明（若 CLI 不可用）：

1. 创建云函数后，在 CloudBase 控制台 → 云函数 → generateReport → 触发器，新建 HTTP 路径 `/api/generateReport`。
2. 函数配置 → 环境变量：添加 `AI_API_KEY`、`AI_API_ENDPOINT`、`AI_REPORT_MODEL`。
3. 函数配置 → 执行超时：设为 300 秒（思考模型耗时长）；内存 512MB。

## 报告导出

- **Word**：浏览器端用 `docx` 库生成 .docx（代码分割，仅点击导出时加载），可在 Word 里二次编辑。
- **PDF**：调用 `window.print()`，配合 `@media print` 打印样式，零依赖、中文无障碍。

## Demo 验收点

- 上传 1 份时按钮禁用；上传 2-3 份时按钮启用；第 4 份被拒绝；非 XLSX 被拒绝。
- 快速比价生成比价表（按项目号对齐，标最低价、漏报、量级异常）。
- 可选生成详细报告（多维分析 + 导出 Word/PDF）。
- 真实 AI 失败时比价表照常返回（降级提示），不静默切 Mock。
- `npm run build` 成功。
