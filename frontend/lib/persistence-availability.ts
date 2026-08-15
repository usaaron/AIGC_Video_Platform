export function shouldStartPersistenceCooldown(status?: number): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}
