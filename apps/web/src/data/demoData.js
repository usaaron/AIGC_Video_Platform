export const DEFAULT_SCRIPT = `雨夜，临港市旧火车站。

林夏撑着一把透明雨伞，站在停运多年的三号站台。她收到一封没有署名的信，约她午夜来取回父亲留下的胶片。

钟声响起，周野从候车室的阴影里走出。他把一只旧铁盒放到长椅上，却提醒林夏：胶片记录的并不是过去，而是明天。

远处传来列车进站声。空无一物的铁轨上，灯光穿透雨幕。林夏打开铁盒，看见胶片第一格正是此刻的自己。`

export const DEMO_CHARACTERS = [
  {
    id: 'lin',
    name: '林夏',
    role: '纪录片导演 · 28岁',
    image: '/demo/lin.jpg',
    prompt: '东亚女性，短发，深色风衣，透明雨伞，克制而敏锐，电影感全身照',
    status: '已确认',
  },
  {
    id: 'zhou',
    name: '周野',
    role: '神秘信使 · 32岁',
    image: '/demo/zhou.jpg',
    prompt: '东亚男性，黑色旧夹克，雨夜逆光，疲惫但坚定，电影人物定妆照',
    status: '待确认',
  },
]

export const DEMO_SCENES = [
  {
    id: 'station',
    name: '三号站台',
    type: '主场景',
    image: '/demo/station.jpg',
    prompt: '废弃海边火车站，雨夜，湿润铁轨，远处暖色信号灯，宽银幕电影构图',
  },
  {
    id: 'room',
    name: '旧候车室',
    type: '室内',
    image: '/demo/room.jpg',
    prompt: '老式候车室，木质长椅，昏暗壁灯，窗外大雨，悬疑电影氛围',
  },
]

export const DEMO_SHOTS = [
  {
    id: 1,
    number: '01',
    image: '/demo/rain.jpg',
    title: '雨夜空镜',
    framing: '大全景',
    duration: 4,
    prompt: '临港市雨夜，镜头缓慢推向废弃火车站，冷色调',
  },
  {
    id: 2,
    number: '02',
    image: '/demo/lin.jpg',
    title: '林夏抵达',
    framing: '中近景',
    duration: 5,
    prompt: '林夏撑透明雨伞走入站台，侧逆光，雨滴清晰',
  },
  {
    id: 3,
    number: '03',
    image: '/demo/station.jpg',
    title: '等待',
    framing: '广角',
    duration: 4,
    prompt: '空旷站台，人物位于画面右侧，信号灯闪烁',
  },
  {
    id: 4,
    number: '04',
    image: '/demo/zhou.jpg',
    title: '周野出现',
    framing: '特写',
    duration: 4,
    prompt: '周野从阴影走出，把旧铁盒放在长椅上',
  },
  {
    id: 5,
    number: '05',
    image: '/demo/room.jpg',
    title: '打开铁盒',
    framing: '俯拍',
    duration: 5,
    prompt: '双手打开生锈铁盒，里面是一卷旧胶片，暖光',
  },
]

export const SEED_JOBS = [
  {
    id: 'seed-1',
    label: '镜头 01 · 雨夜空镜',
    type: '视频',
    status: 'completed',
    progress: 100,
    cost: 18,
    created: '刚刚',
  },
  {
    id: 'seed-2',
    label: '林夏 · 角色定妆',
    type: '图片',
    status: 'completed',
    progress: 100,
    cost: 6,
    created: '2分钟前',
  },
]
