# 智采 AI 报价比价

> 企业灯具采购智能比价系统 — 上传 Excel 报价单，AI 自动对齐、比价、出报告。

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite)](https://vite.dev/)
[![DeepSeek](https://img.shields.io/badge/AI-DeepSeek%20V4-536DFE)](https://www.deepseek.com/)
[![CloudBase](https://img.shields.io/badge/Cloud-Tencent%20CloudBase-0052CC)](https://cloud.tencent.com/product/tcb)

---

## 目录

- [概览](#概览)
- [核心能力](#核心能力)
- [架构设计](#架构设计)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [双函数架构详解](#双函数架构详解)
  - [analyzeQuotes — 快速比价](#analyzequotes--快速比价)
  - [generateReport — 详细报告](#generatereport--详细报告)
- [对齐引擎](#对齐引擎)
- [前端设计](#前端设计)
- [部署指南](#部署指南)
- [报告导出](#报告导出)
- [环境变量](#环境变量)
- [验收清单](#验收清单)
- [技术栈](#技术栈)

---

## 概览

**智采 AI 报价比价**是一款面向灯具企业采购经理的智能比价工具。用户上传 2–3 份供应商 Excel 报价单，系统自动完成：

1. **浏览器端解析**：提取 Excel 所有工作表和列数据，仅上传几 KB 的结构化 JSON，不上传原始文件。
2. **代码对齐引擎**：按表头文字智能识别价格列、项目号列，跨供应商对齐到同一行，计算最低/最高/均价，检测漏报、量级异常、模具费。
3. **AI 生成建议**：DeepSeek V4 Flash 生成中文采购建议，检测供应商擅自篡改规格的行为。
4. **深度分析报告**（可选）：DeepSeek V4 Pro 思考模式生成多维 Analytical Report，支持导出 Word/PDF。

> **设计哲学**：比价表由代码保证，永不为空。AI 只做需要语言理解的部分（叙述、规格篡改检测），不参与价格计算。即使 AI 超时或失败，比价报告照常返回。

---

## 核心能力

| 能力 | 实现方式 | 说明 |
|------|----------|------|
| Excel 解析 | 浏览器端 `read-excel-file` | 保留全部工作表、全部有数据的列，不丢弃成本拆分列 |
| 表头识别 | `align.js` 按文字匹配 | 支持同一模板不同列布局（供应商合并/左移列），鲁棒性强 |
| 跨家对齐 | `canonicalProjectKey` 补零归一化 | `26-0221_4` 与 `26-0221_04` 对齐到同一行 |
| 价格解析 | 多值求和 / 多值标记存疑 | `Frame ¥100.66 + Felt ¥18.55` 自动求和；`1160\n1175` 标记口径不明 |
| 异常检测 | 代码自动 + AI 补充 | 漏报、量级差异 ≥2×、总价多值、模具费、规格篡改 |
| 采购建议 | DeepSeek V4 Flash | 3-6 句中文结论先行，含整体推荐和关键风险项 |
| 深度报告 | DeepSeek V4 Pro（思考模式） | 执行摘要 / 价格分析 / 规格逐项核对 / 成本拆解 / 模具费 / 谈判建议 / 风险 |
| Word 导出 | `docx` 库（代码分割，按需加载） | 含比价明细表，可在 Word 中二次编辑 |
| PDF 导出 | `window.print()` 零依赖 | 配合 `@media print` 打印样式，中文无障碍 |

---

## 架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                        浏览器端 (React 19 + Vite 8)           │
│                                                              │
│  上传 Excel → extractWorkbooks.js → 表格 JSON (几十 KB)       │
│       │                                                      │
│       ▼                                                      │
│  ┌─────────────────┐    可选     ┌──────────────────────┐     │
│  │  analyzeQuotes   │ ────────▶ │   generateReport      │     │
│  │  CloudBase 云函数 │  传递结果  │   CloudBase 云函数     │     │
│  │                  │           │                      │     │
│  │  ① align.js     │           │  ① 接收已对齐结果      │     │
│  │    代码对齐引擎   │           │  ② DeepSeek V4 Pro    │     │
│  │  ② DeepSeek     │           │     思考模式深度分析    │     │
│  │    V4 Flash     │           │  ③ 多维报告输出        │     │
│  │    采购建议+规格  │           │                      │     │
│  │                 │           │  超时预算: 270s        │     │
│  │  超时预算: 185s  │           │  函数超时: ≥300s       │     │
│  │  函数超时: 200s  │           └──────────────────────┘     │
│  └─────────────────┘                                         │
│       │                              │                       │
│       ▼                              ▼                       │
│  比价表 + 异常 + 建议         多维分析报告 + Word/PDF 导出     │
└──────────────────────────────────────────────────────────────┘
```

### 关键设计决策

| 决策 | 原因 |
|------|------|
| 两段式架构（两个云函数） | 快速比价 ~30s 先出结果；深度报告 ~120s 按需触发，互不阻塞 |
| 代码对齐 + AI 叙述分离 | 比价表永不为空，不依赖 AI 心情；AI 只做语言理解 |
| 浏览器端解析 Excel | 不上传原始文件，payload 仅几十 KB，保护数据隐私 |
| 前端 → 云函数 → DeepSeek | API Key 仅存后端环境变量，不暴露到浏览器 |
| 健康检查 `?ping=1` | 部署后秒级验证线上版本，无需等到真实请求 |
| 报告 localStorage 缓存 | 同份文件刷新页面不重复消耗 AI Token |

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- npm ≥ 9

### 本地开发

```bash
# 进入项目目录
cd quote-ai-demo

# 安装依赖
npm install

# 启动开发服务器（默认启用 Mock 模式）
npm run dev
```

本地开发默认使用 `.env` 中的 `VITE_USE_MOCK=true`，展示模拟比价数据，适合离线开发和 UI 调试。

### 构建生产版本

```bash
npm run build
```

构建产物位于 `dist/`，部署时将该目录内容上传到静态托管的根目录。

---

## 项目结构

```
quote-ai-demo/
├── index.html                    # 入口 HTML
├── vite.config.js                # Vite 构建配置
├── package.json                  # 依赖与脚本
├── .env.example                  # 环境变量模板
├── .env.production               # 生产环境变量
├── .oxlintrc.json                # Oxlint 代码检查配置
│
├── public/
│   ├── favicon.svg               # 网站图标
│   └── icons.svg                 # SVG 图标集
│
├── src/
│   ├── main.jsx                  # React 入口
│   ├── App.jsx                   # 根组件：状态管理、流程编排
│   ├── index.css                 # 全局样式（含打印样式）
│   │
│   ├── components/
│   │   ├── Header.jsx            # 顶部导航栏
│   │   ├── UploadZone.jsx        # 文件拖拽上传区域
│   │   ├── FileCard.jsx          # 单个文件卡片（含删除按钮）
│   │   ├── AnalysisProgress.jsx  # 分析进度指示器
│   │   ├── ComparisonTable.jsx   # 比价表：跨家对齐、最低价高亮、成本拆分
│   │   ├── WarningCard.jsx       # 异常警告卡片
│   │   ├── RecommendationPanel.jsx # AI 采购建议面板
│   │   ├── ReportPanel.jsx       # 详细报告展示 + 导出按钮
│   │   └── ErrorBanner.jsx       # 错误提示横幅
│   │
│   ├── services/
│   │   ├── analyzeQuotes.js      # 快速比价 API 调用 + Mock 判断
│   │   └── generateReport.js     # 详细报告 API + localStorage 缓存
│   │
│   ├── utils/
│   │   ├── extractWorkbooks.js   # 浏览器端 Excel 解析与瘦身
│   │   ├── fileValidation.js     # 文件类型/大小/数量校验
│   │   ├── formatters.js         # 货币/文件大小格式化
│   │   ├── exportReport.js       # Word (.docx) 和 PDF 导出
│   │   └── imageCompression.js   # 图片压缩（预留）
│   │
│   └── data/
│       └── mockResult.js         # Mock 比价数据（5 个示例商品 × 3 家供应商）
│
└── cloudfunctions/
    ├── analyzeQuotes/            # 快速比价云函数（零依赖）
    │   ├── index.js              # 入口：两段式架构编排
    │   ├── align.js              # 结构化对齐引擎（纯逻辑）
    │   ├── prompt.js             # AI System Prompt
    │   ├── schema.js             # AI 输出 JSON Schema
    │   └── package.json
    │
    └── generateReport/           # 详细报告云函数（零依赖）
        ├── index.js              # 入口：接收已对齐结果 + 原始表格
        ├── align.js              # 对齐引擎副本（供独立调用）
        ├── prompt.js             # AI System Prompt（多维分析）
        ├── schema.js             # AI 输出 JSON Schema（7 章报告）
        └── package.json
```

---

## 双函数架构详解

### analyzeQuotes — 快速比价

**云函数入口**：`cloudfunctions/analyzeQuotes/index.js`

**处理流程**：

```
接收 2-3 份工作簿 JSON
        │
        ▼
┌──────────────────────┐
│ 第一段：代码对齐引擎   │  ← align.js，纯逻辑，秒级完成
│                      │
│ • 检测表头行          │
│ • 按表头文字识别价格列 │
│ • 按项目号跨家对齐    │
│ • 计算最低/最高/均价   │
│ • 检测漏报/量级/模具费 │
└──────────────────────┘
        │
        ▼
┌──────────────────────┐
│ 第二段：AI 叙述生成   │  ← DeepSeek V4 Flash
│                      │
│ • 中文采购建议        │
│ • 规格篡改检测        │
│ • 量级差异判断        │
│ • 模具费处理建议      │
└──────────────────────┘
        │  AI 失败不阻断
        ▼
   合并输出（代码异常 + AI 补充异常 + AI 建议）
```

**超时预算**：
- 全局截止线：185 秒
- AI 调用超时：175 秒
- 云函数执行超时：200 秒（控制台配置）

### generateReport — 详细报告

**云函数入口**：`cloudfunctions/generateReport/index.js`

**设计原则**：无状态，不重复算价格。接收快速比价的 `alignedResult` + 原始 `rawWorkbooks`，由 DeepSeek V4 Pro（思考模式）生成多维深度报告。

**报告章节**（7 章）：

| 章节 | 内容 |
|------|------|
| 执行摘要 | 整体结论、推荐供应商、关键风险 |
| 价格分析 | 供应商排名、价差洞察、性价比评价 |
| 规格逐项核对 | 逐项目检查规格是否被篡改（最重要的章节） |
| 成本拆解分析 | 原材料/驱动/LED/控制器各家的成本差异 |
| 模具费分析 | 分摊逻辑、单件成本、返还条件 |
| 谈判与选型建议 | 推荐/备选供应商、谈判筹码、下一步行动 |
| 风险提示 | 口径不一致、规格隐患、漏报等风险点 |

**超时预算**：
- AI 调用超时：270 秒
- 云函数执行超时：300 秒以上（控制台配置）

---

## 对齐引擎

对齐引擎（`align.js`）是本系统的心脏，两个云函数各有一份副本（内容相同）。

### 工作原理

1. **表头检测**：扫描前 20 行，找到同时包含「project no」和「lamp type/total price」的行作为表头。
2. **列识别**：按归一化后的表头文字匹配字段。价格字段额外约束必须落在"价格区域"内（`totalPrice - 12` 到 `totalPrice`），防止把流明值等规格列误认为价格。
3. **项目号归一化**：`canonicalProjectKey` 将 `26-0221_4` 补零为 `26-0221_04`，确保与 `26-0221_04` 对齐到同一行。
4. **价格解析**：支持 `Frame ¥100.66 + Felt ¥18.55` 自动求和；多值（如 `1160\n1175`）标记为"口径不明"。
5. **跨家对齐**：收集所有供应商的项目号，按 `projectKey` 去重，每个项目一行，漏报价记为 `null`。
6. **异常检测**：漏报、量级差异 ≥2×、总价多值/口径不明、模具费。

### 支持的字段映射

| 字段 | 候选表头 |
|------|----------|
| 项目号 | `LZ Project No`, `Project No` |
| 灯型 | `Lamp Type` |
| 毛坯灯 | `Raw Lamp`, `Raw Lamp (EXW)`, `Raw Lamp (EXW)+LED Module` |
| 驱动 | `Driver` |
| LED 模组 | `LED Module` |
| 控制器 | `Controller` |
| 遥控 | `Remote Control`, `Remote` |
| 毛毡 | `Felt Price`, `Felt` |
| EMC 滤波器 | `EMC Filter (if needed)`, `EMC Filter` |
| 总价 | `Total Price EXW`, `Total Price` |
| 模具现状 | `Tooling Exisiting Yes/ No` |
| 模具费 | `Tooling Cost` |
| 首单数量 | `1st Order Quantity`, `Order Quantity` |

---

## 前端设计

### 状态管理

所有状态集中在 `App.jsx`，通过 props 向下传递，无全局状态库：

- `files` — 已上传的文件列表
- `isAnalyzing` — 快速比价进行中
- `result` — 快速比价结果
- `report` — 详细报告结果
- `isGeneratingReport` — 详细报告生成中

### 数据流

```
用户上传文件
  → extractWorkbooks (浏览器端 Excel → JSON)
  → analyzeQuotes API (云函数 → 对齐引擎 + V4 Flash)
  → 展示比价表 + 异常 + 建议
  → 用户点击「生成详细报告」
  → generateReport API (云函数 → V4 Pro 思考模式)
  → 展示多维报告 + 导出 Word/PDF
```

### Mock 模式

本地开发默认启用 Mock。`src/data/mockResult.js` 提供了 5 个示例商品 × 3 家供应商的完整模拟数据（含漏报、规格不一致、运费差异等典型场景）。设置 `VITE_USE_MOCK=false` 并填入真实 API 地址即可接入后端。

### 报告导出

- **Word (.docx)**：浏览器端用 `docx` 库组装，含完整比价明细表。`docx` 库通过动态 `import()` 实现代码分割（~400KB），仅在点击导出时加载。
- **PDF**：调用 `window.print()`，配合 `@media print` 样式仅打印 `.printable` 区域，零额外依赖。

---

## 部署指南

### 前端静态托管（CloudBase）

```bash
# 一键构建 + 部署
npm run deploy:static
# 等价于: npm run build && tcb hosting deploy ./dist / -e price-comparing-demo-d2adc62c70c
```

### 云函数部署

```bash
# 快速比价
tcb fn code update analyzeQuotes -e <envId> --deployMode zip

# 详细报告
tcb fn code update generateReport -e <envId> --deployMode zip
```

> `--deployMode zip`（ZIP base64 直传）比默认的 COS 上传更可靠，建议始终使用。

### 新建 generateReport 额外步骤

首次部署 `generateReport` 时需在控制台手动创建 HTTP 触发器：

```bash
tcb service create -e <envId> -p /api/generateReport -f generateReport
```

### 部署验证

```bash
# 健康检查：秒级确认线上代码版本
curl "https://<网关>/api/analyzeQuotes?ping=1"
# → {"success":true,"pong":true,"version":"v4-align-engine-185s"}

curl "https://<网关>/api/generateReport?ping=1"
# → {"success":true,"pong":true,"version":"v1-report-pro"}
```

若返回 400（缺少 workbooks），说明线上仍是旧版，需重新部署。

### 云函数环境变量

**analyzeQuotes**：

```env
AI_API_KEY=                # DeepSeek API Key（必填）
AI_API_ENDPOINT=https://api.deepseek.com/chat/completions
AI_MODEL=deepseek-v4-flash
```

**generateReport**：

```env
AI_API_KEY=                # DeepSeek API Key（必填，可复用同一 Key）
AI_API_ENDPOINT=https://api.deepseek.com/chat/completions
AI_REPORT_MODEL=deepseek-v4-pro
```

### 云函数配置要求

| 配置项 | analyzeQuotes | generateReport |
|--------|---------------|----------------|
| 执行超时 | 200 秒 | 300 秒 |
| 内存 | 512 MB | 512 MB |
| HTTP 路径 | `/api/analyzeQuotes` | `/api/generateReport` |

---

## 环境变量

### 前端（Vite 构建时注入）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_USE_MOCK` | `true` | `false` 时调用真实 API |
| `VITE_ANALYZE_API_URL` | — | 快速比价云函数 HTTP 地址 |
| `VITE_REPORT_API_URL` | — | 详细报告云函数 HTTP 地址 |

### 云函数（CloudBase 控制台配置）

| 变量 | 函数 | 说明 |
|------|------|------|
| `AI_API_KEY` | 两个函数 | DeepSeek API 密钥 |
| `AI_API_ENDPOINT` | 两个函数 | API 端点（优先级高于 `AI_API_BASE_URL`） |
| `AI_MODEL` | analyzeQuotes | AI 模型，默认 `deepseek-v4-flash` |
| `AI_REPORT_MODEL` | generateReport | AI 模型，默认 `deepseek-v4-pro` |

> ⚠️ DeepSeek 旧模型名 `deepseek-chat` / `deepseek-reasoner` 将于 2026-07-24 下线，请使用 V4 新名称。

---

## 验收清单

| # | 验收点 | 预期行为 |
|---|--------|----------|
| 1 | 文件数量校验 | 1 份时按钮禁用；2-3 份时启用；第 4 份拒绝 |
| 2 | 文件类型校验 | 非 XLSX 文件拒绝 |
| 3 | 文件大小校验 | 超过 10 MB 拒绝 |
| 4 | 快速比价 | 生成比价表：按项目号对齐，标最低价、漏报、量级异常 |
| 5 | 异常检测 | 代码自动识别漏报、量级差异 ≥2×、多值口径不明、模具费 |
| 6 | AI 建议 | 中文采购建议含整体推荐和关键风险项 |
| 7 | AI 降级 | AI 失败时比价表照常返回（含降级提示），不静默切 Mock |
| 8 | 详细报告 | 生成 7 章多维分析报告，含规格逐项核对 |
| 9 | Word 导出 | 生成 .docx 文件，含完整报告 + 比价明细表 |
| 10 | PDF 导出 | 调用浏览器打印，仅打印报告区域 |
| 11 | 构建 | `npm run build` 成功，产物在 `dist/` |
| 12 | Mock 模式 | 本地开发展示模拟数据，无需后端 |

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React | 19.x |
| 构建工具 | Vite | 8.x |
| 代码检查 | Oxlint | 1.x |
| Excel 解析 | read-excel-file | 9.x |
| Word 生成 | docx | 9.x |
| 文件下载 | file-saver | 2.x |
| 图标库 | Lucide React | 1.x |
| AI 模型 | DeepSeek V4 Flash / V4 Pro | — |
| 云平台 | 腾讯云 CloudBase | — |
| 运行时 | Node.js | ≥ 18 |

---

## 开发约定

- **无第三方后端依赖**：两个云函数均为零 `dependencies`，仅使用 Node.js 内置模块（`fetch`、`Buffer`）。
- **前端组件职责单一**：每个组件最多 ~80 行，UI 展示与业务逻辑分离。
- **错误处理**：所有 API 调用有明确的错误消息，不静默失败。AI 失败不阻断主流程。
- **代码注释**：关键设计决策和"为什么这样做"有中文注释，文件顶部有模块职责说明。
- **Git**：`.env` 不提交（已在 `.gitignore` 中），仅保留 `.env.example` 和 `.env.production` 作为参考。

---

*Made for 采购经理 who compare quotes every day.*
