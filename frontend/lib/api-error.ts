import type { ProjectMarketProfile } from "./types.ts";

export function visibleApiError(
  message: string,
  status: number,
  marketProfile: ProjectMarketProfile = "cn_mainland",
  failureClass?: string,
): string {
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
  if (status === 503 && /timed out|timeout/i.test(message)) {
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
  if (!error || typeof error !== "object") return fallback;
  const candidate = error as { message?: unknown; status?: unknown };
  if (typeof candidate.message !== "string" || !candidate.message.trim()) {
    return fallback;
  }
  // ApiError messages have already passed through visibleApiError. Preserve
  // that user-safe diagnosis instead of replacing every failure with the
  // feature's generic fallback.
  if (typeof candidate.status === "number") return candidate.message;
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
