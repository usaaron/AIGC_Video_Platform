import { X } from 'lucide-react'
import { IconButton } from '../../components/ui'

export function NotificationToasts({ notifications, onOpen, onDismiss }) {
  if (!notifications.length) return null
  return (
    <div className="notification-toast-stack" aria-live="polite">
      {notifications.map((notification) => (
        <article key={notification.id} className={`notification-toast ${notification.status}`}>
          <span className="notification-status-dot" />
          <button type="button" className="notification-toast-open" onClick={() => void onOpen(notification)}>
            <strong>{notification.title}</strong>
            <small>
              {notification.projectName} · {notification.label}
            </small>
          </button>
          <IconButton
            label="关闭提示"
            className="notification-toast-close"
            onClick={() => onDismiss(notification.id)}
          >
            <X size={15} />
          </IconButton>
        </article>
      ))}
    </div>
  )
}
