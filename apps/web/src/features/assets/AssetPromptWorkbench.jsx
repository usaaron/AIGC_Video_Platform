import { Sparkles } from 'lucide-react'
import { PromptFrameworkPanel } from './PromptFrameworkPanel'

export function AssetPromptWorkbench({
  kind,
  draft,
  setDraft,
  promptBadge,
  promptBlueprint,
  generatedPrompt,
}) {
  return (
    <aside className="prompt-workbench">
      <div className="prompt-workbench-head">
        <span>
          <Sparkles size={16} />
          提示词工作台
        </span>
        <strong>{promptBadge}</strong>
      </div>
      <div className="prompt-mode-switch">
        <button
          type="button"
          className={draft.promptMode === 'standard' ? 'active' : ''}
          onClick={() => setDraft({ ...draft, promptMode: 'standard' })}
        >
          标准模式
        </button>
        <button
          type="button"
          className={draft.promptMode === 'advanced' ? 'active' : ''}
          onClick={() => setDraft({ ...draft, promptMode: 'advanced' })}
        >
          高级模式
        </button>
      </div>
      <PromptFrameworkPanel blueprint={promptBlueprint} />
      <label className="compiled-prompt">
        <span>最终提示词</span>
        <textarea readOnly value={generatedPrompt} />
      </label>
      {draft.promptMode === 'advanced' && (
        <>
          <div className="custom-prompt-mode">
            <button
              type="button"
              className={draft.customPromptMode === 'append' ? 'active' : ''}
              onClick={() => setDraft({ ...draft, customPromptMode: 'append' })}
            >
              追加内容
            </button>
            <button
              type="button"
              className={draft.customPromptMode === 'replace' ? 'active' : ''}
              onClick={() => setDraft({ ...draft, customPromptMode: 'replace' })}
            >
              完全覆盖
            </button>
          </div>
          <label>
            <span>高级自定义提示词</span>
            <textarea
              value={draft.customPrompt}
              placeholder="补充镜头语言、细节要求或完全自定义提示词"
              onChange={(event) => setDraft({ ...draft, customPrompt: event.target.value })}
            />
          </label>
        </>
      )}
      <label>
        <span>负面提示词</span>
        <textarea
          className="negative-prompt"
          value={draft.negativePrompt}
          placeholder={promptBlueprint.suggestedNegativePrompt}
          onChange={(event) => setDraft({ ...draft, negativePrompt: event.target.value })}
        />
      </label>
      <div className="provider-payload-note">
        <strong>{kind === 'audio' ? '音频生成字段' : '图片生成字段'}</strong>
        <p>最终提示词、负面提示词、参考图、项目比例和结构化属性会随生成任务提交。</p>
      </div>
    </aside>
  )
}
