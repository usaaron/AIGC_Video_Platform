import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from './repository.js'
import { GenerationService } from './service.js'
import { registerGenerationRoutes } from './routes.js'
import { buildQueuedGenerationTask } from './taskCreation.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'

describe('content review HTTP contract',()=>{
  it('requires authentication and validates the body; persists a real review without generating',async()=>{
    const principal={tenantId:'tenant-seqora-demo',userId:'user-member',roles:['member'] as ['member']}
    const store=new AppStore(null);await store.initialize()
    const task=buildQueuedGenerationTask({clientRequestId:'review-http',projectId:'project-midnight-film',provider:'seedance',kind:'video',label:'x',estimatedCredits:18},principal,'2026-10-10T00:00:00.000Z')
    task.status='completed';task.resultUrl='/video'
    await store.mutate(state=>{state.tasks=[task]})
    const dispatch=vi.fn()
    const service=new GenerationService(new GenerationTaskRepository(store),{dispatch} as unknown as TaskDispatcher)
    const app=Fastify()
    app.addHook('onRequest',async request=>{ if(request.headers['x-test-user']==='member') request.principal=principal })
    await registerGenerationRoutes(app,service)
    const url=`/generation/tasks/${task.id}/content-review`
    const input={decision:'approved',note:'核对通过',expectedUpdatedAt:task.updatedAt}
    try {
      expect((await app.inject({method:'POST',url,payload:input})).statusCode).toBe(401)
      expect((await app.inject({method:'POST',url,headers:{'x-test-user':'member'},payload:{...input,decision:'rejected',note:''}})).statusCode).toBe(400)
      const response=await app.inject({method:'POST',url,headers:{'x-test-user':'member'},payload:input})
      expect(response.statusCode).toBe(200)
      expect(response.json().metadata.contentReview).toMatchObject({decision:'approved',method:'human',reviewedBy:principal.userId})
      expect(dispatch).not.toHaveBeenCalled()
      expect(store.read(state=>state.tasks.length)).toBe(1)
    } finally {await app.close()}
  })
})
