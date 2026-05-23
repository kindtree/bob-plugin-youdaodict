const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const mod = require("../main.js");

const good = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-good.json"), "utf8"));
const notfound = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-notfound.json"), "utf8"));
const typo = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-typo.json"), "utf8"));
const ce = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-ce-yingxiang.json"), "utf8"));
const ceSent = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-ce-sentence.json"), "utf8"));

test("isSingleWord: 单词为真，含空格/中文/空串为假", () => {
  assert.equal(mod.isSingleWord("good"), true);
  assert.equal(mod.isSingleWord("  Hello  "), true);
  assert.equal(mod.isSingleWord("well-being"), true);
  assert.equal(mod.isSingleWord("good morning"), false);
  assert.equal(mod.isSingleWord("你好"), false);
  assert.equal(mod.isSingleWord(""), false);
  assert.equal(mod.isSingleWord(undefined), false);
});

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

test("buildExchanges: wfs 映射为 name+words", () => {
  const ex = mod.buildExchanges(good.ec.word[0]);
  assert.ok(ex.some(e => e.name === "比较级" && e.words.includes("better")));
  assert.ok(ex.some(e => e.name === "复数" && e.words.includes("goods")));
});

test("buildExchanges: 无 wfs 返回空数组", () => {
  assert.deepEqual(mod.buildExchanges({}), []);
});

test("stripHtml: 去标签压空白", () => {
  assert.equal(mod.stripHtml("<b>Good</b>  means   nice."), "Good means nice.");
  assert.equal(mod.stripHtml(undefined), "");
});

test("collinsSents: 抽出双语例句", () => {
  const s = mod.collinsSents(good);
  assert.ok(s.length > 0);
  assert.ok(s[0].eng && s[0].chn);
  assert.ok(!/[<>]/.test(s[0].eng), "不应残留 HTML 标签");
});

test("buildCollinsDefs: 英文释义带词性、去标签", () => {
  const defs = mod.buildCollinsDefs(good, 2);
  assert.equal(defs.length, 2);
  assert.match(defs[0].name, /^英释/);
  assert.ok(!/[<>]/.test(defs[0].value));
});

test("buildCollinsDefs: 无 collins 返回空", () => {
  assert.deepEqual(mod.buildCollinsDefs({}, 2), []);
});

test("buildExampleAdditions: 取前 N 条、双语、按短优先、去重", () => {
  const adds = mod.buildExampleAdditions(good, 2);
  assert.equal(adds.length, 2);
  assert.equal(adds[0].name, "例句");
  assert.match(adds[0].value, /[a-zA-Z]/);
  assert.match(adds[0].value, /[一-龥]/);
  // 短优先：第一条不长于第二条
  assert.ok(adds[0].value.length <= adds[1].value.length);
});

test("buildExampleAdditions: 无例句返回空数组", () => {
  assert.deepEqual(mod.buildExampleAdditions({}, 2), []);
});

test("orderByAccent: uk 优先把英音排前", () => {
  const ps = mod.buildPhonetics("good", good.ec.word[0]);
  assert.equal(mod.orderByAccent(ps, "uk")[0].type, "uk");
  assert.equal(mod.orderByAccent(ps, "us")[0].type, "us");
});

test("buildDictResult: opts 控制例句数 / 关闭柯林斯 / 口音", () => {
  const d = mod.buildDictResult(good, "good", { exampleCount: 1, showCollins: false, accent: "uk" });
  assert.equal(d.phonetics[0].type, "uk");
  assert.equal(d.additions.filter(a => a.name === "例句").length, 1);
  assert.equal(d.additions.filter(a => /^英释/.test(a.name)).length, 0, "关闭柯林斯后无英释");
});

test("buildDictResult: 默认含柯林斯英释 + 例句", () => {
  const d = mod.buildDictResult(good, "good");
  assert.ok(d.additions.some(a => /^英释/.test(a.name)));
  assert.ok(d.additions.some(a => a.name === "例句"));
});

test("cleanInput: 去首尾标点/引号/空白，保留词内连字符", () => {
  assert.equal(mod.cleanInput("good."), "good");
  assert.equal(mod.cleanInput("“good”"), "good");
  assert.equal(mod.cleanInput("  good,  "), "good");
  assert.equal(mod.cleanInput("(well-being)"), "well-being");
  assert.equal(mod.cleanInput("good"), "good");
});

