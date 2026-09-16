import { describe, expect, it } from 'vitest'
import {
  scriptGenerationSystemPrompt,
  scriptGenerationUserPrompt,
  scriptDetailSystemPrompt,
  scriptDetailUserPrompt,
  scriptSegmentSystemPrompt,
  scriptSegmentUserPrompt,
  withChineseScriptRules,
} from './scriptWriting.js'

describe('script prompt character provenance', () => {
  for (const mode of ['web-series', 'advertisement', 'short-film', 'short-video'] as const) {
    it(`${mode}: generation, rewrite, detail and continuation do not seed example characters`, () => {
      for (const prompt of [
        scriptGenerationSystemPrompt(mode, true),
        scriptGenerationSystemPrompt(mode, false),
        scriptDetailSystemPrompt(mode),
        scriptSegmentSystemPrompt(mode),
      ]) {
        const system = withChineseScriptRules(prompt)
        expect(system).not.toMatch(/林晚|28岁女性|28 岁女性/)
        expect(system).toContain('续写沿用已有角色')
        expect(system).toContain('绝不能把示例姓名、职业、服装或情节当作故事事实')
        expect(system).toContain('有明确换装才增加')
        expect(system).toContain('人物名-具体版本')
        expect(system).toContain('相同造型不要改名重建')
      }
    })

    it(`${mode}: preserves actual user names and costume details, including names previously used in examples`, () => {
      const source = '顾砚是陶艺师，身穿蓝色工装；妹妹林晚穿绿色衬衫，两人修复一只旧瓷碗。'
      for (const prompt of [
        scriptGenerationUserPrompt(mode, '陶艺家庭剧', '沿用角色设定', source),
        scriptDetailUserPrompt(mode, '陶艺家庭剧', source),
        scriptSegmentUserPrompt(mode, '陶艺家庭剧', source, '修好瓷碗', 60),
      ]) {
        expect(prompt).toContain(source)
      }
    })
  }
})
