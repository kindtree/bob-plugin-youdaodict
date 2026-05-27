# Bob 插件开发指南

本文固化了开发本插件时实测/查证过的 Bob 插件知识,供后续在本仓加功能、或开发新的 Bob 插件复用。所有字段路径、API、URL 均经真实数据或官方文档验证。

> 官方文档:https://bobtranslate.com/plugin/ · 插件索引:https://bobplugin.ripperhe.com/

## 1. 插件结构与打包

`.bobplugin` = 一个 zip 包,**根部**必须含 `info.json` + `main.js`(图标等可选)。

```bash
zip -j wordtier.bobplugin info.json main.js   # -j 去掉目录层级，保证文件在根部
```

双击 `.bobplugin` 即安装;Bob 偏好设置 → 服务 中启用。

### info.json 关键字段

```json
{
  "identifier": "com.alex.bob.youdaodict",   // 小写字母/数字/点
  "version": "1.2.0",
  "category": "translate",                    // translate | ocr | tts
  "name": "词阶 WordTier",
  "summary": "...",
  "icon": "001",                              // 内置图标编号 001~149；自定义图片图标官方无文档
  "author": "Alex",
  "minBobVersion": "1.8.0",
  "appcast": "https://raw.githubusercontent.com/<user>/<repo>/main/appcast.json",
  "options": [ /* 见 §6 */ ]
}
```

## 2. 翻译插件运行时入口

```js
function translate(query, completion) { /* ... */ }
function supportLanguages() { return ["auto", "en", "zh-Hans"]; }   // 必需
function pluginTimeoutInterval() { return 10; }                     // 可选，秒
```

- `query.text` 是输入文本;`query.from` / `query.to` 是语言代码。
- **回填结果**:优先 `query.onCompletion({ result })`(Bob 1.8.0+),旧版回退 `completion({ result })`。本仓用 `finish()` 同时兼容两者。
- **报错**:`finish({ error: { type: "network"|"api"|..., message: "..." } })`。

## 3. toDict 词典结构(发音的关键)

`result.toDict` 渲染词典卡片。`result` 至少要有 `toParagraphs` 或 `toDict` 之一。

```js
{
  word: "good",
  phonetics: [
    { type: "us", value: "ɡʊd",
      tts: { type: "url", value: "https://dict.youdao.com/dictvoice?audio=good&type=2" } },
    { type: "uk", value: "ɡʊd",
      tts: { type: "url", value: "https://dict.youdao.com/dictvoice?audio=good&type=1" } }
  ],
  parts:     [{ part: "adj.", means: ["优良的", "愉快的"] }],   // 词性 + 释义数组
  exchanges: [{ name: "比较级", words: ["better"] }],          // 词形变化
  additions: [{ name: "例句", value: "Have a good day. 祝你愉快。" }]  // 补充行（例句/英释/近义/词组/星级等）
}
```

- **发音**:`phonetics[].tts = { type: "url", value: <音频URL> }`。`type` 支持 `"url"` / `"base64"`,用 url 最省事。`phonetics[0]` 是 Bob 默认朗读项。
- `additions` 是通用的"名称: 值"补充行,本仓用它放例句、柯林斯英释、近义词、词组、词频星级。

## 4. Bob 注入的全局对象

沙箱**无 `fetch`、无 npm**。可用:

| 全局 | 用途 | 关键调用 |
|---|---|---|
| `$http` | 网络 | `$http.get({ url, header, handler(resp) })`;`resp.data` 自动 parse JSON,`resp.error`,`resp.response.statusCode` |
| `$file` | 文件读写(缓存) | `$file.write({data, path})` / `read(path)` / `exists(path)` / `mkdir(path)`;写操作只能在 `$sandbox/` 前缀下 |
| `$data` | 二进制 | `$data.fromUTF8(str)`;读回的 `$data` 用 `.toUTF8()` 转字符串 |
| `$option` | 用户设置 | `$option.<identifier>`,menu 值是字符串 |
| `$log` | 日志 | `$log.info(...)` / `$log.error(...)` |

