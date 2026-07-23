const RATIO_MODES = {
  '9:16': 'portrait',
  '16:9': 'landscape',
  '1:1': 'square',
}

export function projectRatioMode(aspectRatio) {
  return RATIO_MODES[aspectRatio] || 'landscape'
}
