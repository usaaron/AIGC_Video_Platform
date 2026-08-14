import { api } from '../../services/apiClient'

export function createImage2Batch(input) {
  return api.createImage2Batch(input)
}

export async function pollImage2Batch(projectId, batchId) {
  const tasks = await api.tasks(projectId)
  return tasks.filter((task) => task.metadata?.image2BatchId === batchId)
}

export function uploadReference(projectId, file) {
  return api.uploadMedia(projectId, file)
}

