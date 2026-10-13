import { describe, expect, it, vi } from 'vitest'
import { videoReviewState, type GenerationTask } from '@seqora/contracts'
import { AppStore } from '../../infra/store.js'
import { GenerationTaskRepository } from './repository.js'
import { buildQueuedGenerationTask } from './taskCreation.js'
import { DependencyResolver } from '../../core/jobs/taskDependencyResolver.js'
import { resolveVideoImages } from '../../core/jobs/taskVideoReferences.js'
import { GenerationService } from './service.js'
import type { TaskDispatcher } from '../../core/jobs/taskDispatcher.js'
import type { VideoGenerationProvider } from '../../core/generation/videoProvider.js'

const principal={tenantId:'tenant-seqora-demo',userId:'user-member',roles:['member'] as ['member']}
async function fixture() {
  const store=new AppStore(null); await store.initialize()
  const task=buildQueuedGenerationTask({clientRequestId:'review',projectId:'project-midnight-film',kind:'video',provider:'seedance',label:'test',estimatedCredits:18},principal,'2026-10-10T10:00:00.000Z')
  task.status='completed'; task.resultUrl='/video'; task.metadata={videoStorageKey:'v.mp4',generatedOutputs:[{view:'last-frame',storageKey:'tail.jpg',contentType:'image/jpeg',size:10}]}
  await store.mutate(state=>{state.tasks=[task]})
  return {store,task,repository:new GenerationTaskRepository(store)}
}
describe('video content review gate',()=>{
  it('persists review with audit history, rejects other users/tenants and stale writes',async()=>{
    const {task,repository}=await fixture()
    const input={decision:'approved' as const,note:'已核对',expectedUpdatedAt:task.updatedAt}
    await expect(repository.reviewVideo(task.id,input,{...principal,userId:'other'})).rejects.toMatchObject({code:'TASK_NOT_FOUND'})
    await expect(repository.reviewVideo(task.id,input,{...principal,tenantId:'other',roles:['owner']})).rejects.toMatchObject({code:'TASK_NOT_FOUND'})
    const approved=await repository.reviewVideo(task.id,input,principal)
    expect(videoReviewState(approved)).toBe('approved')
    expect(approved.status).toBe('completed'); expect(approved.estimatedCredits).toBe(18)
    await expect(repository.reviewVideo(task.id,input,principal)).rejects.toMatchObject({code:'VIDEO_REVIEW_STALE'})
    const rejected=await repository.reviewVideo(task.id,{decision:'rejected',note:'右手持物错误',expectedUpdatedAt:approved.updatedAt},principal)
    expect(videoReviewState(rejected)).toBe('rejected')
    expect(rejected.metadata.contentReviewHistory).toHaveLength(1)
  })
  it('holds the dependency without attempts, even when dependsOnTaskIds is omitted; checks again at reference resolution',async()=>{
    const {task,repository,store}=await fixture()
    const child={...task,id:'child',status:'queued',metadata:{continuitySourceTaskId:task.id}} as GenerationTask
    const resolver=new DependencyResolver()
    expect(resolver.state(child,[task])).toBe('waiting')
    await expect(resolveVideoImages(child,store,{objectStorage:{} as never,mediaRepository:null,videoSourceUrl:null})).rejects.toThrow('内容验收')
    const approved=await repository.reviewVideo(task.id,{decision:'approved',note:'ok',expectedUpdatedAt:task.updatedAt},principal)
    expect(resolver.state(child,[approved])).toBe('ready')
    expect(resolver.state(child,[{...approved,tenantId:'other'}])).toBe('failed')
    const rejected=await repository.reviewVideo(task.id,{decision:'rejected',note:'问题',expectedUpdatedAt:approved.updatedAt},principal)
    expect(resolver.state(child,[rejected])).toBe('waiting')
  })
  it('does not accept a forged approval on generic creation',()=>{
    const task=buildQueuedGenerationTask({clientRequestId:'fake',projectId:'p',kind:'video',provider:'seedance',label:'x',estimatedCredits:18,metadata:{contentReview:{decision:'approved'},contentReviewHistory:[{}],localPostprocess:{outputSha256:'fake'}}},principal,new Date().toISOString())
    expect(task.metadata.contentReview).toBeUndefined();expect(task.metadata.localPostprocess).toBeUndefined()
  })
  it('blocks content approval while a rigid physics audit is not passed', async () => {
    const { task, repository } = await fixture()
    task.metadata.rigidPhysicsContract = { version: 'rigid-physics-v1', objects: [] }
    task.metadata.rigidPhysicsAudit = { status: 'failed' }
    await expect(
      repository.reviewVideo(task.id, { decision: 'approved', note: '已核对', expectedUpdatedAt: task.updatedAt }, principal),
    ).rejects.toMatchObject({ code: 'RIGID_PHYSICS_BLOCKED' })
  })
  it('rejects a known text conflict before charge or dispatch',async()=>{
    const repository={canCreate:vi.fn(async()=>true),storyboardVideoContext:vi.fn(async()=>({shot:{prompt:'屏幕呈现\n必须显示数字。不要显示数字。',references:[]},assets:[]})),createWithCharge:vi.fn()} as unknown as GenerationTaskRepository
    const dispatcher={dispatch:vi.fn()} as unknown as TaskDispatcher
    const service=new GenerationService(repository,dispatcher,{} as VideoGenerationProvider)
    await expect(service.createTask({clientRequestId:'x',projectId:'p',provider:'seedance',kind:'video',label:'x',estimatedCredits:18,metadata:{shotId:'s'}},principal)).rejects.toMatchObject({code:'VIDEO_PROMPT_CONFLICT'})
    expect(repository.createWithCharge).not.toHaveBeenCalled();expect(dispatcher.dispatch).not.toHaveBeenCalled()
  })
})
