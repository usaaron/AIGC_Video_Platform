import type { ProjectMarketProfile } from "./types.ts";
import { CreatorNarrativeLanguageError } from "./mainland-language.ts";

const storyboardConflictMessages = new Set([
  "分镜版本已变化，请重新加载。",
  "分镜已被其他操作更新，请重新加载后再保存。",
  "本场包含已锁定镜头，请先解锁需要重编的场景。",
  "请先单独解锁镜头，再修改或移除其内容。",
  "视觉方向会影响已锁定镜头，请先解锁。",
  "本场已锁定，请先解锁。",
  "请先采用或放弃当前候选。",
  "分镜候选遗漏、重复或重排了正文引用；原分镜已保留，请重试本场。",
]);

const authorConflictMessages = new Set([
  "冲突审阅记录已不可用，请重新检查本次修改。",
  "正文、规划或修改要求已变化，请重新检查影响后再确认。",
  "请选择当前审阅中的处理方案；自定义方向须先重新检查影响。",
  "该方案涉及上游设定，请确认建立修订版本后在新版规划中处理。",
  "总纲、工作区或处理方案已变化，请重新检查影响后再确认。",
]);

const inspirationMessages = new Set([
  "仅使用“我的标签”时，需要补充创作描述或选择至少一个系统标签。",
  "当前项目尚未形成创作规格，无法开始寻找灵感。",
  "创作规格尚未同步，请稍后重试。",
  "本轮没有返回可回答的问题，已停止保存这次无效响应。请重新加载本轮。",
  "当前创作决定已变化，请重新打开这一轮后再获取方案。",
  "本次方案生成超时，已有方案和答案已保留，请重新获取。",
  "本次没有生成有效候选，已有方案和答案已保留，请重新获取。",
  "本次候选与已展示方案重复或数量不足，已有方案和答案已保留，请换一批。",
  "本次未返回当前决定的候选方案，已有方案和答案已保留。",
  "本次没有返回足够的候选方案，请重试。",
]);

const planningApprovalMessages = new Set([
  "最小剧情单元尚未讲完整：至少需要四个因果事件和单位剧情结算；非结尾部分还须交代下一段承接。",
  "该节点处于1至7集或13至15集的不可拆分碎片区间，请返回父层，与相邻分支一起调整完整剧情事件、状态交接和集数边界。",
]);

export const PLANNING_CALL_BUDGET_EXHAUSTED_MESSAGE = "本次生成已停止，已保存的剧情保持不变。请调整这一部分后再继续；系统不会自动重复生成。";

export function visibleApiError(
  message: string,
  status: number,
  marketProfile: ProjectMarketProfile = "cn_mainland",
  failureClass?: string,
  errorType?: string,
): string {
  if (errorType === "planning_call_budget_exhausted" || failureClass === "planning_call_budget_exhausted") {
    return PLANNING_CALL_BUDGET_EXHAUSTED_MESSAGE;
  }
  if (status === 422) {
    if (message === "故事总纲还有少量内容未完成中文转换。已保留生成进度，请重试继续修正。") return message;
    if (/^The Story Bible contains unresolved quality conflicts: non-Chinese field:/.test(message)) {
      return "故事总纲中仍有未转换成中文的内容，本次未保存。请重试生成。";
    }
    if (/^(?:Value error, )?Current and prior author instruction\/selection text exceeds 32000 characters;/.test(message)) {
      return "本次与历史作者要求及选区合计超过 32000 字。请精简或明确撤回已失效的要求后再发送；系统不会截断内容。";
    }
    if (/^(?:Value error, )?Prior author instruction IDs must be distinct\./.test(message)) {
      return "本集作者要求标识重复，请重新加载后重试。";
    }
    if (/(?:^|; )prior_author_instructions(?:\.\d+(?:\.[a-z_]+)*)?: /.test(message)) {
      return "本集历史作者要求超出限制或格式无效：最多 32 条，每条 3–4000 字。请编辑或明确撤回已失效的要求后重试；系统不会自动删减。";
    }
  }
  if (status === 409 && storyboardConflictMessages.has(message)) return message;
  if (status === 409 && authorConflictMessages.has(message)) return message;
  if (status === 422 && inspirationMessages.has(message)) return message;
  if (failureClass?.trim().toLocaleLowerCase() === "configuration") {
    return marketProfile === "cn_mainland"
      ? "生成服务配置当前不可用，请联系管理员检查模型设置。已保存的内容不会丢失。"
      : "生成服务配置当前不可用，请联系管理员检查模型设置。已保存的内容不会丢失。";
  }
  if (marketProfile !== "cn_mainland") {
    if (status === 422) return "本次生成的内容不完整，系统已保留此前成功保存的内容，请重新尝试。";
    if (status === 429) return "生成服务当前较忙，已保存的内容不会丢失，请稍后重试。";
    if (status === 503) return "生成服务暂时不可用，已保存的内容不会丢失，请稍后重试。";
    return "请求暂未完成，已保存的内容不会丢失，请稍后重试。";
  }
  if (status === 422) {
    return "本次生成的内容不完整，系统已保留此前成功保存的内容，请重新尝试。";
  }
  if (status === 429) {
    return "生成服务当前较忙，已保存的内容不会丢失，请稍后重试。";
  }
  if (status === 503 && /timed out|timeout|超时/i.test(message)) {
    return "生成服务响应超时，已保存的内容不会丢失，请重试本次生成。";
  }
  if (status === 503) {
    if (/429|rate.?limit|too many requests/i.test(message)) {
      return "生成服务当前较忙，已保存的内容不会丢失，请稍后重试。";
    }
    if (/non-json success response|content-type\s*text\/html/i.test(message)) {
      return "生成服务暂时没有返回可用内容，系统已保留此前成功保存的内容，请稍后重试。";
    }
    if (/connect|connection|econnrefused|fetch failed|proxy|backend|socket/i.test(message)) {
      return "生成服务连接暂时中断，系统已保留此前成功保存的内容，请稍后重试。";
    }
    if (/status 50[234]|\b50[234]\b|gateway|upstream/i.test(message)) {
      return "生成服务暂时繁忙，系统已保留此前成功保存的内容，请稍后重试。";
    }
    return "生成服务暂时未完成请求，系统已保留此前成功保存的内容，请稍后重试。";
  }
  return "请求暂未完成，已保存的内容不会丢失，请稍后重试。";
}

export function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof CreatorNarrativeLanguageError) return error.message;
  if (!error || typeof error !== "object") return fallback;
  if ("name" in error && error.name === "HostSessionError") return "主站登录状态已失效或账号发生变化，请从主站重新打开剧本大师。";
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) return "连接暂时中断，你的输入已保留，请检查网络后重试。";
  const candidate = error as { message?: unknown; status?: unknown };
  if (typeof candidate.message !== "string" || !candidate.message.trim()) {
    return fallback;
  }
  // ApiError messages have already passed through visibleApiError. Preserve
  // that user-safe diagnosis instead of replacing every failure with the
  // feature's generic fallback.
  if (typeof candidate.status === "number") return candidate.message;
  if (inspirationMessages.has(candidate.message)) return candidate.message;
  if (planningApprovalMessages.has(candidate.message)) return candidate.message;
  if (/^(生成服务|请求暂未完成|本次生成|The generation service|The request could not)/.test(
    candidate.message,
  )) {
    return candidate.message;
  }
  return fallback;
}

export function isRequestAborted(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return Boolean(
    error
    && typeof error === "object"
    && "name" in error
    && (error as { name?: unknown }).name === "AbortError"
  );
}
