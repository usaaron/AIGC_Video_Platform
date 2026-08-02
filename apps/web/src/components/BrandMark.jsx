import { Aperture } from 'lucide-react'

export function BrandMark({ size = 20, className = '', spin = false }) {
  return (
    <span className={`brand-mark ${spin ? 'brand-mark-spin' : ''} ${className}`.trim()} aria-hidden="true">
      <Aperture size={size} />
    </span>
  )
}