test("cleanInput + isSingleWord: 带标点的划词能识别为单词", () => {
  assert.equal(mod.isSingleWord(mod.cleanInput("good.")), true);
  assert.equal(mod.isSingleWord(mod.cleanInput("“good”")), true);
});

test("buildSynonyms: 按词性合并近义词", () => {
  const syn = mod.buildSynonyms(good, 2);
  assert.ok(syn.length >= 1);
  assert.match(syn[0].name, /^近义/);
  assert.ok(syn[0].value.length > 0);
});

test("buildSynonyms: 无 syno 返回空", () => {
  assert.deepEqual(mod.buildSynonyms({}, 2), []);
});

test("buildPhrases: 取词组 + 中文", () => {
  const ph = mod.buildPhrases(good, 2);
  assert.ok(ph.length >= 1);
  assert.equal(ph[0].name, "词组");
  assert.match(ph[0].value, /[a-zA-Z]/);
  assert.match(ph[0].value, /[一-龥]/);
});

test("buildPhrases: 无 phrs 返回空", () => {
  assert.deepEqual(mod.buildPhrases({}, 2), []);
});

test("buildStar: 柯林斯星级转 ★", () => {
  const s = mod.buildStar(good);
  assert.equal(s.name, "词频");
  assert.ok(/^★+$/.test(s.value));
});

test("buildStar: 无星返回 null", () => {
  assert.equal(mod.buildStar({}), null);
  assert.equal(mod.buildStar({ collins: { collins_entries: [{ star: 0 }] } }), null);
});

test("cacheKey: 归一化为小写安全键", () => {
  assert.equal(mod.cacheKey("Good"), "good");
  assert.equal(mod.cacheKey("well-being"), "well-being");
  assert.equal(mod.cacheKey("a/b c"), "a_b_c");
});

test("isFresh: TTL 内为真，超时为假", () => {
  const now = 1000000;
  assert.equal(mod.isFresh({ ts: now - 100 }, now, 1000), true);
  assert.equal(mod.isFresh({ ts: now - 2000 }, now, 1000), false);
  assert.equal(mod.isFresh(null, now, 1000), false);
  assert.equal(mod.isFresh({}, now, 1000), false);
});

test("buildExamTags: ec.exam_type 拼成标签 addition", () => {
  const a = mod.buildExamTags(good);
  assert.equal(a.name, "标签");
  assert.match(a.value, /CET4/);
  assert.match(a.value, /考研/);
});

test("buildExamTags: 无 exam_type 或为空返回 null", () => {
  assert.equal(mod.buildExamTags({}), null);
  assert.equal(mod.buildExamTags({ ec: { exam_type: [] } }), null);
});

test("buildRelatedWordParts: 按词性分组，tran 去前后空格", () => {
  const rwp = mod.buildRelatedWordParts(good);
  assert.ok(rwp.length >= 1);
  const adj = rwp.find(g => g.part === "adj.");
  assert.ok(adj, "应有 adj. 分组");
  const goody = adj.words.find(w => w.word === "goody");
  assert.ok(goody);
  assert.ok(goody.means[0].length > 0);
  assert.equal(goody.means[0].charAt(0), goody.means[0].trim().charAt(0),
    "means[0] 不应有前导空格");
});

test("buildRelatedWordParts: 无 rel_word 返回空数组", () => {
  assert.deepEqual(mod.buildRelatedWordParts({}), []);
});

test("buildDictResult: 含 relatedWordParts 与 标签 addition", () => {
  const d = mod.buildDictResult(good, "good");
  assert.ok(Array.isArray(d.relatedWordParts));
  assert.ok(d.relatedWordParts.length >= 1);
  assert.ok(d.additions.some(a => a.name === "标签" && /CET4/.test(a.value)));
});

test("buildTypoSuggestions: 拼错词返回候选 + 提示 parts", () => {
  const s = mod.buildTypoSuggestions(typo, "serendipty", 5);
  assert.ok(s, "应返回结果对象");
  assert.equal(s.word, "serendipty");
  assert.match(s.parts[0].means[0], /要找的是不是/);
  assert.ok(s.additions.length >= 1);
  assert.ok(s.additions.some(a => /serendipity/i.test(a.value)));
});

