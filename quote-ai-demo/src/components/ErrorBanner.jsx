import { AlertCircle } from 'lucide-react'

function ErrorBanner({ message }) {
  if (!message) return null

  return (
    <div className="error-banner" role="alert">
      <AlertCircle size={16} />
      <span>{message}</span>
    </div>
  )
}

export default ErrorBanner
