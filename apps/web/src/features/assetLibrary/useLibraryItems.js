import { useEffect, useState } from 'react'
import { api } from '../../services/apiClient'

export function useLibraryItems({ open, category, kind, query, page, reload = 0 }) {
  const [result, setResult] = useState({ items: [], total: 0, pageSize: 12 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError('')
    const timer = setTimeout(() => {
      api
        .libraryItems({ category, kind, q: query, page, pageSize: 12, deleted: 'active' })
        .then((value) => {
          if (active) setResult(value)
        })
        .catch((failure) => {
          if (active) setError(failure.message)
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 180)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [open, category, kind, query, page, reload])
  return { result, loading, error }
}
