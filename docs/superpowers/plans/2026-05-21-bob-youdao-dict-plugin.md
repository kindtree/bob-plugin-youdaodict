# Bob 有道词典(单词)插件 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个 Bob 翻译类插件,输入单个英文单词时返回释义、双语例句、英/美发音(可点喇叭出声),解决金山词霸"查不到单词"的问题。

**Architecture:** 单 `main.js`,内部分两层 —— (1) 一组**纯函数**把有道 jsonapi 的响应转成 Bob 的 `toDict` 结构,可在 Node 里用真实夹具单测;(2) 一层**薄胶水** `translate()`,判断是否单词、用 Bob 注入的 `$http.get` 拉数据、调用纯函数、通过 `onCompletion` 回填结果。纯函数通过 `module.exports` 暴露给测试,Bob 沙箱无 `module` 会自动跳过该行。

**Tech Stack:** JavaScript(ES2017,Bob 沙箱无 fetch/无 npm)、Node `node --test`(内置,零依赖)、有道 jsonapi 作数据源、有道 dictvoice 作发音音源。

---

## 已坐实的事实(调研阶段实测,实现时直接用,勿再猜)

**有道 jsonapi**:`GET https://dict.youdao.com/jsonapi?q=<word>`(带 `User-Agent` 头),实测 `q=good` 返回 200 / 295KB JSON。字段路径:

| 内容 | 路径 | 实测值 |
|---|---|---|
| 美音标 | `ec.word[0].usphone` | `ɡʊd` |
| 英音标 | `ec.word[0].ukphone` | `ɡʊd` |
| 美发音参数 | `ec.word[0].usspeech` | `good&type=2` |
| 英发音参数 | `ec.word[0].ukspeech` | `good&type=1` |
| 释义行 | `ec.word[0].trs[].tr[0].l.i[0]` | `adj. 优良的；能干的…`(词性+释义同一字符串) |
| 词形变化 | `ec.word[0].wfs[].wf` | `{name:"复数", value:"goods"}` |
| 规范词 | `ec.word[0].return-phrase` | `good` |
| 双语例句 | `blng_sents_part.sentence-pair[]` | `{sentence, sentence-translation}` |

**发音音源**:`https://dict.youdao.com/dictvoice?audio=good&type=2` 实测返回真实 `audio/mpeg`(8KB mp3,type=1 英 / 2 美)。
拼接规则:`"https://dict.youdao.com/dictvoice?audio=" + usspeech`(因 `usspeech` 已是 `good&type=2` 这种带参字符串)。

**Bob 运行时**(官方文档):
- 入口 `function translate(query, completion)`;`query.text` 为输入文本。
- 回填:优先 `query.onCompletion({result})`(Bob 1.8.0+),旧版回退 `completion({result})`;报错 `{error:{type,message}}`。
- 网络:`$http.get({url, header, handler})`,`handler(resp)` 中 `resp.data` 自动 parse JSON(失败时为字符串),`resp.error` 为错误。沙箱内**无 fetch**。
- 翻译插件还需 `supportLanguages()`、`pluginTimeoutInterval()`。
- `info.json` 关键字段:`identifier`(小写字母数字点)、`version`、`category`(`translate`/`ocr`/`tts`)、`name`、`summary`、`author`、`minBobVersion`、`options`。

**Bob `toDict` 目标结构**(官方 `good` 示例核对一致):
```js
{
  word: "good",
  phonetics: [{ type: "us", value: "ɡʊd", tts: { type: "url", value: "https://…dictvoice?audio=good&type=2" } }],
  parts: [{ part: "adj.", means: ["优良的", "能干的"] }],
  exchanges: [{ name: "比较级", words: ["better"] }],
  additions: [{ name: "例句", value: "We remained good friends. 我们一直是好朋友。" }]
}
```

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `info.json` | 插件清单,声明 `category: "translate"` |
| `main.js` | 纯函数(转换逻辑)+ 胶水(`translate`/`supportLanguages`/`pluginTimeoutInterval`)+ Node 导出钩子 |
| `tests/fixtures/youdao-good.json` | `good` 的真实 jsonapi 响应(单测夹具) |
| `tests/fixtures/youdao-notfound.json` | 查不到词时的真实响应(回退路径夹具) |
| `tests/dict-builder.test.js` | 纯函数单测 |
| `tests/translate.test.js` | `translate()` 胶水单测(stub `$http`) |
| `build.sh` | 打包成 `youdaodict.bobplugin` |

