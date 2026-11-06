# Word Catcher — IDEA 生词采集插件（含浏览器扩展）

阅读代码 / 英文文档时，把生僻单词一键记入「生词本」：去重计数、在线词典（词性 / 音标 / 例句 / 词源）、
词根词缀拆解、编辑器高亮、TTS 朗读、生词卡片自测、导出 CSV。
配套 **Chrome/Edge 浏览器扩展**（`browser/` 目录）与 IDE 共享同一生词本：网页取词、网页高亮、卡片自测。

## 功能

### 取词（Alt+Shift+W）
- 选中单词（或把光标放在单词上）按 `Alt+Shift+W`，或编辑器右键菜单 → 「记入生词本」
- 自动去重：同一个单词再次记录时次数 +1（忽略大小写），并刷新上下文 / 来源文件
- 记录时**自动查在线词典**，写入生词记录：中文释义、**词性**（n./v./adj.）、**音标**、**例句**、词源

### 词典查询（多源降级）
- **必应词典**（cn.bing.com/dict，免费无 key，**国内直连可用**）：词性 + 中文释义、美/英音标、双语例句 —— 首选源
- **Free Dictionary API**（dictionaryapi.dev）：音标、词性 + 英文释义、英文例句、词源 —— 备用
- **Google 词典接口**（gtx）：中文翻译、词性中文词条、中英对照例句 —— 备用
- **MyMemory**：中文翻译兜底（免费无 key，国内直连可用）
- 请求走 IDE 的 HTTP 代理设置；配了代理的环境下各源数据最全
- 取词时自动查单个词；「补全词典」批量补全（间隔 300ms，完成后通知）

### 词根词缀拆解（本地离线）
- 内置常见前缀（约 50 个）+ 词根（约 190 个）+ 后缀（约 60 个）中文含义表
- 保守拆解，宁可少拆不可错拆，例如：
  `prediction → pre-(预先) + dict(说) + -ion(行为/结果)`
  `transport → trans-(横过) + port(搬运)`
  `counteract → counter-(相反) + act(做/行动)`
- 断网也能用，随记录即时写入

### 生词本工具窗（右侧边栏，书签图标）
- 表格列：单词 / 释义（词性）/ 次数 / 例句 / 上下文 / 来源文件 / 最近记录（点表头可按单词、次数排序）
- **底部详情区**：点选任一生词，显示完整信息——音标、词性释义、词根拆解、例句、词源、上下文
- 工具栏：删除选中 ｜ **朗读**（系统 TTS，双击列表行也可朗读） ｜ **补全词典**（给词典信息不全的生词补查）
  ｜ **生词卡片** ｜ **生词高亮**（开关） ｜ 复制全部单词（可直接导入 Anki） ｜ 导出 CSV ｜ 清空

### 生词高亮
- 编辑器里自动高亮所有已记录的生词（忽略大小写、词边界匹配），浅 / 深色主题各配一种底色
- 文档编辑后 300ms 防抖重刷；超过 2M 字符的大文件跳过
- 工具窗「生词高亮」按钮一键开关，状态持久化

### 发音（TTS）
- Windows 用 PowerShell 的 `System.Speech`（离线），macOS 用 `say`，Linux 用 `espeak`

### 生词卡片（翻卡自测）
- 随机顺序出卡：正面单词 + 音标 → 「显示释义」核对 → 背面显示词性释义、**词根拆解**、**例句**、上下文
- 标记 认识 / 不认识，支持朗读、跳过；结束后统计认识 / 不认识数量

### 浏览器扩展（Chrome / Edge，同数据源）
- 插件内嵌本地服务 `127.0.0.1:18091`（只绑本机，随 IDE 启停），扩展所有读写都走它——
  IDE 进程是唯一写入方，网页取词后工具窗实时联动，永不冲突
- 网页里选中单词 → 右键「记入生词本」或 `Alt+Shift+W`（与 IDE 同快捷键），badge 显示 `✓次数` / 失败原因
- 网页自动高亮已记生词（规则同编辑器高亮：忽略大小写、词边界、300ms 防抖、2M 字符跳过）
- 弹窗：列表 / 详情 / 朗读 / 删除 / 补全词典 / 复制全部（Anki） / 导出 CSV（同 IDE 格式）
- 生词卡片网页版：翻卡自测流程与 IDE 一致
- 安装与详细说明见 [browser/README.md](browser/README.md)

> 目前取词只接受英文单词（允许内部连字符 / 撇号，如 `state-of-the-art`、`don't`）。

## 构建与打包

```bash
gradlew.bat buildPlugin      # 构建，产物在 build/distributions/
gradlew.bat packagePlugin    # 打包任务：构建 + 复制当前版本安装包到 dist/（自动清理旧版本）
gradlew.bat installPlugin    # 构建 + 解压安装到本机 IDEA 插件目录（重启 IDEA 生效）
                              # 默认 IdeaIC2025.2，可用 -PideaConfigDir=<配置目录> 覆盖
gradlew.bat runIde           # 启动一个带插件的沙箱 IDEA 调试
```

安装包：`dist/idea-word-catcher-<version>.zip`，也可以手动
`File → Settings → Plugins → ⚙ → Install Plugin from Disk...` 安装。

## 环境要求

- JDK 17+（构建用）
- 本机 IntelliJ IDEA：默认指向 `D:/tools/ideaIC-2025.2.6.2.win`，
  可用 `-PlocalIdeaPath=<IDE 安装目录>` 覆盖；没有本机 IDE 时自动改为远程下载 `2025.2.6`

## 数据存储

全局（跨项目）保存在 IDE 配置目录 `wordCatcher.xml`：
`C:\Users\<你>\AppData\Roaming\JetBrains\IdeaIC2025.2\options\wordCatcher.xml`

浏览器扩展不单独存数据：经插件内嵌的本地 HTTP 服务（`WordCatcherHttpService`，
`127.0.0.1:18091`）直接读写 `WordStorage`，与 IDE 内操作同一条代码路径。

## 项目结构

```
src/main/java/com/gientech/wordcatcher/
├── CaptureWordAction.java           # 取词动作（快捷键 + 右键菜单，自动触发词典增强）
├── WordStorage.java                 # 应用级持久化存储（去重/计数/词典缓存/监听）
├── WordEntry.java                   # 生词数据模型（含音标/词性/词根/例句/词源）
├── WordHighlighter.java             # 编辑器生词高亮（可开关，防抖重刷）
├── WordTranslator.java              # 在线词典（FreeDictionary + Google + MyMemory 多源降级）
├── RootAnalyzer.java                # 本地词根词缀拆解（离线）
├── WordEnricher.java                # 词典查询 + 词根分析结果写回存储
├── SpeakWord.java                   # 系统 TTS 朗读
├── FlashcardsDialog.java            # 生词卡片翻卡自测
├── WordCatcherPanel.java            # 工具窗面板（表格 + 详情区 + 工具栏）
├── WordCatcherToolWindowFactory.java
└── WordCatcherNotifications.java    # 气泡通知
src/main/resources/
├── META-INF/plugin.xml
└── icons/                           # 朗读 / 卡片图标（自绘 SVG）
browser/                             # 浏览器扩展（Chrome/Edge 通用，见 browser/README.md）
├── manifest.json / api.js / background.js / highlight.js
├── popup.html/js/css                # 弹窗：列表 / 详情 / 工具栏
├── flashcards.html/js/css           # 生词卡片自测页
└── icons/ + tools/make_icons.ps1    # 图标及生成脚本
```

## 兼容性

`since-build=252`（IDEA 2025.2+，含 Community / Ultimate），`until-build=299.*`。
