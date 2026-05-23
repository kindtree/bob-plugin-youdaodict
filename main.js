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

// 是否为 1-4 个汉字的纯中文短词（用于触发"中文 -> 英文候选"路径）。
function isShortChineseWord(text) {
  return /^[一-鿿]{1,4}$/.test((text || "").trim());
}

// 文本是否含汉字（用于"中文整句翻译"路径触发）。
function containsChinese(text) {
  return /[一-鿿]/.test((text || "").trim());
}

// 句子级英文停用词（不进可点词列表）
var STOP_WORDS = (function () {
  var list = ("a an the is am are was were be been being do does did done will would shall " +
    "should can could may might must have has had of in on at to for with without by from " +
    "into onto upon and or but nor so yet not no my your his her its our their this that " +
    "these those he she it we they you i me us them him as if then than there here when " +
    "where why how what which who whom whose").split(/\s+/);
  var o = {};
  list.forEach(function (w) { o[w] = 1; });
  return o;
})();

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

// 考试标签 -> addition（"CET4 / CET6 / 考研"）。结构：ec.exam_type 是字符串数组。
function buildExamTags(data) {
  var tags = (data.ec && data.ec.exam_type) || [];
  if (!tags.length) return null;
  return { name: "标签", value: tags.join(" / ") };
}

// 相关词 -> Bob toDict 的 relatedWordParts 字段（按词性分组）。
// 结构：rel_word.rels[].rel{pos, words[]{word, tran}}（tran 通常带前导空格，trim 掉）。
function buildRelatedWordParts(data) {
  var rels = (data.rel_word && data.rel_word.rels) || [];
  return rels
    .map(function (r) { return r && r.rel; })
    .filter(function (rel) { return rel && rel.words && rel.words.length; })
    .map(function (rel) {
      return {
        part: rel.pos || "",
        words: rel.words
          .filter(function (w) { return w && w.word; })
          .map(function (w) { return { word: w.word, means: [(w.tran || "").trim()] }; })
      };
    });
}

// 中文 -> 英文候选。结构：ce.word[0]{phone, return-phrase, trs[]}。
// trs[].tr[0].l = { pos, i: ["", {"#text": "influence", ...}], "#tran": "中文补充" }
// 按 pos 分组到 relatedWordParts（Bob 会把英文 word 渲染成可点蓝字，点击触发新查）。
function buildCeDictResult(data, word) {
  var ceWord = data.ce && data.ce.word;
  var w0 = Array.isArray(ceWord) ? ceWord[0] : ceWord;
  if (!w0 || !w0.trs || !w0.trs.length) return null;

  var byPos = {}; // {pos: [{word,means}]}
  var posOrder = []; // 保持原顺序
  w0.trs.forEach(function (t) {
    var l = t && t.tr && t.tr[0] && t.tr[0].l;
    if (!l) return;
    // 取英文词：l.i 是 ["", {"#text":"influence", ...}] 或字符串
    var en = "";
    if (Array.isArray(l.i)) {
      for (var k = 0; k < l.i.length; k++) {
        var it = l.i[k];
        if (it && typeof it === "object" && it["#text"]) { en = it["#text"]; break; }
        if (typeof it === "string" && it.trim()) { en = it.trim(); break; }
      }
    } else if (typeof l.i === "string") {
      en = l.i;
    }
    if (!en) return;
    var pos = l.pos || "";
    var tran = (l["#tran"] || "").trim();
    if (!byPos[pos]) { byPos[pos] = []; posOrder.push(pos); }
    byPos[pos].push({ word: en, means: tran ? [tran] : [] });
  });

  var groups = posOrder.map(function (pos) { return { part: pos, words: byPos[pos] }; });
  if (!groups.length) return null;

  var additions = [];
  if (w0.phone) additions.push({ name: "拼音", value: w0.phone });

  return {
    word: pickPhrase(w0["return-phrase"], word),
    phonetics: [],
    parts: [],
    exchanges: [],
    additions: additions,
    relatedWordParts: groups
  };
}

// 解析 ce 节里单条 trs 的整句翻译。tr[0].l.i 是混合数组：字符串 + {#text} 对象交替。
// 返回 {english: "完整英文句", words: ["The","weather",...]}（words 保持原顺序，含停用词，调用方再过滤）。
function parseCeSentenceTr(trItem) {
  var i = trItem && trItem.tr && trItem.tr[0] && trItem.tr[0].l && trItem.tr[0].l.i;
  if (!Array.isArray(i)) return { english: "", words: [] };
  var parts = [];
  var words = [];
  i.forEach(function (x) {
    if (typeof x === "string") { parts.push(x); return; }
    if (x && typeof x === "object" && x["#text"]) {
      parts.push(x["#text"]);
      words.push(x["#text"]);
    }
  });
  return { english: parts.join("").trim(), words: words };
}