test("buildTypoSuggestions: 限制候选数量", () => {
  const s = mod.buildTypoSuggestions(typo, "x", 1);
  assert.equal(s.additions.length, 1);
});

test("buildTypoSuggestions: 无 typos 返回 null", () => {
  assert.equal(mod.buildTypoSuggestions({}, "x", 5), null);
  assert.equal(mod.buildTypoSuggestions(notfound, "x", 5), null);
});

test("isShortChineseWord: 1-4 汉字为真,英文/混合/超长为假", () => {
  assert.equal(mod.isShortChineseWord("影响"), true);
  assert.equal(mod.isShortChineseWord("人"), true);
  assert.equal(mod.isShortChineseWord("能力发展"), true);
  assert.equal(mod.isShortChineseWord("good"), false);
  assert.equal(mod.isShortChineseWord("影响 good"), false);
  assert.equal(mod.isShortChineseWord("影响力很大的事"), false); // 7 字
  assert.equal(mod.isShortChineseWord(""), false);
  assert.equal(mod.isShortChineseWord(undefined), false);
});

test("buildCeDictResult: 中文输入返回候选 relatedWordParts + 拼音 additions", () => {
  const d = mod.buildCeDictResult(ce, "影响");
  assert.equal(d.word, "影响");
  // phonetics 空（Bob 协议 type 限 us/uk，中文不放 phonetics）
  assert.deepEqual(d.phonetics, []);
  // 拼音作为 additions
  const py = d.additions.find(a => a.name === "拼音");
  assert.ok(py, "应有拼音 addition");
  assert.match(py.value, /yǐng/);
  // relatedWordParts 按词性分组
  assert.ok(d.relatedWordParts.length >= 2);
  const n = d.relatedWordParts.find(g => g.part === "n.");
  const vt = d.relatedWordParts.find(g => g.part === "vt.");
  assert.ok(n && vt);
  assert.ok(n.words.some(w => w.word === "influence"));
  assert.ok(vt.words.some(w => w.word === "affect"));
  // 每个候选含中文补充释义
  const inf = n.words.find(w => w.word === "influence");
  assert.ok(inf.means[0].length > 0);
  assert.match(inf.means[0], /影响/);
});

test("buildCeDictResult: 无 ce.word 返回 null", () => {
  assert.equal(mod.buildCeDictResult({}, "x"), null);
  assert.equal(mod.buildCeDictResult({ ce: { word: [] } }, "x"), null);
});

test("containsChinese: 含汉字为真", () => {
  assert.equal(mod.containsChinese("今天天气不错"), true);
  assert.equal(mod.containsChinese("hello 世界"), true);
  assert.equal(mod.containsChinese("good"), false);
  assert.equal(mod.containsChinese(""), false);
});

test("parseCeSentenceTr: 重组英文 + 抽词", () => {
  const tr = ceSent.ce.word[0].trs[0];
  const r = mod.parseCeSentenceTr(tr);
  assert.equal(r.english, "The weather is good today.");
  assert.deepEqual(r.words, ["The", "weather", "is", "good", "today"]);
});

test("buildCeSentenceResult: 主译进 parts、其他译法进 additions、词列表进 relatedWordParts(去停用词去重)", () => {
  const d = mod.buildCeSentenceResult(ceSent, "今天天气不错");
  assert.equal(d.word, "今天天气不错");
  // 主译
  assert.equal(d.parts.length, 1);
  assert.match(d.parts[0].means[0], /weather/);
  // 其他译法
  const alt = d.additions.filter(a => a.name === "其他译法");
  assert.ok(alt.length >= 1, "应至少有 1 条其他译法");
  assert.match(alt[0].value, /fine|nice/);
  // 可点词列表：含 weather/good/today，去掉 the/is 等停用词
  const words = d.relatedWordParts[0].words.map(w => w.word.toLowerCase());
  assert.ok(words.includes("weather"));
  assert.ok(words.includes("today"));
  assert.ok(!words.includes("the"), "the 应被过滤");
  assert.ok(!words.includes("is"), "is 应被过滤");
});

test("buildCeSentenceResult: word 超长会截断", () => {
  const longInput = "今天".repeat(20); // 40 字
  const d = mod.buildCeSentenceResult(ceSent, longInput);
  assert.ok(d.word.length <= 31, "word 应被截断至 30 字内 + 省略号");
  assert.ok(d.word.endsWith("…"));
});

