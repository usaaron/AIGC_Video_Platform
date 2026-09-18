import { useRef } from 'react'

// Decorative only: CSS transforms, no animation loop or generation state.
export function StudioAtmosphere() {
  const surface = useRef(null)
  const move = (event) => {
    if (event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const bounds = event.currentTarget.getBoundingClientRect()
    surface.current?.style.setProperty(
      '--orbit-x',
      `${((event.clientX - bounds.left) / bounds.width - 0.5) * 16}deg`,
    )
    surface.current?.style.setProperty(
      '--orbit-y',
      `${((event.clientY - bounds.top) / bounds.height - 0.5) * -12}deg`,
    )
  }
  const reset = () => {
    surface.current?.style.setProperty('--orbit-x', '0deg')
    surface.current?.style.setProperty('--orbit-y', '0deg')
  }
  return (
    <div className="studio-atmosphere" aria-hidden="true" onPointerMove={move} onPointerLeave={reset}>
      <div className="studio-orbit" ref={surface}>
        <div className="studio-orbit-halo" />
        <div className="studio-orbit-core" />
        {[0, 1, 2, 3].map((ring) => (
          <i key={ring} className="studio-orbit-ring" style={{ '--ring': ring }} />
        ))}
        <span className="studio-orbit-caption">IMAGINATION, IN MOTION.</span>
      </div>
      <div className="studio-particles">
        {Array.from({ length: 22 }, (_, index) => (
          <i
            key={index}
            style={{
              '--x': `${(index * 37 + 13) % 100}%`,
              '--y': `${(index * 53 + 7) % 100}%`,
              '--delay': `${-index * 1.7}s`,
              '--duration': `${10 + (index % 7)}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