> `$file`/`$data` 只能在 Bob 内最终验证(Node 单测覆盖不到)。涉及它们的代码务必 try/catch 兜底,失败要能退回主流程(本仓缓存层即如此:任何缓存异常都退回联网)。

沙箱目录:`~/Library/Containers/com.hezongyidev.Bob/Data/Documents/InstalledPluginSandbox`。

## 5. 数据源:有道(免 key)

### 词典 jsonapi

`GET https://dict.youdao.com/jsonapi?q=<word>`,带 `User-Agent` + `Referer: https://dict.youdao.com/`(防反爬,失败重试一次)。实测字段路径:

| 内容 | 路径 | 备注 |
|---|---|---|
| 美/英音标 | `ec.word[0].usphone` / `ukphone` | |
| 发音参数 | `ec.word[0].usspeech` / `ukspeech` | 形如 `good&type=2`，直接拼到 dictvoice base |
| 中文释义 | `ec.word[0].trs[].tr[0].l.i[0]` | 词性+释义同串,如 `adj. 优良的；…` |
| 词形变化 | `ec.word[0].wfs[].wf` | `{name:"复数", value:"goods"}` |
| 规范词 | `ec.word[0]["return-phrase"]` | **可能是 `{l:{i:"good"}}` 或字符串**,需兼容(见 `pickPhrase`) |
| 双语例句 | `blng_sents_part["sentence-pair"][]` | `{sentence, "sentence-translation"}` |
| 柯林斯 | `collins.collins_entries[].entries.entry[].tran_entry[]` | `pos_entry.pos` / `tran`(含 `<b>` 需 strip)/ `exam_sents.sent[]{eng_sent,chn_sent}`;entry 有 `star` 词频 |
| 同义词 | `syno.synos[].syno` | `{pos, ws[].w}` |
| 常用词组 | `phrs.phrs[].phr` | `{headword.l.i, trs[].tr.l.i}`(注意此处 `tr` 是对象,非数组) |
| 考试标签 | `ec.exam_type` | 字符串数组,如 `["CET4","CET6","考研"]` |
| 相关词(同根衍生) | `rel_word.rels[].rel` | `{pos, words[]{word, tran}}`;`tran` 有前导空格需 trim;映射到 Bob 的 `toDict.relatedWordParts`(独立字段,非 additions) |
| 中文反查英文 | `ce.word[0]` | `{phone, return-phrase, trs[].tr[0].l{pos, i, "#tran"}}`;`l.i` 是混合数组(空字符串 + `{"#text": "influence"}` 对象);多义按 `pos` 分组到 `relatedWordParts`,英文渲染为可点蓝字。`phone` 是拼音,塞进 `additions[].name="拼音"`(`phonetics.type` 受限于 us/uk,不放拼音) |
| 中文整句翻译 | `ce.word[0].trs[]` 多条备选,每条 `tr[0].l.i` 是"字符串+`{#text}`对象"混合序列 | 用 `trs[0]` 当主译(parts 主区),`trs[1..2]` 进 additions 当"其他译法";从 `#text` 抽词,过滤停用词 + 仅字母词 + 去重 → `relatedWordParts[0].words` 渲染成可点蓝字。空格/标点都在序列里,按顺序 join 即得完整英文。 |

### DeepSeek LLM(v1.7+,可选;v2.1+ 支持自定义 BaseURL 与模型)

