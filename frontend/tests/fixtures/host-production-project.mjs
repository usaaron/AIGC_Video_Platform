export function productionProject(language = 'en') {
  const characters = [
    { id: 'character.ethan', name: 'Ethan', age: '32', gender: '男', role: '档案调查员', appearance: '黑色短发，深蓝外套' },
    { id: 'character.maya', name: 'Maya', age: '29', gender: '女', role: '档案管理员', appearance: '棕色卷发，灰色制服' },
  ];
  const cards = [
    { asset_ref: 'scene.archive', kind: 'scene', name: '档案室', appearance: '红砖墙、木制档案柜、窄窗', fixed_details: ['门在左侧，长桌在中央'] },
    { asset_ref: 'prop.brass_key', kind: 'prop', name: '铜钥匙', appearance: '黄铜材质，三角形钥匙头', fixed_details: ['钥匙柄刻着数字七'] },
    { asset_ref: 'prop.unused', kind: 'prop', name: '旧怀表', appearance: '银色外壳', fixed_details: [] },
  ];
  const plan = { characters: characters.map(c => ({ character_ref: c.id, name: c.name, fixed_identity: c.role })), production_assets: cards };
  return { id: 'production-project', title: '档案核验', creationMode: 'quick', characters,
    generationSettings: { episodeCount: 2, releaseRegion: language === 'en' ? 'overseas' : 'cn_mainland', outputLanguage: language },
    quickWorkflow: { plan_confirmed: true, plan },
    episodes: [1, 2].map(number => ({ id: `source-episode-${number}`, episodeNumber: number, status: 'saved',
      generationRun: { draft_master_script: { id: `draft-${number}`, title: `档案核验${number}`, language,
        synopsis: '调查员核验原件，管理员递交钥匙。', target_duration_seconds: 90,
        characters: characters.map(c => ({ name: c.name, role: c.role, description: c.appearance, motivation: '完成核验' })),
        scenes: [2, 7].map((sceneNumber, index) => ({ scene_number: sceneNumber,
          scene_heading: `INT. 档案室 - ${index ? '夜' : '日'}`, slug: `INT. 档案室 - ${index ? '夜' : '日'}`,
          purpose: '核对档案原件', beat_summary: '调查员核验原件', character_refs: index ? ['character.ethan'] : ['character.ethan', 'character.maya'],
          character_actions: [index ? 'Ethan合上档案。' : 'Maya递给Ethan铜钥匙。'],
          dialogues: [{ character_name: 'Ethan', intent: '', text: language === 'en' ? `Check document ${number}-${sceneNumber}.` : `核对第${number}集第${sceneNumber}场档案。`,
            ...(language === 'en' ? { chinese_translation: `核对第${number}集第${sceneNumber}场档案。` } : {}) }],
          body_order: ['action:0', 'dialogue:0'], content_manifest: { location: '档案室', time_of_day: index ? '夜' : '日',
            character_refs: index ? ['character.ethan'] : ['character.ethan', 'character.maya'], props: index ? [] : ['铜钥匙'] },
        })) } } })) };
}
