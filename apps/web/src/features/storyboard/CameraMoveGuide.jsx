import { Search } from 'lucide-react'
import { useState } from 'react'
import { CAMERA_ACTION_TERMS } from './cameraActionTerms'
import { CAMERA_EMOTION_TERMS } from './cameraEmotionTerms'
import { CAMERA_FRAMING_TERMS } from './cameraFramingTerms'
import { CAMERA_MOVE_TERMS, appendCameraMovePrompt, hasCameraMovePrompt } from './cameraMoveTerms'
import { CAMERA_NARRATIVE_TERMS } from './cameraNarrativeTerms'
import './cameraMoveGuide.css'

const CAMERA_TERM_GROUPS = [
  {
    id: 'movement',
    label: '运动镜头',
    terms: CAMERA_MOVE_TERMS,
    note: '运镜是导演的语言，镜头是情绪的节奏。',
  },
  {
    id: 'emotion',
    label: '情绪镜头',
    terms: CAMERA_EMOTION_TERMS,
    note: '镜头不只是语言，更是情绪的推动者。',
  },
  {
    id: 'action',
    label: '动作镜头',
    terms: CAMERA_ACTION_TERMS,
    note: '运镜创造情绪，镜头讲述故事。',
  },
  {
    id: 'framing',
    label: '景别镜头',
    terms: CAMERA_FRAMING_TERMS,
    note: '镜头不是记录，而是选择。你如何运镜，你就如何讲述。',
  },
  {
    id: 'narrative',
    label: '叙事定格',
    terms: CAMERA_NARRATIVE_TERMS,
    note: '镜头语言，叙事有道。用镜头讲好故事。',
  },
]

export function CameraMoveGuide({ prompt, onPromptChange }) {
  const [query, setQuery] = useState('')
  const [activeGroupId, setActiveGroupId] = useState(CAMERA_TERM_GROUPS[0].id)
  const activeGroup = CAMERA_TERM_GROUPS.find((group) => group.id === activeGroupId) || CAMERA_TERM_GROUPS[0]
  const normalizedQuery = query.trim().toLowerCase()
  const visibleTerms = normalizedQuery
    ? activeGroup.terms.filter((term) =>
        [term.name, term.alias, term.prompt, term.scene].some((value) =>
          String(value ?? '')
            .toLowerCase()
            .includes(normalizedQuery),
        ),
      )
    : activeGroup.terms

  const handleSelectTerm = (term) => {
    onPromptChange(appendCameraMovePrompt(prompt, term))
  }

  return (
    <section className="camera-move-guide" aria-label="运镜术语速查">
      <div className="camera-move-head">
        <div>
          <span>运镜术语速查</span>
          <strong>
            {activeGroup.terms.length} 个{activeGroup.label}
          </strong>
        </div>
        <label className="camera-move-search">
          <Search size={14} />
          <input
            aria-label="搜索运镜术语"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索镜头或情节"
          />
        </label>
      </div>

      <div className="camera-move-tabs" role="tablist" aria-label="运镜术语分类">
        {CAMERA_TERM_GROUPS.map((group) => (
          <button
            aria-selected={group.id === activeGroup.id}
            className={group.id === activeGroup.id ? 'active' : ''}
            key={group.id}
            role="tab"
            type="button"
            onClick={() => setActiveGroupId(group.id)}
          >
            {group.label}
            <span>{group.terms.length}</span>
          </button>
        ))}
      </div>

      <div className="camera-move-grid">
        {visibleTerms.map((term) => {
          const isSelected = hasCameraMovePrompt(prompt, term)
          return (
            <button
              aria-pressed={isSelected}
              className={`camera-move-card ${isSelected ? 'selected' : ''}`}
              key={term.id}
              type="button"
              onClick={() => handleSelectTerm(term)}
            >
              <span>{term.name}</span>
              {term.alias && <small className="camera-move-alias">{term.alias}</small>}
              <strong>{term.prompt}</strong>
              <small>{term.scene}</small>
              <em>{isSelected ? '已加入' : '加入镜头'}</em>
            </button>
          )
        })}
      </div>

      {visibleTerms.length === 0 && <p className="camera-move-empty">没有匹配的{activeGroup.label}。</p>}
      <p className="camera-move-note">{activeGroup.note}</p>
    </section>
  )
}
