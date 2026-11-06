# 浏览器工具箱（browser-toolbox）

个人开发小工具集合的 Chrome 扩展（Manifest V3）。第一个工具是 JWT 解析，后续工具持续集成。

## 安装

1. Chrome 打开 `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 「加载已解压的扩展程序」选择本目录
4. 工具栏拼图图标里把「浏览器工具箱」固定到工具栏

## 功能

| 工具 | 说明 |
|---|---|
| JWT 解析 | 粘贴 token 自动解码 header/payload；显示用户、角色标签、过期倒计时；支持 JSON 复制、深色模式 |
| JSON 格式化 | 树形折叠视图（点击 {}/[] 折叠展开，超 16 行节点自动折叠，一键展开/折叠全部）与纯文本视图切换；缩进 / Tab / 压缩单行、按键名排序；容忍粘贴杂文自动截取；Python dict（单引号 / None / False / 未引号键）自动修复；解析失败给出错行 + `^` 定位与原因提示；语法高亮、复制、深色模式 |
| 右键菜单 | 选中网页里的 JWT 或 JSON 文本 → 右键「工具箱：…」直接打开对应工具并带入 |

所有工具仅在本地处理，不发起任何网络请求；JWT 签名验证需服务端公钥，工具不验签。

## 如何新增一个工具（两步）

1. `tools/` 下新建目录，如 `tools/timestamp/`，写 `index.html`（引用 `../common.css` 即获得统一的卡片/按钮/深色主题样式）
2. `tools/registry.js` 里加一条：

```js
{
  id: 'timestamp',
  name: '时间戳转换',
  icon: '⏱',
  desc: 'Unix 时间戳与日期互转',
  path: 'tools/timestamp/index.html'
}
```

popup 会自动渲染新工具入口。

## 目录结构

```
browser-toolbox/
├── manifest.json        # MV3 清单（版本号唯一来源）
├── bg.js                # service worker：右键菜单
├── gen_icons.py         # 图标生成脚本（Pillow），改色后重跑
├── icons/               # 16/48/128 png
├── popup/               # 点图标弹出的工具入口
└── tools/
    ├── registry.js      # 工具注册表（唯一要维护的清单）
    ├── common.css       # 工具页公共样式（深/浅主题）
    ├── jwt-decoder/     # JWT 解析工具
    └── json-formatter/  # JSON 格式化工具
```

## 相关项目

- [rich-notes](../rich-notes/)：同为本人的 Chrome 扩展，风格一致
