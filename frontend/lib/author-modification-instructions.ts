import type { StoryBibleSelectionContext } from "./story-planning-client";

export interface PriorAuthorInstruction {
  id: string;
  instruction: string;
  selection_context?: StoryBibleSelectionContext | null;
}

export interface AuthorModificationInstruction extends PriorAuthorInstruction {
  createdAt: string;
  withdrawnAt?: string;
}

const characterCount = (value: string) => Array.from(value).length;
const sameSelection = (a?: StoryBibleSelectionContext | null, b?: StoryBibleSelectionContext | null) =>
  (!a && !b) || Boolean(a && b && a.source_field === b.source_field && a.selected_text === b.selected_text
    && a.before_text === b.before_text && a.after_text === b.after_text);

export function validateAuthorInstructionRequest(current: PriorAuthorInstruction, prior: PriorAuthorInstruction[]) {
  if (prior.length > 32) throw new Error("本集仍生效的历史要求最多 32 条。请明确撤回已失效的要求后再发送；系统不会自动删减。");
  if (new Set(prior.map((item) => item.id)).size !== prior.length) throw new Error("本集作者要求标识重复，请重新加载后重试。");
  let count = 0;
  for (const item of [...prior, current]) {
    const size = characterCount(item.instruction);
    if (size < 3 || size > 4000) throw new Error("每条作者要求须为 3–4000 字，请编辑后重试。");
    count += size;
    const selection = item.selection_context;
    if (selection) for (const value of [selection.source_field, selection.selected_text, selection.before_text, selection.after_text]) {
      if (typeof value === "string") count += characterCount(value);
    }
  }
  if (count > 32000) throw new Error("本次与历史作者要求及选区合计超过 32000 字。请精简或明确撤回已失效的要求后再发送；系统不会截断内容。");
}

/** A retry reuses the latest identical requirement; editing explicitly replaces its branch. */
export function prepareAuthorInstruction(
  previous: readonly AuthorModificationInstruction[] = [],
  instruction: string,
  selection: StoryBibleSelectionContext | null,
  options: { replaceId?: string; replayId?: string; now?: string; id?: string } = {},
) {
  const now = options.now ?? new Date().toISOString();
  const replacementIndex = options.replaceId ? previous.findIndex((item) => item.id === options.replaceId && !item.withdrawnAt) : -1;
  if (options.replaceId && replacementIndex < 0) throw new Error("该要求已经变化或撤回，请重新打开本集最新要求。");
  let history = previous.map((item, index) => replacementIndex >= 0 && index >= replacementIndex && !item.withdrawnAt
    ? { ...item, withdrawnAt: now } : item);
  const latest = history.filter((item) => !item.withdrawnAt).at(-1);
  const existing = options.replayId ? history.find((item) => item.id === options.replayId && !item.withdrawnAt) : latest;
  const matches = existing?.instruction === instruction && sameSelection(existing.selection_context, selection);
  if (options.replayId && !matches) throw new Error("待处理作者要求已变化，请重新检查影响。");
  const current: AuthorModificationInstruction = matches && replacementIndex < 0 ? existing! : {
    id: options.id ?? crypto.randomUUID(), instruction, selection_context: selection, createdAt: now,
  };
  if (!history.some((item) => item.id === current.id)) history = [...history, current];
  const prior = history.filter((item) => !item.withdrawnAt && item.id !== current.id)
    .map(({ id, instruction: text, selection_context }) => ({ id, instruction: text, selection_context }));
  validateAuthorInstructionRequest(current, prior);
  return { history, current, prior };
}

export function withdrawAuthorInstruction(history: readonly AuthorModificationInstruction[], id: string, now = new Date().toISOString()) {
  if (!history.some((item) => item.id === id && !item.withdrawnAt)) throw new Error("该要求已经变化或撤回，请重新加载本集要求。");
  return history.map((item) => item.id === id ? { ...item, withdrawnAt: now } : item);
}
