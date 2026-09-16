import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function LibraryDialog({ title, onClose, children, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return createPortal(
    <dialog
      ref={ref}
      className={`library-dialog ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect()
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose()
        }
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭预览">
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>,
    document.body,
  )
}
