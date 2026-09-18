import { describe, expect, it } from 'vitest'
import { scriptMasterFrameUrl } from './ScriptMasterWorkspace'

describe('embedded script workspace address', () => {
  const origin = 'https://studio.example'
  it('preserves the authenticated project launch on the host service', () => {
    const launchUrl = '/script-master?host_project_id=one#host_token=test-ticket'
    expect(scriptMasterFrameUrl({ enabled: true, launchUrl }, origin)).toBe(origin + launchUrl)
  })
  it('does not send a launch ticket to another origin or another application', () => {
    for (const launchUrl of [
      'https://other.example/script-master',
      '//other.example/script-master',
      'javascript:alert(1)',
      '/admin/',
      '/script-master-fake',
      'https://user:pass@studio.example/script-master',
    ]) {
      expect(() => scriptMasterFrameUrl({ enabled: true, launchUrl }, origin)).toThrow()
    }
    expect(() => scriptMasterFrameUrl({ enabled: false }, origin)).toThrow('暂未配置')
  })
})
