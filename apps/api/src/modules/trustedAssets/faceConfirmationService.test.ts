import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateGenerationTask, TrustedPortrait } from '@seqora/contracts'
import type {
  AssetLibraryProvider,
  ProviderPortrait,
} from '../../core/generation/volcArkAssetLibraryProvider.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import { GenerationTaskRepository } from '../generation/repository.js'
import { GenerationService } from '../generation/service.js'
import { ProjectRepository } from '../projects/repository.js'
import { FaceConfirmationService } from './faceConfirmationService.js'
import { TrustedAssetService } from './service.js'
import {
  assetId,
  createFaceConfirmationStore,
  face,
  principal,
  projectId,
} from './faceConfirmationFixtures.js'

let store: Awaited<ReturnType<typeof createFaceConfirmationStore>>
let projects: ProjectRepository
let tasks: GenerationTaskRepository
beforeEach(async () => {
  store = await createFaceConfirmationStore()
  projects = new ProjectRepository(store)
  tasks = new GenerationTaskRepository(store)
})

describe('face confirmation recovery and local compatibility', () => {
  it.each([
    ['refresh', true],
    ['refresh', false],
    ['refreshProcessing', true],
    ['refreshProcessing', false],
    ['registerVirtual', true],
    ['registerVirtual', false],
  ] as const)(
    'rejects a late %s after explicit binding changes from A to B (repository=%s)',
    async (operation, useRepository) => {
      const confirmed = (await projects.confirmFace(projectId, assetId, face(), principal))!
      if (operation !== 'registerVirtual') {
        await projects.updateTrustedPortrait(
          confirmed,
          binding('resource-a', operation === 'refresh' ? 'active' : 'processing'),
          'ai-virtual',
          principal,
        )
      }
      const started = deferred<void>()
      const response = deferred<ProviderPortrait>()
      const lateResponse = () => {
        started.resolve()
        return response.promise
      }
      const provider: AssetLibraryProvider = {
        createVirtualGroup: async () => 'group',
        createVirtualAsset: lateResponse,
        getPortrait: async (id) =>
          id === 'resource-b' ? { ...binding(id, 'processing'), assetType: 'Image' } : lateResponse(),
        listPortraits: async () => [await lateResponse()],
        listAuthorizedPortraits: async () => [],
      }
      const trusted = new TrustedAssetService(
        store,
        provider,
        {} as ObjectStorage,
        'test-only',
        'https://test.example',
        '',
        '',
        useRepository ? projects : null,
      )
      const pending =
        operation === 'refreshProcessing'
          ? trusted.refreshProcessing(projectId, principal)
          : trusted[operation](projectId, assetId, principal)
      const rejected = expect(pending).rejects.toMatchObject({ code: 'PORTRAIT_BINDING_CHANGED' })
      await started.promise
      const replacement = await trusted.bind(projectId, assetId, 'resource-b', principal)
      expect(replacement.attributes).toMatchObject({
        trustedPortrait: { assetId: 'resource-b', status: 'processing' },
      })
      response.resolve({ ...binding('resource-a'), assetType: 'Image' })
      await rejected
      expect((await projects.findOwnedAsset(projectId, assetId, principal))!.attributes).toMatchObject({
        trustedPortrait: { assetId: 'resource-b', status: 'processing' },
        faceReference: face(),
      })
    },
  )

  it('saves confirmation even when registration is not configured, with no debit', async () => {
    const trusted = new TrustedAssetService(store, null, {} as ObjectStorage, 'test-only', '', '')
    const dispatch = vi.fn()
    const generation = new GenerationService(
      tasks,
      { dispatch },
      null,
      undefined,
      null,
      null,
      null,
      (...args) => trusted.assertVirtualRegistrationReady(...args),
    )
    const service = new FaceConfirmationService(projects, tasks, generation, trusted)
    const result = await service.confirm(projectId, assetId, { faceReference: face() }, principal)
    expect(result).toMatchObject({
      asset: { attributes: { faceStatus: 'approved', faceReference: face() } },
      registrationTask: null,
      registrationError: expect.any(String),
    })
    expect((await projects.findOwnedAsset(projectId, assetId, principal))!.attributes).toMatchObject({
      faceStatus: 'approved',
    })
    expect(store.read((state) => state.tasks.filter((task) => task.provider === 'asset-library'))).toEqual([])
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent manual/automatic local tasks and charges the fixed server price', async () => {
    await projects.confirmFace(projectId, assetId, face(), principal)
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        tasks.createWithCharge(input(`concurrent-${index}`, index % 2 === 0), principal),
      ),
    )
    expect(new Set(created.map((task) => task.id)).size).toBe(1)
    expect(created[0].estimatedCredits).toBe(1)
    expect(
      store.read((state) =>
        state.ledger
          .filter((entry) => entry.id === `generation-${created[0].clientRequestId}`)
          .map((entry) => entry.amount),
      ),
    ).toEqual([-1])
  })

  it('allows a new face despite a running old task and fails stale writeback', async () => {
    const oldAsset = (await projects.confirmFace(projectId, assetId, face(), principal))!
    const first = await tasks.createWithCharge(input('old-face'), principal)
    await projects.confirmFace(projectId, assetId, face('face-two'), principal)
    const second = await tasks.createWithCharge(input('new-face'), principal)
    expect(second.id).not.toBe(first.id)
    expect(second.metadata.faceReferenceId).toBe(face('face-two').id)
    await expect(
      projects.updateTrustedPortrait(
        oldAsset,
        {
          assetId: 'old-upstream',
          groupId: 'group',
          groupType: 'AIGC',
          name: 'old',
          status: 'active',
          faceReferenceId: face().id,
          checkedAt: new Date().toISOString(),
          previewUrl: null,
          errorCode: null,
          errorMessage: null,
        },
        'ai-virtual',
        principal,
      ),
    ).rejects.toMatchObject({ code: 'FACE_CONFIRMATION_CHANGED' })
  })

  it('leaves hidden failures unchanged on automatic repeat but allows one explicit manual retry', async () => {
    await projects.confirmFace(projectId, assetId, face(), principal)
    const failed = await tasks.createWithCharge(input('failed-auto', true), principal)
    await store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === failed.id)!
      task.status = 'failed'
      task.error = 'provider failed'
      task.metadata.queueHiddenAt = new Date().toISOString()
    })
    expect((await tasks.createWithCharge(input('automatic-repeat', true), principal)).id).toBe(failed.id)
    const retry = await tasks.createWithCharge(input('manual-retry'), principal)
    expect(retry.id).not.toBe(failed.id)
    expect((await tasks.createWithCharge(input('second-manual'), principal)).id).toBe(retry.id)
  })
})

function input(clientRequestId: string, automaticFaceConfirmation = false): CreateGenerationTask {
  return {
    clientRequestId,
    projectId,
    kind: 'text',
    provider: 'asset-library',
    label: 'Register',
    estimatedCredits: 999,
    metadata: { assetId, trustedAssetOperation: 'register-virtual', automaticFaceConfirmation },
  }
}

function binding(id: string, status: TrustedPortrait['status'] = 'active'): TrustedPortrait {
  return {
    assetId: id,
    groupId: 'group',
    groupType: 'AIGC',
    name: id,
    status,
    faceReferenceId: face().id,
    previewUrl: null,
    errorCode: null,
    errorMessage: null,
    checkedAt: new Date().toISOString(),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