`main.js` 把纯函数与胶水放在同一文件,纯函数定义在顶层、不在加载时触碰任何 `$http`/`query` 全局,因此 Node `require` 安全。文件末尾的 `module.exports` 用 `typeof module !== "undefined"` 保护,Bob 沙箱无 `module` 时跳过。

---

## Chunk 1: 脚手架与真实夹具

### Task 1: 创建 info.json

**Files:**
- Create: `info.json`

- [ ] **Step 1: 写 info.json**

```json
{
  "identifier": "com.alex.bob.youdaodict",
  "version": "1.0.0",
  "category": "translate",
  "name": "有道词典(单词)",
  "summary": "查询单个英文单词：释义、双语例句、英/美发音",
  "icon": "001",
  "author": "Alex",
  "minBobVersion": "1.8.0",
  "options": []
}
```

- [ ] **Step 2: 校验 JSON 合法**

Run: `python3 -m json.tool info.json`
Expected: 原样打印,无报错。

- [ ] **Step 3: Commit**

```bash
git init && git add info.json && git commit -m "chore: add Bob plugin manifest"
```

### Task 2: 抓取真实 jsonapi 夹具

**Files:**
- Create: `tests/fixtures/youdao-good.json`
- Create: `tests/fixtures/youdao-notfound.json`

- [ ] **Step 1: 抓 good(命中词典)**

```bash
curl -s --noproxy '*' "https://dict.youdao.com/jsonapi?q=good" \
  -H 'User-Agent: Mozilla/5.0' -o tests/fixtures/youdao-good.json
```

- [ ] **Step 2: 抓一个查不到的串(无 ec 字段)**

```bash
curl -s --noproxy '*' "https://dict.youdao.com/jsonapi?q=asdfqwerzxcv" \
  -H 'User-Agent: Mozilla/5.0' -o tests/fixtures/youdao-notfound.json
```

- [ ] **Step 3: 确认两个夹具的 ec 差异**

