import { readFile, writeFile } from 'node:fs/promises'
import { auditRigidVideoFrames, readGrayscaleVideoFrames } from '../core/generation/rigidFrameAudit.js'

const videoPath = process.argv[2]
const outputPath = process.argv[3]
const prompt =
  process.argv.slice(4).join(' ') ||
  '固定隔离栏底板以螺栓固定于混凝土地面，前排人群施压；单一连续镜头，固定机位。'
const observationsPath = process.env.RIGID_FRAME_OBSERVATIONS?.trim()

if (!videoPath) {
  process.stderr.write('Usage: tsx src/scripts/auditRigidVideo.ts <video.mp4> [report.json] [prompt...]\n')
  process.exit(2)
}

await readFile(videoPath)
const { frames, fps } = await readGrayscaleVideoFrames(videoPath)
const observations = observationsPath
  ? (JSON.parse(await readFile(observationsPath, 'utf8')) as { observations?: unknown[] })
  : null
const report = auditRigidVideoFrames({
  prompt,
  frames,
  fps,
  ...(Array.isArray(observations?.observations)
    ? { observations: observations.observations as never[] }
    : {}),
})
const serialized = JSON.stringify({ videoPath, ...report }, null, 2)
if (outputPath) await writeFile(outputPath, serialized, 'utf8')
process.stdout.write(`${serialized}\n`)
