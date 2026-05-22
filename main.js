//  Bob 翻译插件：有道词典(单词)
//  输入单个英文单词 -> 释义 / 双语例句 / 英美发音；整句或查不到时友好回退。
//
//  分层：
//   - 纯函数（buildXxx / isSingleWord）：把有道 jsonapi 响应转成 Bob toDict，可在 Node 单测。
//   - 胶水（translate / supportLanguages / pluginTimeoutInterval）：依赖 Bob 注入的 $http。
//  文件末尾 module.exports 仅在 Node（测试）下生效；Bob 沙箱无 module，自动跳过。

var VOICE_BASE = "https://dict.youdao.com/dictvoice?audio=";

// 净化划词输入：去掉首尾的标点/引号/空白（划词常把句号、引号一起选中），保留词内连字符/撇号。
function cleanInput(text) {
  return (text || "").trim().replace(/^[^a-zA-Z]+/, "").replace(/[^a-zA-Z]+$/, "");
}

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

// 去掉有道释义里的 <b> 等 HTML 标签并压空白
function stripHtml(s) {
  return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// 柯林斯例句（简洁、双语）。结构：collins_entries[].entries.entry[].tran_entry[].exam_sents.sent[]
function collinsSents(data) {
  var entries = (data.collins && data.collins.collins_entries) || [];
  var out = [];
  entries.forEach(function (ce) {
    ((ce.entries && ce.entries.entry) || []).forEach(function (en) {
      (en.tran_entry || []).forEach(function (te) {
        ((te.exam_sents && te.exam_sents.sent) || []).forEach(function (s) {
          if (s.eng_sent) out.push({ eng: stripHtml(s.eng_sent), chn: stripHtml(s.chn_sent) });
        });
      });
    });
  });
  return out;
}

// 柯林斯英文释义 -> additions（"英释·ADJ" 之类）
function buildCollinsDefs(data, max) {
  var entries = (data.collins && data.collins.collins_entries) || [];
  var out = [];
  for (var a = 0; a < entries.length && out.length < (max || 2); a++) {
    var ents = (entries[a].entries && entries[a].entries.entry) || [];
    for (var b = 0; b < ents.length && out.length < (max || 2); b++) {
      var tes = ents[b].tran_entry || [];
      for (var c = 0; c < tes.length && out.length < (max || 2); c++) {
        var tran = stripHtml(tes[c].tran);
        if (!tran) continue;
        var pos = tes[c].pos_entry && tes[c].pos_entry.pos;
        out.push({ name: pos ? "英释·" + pos : "英释", value: tran });
      }
    }
  }
  return out;
}

// 双语例句 -> additions：合并柯林斯 + 有道，去重，偏好简短（按长度升序取前 N）
function buildExampleAdditions(data, max) {
  var raw = collinsSents(data);
  var pairs = (data.blng_sents_part && data.blng_sents_part["sentence-pair"]) || [];
  pairs.forEach(function (p) {
    if (p.sentence) raw.push({ eng: (p.sentence || "").trim(), chn: (p["sentence-translation"] || "").trim() });
  });
  var seen = {}, uniq = [];
  raw.forEach(function (s) { if (s.eng && !seen[s.eng]) { seen[s.eng] = 1; uniq.push(s); } });
  uniq.sort(function (a, b) { return a.eng.length - b.eng.length; });
  return uniq.slice(0, max || 2).map(function (s) {
    return { name: "例句", value: (s.eng + (s.chn ? " " + s.chn : "")).trim() };
  });
}

// 按口音偏好排序：英式优先时把 uk 排前（phonetics[0] 是 Bob 默认朗读项）
function orderByAccent(phonetics, accent) {
  if (accent !== "uk") return phonetics;
  return phonetics.slice().sort(function (a, b) {
    return (b.type === "uk") - (a.type === "uk");
  });
}

// 同义词 -> additions（按词性合并一行，如 "近义·adj. fine / nice"）。结构：syno.synos[].syno{pos, ws[].w}
function buildSynonyms(data, max) {
  var synos = (data.syno && data.syno.synos) || [];
  var out = [];
  for (var i = 0; i < synos.length && out.length < (max || 2); i++) {
    var s = synos[i].syno || {};
    var words = (s.ws || []).map(function (x) { return x.w; }).filter(Boolean);
    if (!words.length) continue;
    out.push({ name: s.pos ? "近义·" + s.pos : "近义", value: words.join(" / ") });
  }
  return out;
}

// 常用词组 -> additions（如 "词组 good at 善于"）。结构：phrs.phrs[].phr{headword.l.i, trs[].tr.l.i}
function buildPhrases(data, max) {
  var phrs = (data.phrs && data.phrs.phrs) || [];
  var out = [];
  for (var i = 0; i < phrs.length && out.length < (max || 2); i++) {
    var p = phrs[i].phr || {};
    var head = p.headword && p.headword.l && p.headword.l.i;
    var tr = p.trs && p.trs[0] && p.trs[0].tr && p.trs[0].tr.l && p.trs[0].tr.l.i;
    if (!head) continue;
    out.push({ name: "词组", value: (head + (tr ? " " + tr : "")).trim() });
  }
  return out;
}

// 词频星级 -> addition（柯林斯 star 0~5）。无星返回 null。
function buildStar(data) {
  var ce = (data.collins && data.collins.collins_entries) || [];
  var star = ce[0] && parseInt(ce[0].star, 10);
  if (!star || star < 1) return null;
  return { name: "词频", value: new Array(star + 1).join("★") };
}

// ---- 缓存（纯逻辑，可单测；$file 读写层在 translate 处，全 try/catch 兜底）----

function cacheKey(word) {
  return (word || "").toLowerCase().replace(/[^a-z0-9'\-]/g, "_");
}

function isFresh(entry, now, ttlMs) {
  return !!(entry && typeof entry.ts === "number" && (now - entry.ts) < ttlMs);
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
// opts: { accent: "us"|"uk", exampleCount: number, showCollins: boolean }
function buildDictResult(data, word, opts) {
  opts = opts || {};
  var accent = opts.accent === "uk" ? "uk" : "us";
  var exampleCount = opts.exampleCount || 2;
  var showCollins = opts.showCollins !== false; // 默认显示

  var w = data.ec && data.ec.word;
  var ecWord = Array.isArray(w) ? w[0] : w;
  if (!ecWord) return null;

  var additions = [];
  var star = buildStar(data);
  if (star) additions.push(star);
  if (showCollins) additions = additions.concat(buildCollinsDefs(data, 2));
  additions = additions.concat(buildExampleAdditions(data, exampleCount));
  additions = additions.concat(buildSynonyms(data, 2));
  additions = additions.concat(buildPhrases(data, 2));

  return {
    word: pickPhrase(ecWord["return-phrase"], word),
    phonetics: orderByAccent(buildPhonetics(word, ecWord), accent),
    parts: buildParts(ecWord),
    exchanges: buildExchanges(ecWord),
    additions: additions
  };
}

// ---- Bob 运行时入口 ----

// 从 Bob 注入的 $option 读用户设置（menu 值是字符串）；不存在时用默认值。
function readOptions() {
  var o = (typeof $option !== "undefined" && $option) || {};
  return {
    accent: o.accent === "uk" ? "uk" : "us",
    exampleCount: parseInt(o.exampleCount, 10) || 2,
    showCollins: o.showCollins !== "off"
  };
}

var CACHE_DIR = "$sandbox/cache";
var CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

// 读缓存：命中且未过期返回已解析的 jsonapi data，否则 null。全程 try/catch，任何异常都当未命中。
function cacheGet(word) {
  try {
    if (typeof $file === "undefined") return null;
    var path = CACHE_DIR + "/" + cacheKey(word) + ".json";
    if (!$file.exists(path)) return null;
    var raw = $file.read(path);
    var str = raw && raw.toUTF8 ? raw.toUTF8() : null;
    if (!str) return null;
    var entry = JSON.parse(str);
    return isFresh(entry, Date.now(), CACHE_TTL_MS) ? entry.data : null;
  } catch (e) { return null; }
}

// 写缓存：失败静默忽略，绝不影响查词。
function cacheSet(word, data) {
  try {
    if (typeof $file === "undefined" || typeof $data === "undefined") return;
    $file.mkdir(CACHE_DIR);
    var entry = JSON.stringify({ ts: Date.now(), data: data });
    $file.write({ data: $data.fromUTF8(entry), path: CACHE_DIR + "/" + cacheKey(word) + ".json" });
  } catch (e) { /* ignore */ }
}

// GET jsonapi：带 Referer 防反爬，失败（error 或 4xx/5xx）重试一次。
function fetchDict(text, onResp) {
  var url = "https://dict.youdao.com/jsonapi?q=" + encodeURIComponent(text);
  var header = { "User-Agent": "Mozilla/5.0", "Referer": "https://dict.youdao.com/" };
  var attempt = function (left) {
    $http.get({
      url: url, header: header, handler: function (resp) {
        var bad = resp.error || (resp.response && resp.response.statusCode >= 400);
        if (bad && left > 0) { attempt(left - 1); return; }
        onResp(resp);
      }
    });
  };
  attempt(1);
}

function translate(query, completion) {
  var finish = function (payload) {
    if (query && typeof query.onCompletion === "function") query.onCompletion(payload);
    else completion(payload);
  };
  var text = cleanInput(query.text);

  if (!isSingleWord(text)) {
    finish({ result: { toParagraphs: ["本插件用于查询单个英文单词的释义、例句与发音，请输入单个单词。"] } });
    return;
  }

  var opts = readOptions();
  var render = function (data) {
    var dict = buildDictResult(data, text, opts);
    if (!dict) { finish({ result: { toParagraphs: ["未查询到「" + text + "」的词典释义。"] } }); return; }
    finish({ result: { from: "en", to: "zh-Hans", toDict: dict } });
  };

  var cached = cacheGet(text);
  if (cached) { render(cached); return; }

  fetchDict(text, function (resp) {
    if (resp.error) {
      finish({ error: { type: "network", message: "查询失败：" + (resp.error.message || "网络错误") } });
      return;
    }
    var data = resp.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); }
      catch (e) { finish({ error: { type: "api", message: "返回数据解析失败" } }); return; }
    }
    cacheSet(text, data);
    render(data);
  });
}

function supportLanguages() { return ["auto", "en", "zh-Hans"]; }
function pluginTimeoutInterval() { return 10; }

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    cleanInput: cleanInput,
    isSingleWord: isSingleWord,
    buildPhonetics: buildPhonetics,
    buildParts: buildParts,
    buildExchanges: buildExchanges,
    buildSynonyms: buildSynonyms,
    buildPhrases: buildPhrases,
    buildStar: buildStar,
    cacheKey: cacheKey,
    isFresh: isFresh,
    stripHtml: stripHtml,
    collinsSents: collinsSents,
    buildCollinsDefs: buildCollinsDefs,
    buildExampleAdditions: buildExampleAdditions,
    orderByAccent: orderByAccent,
    buildDictResult: buildDictResult,
    readOptions: readOptions,
    translate: translate,
    supportLanguages: supportLanguages,
    pluginTimeoutInterval: pluginTimeoutInterval
  };
}