// 中文整句 -> 翻译 + 可点词列表。结构：ce.word[0].trs[] 多条备选译法，取 trs[0] 当主译，
// 其余进 additions 当"其他译法"。词列表去停用词 + 去重 + 仅保留字母词。
function buildCeSentenceResult(data, text) {
  var w0 = data.ce && data.ce.word;
  var word = Array.isArray(w0) ? w0[0] : w0;
  var trs = word && word.trs;
  if (!Array.isArray(trs) || !trs.length) return null;

  var main = parseCeSentenceTr(trs[0]);
  if (!main.english) return null;

  // 去停用词 + 去重 + 仅字母词
  var seen = {}, clickable = [];
  main.words.forEach(function (w) {
    if (!/^[a-zA-Z][a-zA-Z'\-]*$/.test(w)) return;
    var k = w.toLowerCase();
    if (STOP_WORDS[k] || seen[k]) return;
    seen[k] = 1;
    clickable.push({ word: w, means: [] });
  });

  // 备选译法（最多 2 条）
  var alts = [];
  for (var i = 1; i < trs.length && alts.length < 2; i++) {
    var s = parseCeSentenceTr(trs[i]).english;
    if (s) alts.push({ name: "其他译法", value: s });
  }

  return {
    word: text.length > 30 ? text.slice(0, 30) + "…" : text,
    phonetics: [],
    parts: [{ part: "", means: [main.english] }],
    exchanges: [],
    additions: alts,
    relatedWordParts: clickable.length ? [{ part: "", words: clickable }] : []
  };
}

// 拼错词候选 -> 一个 toDict 风格的对象（无 phonetics，parts 给提示，additions 列候选）。
// 结构：data.typos.typo[]{word, trans}。无候选返回 null。
function buildTypoSuggestions(data, word, max) {
  var arr = (data.typos && data.typos.typo) || [];
  if (!arr.length) return null;
  return {
    word: word,
    phonetics: [],
    parts: [{ part: "", means: ["未找到该词，您要找的是不是："] }],
    exchanges: [],
    additions: arr.slice(0, max || 5).map(function (t) {
      var w = (t.word || "").trim();
      var tr = (t.trans || "").trim();
      return { name: "近似", value: tr ? (w + " — " + tr) : w };
    }),
    relatedWordParts: []
  };
}

// ---- 缓存（纯逻辑，可单测；$file 读写层在 translate 处，全 try/catch 兜底）----

// 缓存键：英文小写化，保留汉字与连字符/撇号，其它非常规字符替换为下划线。
function cacheKey(word) {
  return (word || "").toLowerCase().replace(/[^a-z0-9'\-一-鿿]/g, "_");
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
  var tag = buildExamTags(data);
  if (tag) additions.push(tag);
  if (showCollins) additions = additions.concat(buildCollinsDefs(data, 2));
  additions = additions.concat(buildExampleAdditions(data, exampleCount));
  additions = additions.concat(buildSynonyms(data, 2));
  additions = additions.concat(buildPhrases(data, 2));

  return {
    word: pickPhrase(ecWord["return-phrase"], word),
    phonetics: orderByAccent(buildPhonetics(word, ecWord), accent),
    parts: buildParts(ecWord),
    exchanges: buildExchanges(ecWord),
    additions: additions,
    relatedWordParts: buildRelatedWordParts(data)
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
  // 注意先 trim 一次拿原始文本，cleanInput 只对英文路径用（去首尾标点），中文路径不要去掉汉字
  var raw = (query.text || "").trim();
  var enText = cleanInput(query.text);
  var isEn = isSingleWord(enText);
  var isZhShort = isShortChineseWord(raw);
  var isZhSent = !isZhShort && containsChinese(raw);

  if (!isEn && !isZhShort && !isZhSent) {
    finish({ result: { toParagraphs: ["请输入单个英文单词，或中文（短词反查英文 / 整句翻译并列出可点词）。"] } });
    return;
  }

  var text = isEn ? enText : raw;
  var opts = readOptions();
  var render = function (data) {
    if (isZhShort) {
      var ce = buildCeDictResult(data, text);
      if (ce) { finish({ result: { from: "zh-Hans", to: "en", toDict: ce } }); return; }
      finish({ result: { toParagraphs: ["未查询到「" + text + "」的英文候选。"] } });
      return;
    }
    if (isZhSent) {
      var sent = buildCeSentenceResult(data, text);
      if (sent) { finish({ result: { from: "zh-Hans", to: "en", toDict: sent } }); return; }
      finish({ result: { toParagraphs: ["未查询到「" + text + "」的翻译。"] } });
      return;
    }
    var dict = buildDictResult(data, text, opts);
    if (dict) { finish({ result: { from: "en", to: "zh-Hans", toDict: dict } }); return; }
    var typo = buildTypoSuggestions(data, text, 5);
    if (typo) { finish({ result: { from: "en", to: "zh-Hans", toDict: typo } }); return; }
    finish({ result: { toParagraphs: ["未查询到「" + text + "」的词典释义。"] } });
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

function supportLanguages() { return ["auto", "en", "zh-Hans", "zh-Hant"]; }
function pluginTimeoutInterval() { return 10; }

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    cleanInput: cleanInput,
    isSingleWord: isSingleWord,
    isShortChineseWord: isShortChineseWord,
    containsChinese: containsChinese,
    buildCeDictResult: buildCeDictResult,
    parseCeSentenceTr: parseCeSentenceTr,
    buildCeSentenceResult: buildCeSentenceResult,
    buildPhonetics: buildPhonetics,
    buildParts: buildParts,
    buildExchanges: buildExchanges,
    buildSynonyms: buildSynonyms,
    buildPhrases: buildPhrases,
    buildStar: buildStar,
    buildExamTags: buildExamTags,
    buildRelatedWordParts: buildRelatedWordParts,
    buildTypoSuggestions: buildTypoSuggestions,
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
