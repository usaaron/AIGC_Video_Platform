import { useCallback, useEffect, useState } from 'react'

export function useWorkspaceNavigation() {
  const [activeStep, setActiveStep] = useState('overview')
  const [mobileNav, setMobileNav] = useState(false)

  const navigateTo = useCallback((id) => {
    setActiveStep(id)
    setMobileNav(false)
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [activeStep])

  return {
    activeStep,
    mobileNav,
    setMobileNav,
    navigateTo,
  }
}