test("buildCeSentenceResult: 无 ce.word 返回 null", () => {
  assert.equal(mod.buildCeSentenceResult({}, "x"), null);
});

test("buildLlmPrompt: 含 'json' 字、含示例、含中文输入", () => {
  const p = mod.buildLlmPrompt("今天面试很顺利");
  assert.match(p, /json/i, "DeepSeek JSON mode 要求 prompt 含 'json'");
  assert.match(p, /translation/);
  assert.match(p, /CET4/);
  assert.match(p, /雅思/);
  assert.match(p, /今天面试很顺利/);
});

test("parseLlmResponse: 合法 JSON 解析成功", () => {
  const raw = JSON.stringify({
    translation: "The interview today went well.",
    words: [{word:"interview", level:"CET6"}, {word:"today", level:"基础"}]
  });
  const r = mod.parseLlmResponse(raw);
  assert.equal(r.translation, "The interview today went well.");
  assert.equal(r.words.length, 2);
  assert.equal(r.words[0].word, "interview");
});

test("parseLlmResponse: 非 JSON / 空 / 缺字段 返回 null", () => {
  assert.equal(mod.parseLlmResponse("not json"), null);
  assert.equal(mod.parseLlmResponse(""), null);
  assert.equal(mod.parseLlmResponse(null), null);
  assert.equal(mod.parseLlmResponse('{"foo":"bar"}'), null, "缺 translation 字段");
  assert.equal(mod.parseLlmResponse('{"translation":""}'), null, "translation 空");
});

test("parseLlmResponse: words 缺失或非数组时退化为空数组", () => {
  const r = mod.parseLlmResponse('{"translation":"hello"}');
  assert.deepEqual(r.words, []);
});

test("buildLlmSentenceResult: 按 level 分组、按难度顺序、去重、过滤非字母词", () => {
  const llm = {
    translation: "The interview today went well.",
    words: [
      {word:"interview", level:"CET6"},
      {word:"today", level:"初中"},
      {word:"went", level:"初中"},
      {word:"well", level:"初中"},
      {word:"Today", level:"初中"},          // 大小写重复
      {word:".", level:"初中"},               // 标点
      {word:"epitome", level:"GRE"}           // 难词
    ]
  };
  const d = mod.buildLlmSentenceResult(llm, "今天面试很顺利");
  // 主译进 parts
  assert.equal(d.parts[0].means[0], "The interview today went well.");
  // 来源标注
  assert.ok(d.additions.some(a => /DeepSeek/.test(a.value)));
  // relatedWordParts 按难→易顺序:GRE > CET6 > 初中
  const partsOrder = d.relatedWordParts.map(g => g.part);
  assert.deepEqual(partsOrder, ["GRE", "CET6", "初中"]);
  // 标点被过滤
  const allWords = d.relatedWordParts.flatMap(g => g.words.map(w => w.word));
  assert.ok(!allWords.includes("."));
  // 大小写去重(Today 不重复出现)
  const basicWords = d.relatedWordParts.find(g => g.part === "初中").words.map(w => w.word.toLowerCase());
  assert.equal(basicWords.filter(w => w === "today").length, 1);
});

test("buildLlmSentenceResult: 未知 level 归入 '其它'", () => {
  const llm = { translation: "Hello world.", words: [{word:"hello", level:"hallucination"}, {word:"world", level:"GRE"}] };
  const d = mod.buildLlmSentenceResult(llm, "你好世界");
  const other = d.relatedWordParts.find(g => g.part === "其它");
  assert.ok(other, "未知 level 应进 '其它' 分组");
  assert.equal(other.words[0].word, "hello");
});

test("buildLlmSentenceResult: 无 translation 返回 null", () => {
  assert.equal(mod.buildLlmSentenceResult(null, "x"), null);
  assert.equal(mod.buildLlmSentenceResult({words:[]}, "x"), null);
});

test("buildLlmSentenceResult: word 超长截断", () => {
  const llm = { translation: "x", words: [] };
  const d = mod.buildLlmSentenceResult(llm, "今天".repeat(20));
  assert.ok(d.word.length <= 31);
  assert.ok(d.word.endsWith("…"));
});

