import type { AppConfig } from '../config.js'
import { createObjectStorage, type ObjectStorage } from '../infra/objectStorage.js'

export type RuntimeStorage = {
  objectStorage: ObjectStorage
}

export function createRuntimeStorage(config: AppConfig): RuntimeStorage {
  return {
    objectStorage: createObjectStorage(config),
  }
}