Run:
```bash
python3 -c "import json;print('good has ec:', 'ec' in json.load(open('tests/fixtures/youdao-good.json')))"
python3 -c "import json;d=json.load(open('tests/fixtures/youdao-notfound.json'));print('notfound ec.word:', (d.get('ec') or {}).get('word'))"
```
Expected: `good has ec: True`;notfound 的 `ec.word` 为 `None` 或缺失(即 `buildDictResult` 应返回 null 走回退)。
> 若 notfound 串意外命中了词典,换一个更随机的乱码串重抓,确保拿到"无 ec.word"的真实样本。

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures && git commit -m "test: add real youdao jsonapi fixtures"
```

---

## Chunk 2: 纯转换函数(TDD)

> 本 chunk 全程 @superpowers:test-driven-development:先写失败测试 → 跑红 → 最小实现 → 跑绿 → commit。
> 所有测试用 `node --test`,断言用内置 `node:assert`,数据用 Chunk 1 的真实夹具。

测试文件顶部统一:
```js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const mod = require("../main.js");
const good = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-good.json"), "utf8"));
```

### Task 3: isSingleWord(单词判定)

**Files:**
- Test: `tests/dict-builder.test.js`
- Modify: `main.js`

- [ ] **Step 1: 写失败测试**

```js
test("isSingleWord: 单词为真，含空格/中文/空串为假", () => {
  assert.equal(mod.isSingleWord("good"), true);
  assert.equal(mod.isSingleWord("  Hello  "), true);
  assert.equal(mod.isSingleWord("well-being"), true);
  assert.equal(mod.isSingleWord("good morning"), false);
  assert.equal(mod.isSingleWord("你好"), false);
  assert.equal(mod.isSingleWord(""), false);
  assert.equal(mod.isSingleWord(undefined), false);
});
```

- [ ] **Step 2: 跑红**

Run: `node --test tests/dict-builder.test.js`
Expected: FAIL(`mod.isSingleWord is not a function` 或 `Cannot find module ../main.js`)。

- [ ] **Step 3: 最小实现(创建 main.js 并加函数 + 导出钩子)**

```js
function isSingleWord(text) {
  return /^[a-zA-Z][a-zA-Z'\-]*$/.test((text || "").trim());
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { isSingleWord };
}
```

- [ ] **Step 4: 跑绿**

Run: `node --test tests/dict-builder.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add main.js tests/dict-builder.test.js && git commit -m "feat: isSingleWord detection"
```

### Task 4: buildPhonetics(音标 + 发音 URL)

**Files:**
- Test: `tests/dict-builder.test.js`
- Modify: `main.js`

- [ ] **Step 1: 写失败测试**

```js
test("buildPhonetics: 生成英美两条，tts 指向 dictvoice", () => {
  const ec = good.ec.word[0];
  const ps = mod.buildPhonetics("good", ec);
  const us = ps.find(p => p.type === "us");
  const uk = ps.find(p => p.type === "uk");
  assert.ok(us && uk, "应同时有美音和英音");
  assert.equal(us.value, "ɡʊd");
  assert.equal(us.tts.type, "url");
  assert.equal(us.tts.value, "https://dict.youdao.com/dictvoice?audio=good&type=2");
  assert.equal(uk.tts.value, "https://dict.youdao.com/dictvoice?audio=good&type=1");
});

test("buildPhonetics: 缺 speech 字段时按 word 兜底拼参数", () => {
  const ps = mod.buildPhonetics("good", { usphone: "x" });
  assert.equal(ps[0].tts.value, "https://dict.youdao.com/dictvoice?audio=good&type=2");
});
```

- [ ] **Step 2: 跑红** — Run: `node --test tests/dict-builder.test.js` → FAIL。

- [ ] **Step 3: 实现**

```js
const VOICE_BASE = "https://dict.youdao.com/dictvoice?audio=";

function buildPhonetics(word, ecWord) {
  const out = [];
  if (ecWord.usphone) {
    out.push({
      type: "us", value: ecWord.usphone,
      tts: { type: "url", value: VOICE_BASE + (ecWord.usspeech || encodeURIComponent(word) + "&type=2") }
    });
  }
  if (ecWord.ukphone) {
    out.push({
      type: "uk", value: ecWord.ukphone,
      tts: { type: "url", value: VOICE_BASE + (ecWord.ukspeech || encodeURIComponent(word) + "&type=1") }
    });
  }
  return out;
}
```
并把 `buildPhonetics` 加入 `module.exports`。

- [ ] **Step 4: 跑绿** — Run: `node --test tests/dict-builder.test.js` → PASS。

- [ ] **Step 5: Commit** — `git commit -am "feat: buildPhonetics with dictvoice tts"`

### Task 5: buildParts(词性 + 释义)

**Files:**
- Test: `tests/dict-builder.test.js`
- Modify: `main.js`

- [ ] **Step 1: 写失败测试**

```js
test("buildParts: 拆出词性与释义数组", () => {
  const parts = mod.buildParts(good.ec.word[0]);
  assert.ok(parts.length >= 2);
  const adj = parts.find(p => p.part === "adj.");
  assert.ok(adj, "应有 adj. 词性");
  assert.ok(Array.isArray(adj.means) && adj.means.length > 1);
  assert.ok(adj.means.every(s => s.length > 0));
});

test("buildParts: 无法识别词性时整行作单条释义", () => {
  const parts = mod.buildParts({ trs: [{ tr: [{ l: { i: ["纯中文释义没有词性"] } }] }] });
  assert.deepEqual(parts, [{ part: "", means: ["纯中文释义没有词性"] }]);
});
```

- [ ] **Step 2: 跑红** → FAIL。

- [ ] **Step 3: 实现**

```js
function buildParts(ecWord) {
  const parts = [];
  for (const t of (ecWord.trs || [])) {
    const line = t && t.tr && t.tr[0] && t.tr[0].l && t.tr[0].l.i && t.tr[0].l.i[0];
    if (!line) continue;
    const m = line.match(/^([a-zA-Z]+\.)\s*(.+)$/);
    if (m) {
      parts.push({ part: m[1], means: m[2].split(/[；;]/).map(s => s.trim()).filter(Boolean) });
    } else {
      parts.push({ part: "", means: [line.trim()] });
    }
  }
  return parts;
}
```
加入 `module.exports`。

- [ ] **Step 4: 跑绿** → PASS。
- [ ] **Step 5: Commit** — `git commit -am "feat: buildParts"`

### Task 6: buildExchanges(词形变化)

**Files:**
- Test: `tests/dict-builder.test.js`
- Modify: `main.js`

- [ ] **Step 1: 写失败测试**

```js
test("buildExchanges: wfs 映射为 name+words", () => {
  const ex = mod.buildExchanges(good.ec.word[0]);
  assert.ok(ex.some(e => e.name === "比较级" && e.words.includes("better")));
  assert.ok(ex.some(e => e.name === "复数" && e.words.includes("goods")));
});

test("buildExchanges: 无 wfs 返回空数组", () => {
  assert.deepEqual(mod.buildExchanges({}), []);
});
```

- [ ] **Step 2: 跑红** → FAIL。

- [ ] **Step 3: 实现**

```js
function buildExchanges(ecWord) {
  return (ecWord.wfs || [])
    .map(x => x && x.wf)
    .filter(wf => wf && wf.name && wf.value)
    .map(wf => ({ name: wf.name, words: [wf.value] }));
}
```
加入 `module.exports`。

- [ ] **Step 4: 跑绿** → PASS。
- [ ] **Step 5: Commit** — `git commit -am "feat: buildExchanges"`

### Task 7: buildExamples(双语例句)

**Files:**
- Test: `tests/dict-builder.test.js`
- Modify: `main.js`

- [ ] **Step 1: 写失败测试**

```js
test("buildExamples: 取前 N 条双语例句", () => {
  const adds = mod.buildExamples(good, 2);
  assert.equal(adds.length, 2);
  assert.equal(adds[0].name, "例句");
  assert.match(adds[0].value, /good/i);          // 含英文
  assert.match(adds[0].value, /[一-龥]/); // 含中文译文
});

test("buildExamples: 无例句返回空数组", () => {
  assert.deepEqual(mod.buildExamples({}, 2), []);
});
```

- [ ] **Step 2: 跑红** → FAIL。

- [ ] **Step 3: 实现**

```js
function buildExamples(data, max) {
  const pairs = (data.blng_sents_part && data.blng_sents_part["sentence-pair"]) || [];
  return pairs.slice(0, max || 2)
    .map(p => ({
      name: "例句",
      value: `${(p.sentence || "").trim()} ${(p["sentence-translation"] || "").trim()}`.trim()
    }))
    .filter(a => a.value);
}
```
加入 `module.exports`。

- [ ] **Step 4: 跑绿** → PASS。
- [ ] **Step 5: Commit** — `git commit -am "feat: buildExamples"`

### Task 8: buildDictResult(组装 + 查不到兜底)

**Files:**
- Test: `tests/dict-builder.test.js`
- Modify: `main.js`

- [ ] **Step 1: 写失败测试**

```js
const notfound = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-notfound.json"), "utf8"));

test("buildDictResult: 命中词典返回完整 toDict", () => {
  const d = mod.buildDictResult(good, "good");
  assert.equal(d.word, "good");
  assert.ok(d.phonetics.length >= 1);
  assert.ok(d.parts.length >= 1);
  assert.ok(d.additions.length >= 1);
});

test("buildDictResult: 查不到返回 null", () => {
  assert.equal(mod.buildDictResult(notfound, "asdfqwerzxcv"), null);
});

test("buildDictResult: ec.word 为对象(非数组)也能处理", () => {
  const obj = { ec: { word: good.ec.word[0] } };
  assert.equal(mod.buildDictResult(obj, "good").word, "good");
});
```

- [ ] **Step 2: 跑红** → FAIL。

- [ ] **Step 3: 实现**

```js
function buildDictResult(data, word) {
  const w = data.ec && data.ec.word;
  const ecWord = Array.isArray(w) ? w[0] : w;
  if (!ecWord) return null;
  return {
    word: ecWord["return-phrase"] || word,
    phonetics: buildPhonetics(word, ecWord),
    parts: buildParts(ecWord),
    exchanges: buildExchanges(ecWord),
    additions: buildExamples(data, 2)
  };
}
```
加入 `module.exports`。

- [ ] **Step 4: 跑绿(全量)** — Run: `node --test tests/dict-builder.test.js` → 所有用例 PASS。
- [ ] **Step 5: Commit** — `git commit -am "feat: buildDictResult assembly + not-found fallback"`

---

## Chunk 3: Bob 胶水与打包

### Task 9: translate / supportLanguages / pluginTimeoutInterval

**Files:**
- Test: `tests/translate.test.js`
- Modify: `main.js`

- [ ] **Step 1: 写失败测试(stub 全局 $http)**

```js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const good = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-good.json"), "utf8"));

function loadFresh() { delete require.cache[require.resolve("../main.js")]; return require("../main.js"); }

test("translate: 单词走词典，回填 toDict", () => {
  global.$http = { get: ({ handler }) => handler({ data: good }) };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "good", onCompletion: (p) => { out = p; } });
  assert.ok(out.result.toDict, "应返回 toDict");
  assert.equal(out.result.toDict.word, "good");
});