- 默认端点:`POST https://api.deepseek.com/chat/completions`(OpenAI 兼容协议)
- **v2.1+ 用户可改 BaseURL** 走任意 OpenAI 兼容服务(SiliconFlow / 火山方舟 / OpenRouter 等);`resolveLlmEndpoint(baseUrl)` 智能拼接 `/chat/completions`,用户填 `https://x/v1`、`https://x/v1/`、`https://x/v1/chat/completions` 都正确解析
- Header:`Authorization: Bearer <user-key>` + `Content-Type: application/json`
- **模型清单**(刚性核实 2026-05-27,一手来源 https://api-docs.deepseek.com/updates 与 /news/news260424):
  - `deepseek-v4-flash`(**当前主推**,1M 上下文,~$0.14/M 输入 / $0.28/M 输出,284B 总参 / 13B 活跃)
  - `deepseek-v4-pro`(更强,1M 上下文,约 3× 价,1.6T 总参 / 49B 活跃)
  - `deepseek-chat` / `deepseek-reasoner` 是 v4-flash 非思考 / 思考模式的别名,**官方公告 2026-07-24 15:59 UTC 完全下线** (`will be fully retired and inaccessible`),不是模糊"将来废弃"而是写死的硬日期。插件 menu v2.1 起:移除 chat(与 v4-flash 重复)、保留 reasoner 但标硬下线日期;老用户 $option 残留的 `deepseek-chat` 字符串在 7-24 之前仍可调通,之后 `buildLlmErrorAddition` 会把 401/invalid model 错误塞进 additions 给用户看
  - **`deepseek-v3` / `deepseek-v3.2` / `deepseek-r1` / `deepseek-coder` 等具体字面值从未作为 API model id 暴露**——chat/reasoner 别名一路滚动指向背后的具体版本(V3 → V3-0324 → V3.1 → V3.2 → V4-flash),但用户填字面 V3 id 直接 invalid model
  - chat/reasoner 别名演变历史(供参考,**非可直接调用清单**):2025-01 V3+R1 / 2025-03 V3-0324 / 2025-05 R1-0528 / 2025-08 V3.1 / 2025-09 V3.1-Terminus / 2025-09 V3.2-Exp / 2025-12 V3.2 / 2026-04 V4-flash
- Body 关键字段:`model`、`response_format: {type:"json_object"}`、`temperature: 0.2`、`messages[]`
- **JSON mode 硬要求**:prompt 必须**含 "json" 字** + 给出**示例结构**,否则可能不开启严格模式或返回非 JSON
- **DeepSeek 已知**:JSON mode 偶发返回空 content,代码必须 try/catch 兜底;v2.1 起失败时把详细错误(endpoint / model / HTTP status / upstream message)塞进 jsonapi 兜底结果的 `additions`(`buildLlmErrorAddition`),让用户在卡片里直接看到为啥 LLM 没生效——Bob 的 options 协议没有"测试连接"按钮可用(text/menu 二选一),只能用这种方式给配置排错反馈
- Bob `$http.request({method:"POST", url, header, body, handler})` 自动序列化 body 对象;响应里 `resp.data` 是已 parse 的 JSON
- 响应路径:`data.choices[0].message.content` 是 LLM 输出的 JSON 字符串,需二次 `JSON.parse`
- 时延:v4-flash 1-2s;v4-pro / reasoner 思考模式可达 5-15s
- prompt 等级取值固定 10 个(v1.8 起):`小学 / 初中 / 高中 / CET4 / CET6 / 考研 / 雅思 / 托福 / GRE / 其它`,LLM 偶尔会返回意外字符串(如 v1.7 的"基础")→ `buildLlmSentenceResult` 把不在白名单的 level 归入"其它"
- 个性化:`buildLlmPrompt(text, targetLevel)` 在 targetLevel 非 "all" 时插入"学习者当前正在准备:X"段,引导 LLM 选词。是否真生效取决于模型遵守 prompt 的程度,需真 key 实测
- 渲染过滤:`filterLevelGroups(groups, targetLevel, range)` 按 `only / above / all` 过滤;"其它" 始终保留

#### Bob `toDict.relatedWordParts` 当"按等级分组的可点词"用

`relatedWordParts[].part` 字段被 Bob 渲染为分组标题(灰色),`.words[].word` 是蓝色可点击文本 → 点击触发新一次 Bob 划词,自动用同一组翻译服务查那个英文词(我们插件会走 ec 路径出完整词典卡)。这是协议本意之外的复用,但视觉效果好且原生支持。

> 有道字段结构不统一(同名 `l.i` 有时字符串有时数组、`tr` 有时对象有时数组),改解析前务必 `python3 -c` 打印真实夹具对照,不要凭印象。

### 发音 dictvoice

`https://dict.youdao.com/dictvoice?audio=<word>&type=2`(type=1 英音 / 2 美音),返回真实 `audio/mpeg` mp3,无需 key。把它塞进 `phonetics[].tts.value` 即可点喇叭出声。

## 6. info.json options(用户设置)

```json
{
  "identifier": "accent", "type": "menu", "title": "发音口音优先", "defaultValue": "us",
  "menuValues": [ { "title": "美式优先", "value": "us" }, { "title": "英式优先", "value": "uk" } ]
}
```

插件内通过 `$option.accent` 读取(menu 值是字符串)。本仓在 `readOptions()` 里带默认值兜底,`$option` 不存在也安全。

## 7. 工程约定

- **分层**:纯函数(可单测)+ 薄胶水(碰 Bob 全局)。纯函数经 `module.exports` 暴露,导出语句用 `typeof module !== "undefined"` 守卫,Bob 沙箱忽略。
- **TDD + 真实夹具**:`node --test tests/*.test.js`(零依赖,内置 runner;**必须文件 glob,传目录会报错**)。夹具用真实抓取的 jsonapi 响应,不要手搓合成数据。
- **端到端冒烟**:无法在 Node 直接跑 Bob,可写小脚本用 Node `https` 模拟 `$http.get` 真打有道,跑通整条 `translate` 链路(见 git 历史里的 live 验证片段)。
- **打包/发布**:`build.sh` 打包;`release.sh` 打包并把 sha256 写回 `appcast.json`。

## 8. appcast 自动更新(可选)

`info.json` 的 `appcast` 指向一个 `appcast.json`:

```json
{ "identifier": "...", "versions": [
  { "version": "1.2.0", "desc": "...", "sha256": "<.bobplugin的sha256>",
    "url": "https://github.com/<user>/<repo>/releases/download/v1.0.0/<your-plugin>.bobplugin",
    "minBobVersion": "1.8.0" }
] }
```

发布流程:`bash release.sh` → 把 `.bobplugin` 传到对应 GitHub Release → 推仓库。
**注意**:`appcast` 用 `raw.githubusercontent.com` 公开地址,**私有仓的 raw 链接需 token,Bob 拿不到** → 要自动更新必须仓库 public,否则忽略此项(不影响查词)。

## 9. 协议限制 / 字段元规则 / 实测要点(沉淀)

本节是开发本仓 v1.0→v2.0 期间踩过的硬约束与意外发现,集中放一处供后续翻阅。

### A. Bob `toDict` 协议限制(全部已实测/查证)

- `toDict` 字段全集就 6 个:`word / phonetics / parts / exchanges / relatedWordParts / additions`。除此之外没有自由扩展位。
- `phonetics[].type` 文档只列 `"us"`/`"uk"` 两个值。塞别的(如 `"py"` 拼音、`"例句"`)大概率被 Bob 忽略 → 拼音用 `additions` 渲染。
- `additions[].value` 是纯文本,**无 `tts` 字段** → 不能做"例句配独立喇叭"、"段落内可点链接"。
- `toParagraphs[]` 是字符串数组,Bob 不解析 Markdown/HTML。
- `relatedWordParts[].words[].word` 是 Bob 唯一会渲染成蓝色可点跳查的位置;点击触发对该 word 的新一次划词查询(走插件 ec 路径)。
- 顶层 `toTTS` / `fromTTS` 是给"整段翻译音频"用,不是 per-element 音频。
- **句子级 dictvoice 数据存在但 Bob 无字段渲染**:`blng_sents_part.sentence-pair[].sentence-speech`(如 `We+remained+good+friends.&le=eng`)拼到 dictvoice base 实测能拉到真实 47KB mp3,但 toDict 没位置塞 — 只能放弃,等 Bob 协议升级。

### B. 同一份响应中同名字段结构不一致的元规则(踩坑集锦)

有道 jsonapi 是非官方网页端点,字段结构不统一。**勘察新接口前必 `python3 -c` 打印真实分支**,不假设同形。已知不一致:

| 同名字段 | 在 A 分支 | 在 B 分支 |
|---|---|---|
| `return-phrase` | `ec.word[0]` 里是 `{l:{i:"good"}}` | `simple.word[0]` 里是字符串 `"good"` |
| `tr` | `ec.word[0].trs[]` 里是数组 | `phrs.phrs[].phr.trs[]` 里是对象 |
| `l.i` | `ec.word[0].trs[].tr[0].l.i` 是字符串数组 | `ce.word[0].return-phrase.l.i` 是字符串 / `ce.word[0].trs[].tr[0].l.i` 是混合数组(字符串+`{#text}`对象交替) |
| `tran` | 通常带前导空格,必须 `.trim()`(见 `buildRelatedWordParts`) | — |

### C. DeepSeek (OpenAI 兼容)JSON mode 关键约束(实测)

- 默认端点:`POST https://api.deepseek.com/chat/completions`,Header `Authorization: Bearer <key>`;v2.1+ 端点可用户改为任意 OpenAI 兼容服务(智能拼接 `/chat/completions`)
- `response_format: {type: "json_object"}` + **prompt 必须含 "json" 字 + 给示例**(否则不开严格 JSON 模式)
- 偶发返回空 `content`(官方已知),代码必须 try/catch 兜底,失败回退 jsonapi 路径并在结果 `additions` 追加 LLM 调试行
- 实测 `deepseek-v4-flash` 1-2 秒响应,严格 JSON 输出(此前实测的 `deepseek-chat` 性能同此值,因 chat 即 v4-flash 别名)
- `temperature: 0.2` 是稳定性与自然度的甜点
- 响应路径:`data.choices[0].message.content` 是 LLM 输出的 JSON 字符串,需二次 `JSON.parse`

### D. Bob 生态与第三方协议(运营/发布层)

- **官方插件索引** `bobplugin.ripperhe.com` 按 GitHub topic **`bobplugin`(单数、无连字符)** 每日自动抓取。`bob-plugin`(带连字符)**不会被收录** —— 这是本仓踩过的真实坑。
- **Bob 1.15.0+ `thinkInfo`** 字段是给 AI 推理/思考类模型(如 `deepseek-reasoner` 思考模式)的"思考过程"展示用,非翻译输出。
- **Bob 内置智谱翻译**:Bob 与智谱官方合作,**GLM-4-Flash 免 key 直接可用**(在 Bob 服务列表标"内置")。若你的插件想做翻译,先想清楚是否与 Bob 内置功能重复 —— 重复造轮子且做得更差是常见陷阱。
- **自定义图标**:官方只文档化内置编号 `icon: "001"~"149"`。自定义图片图标无公开文档,不要硬编可能无效的机制。
- **Bob 插件改名**:`identifier` **绝对不动**(改了 Bob 把新版当全新插件,**用户的设置/缓存/key 全部重置**);只改 `info.json` 的 `name` 字段,用户在 Bob 服务列表里就能看到新名,平稳过渡。
- **本地装新包后必须 bump `version`**:Bob 看到同 `identifier` + 同 `version` 的 .bobplugin 可能静默不刷,即使 main.js / info.json 内容变了。开发时每次重 build 验收前要么 bump version(推荐),要么先在 Bob 里手动卸载老版再装新版。沙箱实际安装路径在 `~/Library/Containers/com.hezongyidev.Bob/Data/Documents/InstalledPlugin/<identifier>/`,有疑问直接 `grep version` 看真实落地状态。
- **Bob 偏好面板有 UI 缓存,不会热刷新已安装插件的 options**:装包成功后,**已经打开的偏好设置窗口仍渲染旧 menuValues / desc**,必须关掉偏好面板再打开(或重启 Bob)才能看到新字段。验收时如果 UI 没变化,先去沙箱 `info.json` 看真实安装版本,别被缓存误导。
- **GitHub 仓库改名**:`gh repo rename` 后旧 URL 由 GitHub 自动 301 重定向(包括 raw.githubusercontent.com),v1.x 用户的 appcast 拉取继续工作 — 但不是永久保证,**新版本应同步更新 `info.json` 的 appcast 字段** 指向新 URL,让用户首次升级后完全脱离旧 URL。

### E. 元教训(适用于其它 Bob 插件 / 第三方平台开发)

> 凡涉及外部生态的事实性主张(平台 topic / 协议字段名 / API 端点 / 内置服务清单 / 文件名规则 / **第三方模型清单**),**出方案前 30 秒去 WebFetch 官方文档或 curl 实测一次**。本仓累计 5 次"凭记忆/印象出方案"踩坑:bobplugin topic 名写错 / 假设 Bob 没内置 LLM / 假设 fanyi.tran 能兜底 / 假设 phonetics.type 可塞非 us/uk 值 / **以为 DeepSeek 仍是 V3+R1 时代(实际 2026-05 官方已升 V4,chat/reasoner 沦为待废弃别名)**。每次都要回头致歉撤回,浪费来回 — 这条比"先实测"更精准的版本是:**外部生态事实必须刚性验证**。

### F. v2.1.0 周期沉淀(2026-05-27,响应 #1 maxfong "改自定义模型"诉求)

#### F1. options 协议刚性事实(三源互证:官方文档 + yetone/bob-plugin-openai-translator + yetone/bob-plugin-openai-polisher 真实 info.json)

- **`options[].type` 完整支持清单:仅 `text` 与 `menu`**。无 button / action / validate / link / switch / checkbox / number 任何其他取值。`textConfig.type` 内部还能分 `secure` / `visible`(影响是否打码),但**不是"动作类型"**。
- **无条件显示机制**:options 字段定义里没有 `visibleWhen` / `depend` / `showIf` / `dependsOn` / `hide`。条件显示做不到,只能 `desc` 文案兜底("仅当上方选 X 时生效")。yetone 等成熟第三方插件全部采用这个妥协方案。
- **"测试连接"按钮做不了**:Bob 服务列表里 Google 翻译、智谱翻译等带「验证」按钮的是 **Bob 自己用 Swift 写的内置服务特权 UI**(图中带"内置"/"密钥"标签),第三方 .bobplugin 永远没有这个能力。替代方案:LLM 调用失败时把详细错误(endpoint / model / HTTP status / 上游 message)塞进结果 `additions`(本仓 `buildLlmErrorAddition`),让用户在卡片里直接看到为啥配置不通。

#### F2. 本地开发"看似没生效"的两阶诊断

当用户截图反馈"UI 还是旧的",别立刻怀疑 build 错了。两阶定位:

1. **Bob 沙箱真实状态**:`grep -E '"version"|deepseek-v4' ~/Library/Containers/com.hezongyidev.Bob/Data/Documents/InstalledPlugin/<identifier>/info.json` — 若是新版,问题在 UI 层;若仍是旧版,看 §9.D "本地装新包后必须 bump version"。
2. **偏好面板 UI 缓存**:Bob 偏好窗口不会热刷新已安装插件的 options 渲染。沙箱已是新版但 UI 看到旧字段 → 关闭偏好窗口再打开(或重启 Bob)。

本周期内这两层 cache 叠加踩了两次,验收姿势固化下来。

#### F3. 文档里给具体性能/价格数字必须标注"实测"还是"类推"

本周期把"`deepseek-v4-flash` 1-2 秒响应"写进 §5,实际是从 v3 时代 `deepseek-chat` 旧 1.2s 实测值**类推**——V4 是新架构(DSA + 1M context 默认 + 双模式),性能不一定可类比。后来用户反馈"v4-flash 挺慢的"对不上文档预期。

教训:文档化具体数字(延迟 / 价格 / token 速率)必须配标签 **(实测 yyyy-mm-dd)** 或 **(类推,未实测)**。第三方模型升级周期短(DeepSeek 5 个月 7 次别名滚动),旧实测数据可能已经无效。

#### F4. 版本号策略:开发周期内可任意 bump,release 前回到"承诺版本号"

issue #1 里对 maxfong 承诺过"v2.1.0 改自定义模型"。开发过程为了让 Bob 重新读包,bump 到 2.1.1 / 2.1.2 是 development convenience(同 version 静默不刷)。**release 前必须回退到承诺号 2.1.0**,对外只暴露一个干净版本,CHANGELOG 三段合并,git history 一个 commit。开发过程的迭代版本号不进 git 不进 release。

#### F5. 对外发布完整流程(端到端)

1. **统一版本号**:`info.json` 的 `version` 回到对外承诺号。
2. **合并 CHANGELOG**:开发期内多个 patch 条目压成一个版本条目。
3. **加 appcast.json entry**:`release.sh` 期望该版本 entry 已存在(它只回写 sha256),必须手动加 `{version, desc, sha256: "PLACEHOLDER", url, minBobVersion}`。
4. **跑测试**:`node --test tests/*.test.js`,确保 100% 通过。
5. **`bash release.sh`**:自动 build + 算 sha256 + 写回 appcast.json。
6. **git commit + push**:**全程 `env -u GITHUB_TOKEN`**(细粒度 PAT 没 `repo` 权限,会推不动)。
7. **`env -u GITHUB_TOKEN gh release create v<X.Y.Z> wordtier.bobplugin --repo <user>/<repo> --title ... --notes ...`**:notes 写关键改动 + 来源 + 兼容说明。
8. **`env -u GITHUB_TOKEN gh issue comment <N> --body ...`**:响应原诉求 + 提"超出承诺"的额外好处 + release 链接。
9. **Bob 客户端 24h 内通过 appcast 推送更新提示**(实测稳定);新用户去 release 页双击安装。

#### F6. LLM 缓存的设计要点

- **联合键**:`(text, targetLevel)` 而非仅 text。因为 prompt 个性化(`buildLlmPrompt` 在 targetLevel 非 all 时插入"学习者当前正在准备:X"段)会让同句在不同等级下产出不同结果,共用缓存会污染。本仓用 `prefix = "llm-<targetLevel>"` 写入 `$sandbox/cache/llm-<level>_<key>.json`。
- **schema 隔离**:jsonapi 缓存与 LLM 缓存不能混(`renderJsonapi` 与 `buildLlmSentenceResult` 期望不同 data 形态),用 `cachePath(word, prefix)` 加前缀区分,前缀默认 "yd"。
- **失败不写**:LLM 调用失败 / JSON 解析异常一律不写缓存,避免坏数据污染未来 7 天。仅在 `buildLlmSentenceResult` 成功生成 dict 后才 `cacheSet`。
- **命中可见**:缓存命中时给 additions 加一行"缓存:命中(未走 API · 7 天 TTL)",让用户在使用中能区分"第一次调用" vs "缓存命中",出问题也能快速定位是缓存层还是 LLM 层。

## 10. 新建一个 Bob 插件的起步清单

### 开发阶段
1. 建目录 + `info.json`(填 `category`/`identifier`/`minBobVersion`)。
2. `main.js`:`translate`/`supportLanguages`/`pluginTimeoutInterval` + 纯函数 + `module.exports` 守卫。
3. 先用 `curl` 抓数据源真实响应存为 `tests/fixtures/*.json`,`python3` 打印结构坐实字段。
4. 纯函数 TDD(`node --test tests/*.test.js`)。
5. 胶水接 `$http`/`$option`,涉及 `$file`/`$data` 的全 try/catch。
6. Node 模拟 `$http` live 冒烟 → `build.sh` 打包 → 双击装进 Bob 人工验收(发音点喇叭确认出声)。
7. 验收"UI 没变化"时按 §9.F2 两阶诊断(沙箱真实版本 → 偏好面板 UI 缓存)。

### 对外发布阶段
8. 版本号回到对外承诺号(开发期 bump 的 patch 号合并)。
9. CHANGELOG 多段压成一个版本条目;appcast.json 手动加版本 entry。
10. `bash release.sh` 算 sha256 写回 appcast.json。
11. `env -u GITHUB_TOKEN` 前缀:`git push` + `gh release create v<X.Y.Z> <name>.bobplugin` + `gh issue comment`。
12. Bob 客户端 24h 内通过 appcast 自动推送更新提示。
