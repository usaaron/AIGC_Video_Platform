import { describe, expect, it } from 'vitest'
import { videoProviderFailure } from './videoProviderFailure.js'

describe('safe video failure classification', () => {
  it.each([
    ['copyright_violation', 'UPSTREAM_COPYRIGHT_REJECTED'],
    ['content_policy_violation', 'UPSTREAM_CONTENT_REJECTED'],
    ['quota_exceeded', 'UPSTREAM_QUOTA_EXCEEDED'],
  ])('classifies %s without exposing the response body', (code, expectedCode) => {
    const failure = videoProviderFailure('failed', code, 'secret-token private-response debug-body')
    expect(failure.failureCode).toBe(expectedCode)
    expect(JSON.stringify(failure)).not.toMatch(/secret-token|private-response|debug-body/)
  })

  it('uses the upstream code before falling back to a copyright message', () => {
    expect(videoProviderFailure('failed', 'quota_exceeded', 'copyright')).toMatchObject({
      failureCode: 'UPSTREAM_QUOTA_EXCEEDED',
    })
    expect(videoProviderFailure('failed', undefined, 'copyright rejection: secret-token')).toMatchObject({
      failureCode: 'UPSTREAM_COPYRIGHT_REJECTED',
    })
    expect(videoProviderFailure('failed', 'arbitrary-private-code', 'private-response')).toEqual({
      failureCode: 'UPSTREAM_FAILED',
      error: '上游视频生成失败，请稍后重试。',
    })
  })

  it('retains only a bounded request identifier for support diagnostics', () => {
    expect(
      videoProviderFailure('failed', undefined, 'private body. Request id: 02178990123456789-abc'),
    ).toMatchObject({ providerRequestId: '02178990123456789-abc' })
    expect(videoProviderFailure('failed', undefined, 'private body', 'request_0123456789')).toMatchObject({
      providerRequestId: 'request_0123456789',
    })
    for (const value of ['https://provider.example/secret', 'request-id?token=secret', 'a'.repeat(129)]) {
      expect(
        videoProviderFailure('failed', undefined, `Request id: ${value}`, value).providerRequestId,
      ).toBeUndefined()
    }
  })
})
