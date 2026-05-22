const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const mod = require("../main.js");

const good = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-good.json"), "utf8"));
const notfound = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-notfound.json"), "utf8"));

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
