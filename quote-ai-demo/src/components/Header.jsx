import { Building2, ShieldCheck } from 'lucide-react'
import { isMockAnalysisMode } from '../services/analyzeQuotes.js'

function Header() {
  return (
    <header className="app-header">
      <div className="header-inner">
        <div className="brand-lockup">
          <div className="brand-icon" aria-hidden="true">
            <Building2 size={22} />
          </div>
          <div>
            <h1>智采 AI 报价比价</h1>
            <p>Excel 报价单智能比价 · DeepSeek 实时分析</p>
          </div>
        </div>

        <div className="header-meta">
          <span>桌面端优先</span>
          <span>2-3 份 Excel 报价单</span>
          <span className="success-badge">
            <ShieldCheck size={16} />
            {isMockAnalysisMode ? '本地 Mock 模式' : '真实 AI 已接入'}
          </span>
        </div>
      </div>
    </header>
  )
}

export default Header
