export function quickStartAnalysis(): string {
  return JSON.stringify({
    summary: '用主角、标志服装和暗房建立最小资产闭环',
    visualStyle: 'cinematic-cg',
    characters: [
      {
        name: '张岚',
        description: '寻找失踪父亲的青年导演，克制而警觉',
        prompt: '青年女性导演，短发，清晰五官，冷静警觉的神情',
        subjectType: 'human',
        gender: 'female',
        ageGroup: 'young',
        species: '',
        anthropomorphic: false,
        bodyType: 'slim',
      },
    ],
    costumes: [
      {
        name: '张岚的旧风衣',
        description: '贯穿雨夜调查段落的主角服装',
        prompt: '深灰色旧风衣，防水棉质，磨损袖口，暗红色围巾',
        audience: 'female',
        category: 'daily',
        season: 'autumn-winter',
        design: 'retro',
      },
    ],
    scenes: [
      {
        name: '胶片暗房',
        description: '主角发现胶片秘密的核心室内场景',
        prompt: '老式胶片暗房，红色安全灯，冲洗台，墙面挂着湿润胶片',
        space: 'interior',
        sceneType: 'industrial',
        era: 'modern',
        time: 'night',
        weather: 'rain',
        mood: 'mystery',
        camera: 'wide',
      },
    ],
  })
}
