export async function inspectDeliveryDialog({ job, inspect, inspectGate, setDialog }) {
  if (!inspect) return
  const request = { job, status: 'loading', snapshot: null, gate: null, error: '' }
  setDialog(request)
  const complete = (result) => setDialog((current) => (current === request ? result : current))
  try {
    const [snapshot, gate] = await Promise.all([
      inspect(job),
      inspectGate ? inspectGate(job) : Promise.resolve(null),
    ])
    complete({ job, status: 'ready', snapshot, gate, error: '' })
  } catch (error) {
    complete({
      job,
      status: 'error',
      snapshot: null,
      gate: null,
      error: error?.message || '暂时无法读取交付核验',
    })
  }
}