test("translate: 非单词回填提示段落，不发请求", () => {
  let called = false;
  global.$http = { get: () => { called = true; } };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "good morning", onCompletion: (p) => { out = p; } });
  assert.equal(called, false);
  assert.ok(out.result.toParagraphs[0].includes("单个"));
});

test("translate: 网络错误回填 error", () => {
  global.$http = { get: ({ handler }) => handler({ error: { message: "boom" } }) };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "good", onCompletion: (p) => { out = p; } });
  assert.equal(out.error.type, "network");
});

test("translate: 旧版无 onCompletion 时用 completion 参数", () => {
  global.$http = { get: ({ handler }) => handler({ data: good }) };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "good" }, (p) => { out = p; });
  assert.ok(out.result.toDict);
});

test("supportLanguages / pluginTimeoutInterval", () => {
  const mod = loadFresh();
  assert.ok(mod.supportLanguages().includes("en"));
  assert.equal(typeof mod.pluginTimeoutInterval(), "number");
});
```

- [ ] **Step 2: 跑红** — Run: `node --test tests/translate.test.js` → FAIL(`translate is not a function`)。

- [ ] **Step 3: 实现胶水**

```js
function translate(query, completion) {
  const finish = (payload) => {
    if (query && typeof query.onCompletion === "function") query.onCompletion(payload);
    else completion(payload);
  };
  const text = (query.text || "").trim();

  if (!isSingleWord(text)) {
    finish({ result: { toParagraphs: ["本插件用于查询单个英文单词的释义、例句与发音，请输入单个单词。"] } });
    return;
  }

  $http.get({
    url: "https://dict.youdao.com/jsonapi?q=" + encodeURIComponent(text),
    header: { "User-Agent": "Mozilla/5.0" },
    handler: (resp) => {
      if (resp.error) {
        finish({ error: { type: "network", message: "查询失败：" + (resp.error.message || "网络错误") } });
        return;
      }
      let data = resp.data;
      if (typeof data === "string") {
        try { data = JSON.parse(data); }
        catch (e) { finish({ error: { type: "api", message: "返回数据解析失败" } }); return; }
      }
      const dict = buildDictResult(data, text);
      if (!dict) {
        finish({ result: { toParagraphs: ["未查询到「" + text + "」的词典释义。"] } });
        return;
      }
      finish({ result: { from: "en", to: "zh-Hans", toDict: dict } });
    }
  });
}

