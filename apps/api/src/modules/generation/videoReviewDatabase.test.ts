import { describe, expect, it } from 'vitest'
import { videoReviewState } from '@seqora/contracts'
import type { AccountDatabase } from '../../infra/postgres.js'
import { GenerationTaskRepository } from './repository.js'
import { buildQueuedGenerationTask } from './taskCreation.js'

describe('database review transaction contract',()=>{
  it('locks the authorized row, persists metadata and preserves media and billing fields',async()=>{
    const principal={tenantId:'tenant-seqora-demo',userId:'user-member',roles:['member'] as ['member']}
    const task=buildQueuedGenerationTask({clientRequestId:'db-review',projectId:'p',kind:'video',provider:'seedance',label:'x',estimatedCredits:18},principal,'2026-10-10T00:00:00.000Z')
    task.status='completed';task.resultUrl='/video';task.metadata={videoStorageKey:'original.mp4',providerTaskId:'remote'}
    const row=Object.fromEntries(Object.entries(task).map(([key,value])=>[key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),value]))
    for(const key of ['lease_acquired_at','lease_heartbeat_at','lease_expires_at','lease_owner_id','lease_token']) row[key]=null
    row.attempts=1;row.max_attempts=3
    const calls:{sql:string;params:unknown[]}[]=[]
    const query=async(sql:string,params:unknown[])=>{
      calls.push({sql,params})
      if(sql.includes('SELECT')) return {rows:[row]}
      if(sql.includes('UPDATE')) return {rows:[{...row,metadata:JSON.parse(String(params[1])),updated_at:params[14]}]}
      throw Error('Unexpected SQL')
    }
    const database={transaction:async(callback:(client:{query:typeof query})=>Promise<unknown>)=>callback({query})} as unknown as AccountDatabase
    const repository=new GenerationTaskRepository(null,null,database)
    const reviewed=await repository.reviewVideo(task.id,{decision:'approved',note:'ok',expectedUpdatedAt:task.updatedAt},principal)
    expect(videoReviewState(reviewed)).toBe('approved')
    expect(reviewed.metadata.providerTaskId).toBe('remote')
    expect(reviewed.metadata.videoStorageKey).toBe('original.mp4')
    expect(reviewed.estimatedCredits).toBe(18)
    expect(calls[0]?.sql).toContain('FOR UPDATE')
    expect(calls[0]?.sql).toContain('tenant_id = $2')
    expect(calls[0]?.params).toEqual([task.id,principal.tenantId,false,principal.userId])
    expect(calls[1]?.sql).not.toContain('estimated_credits =')
  })
})
