import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { OPTIONS } from './assetOptions'

export function AssetFields({ attributes, characterStage = 'face', characterAssets = [], onChange }) {
  const update = (key, value) => onChange({ ...attributes, [key]: value })

  return (
    <div className="asset-fields">
      {attributes.type === 'character' && (
        <CharacterFields value={attributes} stage={characterStage} update={update} />
      )}
      {attributes.type === 'scene' && <SceneFields value={attributes} update={update} />}
      {attributes.type === 'prop' && <PropFields value={attributes} update={update} />}
      {attributes.type === 'costume' && (
        <CostumeFields value={attributes} characterAssets={characterAssets} update={update} />
      )}
      {attributes.type === 'brand' && <BrandFields value={attributes} update={update} />}
      {attributes.type === 'audio' && <AudioFields value={attributes} update={update} />}
    </div>
  )
}

function CharacterFields({ value, stage, update }) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  if (stage === 'turnaround') return null
  if (stage === 'body') {
    return (
      <>
        {value.subjectType === 'human' && (
          <ChoiceField
            label="体型"
            value={value.bodyType}
            options={OPTIONS.bodyType}
            onChange={(next) => update('bodyType', next)}
          />
        )}
      </>
    )
  }
  return (
    <>
      <ChoiceField
        className="character-subject-field"
        label="角色类型"
        value={value.subjectType}
        options={OPTIONS.subjectType}
        onChange={(next) => update('subjectType', next)}
      />
      {value.subjectType === 'human' && (
        <ChoiceField
          className="character-gender-field"
          label="性别"
          value={value.gender}
          options={OPTIONS.gender}
          onChange={(next) => update('gender', next)}
        />
      )}
      {value.subjectType === 'human' && (
        <ChoiceField
          className="character-age-field"
          label="年龄段"
          value={value.ageGroup}
          options={OPTIONS.ageGroup}
          onChange={(next) => update('ageGroup', next)}
        />
      )}
      <div className="asset-inline-fields">
        {value.subjectType === 'human' && (
          <label>
            <span>具体年龄（可选）</span>
            <input
              type="number"
              min="1"
              max="120"
              value={value.exactAge ?? ''}
              onChange={(event) => update('exactAge', event.target.value ? Number(event.target.value) : null)}
            />
          </label>
        )}
        {value.subjectType === 'animal' && (
          <label>
            <span>动物物种</span>
            <input
              value={value.species}
              placeholder="例如：橘猫、白马"
              onChange={(event) => update('species', event.target.value)}
            />
          </label>
        )}
      </div>
      {value.subjectType === 'animal' && (
        <ToggleField
          label="拟人化表现"
          description="保留物种特征，增加人物姿态和服装表现"
          checked={value.anthropomorphic}
          onChange={(next) => update('anthropomorphic', next)}
        />
      )}
      {value.subjectType === 'human' && (
        <section className={`character-advanced-settings ${advancedOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="character-advanced-trigger"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            <span>
              <SlidersHorizontal size={15} />
              <span>
                <strong>高级外观设置</strong>
                <small>人种、肤色、瞳孔与头发颜色</small>
              </span>
            </span>
            <ChevronDown size={16} />
          </button>
          {advancedOpen && (
            <div className="character-advanced-grid">
              <SelectField
                label="人种"
                value={value.ethnicity || 'unspecified'}
                options={OPTIONS.ethnicity}
                onChange={(next) => update('ethnicity', next)}
              />
              <SelectField
                label="肤色"
                value={value.skinTone || 'unspecified'}
                options={OPTIONS.skinTone}
                onChange={(next) => update('skinTone', next)}
              />
              <SelectField
                label="瞳孔颜色"
                value={value.eyeColor || 'unspecified'}
                options={OPTIONS.eyeColor}
                onChange={(next) => update('eyeColor', next)}
              />
              <SelectField
                label="头发颜色"
                value={value.hairColor || 'unspecified'}
                options={OPTIONS.hairColor}
                onChange={(next) => update('hairColor', next)}
              />
            </div>
          )}
        </section>
      )}
    </>
  )
}

function SceneFields({ value, update }) {
  return (
    <>
      <ChoiceField
        label="空间"
        value={value.space}
        options={OPTIONS.space}
        onChange={(next) => update('space', next)}
      />
      <ChoiceField
        label="场景类型"
        value={value.sceneType}
        options={OPTIONS.sceneType}
        onChange={(next) => update('sceneType', next)}
      />
      <ChoiceField
        label="年代"
        value={value.era}
        options={OPTIONS.era}
        onChange={(next) => update('era', next)}
      />
      <ChoiceField
        label="时间"
        value={value.time}
        options={OPTIONS.time}
        onChange={(next) => update('time', next)}
      />
      <ChoiceField
        label="天气"
        value={value.weather}
        options={OPTIONS.weather}
        onChange={(next) => update('weather', next)}
      />
      <ChoiceField
        label="氛围"
        value={value.mood}
        options={OPTIONS.mood}
        onChange={(next) => update('mood', next)}
      />
      <ChoiceField
        label="镜头"
        value={value.camera}
        options={OPTIONS.camera}
        onChange={(next) => update('camera', next)}
      />
    </>
  )
}

function PropFields({ value, update }) {
  return (
    <>
      <ChoiceField
        label="物品类型"
        value={value.category}
        options={OPTIONS.propCategory}
        onChange={(next) => update('category', next)}
      />
      <ChoiceField
        label="主要材质"
        value={value.material}
        options={OPTIONS.material}
        onChange={(next) => update('material', next)}
      />
      <ChoiceField
        label="使用状态"
        value={value.condition}
        options={OPTIONS.condition}
        onChange={(next) => update('condition', next)}
      />
      <ChoiceField
        label="展示角度"
        value={value.view}
        options={OPTIONS.view}
        onChange={(next) => update('view', next)}
      />
      <ChoiceField
        label="背景"
        value={value.background}
        options={OPTIONS.background}
        onChange={(next) => update('background', next)}
      />
    </>
  )
}

function CostumeFields({ value, characterAssets, update }) {
  return (
    <>
      <SelectField
        label="归属人物"
        value={value.characterAssetId || ''}
        options={[['', '未绑定人物'], ...characterAssets.map((asset) => [asset.id, asset.name])]}
        onChange={(next) => update('characterAssetId', next || null)}
      />
      <small className="asset-field-help">
        绑定后，生成服装会参考该人物已确认的全身图；视频镜头提到人物时也会自动带入这套服装。
      </small>
      <ChoiceField
        label="适用对象"
        value={value.audience}
        options={OPTIONS.audience}
        onChange={(next) => update('audience', next)}
      />
      <ChoiceField
        label="服装类型"
        value={value.category}
        options={OPTIONS.costumeCategory}
        onChange={(next) => update('category', next)}
      />
      <ChoiceField
        label="季节"
        value={value.season}
        options={OPTIONS.season}
        onChange={(next) => update('season', next)}
      />
      <ChoiceField
        label="设计方向"
        value={value.design}
        options={OPTIONS.design}
        onChange={(next) => update('design', next)}
      />
      <ChoiceField
        label="展示方式"
        value={value.presentation}
        options={OPTIONS.presentation}
        onChange={(next) => update('presentation', next)}
      />
      <ToggleField
        label="服装三视图"
        description="生成正面、背面和细节三张独立图片"
        checked={value.turnaround}
        onChange={(next) => update('turnaround', next)}
      />
    </>
  )
}

function AudioFields({ value, update }) {
  return (
    <>
      <ChoiceField
        label="音频类型"
        value={value.audioType}
        options={OPTIONS.audioType}
        onChange={(next) => update('audioType', next)}
      />
      {value.audioType === 'voice' && (
        <>
          <ChoiceField
            label="声音性别"
            value={value.gender}
            options={OPTIONS.gender}
            onChange={(next) => update('gender', next)}
          />
          <ChoiceField
            label="年龄段"
            value={value.ageGroup}
            options={OPTIONS.ageGroup}
            onChange={(next) => update('ageGroup', next)}
          />
        </>
      )}
      <ChoiceField
        label="情绪"
        value={value.emotion}
        options={OPTIONS.emotion}
        onChange={(next) => update('emotion', next)}
      />
      <ChoiceField
        label="音色"
        value={value.tone}
        options={OPTIONS.tone}
        onChange={(next) => update('tone', next)}
      />
      <ChoiceField
        label="速度"
        value={value.speed}
        options={OPTIONS.speed}
        onChange={(next) => update('speed', next)}
      />
      <ChoiceField
        label="语言"
        value={value.language}
        options={OPTIONS.language}
        onChange={(next) => update('language', next)}
      />
      <div className="asset-inline-fields">
        <label>
          <span>时长（秒）</span>
          <input
            type="number"
            min="1"
            max="300"
            value={value.duration}
            onChange={(event) => update('duration', Number(event.target.value) || 1)}
          />
        </label>
      </div>
      <ToggleField
        label="无缝循环"
        description="适合环境音和持续音效"
        checked={value.loop}
        onChange={(next) => update('loop', next)}
      />
    </>
  )
}

function BrandFields({ value, update }) {
  return (
    <>
      <ChoiceField
        label="品牌资产形态"
        value={value.brandType}
        options={OPTIONS.brandType}
        onChange={(next) => update('brandType', next)}
      />
      <ChoiceField
        label="主要用途"
        value={value.usage}
        options={OPTIONS.usage}
        onChange={(next) => update('usage', next)}
      />
      <ChoiceField
        label="构图方式"
        value={value.layout}
        options={OPTIONS.layout}
        onChange={(next) => update('layout', next)}
      />
      <ChoiceField
        label="背景"
        value={value.background}
        options={OPTIONS.background.filter(([id]) => id !== 'environment')}
        onChange={(next) => update('background', next)}
      />
      <div className="asset-inline-fields">
        <label>
          <span>必须正确显示的文字（可选）</span>
          <input
            value={value.exactText || ''}
            placeholder="例如：序幕TV"
            onChange={(event) => update('exactText', event.target.value)}
          />
        </label>
        <label>
          <span>品牌配色（可选）</span>
          <input
            value={value.palette || ''}
            placeholder="例如：黑金、青绿色"
            onChange={(event) => update('palette', event.target.value)}
          />
        </label>
      </div>
      <small className="asset-field-help">
        品牌文字会原样注入提示词；生成模型可能仍会产生字形误差，建议将最终 Logo 作为原图导入并用于关键落版。
      </small>
    </>
  )
}

function ChoiceField({ className = '', label, value, options, onChange }) {
  return (
    <fieldset className={`asset-choice-field ${className}`}>
      <legend>{label}</legend>
      <div>
        {options.map(([id, text]) => (
          <button
            type="button"
            className={value === id ? 'active' : ''}
            aria-pressed={value === id}
            key={id}
            onClick={() => onChange(id)}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function SelectField({ label, value, options, onChange }) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option value={optionValue} key={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function ToggleField({ label, description, checked, onChange }) {
  return (
    <label className={`asset-toggle ${checked ? 'active' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="asset-toggle-check">{checked && <Check size={13} />}</span>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  )
}
