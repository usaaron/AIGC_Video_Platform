export function portraitStatusLabel(portrait) {
  if (portrait?.groupType === 'AIGC') return 'AI人物已入库'
  if (portrait?.groupType === 'LivenessFace') return '真人授权素材已入库'
  return '人像素材已入库'
}

export function PortraitReadinessNotice({ attributes, configuration, faceReady }) {
  const aiPortrait = attributes.trustedPortrait?.groupType === 'AIGC'
  const sourceImageMode = configuration?.videoReferenceMode === 'source-image'
  return (
    <>
      {sourceImageMode && aiPortrait && attributes.trustedPortrait?.status === 'active' && (
        <p className="trusted-portrait-notice">AI人物已入库；当前视频通道仍会独立审核生成内容。</p>
      )}
      {faceReady && attributes.bodyStatus !== 'approved' && (
        <p className="trusted-portrait-notice">未确认全身造型，视频服装和体型可能变化。</p>
      )}
    </>
  )
}
