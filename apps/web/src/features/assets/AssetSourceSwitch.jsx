import { Bot, FileUp } from 'lucide-react'

export function AssetSourceSwitch({ sourceMode, onChange }) {
  return (
    <div className="source-switch" role="group" aria-label="资产来源">
      <button
        type="button"
        className={sourceMode === 'generate' ? 'active' : ''}
        onClick={() => onChange('generate')}
      >
        <Bot size={17} />
        <span>
          <strong>AI 生成</strong>
          <small>使用 Img2 创建新资产</small>
        </span>
      </button>
      <button
        type="button"
        className={sourceMode === 'import' ? 'active' : ''}
        onClick={() => onChange('import')}
      >
        <FileUp size={17} />
        <span>
          <strong>本地导入</strong>
          <small>直接使用或作为 Img2 参考</small>
        </span>
      </button>
    </div>
  )
}
