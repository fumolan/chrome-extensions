// 工具注册表：新增工具两步 —— ① tools/ 下建目录 ② 这里加一条
const TOOLS = [
  {
    id: 'jwt-decoder',
    name: 'JWT 解析',
    icon: '🔑',
    desc: '解码 header / payload、过期时间',
    path: 'tools/jwt-decoder/index.html'
  },
  {
    id: 'json-formatter',
    name: 'JSON 格式化',
    icon: '{}',
    desc: '格式化 / 压缩 / 键名排序',
    path: 'tools/json-formatter/index.html'
  },
  {
    id: 'clock',
    name: '当前时间',
    icon: '⏰',
    desc: '大时钟、地图点选世界城市钟表',
    path: 'tools/time/index.html'
  },
  {
    id: 'location',
    name: '位置 / GPS',
    icon: '📍',
    desc: '定位、坐标转换、外卖收件地址',
    path: 'tools/location/index.html'
  },
  {
    id: 'qrcode',
    name: '二维码生成',
    icon: '▦',
    desc: '网址/文本转二维码，下载 PNG',
    path: 'tools/qrcode/index.html'
  },
  {
    id: 'matrix',
    name: '矩阵计算器',
    icon: '🔢',
    desc: '行列式/逆/乘法/秩迹，草稿自动保存',
    path: 'tools/matrix/index.html'
  },
  {
    id: 'calculus',
    name: '微积分计算器',
    icon: '∫',
    desc: '符号求导/定积分/极限/泰勒/函数图像',
    path: 'tools/calculus/index.html'
  },
  {
    id: 'finance',
    name: '金融工具',
    icon: '💰',
    desc: '金融术语/常识 + 复利月供 IRR 夏普 回撤计算',
    path: 'tools/finance/index.html'
  }
];