test("buildLlmPrompt: targetLevel 非 all 时含学习者级别提示", () => {
  const p = mod.buildLlmPrompt("今天面试很顺利", "雅思");
  assert.match(p, /学习者当前正在准备：雅思/);
  assert.match(p, /倾向使用 雅思 常考词汇/);
});

test("buildLlmPrompt: targetLevel 为 all 或缺失时不加提示", () => {
  const p1 = mod.buildLlmPrompt("x", "all");
  const p2 = mod.buildLlmPrompt("x");
  assert.ok(!/学习者当前正在准备/.test(p1));
  assert.ok(!/学习者当前正在准备/.test(p2));
});

test("buildLlmPrompt: 等级取值列表已细分到 10 档(含小学/初中/高中)", () => {
  const p = mod.buildLlmPrompt("x", "all");
  ["小学","初中","高中","CET4","CET6","考研","雅思","托福","GRE","其它"].forEach(l => {
    assert.match(p, new RegExp('"' + l + '"'), `等级 "${l}" 应出现在 prompt`);
  });
});

test("filterLevelGroups: only 模式仅保留目标级 + 其它", () => {
  const g = { "GRE":[1], "雅思":[2], "CET4":[3], "初中":[4], "其它":[5] };
  const out = mod.filterLevelGroups(g, "雅思", "only");
  assert.deepEqual(Object.keys(out).sort(), ["其它","雅思"]);
});

test("filterLevelGroups: above 模式保留目标及更难等级 + 其它", () => {
  const g = { "GRE":[1], "托福":[2], "雅思":[3], "CET6":[4], "初中":[5], "其它":[6] };
  const out = mod.filterLevelGroups(g, "雅思", "above");
  // 雅思及以上(更难的) = GRE/托福/雅思,加"其它"
  assert.deepEqual(Object.keys(out).sort(), ["GRE","其它","托福","雅思"]);
  assert.ok(!out["CET6"]);
  assert.ok(!out["初中"]);
});

test("filterLevelGroups: all/未指定/未知目标 → 不过滤", () => {
  const g = { "GRE":[1], "初中":[2] };
  assert.deepEqual(Object.keys(mod.filterLevelGroups(g, "all", "above")).sort(), ["GRE","初中"]);
  assert.deepEqual(Object.keys(mod.filterLevelGroups(g, "雅思", "all")).sort(), ["GRE","初中"]);
  assert.deepEqual(Object.keys(mod.filterLevelGroups(g, null, "above")).sort(), ["GRE","初中"]);
});

test("buildLlmSentenceResult: opts.targetLevel + only 只渲染目标分组", () => {
  const llm = {
    translation: "x",
    words: [{word:"epitome",level:"GRE"},{word:"interview",level:"CET6"},{word:"today",level:"初中"}]
  };
  const d = mod.buildLlmSentenceResult(llm, "x", { targetLevel: "CET6", levelRange: "only" });
  const partNames = d.relatedWordParts.map(g => g.part);
  assert.deepEqual(partNames, ["CET6"]);
  // 来源标注里应含目标级别
  assert.match(d.additions[0].value, /目标:CET6/);
});

test("buildLlmSentenceResult: opts.targetLevel + above 保留目标及以上", () => {
  const llm = {
    translation: "x",
    words: [{word:"epitome",level:"GRE"},{word:"interview",level:"CET6"},{word:"today",level:"初中"}]
  };
  const d = mod.buildLlmSentenceResult(llm, "x", { targetLevel: "CET6", levelRange: "above" });
  const partNames = d.relatedWordParts.map(g => g.part);
  assert.deepEqual(partNames, ["GRE","CET6"]); // 初中被过滤
});

test("buildDictResult: 命中词典返回完整 toDict", () => {
  const d = mod.buildDictResult(good, "good");
  assert.equal(d.word, "good");
  assert.ok(d.phonetics.length >= 1);
  assert.ok(d.parts.length >= 1);
  assert.ok(d.additions.length >= 1);
});

test("buildDictResult: 查不到返回 null", () => {
  assert.equal(mod.buildDictResult(notfound, "asdfqwerzxcvbnmzzz"), null);
});

test("buildDictResult: ec.word 为对象(非数组)也能处理", () => {
  const obj = { ec: { word: good.ec.word[0] } };
  assert.equal(mod.buildDictResult(obj, "good").word, "good");
});
