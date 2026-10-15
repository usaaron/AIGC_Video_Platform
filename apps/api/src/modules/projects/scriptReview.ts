import {
  scriptReviewContentSchema,
  SCRIPT_OPERATION_CREDITS,
  type Principal,
  type ScriptCreativeDirection,
  type ScriptModel,
} from '@seqora/contracts'
import type { TextGenerationProvider } from '../../core/generation/textProvider.js'
import type { CreditLedger } from '../billing/creditLedger.js'
import { runBillableScriptOperation } from '../billing/scriptBilling.js'
import { directionSummary } from './projectPresentation.js'
import { parseProviderJson } from './providerJson.js'
import { usageContextForPrincipal } from './scriptContext.js'

export function generateScriptReview(
  provider: TextGenerationProvider,
  ledger: CreditLedger | null,
  project: { name: string; contentType: string; aspectRatio: string },
  source: string,
  direction: ScriptCreativeDirection,
  clientRequestId: string,
  principal: Principal,
  model: ScriptModel,
) {
  return runBillableScriptOperation(
    ledger,
    principal,
    `script-review-${clientRequestId}`,
    SCRIPT_OPERATION_CREDITS.review,
    '专业审核剧本',
    async () => {
      const response = await provider.generate({
        systemPrompt:
          '你是漫剧公司的编导总监、摄影指导和剪辑指导。请只返回严格 JSON，不要 Markdown，不要代码块。必须包含 score（0到100整数）、verdict、dimensions、priorityActions。dimensions 必须覆盖 plot、character、dialogue、style、composition、lighting、camera，每项包含 key、score、finding、suggestion。评价要具体到可执行的剧本修改和画面执行，不要泛泛而谈。',
        userPrompt: `项目：${project.name}\n内容类型：${project.contentType}\n画面比例：${project.aspectRatio}\n当前选择模型：${model}\n创作方向：${directionSummary(direction)}\n\n待审核剧本：\n${source}`,
        maxOutputTokens: 4_000,
        model,
        usageContext: usageContextForPrincipal(principal),
      })
      const review = parseProviderJson(response, scriptReviewContentSchema, '专业审核结果格式错误')
      return { ...review, generatedAt: new Date().toISOString() }
    },
  )
}
