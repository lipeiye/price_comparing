import { Building2, ShieldCheck } from 'lucide-react'

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
            <p>内部演示版 · 请勿上传真实敏感采购数据</p>
          </div>
        </div>

        <div className="header-meta">
          <span>桌面端优先</span>
          <span>2-3 份报价单</span>
          <span className="success-badge">
            <ShieldCheck size={16} />
            Mock 兜底
          </span>
        </div>
      </div>
    </header>
  )
}

export default Header
