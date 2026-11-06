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
  }
];
