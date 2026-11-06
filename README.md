# Chrome 插件合集

四个自用浏览器插件的统一源码仓库（Manifest V3，均遵循最小权限、纯本地优先的原则）。

| 目录 | 插件 | 说明 |
|---|---|---|
| [`rich-notes/`](rich-notes/) | 富文本笔记 | 浏览器内富文本笔记；`extension/`=Chrome 扩展，`server/`=配套 Node 服务端 |
| [`browser-toolbox/`](browser-toolbox/) | 浏览器工具箱 | 纯本地工具集（JWT 解码等），只声明 `contextMenus`+`storage`，零网络请求 |
| [`idea-word-catcher/`](idea-word-catcher/) | Word Catcher 生词本 | `browser/`=Chrome 扩展，`src/`=IDEA 插件（Java/Gradle） |
| [`password-manager/`](password-manager/) | 本地密码库 | 纯本地密码管理，数据不出本机 |

## 安装（加载已解压的扩展程序）

1. Chrome 打开 `chrome://extensions/`，开启右上角「开发者模式」
2. 点「加载已解压的扩展程序」，选择对应目录：
   - rich-notes → 选 `rich-notes/extension/`
   - browser-toolbox → 选 `browser-toolbox/`（项目根即插件根）
   - word-catcher → 选 `idea-word-catcher/browser/`
   - password-manager → 选 `password-manager/extension/`

## 服务端（仅 rich-notes 需要）

```bash
cd rich-notes/server
npm install
cp .env.example .env   # 按实际环境填写；.env 含密码，不入库
node server.js
```

## 仓库约定

- 只收源码：`node_modules/`、`build/`、`dist/`、`tmp-test/`、`.env` 均不入库
- 版本号唯一来源 = 各插件 `manifest.json`
- 图标由脚本再生成：`gen_icons.js`（rich-notes）、`gen_icons.py`（browser-toolbox / password-manager）
