//  Bob 翻译插件：有道词典(单词)
//  输入单个英文单词 -> 释义 / 双语例句 / 英美发音；整句或查不到时友好回退。
//
//  分层：
//   - 纯函数（buildXxx / isSingleWord）：把有道 jsonapi 响应转成 Bob toDict，可在 Node 单测。
//   - 胶水（translate / supportLanguages / pluginTimeoutInterval）：依赖 Bob 注入的 $http。
//  文件末尾 module.exports 仅在 Node（测试）下生效；Bob 沙箱无 module，自动跳过。

var VOICE_BASE = "https://dict.youdao.com/dictvoice?audio=";

// 是否为单个英文单词（允许连字符/撇号，如 well-being、don't）
function isSingleWord(text) {
  return /^[a-zA-Z][a-zA-Z'\-]*$/.test((text || "").trim());
}

// 音标 + 发音 URL。usspeech 形如 "good&type=2"，拼到 VOICE_BASE 即可出声。
function buildPhonetics(word, ecWord) {
  var out = [];
  if (ecWord.usphone) {
    out.push({
      type: "us",
      value: ecWord.usphone,
      tts: { type: "url", value: VOICE_BASE + (ecWord.usspeech || encodeURIComponent(word) + "&type=2") }
    });
  }
  if (ecWord.ukphone) {
    out.push({
      type: "uk",
      value: ecWord.ukphone,
      tts: { type: "url", value: VOICE_BASE + (ecWord.ukspeech || encodeURIComponent(word) + "&type=1") }
    });
  }
  return out;
}

// 词性 + 释义。有道把词性和释义放在同一字符串里（"adj. 优良的；能干的…"），这里拆开。
function buildParts(ecWord) {
  var parts = [];
  var trs = ecWord.trs || [];
  for (var i = 0; i < trs.length; i++) {
    var t = trs[i];
    var line = t && t.tr && t.tr[0] && t.tr[0].l && t.tr[0].l.i && t.tr[0].l.i[0];
    if (!line) continue;
    var m = line.match(/^([a-zA-Z]+\.)\s*(.+)$/);
    if (m) {
      parts.push({
        part: m[1],
        means: m[2].split(/[；;]/).map(function (s) { return s.trim(); }).filter(Boolean)
      });
    } else {
      parts.push({ part: "", means: [line.trim()] });
    }
  }
  return parts;
}

// 词形变化（复数 / 比较级 / 最高级 …）
function buildExchanges(ecWord) {
  return (ecWord.wfs || [])
    .map(function (x) { return x && x.wf; })
    .filter(function (wf) { return wf && wf.name && wf.value; })
    .map(function (wf) { return { name: wf.name, words: [wf.value] }; });
}

// 双语例句 -> additions
function buildExamples(data, max) {
  var pairs = (data.blng_sents_part && data.blng_sents_part["sentence-pair"]) || [];
  return pairs.slice(0, max || 2)
    .map(function (p) {
      return {
        name: "例句",
        value: ((p.sentence || "").trim() + " " + (p["sentence-translation"] || "").trim()).trim()
      };
    })
    .filter(function (a) { return a.value; });
}

// 取规范词形。有道 return-phrase 可能是字符串，也可能是 {l:{i:"good"}} 或 {l:{i:["good"]}}。
function pickPhrase(rp, fallback) {
  if (typeof rp === "string" && rp) return rp;
  var i = rp && rp.l && rp.l.i;
  if (Array.isArray(i)) return i[0] || fallback;
  if (typeof i === "string" && i) return i;
  return fallback;
}

// 组装 toDict；查不到（无 ec.word）返回 null。
function buildDictResult(data, word) {
  var w = data.ec && data.ec.word;
  var ecWord = Array.isArray(w) ? w[0] : w;
  if (!ecWord) return null;
  return {
    word: pickPhrase(ecWord["return-phrase"], word),
    phonetics: buildPhonetics(word, ecWord),
    parts: buildParts(ecWord),
    exchanges: buildExchanges(ecWord),
    additions: buildExamples(data, 2)
  };
}

// ---- Bob 运行时入口 ----

function translate(query, completion) {
  var finish = function (payload) {
    if (query && typeof query.onCompletion === "function") query.onCompletion(payload);
    else completion(payload);
  };
  var text = (query.text || "").trim();

  if (!isSingleWord(text)) {
    finish({ result: { toParagraphs: ["本插件用于查询单个英文单词的释义、例句与发音，请输入单个单词。"] } });
    return;
  }

  $http.get({
    url: "https://dict.youdao.com/jsonapi?q=" + encodeURIComponent(text),
    header: { "User-Agent": "Mozilla/5.0" },
    handler: function (resp) {
      if (resp.error) {
        finish({ error: { type: "network", message: "查询失败：" + (resp.error.message || "网络错误") } });
        return;
      }
      var data = resp.data;
      if (typeof data === "string") {
        try { data = JSON.parse(data); }
        catch (e) { finish({ error: { type: "api", message: "返回数据解析失败" } }); return; }
      }
      var dict = buildDictResult(data, text);
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isSingleWord: isSingleWord,
    buildPhonetics: buildPhonetics,
    buildParts: buildParts,
    buildExchanges: buildExchanges,
    buildExamples: buildExamples,
    buildDictResult: buildDictResult,
    translate: translate,
    supportLanguages: supportLanguages,
    pluginTimeoutInterval: pluginTimeoutInterval
  };
}
