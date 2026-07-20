export function completedOutput(task) {
  return task?.status === 'completed' ? task.outputs[0] || null : null
}

export function isActive(task) {
  return task?.status === 'queued' || task?.status === 'running'
}

export function toReference(candidate, name) {
  return { id: candidate.id, url: candidate.url, name }
}

export function orderedTurnaroundOutputs(outputs = []) {
  const views = ['front', 'side', 'back']
  return views.map((view) => outputs.find((output) => output.view === view)).filter(Boolean)
}

export function viewLabel(view) {
  return { front: '正面', side: '侧面', back: '背面' }[view] || '设定图'
}

export async function downloadTurnaroundSheet(outputs, name) {
  const selected = outputs.slice(0, 3)
  if (selected.length < 3) throw new Error('三张源图尚未全部生成')
  const images = await Promise.all(selected.map((output) => loadImage(output.url)))
  const canvas = document.createElement('canvas')
  canvas.width = 2400
  canvas.height = 1350
  const context = canvas.getContext('2d')
  context.fillStyle = '#f4f5f1'
  context.fillRect(0, 0, canvas.width, canvas.height)
  images.forEach((image, index) => drawContained(context, image, index * 800 + 40, 70, 720, 1160))
  context.fillStyle = '#20241f'
  context.font = '600 34px sans-serif'
  context.textAlign = 'center'
  selected.forEach((output, index) => context.fillText(viewLabel(output.view), index * 800 + 400, 1285))
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('设定表合成失败')
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name || '人物'}-三视图设定表.png`
  anchor.click()
  URL.revokeObjectURL(url)
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('三视图源图读取失败'))
    image.src = url
  })
}

function drawContained(context, image, x, y, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
}
