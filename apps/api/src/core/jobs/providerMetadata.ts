export const SEEDANCE_PROVIDER_NAME = 'aideos-seedance'
export const IMG2_PROVIDER_NAME = 'aideos-img2'
export const AUDIO_PROVIDER_NAME = 'aideos-audio'
export const REMOTE_PROVIDER_NAMES = new Set([
  SEEDANCE_PROVIDER_NAME,
  IMG2_PROVIDER_NAME,
  AUDIO_PROVIDER_NAME,
])

export function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
