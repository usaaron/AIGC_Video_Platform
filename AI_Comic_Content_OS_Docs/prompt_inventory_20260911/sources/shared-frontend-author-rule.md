# 正文工作区追加的作者意图最高原则

编号：`shared-frontend-author-rule`。状态：`active`。

来源：[frontend/components/script-workspace.tsx:253](/Users/simonriley/Downloads/docs/frontend/components/script-workspace.tsx:253)。符号：`指定原文片段`。

正文工作区构造修改指令时追加的前缀；其中既有用户意志优先，也有未明确内容保持待定。需与后端用户修订合同的实际优先级一起理解。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````text
const AUTHOR_INTENT_WORKFLOW_RULE = "工作流最高原则：用户明确表达的意志、选择、修改和否决永远优先于系统建议、模板和模型推断；未明确决定的内容保持待定，不得擅自补写或替用户做决定。";

function withAuthorIntentWorkflowRule(instruction?: string): string {
  const prefix = AUTHOR_INTENT_WORKFLOW_RULE;
  const value = instruction?.trim() ?? "";
  if (!value) return prefix;
  const remaining = Math.max(0, 4000 - prefix.length - 1);
  return `${prefix}；${value.slice(0, remaining)}`;
}
````

片段 SHA-256：`344093a2279b3167dfc7cafe63e774dbd345670580e10bc2022aa63440010813`