function supportLanguages() { return ["auto", "en", "zh-Hans"]; }
function pluginTimeoutInterval() { return 10; }
```
把 `translate`、`supportLanguages`、`pluginTimeoutInterval` 加入 `module.exports`。

- [ ] **Step 4: 跑绿** — Run: `node --test tests/translate.test.js` → 全 PASS。

- [ ] **Step 5: 全量回归** — Run: `node --test tests/` → 两个测试文件全 PASS。

- [ ] **Step 6: Commit** — `git commit -am "feat: translate glue + language/timeout hooks"`

### Task 10: 打包脚本

**Files:**
- Create: `build.sh`

- [ ] **Step 1: 写 build.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
OUT="youdaodict.bobplugin"
rm -f "$OUT"
# .bobplugin 是 zip，info.json 与 main.js 必须在压缩包根部
zip -j "$OUT" info.json main.js
echo "built $OUT"
```

- [ ] **Step 2: 赋权并打包**

Run: `chmod +x build.sh && ./build.sh`
Expected: 生成 `youdaodict.bobplugin`,`unzip -l youdaodict.bobplugin` 显示根部含 `info.json` 与 `main.js`。

- [ ] **Step 3: Commit** — `git add build.sh && git commit -m "chore: add bobplugin packaging script"`

### Task 11: 在 Bob 中安装并人工验证(手动)

