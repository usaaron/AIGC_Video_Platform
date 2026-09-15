import { libraryDocuments } from '@/lib/library-documents';
import type { ScriptProject } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return Response.json({ error: '需要宿主授权' }, { status: 401 });
  const offset = Math.max(0, Number(new URL(request.url).searchParams.get('offset')) || 0);
  const backend = (process.env.BACKEND_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const headers = { Authorization: authorization };
  const response = await fetch(`${backend}/story-projects?limit=10&offset=${offset}&include_archived=true`, { headers, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return Response.json({ error: '剧本项目暂时无法读取' }, { status: response.status });
  const projects = await response.json() as { data: { project_id: string }[]; total: number };
  const documents = [];
  for (const project of projects.data) {
    const workspace = await fetch(`${backend}/story-projects/${encodeURIComponent(project.project_id)}/workspace`, { headers, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (workspace.status === 404) continue; // A planning-only project has no episode workspace yet.
    if (!workspace.ok) return Response.json({ error: '部分剧本暂时无法读取' }, { status: workspace.status });
    const snapshot = await workspace.json() as { data: { workspace_payload: ScriptProject } };
    documents.push(...libraryDocuments(snapshot.data.workspace_payload));
  }
  return Response.json({ documents, nextOffset: offset + projects.data.length < projects.total ? offset + projects.data.length : null });
}
