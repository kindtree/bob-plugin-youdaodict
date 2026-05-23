# Bob 插件开发指南

本文固化了开发本插件时实测/查证过的 Bob 插件知识,供后续在本仓加功能、或开发新的 Bob 插件复用。所有字段路径、API、URL 均经真实数据或官方文档验证。

> 官方文档:https://bobtranslate.com/plugin/ · 插件索引:https://bobplugin.ripperhe.com/

## 1. 插件结构与打包

`.bobplugin` = 一个 zip 包,**根部**必须含 `info.json` + `main.js`(图标等可选)。

```bash
zip -j youdaodict.bobplugin info.json main.js   # -j 去掉目录层级，保证文件在根部
```

双击 `.bobplugin` 即安装;Bob 偏好设置 → 服务 中启用。

### info.json 关键字段

```json
{
  "identifier": "com.alex.bob.youdaodict",   // 小写字母/数字/点
  "version": "1.2.0",
  "category": "translate",                    // translate | ocr | tts
  "name": "有道词典(单词)",
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
    "url": "https://github.com/<user>/<repo>/releases/download/v1.2.0/youdaodict.bobplugin",
    "minBobVersion": "1.8.0" }
] }
```

发布流程:`bash release.sh` → 把 `.bobplugin` 传到对应 GitHub Release → 推仓库。
**注意**:`appcast` 用 `raw.githubusercontent.com` 公开地址,**私有仓的 raw 链接需 token,Bob 拿不到** → 要自动更新必须仓库 public,否则忽略此项(不影响查词)。

## 9. 新建一个 Bob 插件的起步清单

1. 建目录 + `info.json`(填 `category`/`identifier`/`minBobVersion`)。
2. `main.js`:`translate`/`supportLanguages`/`pluginTimeoutInterval` + 纯函数 + `module.exports` 守卫。
3. 先用 `curl` 抓数据源真实响应存为 `tests/fixtures/*.json`,`python3` 打印结构坐实字段。
4. 纯函数 TDD(`node --test tests/*.test.js`)。
5. 胶水接 `$http`/`$option`,涉及 `$file`/`$data` 的全 try/catch。
6. Node 模拟 `$http` live 冒烟 → `build.sh` 打包 → 双击装进 Bob 人工验收(发音点喇叭确认出声)。