> 自动化测试已覆盖逻辑;此步是真实环境冒烟,需人工在 Bob GUI 操作。

- [ ] **Step 1:** 双击 `youdaodict.bobplugin` 安装,Bob 偏好设置 → 服务 中确认插件已启用。
- [ ] **Step 2:** 选中翻译服务为本插件,划词查 `good`。预期:显示美/英音标、词性+释义、词形变化、≥1 条双语例句。
- [ ] **Step 3:** 点音标旁喇叭。预期:能听到发音(美音/英音)。
- [ ] **Step 4:** 查一个金山词霸常查不到的中阶词(如 `serendipity`)。预期:有结果(验证换源解决了"查不到")。
- [ ] **Step 5:** 输入一句话(如 `how are you`)。预期:回退为"请输入单个单词"提示,不报错。
- [ ] **Step 6:** 若全部通过,`git tag v1.0.0 && git commit --allow-empty -m "release: v1.0.0 smoke-tested in Bob"`。

---

## 风险点与回滚

- **有道 jsonapi 无官方契约,字段可能变更**:所有解析函数对缺字段做了 `|| []` / null 兜底,字段消失只会少显示,不崩溃;夹具单测能在改版后快速定位坏在哪一层。
- **dictvoice 可能限流/改签名**:目前公开可用;若失效,`tts.value` 的拼接是唯一改动点,可换 `youdao` 其它音源或改用 `tts.type:"base64"` 自行下载音频。
- **反爬风险**:仅在用户主动查词时单次 GET,频率低;已带 `User-Agent`。如遇 412/403,在 `header` 补 `Referer: https://dict.youdao.com/` 重试。
- **回滚**:插件是独立 `.bobplugin`,在 Bob 服务列表删除即可,不影响其它翻译服务。

## 完成判定标准

1. `node --test tests/` 全绿(纯函数 + 胶水)。
2. `./build.sh` 产出可双击安装的 `youdaodict.bobplugin`。
3. Bob 内查单词:释义 + 例句 + **可点击出声的英/美发音**三项齐全。
4. 整句输入有友好回退,不报错。
