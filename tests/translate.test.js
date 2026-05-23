const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const good = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-good.json"), "utf8"));
const typo = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-typo.json"), "utf8"));
const ce = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-ce-yingxiang.json"), "utf8"));
const ceSent = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/youdao-ce-sentence.json"), "utf8"));

function loadFresh() {
  delete require.cache[require.resolve("../main.js")];
  return require("../main.js");
}

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

test("translate: 返回字符串 JSON 也能解析", () => {
  global.$http = { get: ({ handler }) => handler({ data: JSON.stringify(good) }) };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "good", onCompletion: (p) => { out = p; } });
  assert.ok(out.result.toDict);
});

test("translate: 带标点 'good.' 经净化仍走词典", () => {
  delete global.$file;
  global.$http = { get: ({ handler }) => handler({ data: good }) };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "good.", onCompletion: (p) => { out = p; } });
  assert.ok(out.result.toDict);
  assert.equal(out.result.toDict.word, "good");
});

test("translate: 缓存命中则不发网络请求", () => {
  let netCalled = false;
  global.$http = { get: () => { netCalled = true; } };
  const entry = JSON.stringify({ ts: Date.now(), data: good });
  global.$file = { exists: () => true, read: () => ({ toUTF8: () => entry }) };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "good", onCompletion: (p) => { out = p; } });
  assert.equal(netCalled, false, "命中缓存不应发网络");
  assert.ok(out.result.toDict);
  delete global.$file;
});

test("translate: 缓存读异常时回退联网，不崩", () => {
  let netCalled = false;
  global.$http = { get: ({ handler }) => { netCalled = true; handler({ data: good }); } };
  global.$file = { exists: () => { throw new Error("boom"); } };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "good", onCompletion: (p) => { out = p; } });
  assert.equal(netCalled, true);
  assert.ok(out.result.toDict);
  delete global.$file;
});

test("translate: 4xx 时重试一次", () => {
  let calls = 0;
  delete global.$file;
  global.$http = { get: ({ handler }) => {
    calls++;
    if (calls === 1) handler({ response: { statusCode: 412 } });
    else handler({ data: good });
  }};
  const mod = loadFresh();
  let out;
  mod.translate({ text: "good", onCompletion: (p) => { out = p; } });
  assert.equal(calls, 2, "首次 412 应重试一次");
  assert.ok(out.result.toDict);
});

test("translate: 拼错词走 typo 路径，返回 toDict 含候选", () => {
  delete global.$file;
  global.$http = { get: ({ handler }) => handler({ data: typo }) };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "serendipty", onCompletion: (p) => { out = p; } });
  assert.ok(out.result.toDict, "应返回 toDict（而非 toParagraphs）");
  assert.match(out.result.toDict.parts[0].means[0], /要找的是不是/);
  assert.ok(out.result.toDict.additions.some(a => /serendipity/i.test(a.value)));
});

test("translate: 中文短词走 ce 路径，返回 toDict 含英文候选", () => {
  delete global.$file;
  global.$http = { get: ({ handler }) => handler({ data: ce }) };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "影响", onCompletion: (p) => { out = p; } });
  assert.ok(out.result.toDict, "应返回 toDict");
  assert.equal(out.result.toDict.word, "影响");
  assert.ok(out.result.toDict.relatedWordParts.length >= 1);
  const allWords = out.result.toDict.relatedWordParts.flatMap(g => g.words.map(w => w.word));
  assert.ok(allWords.includes("influence"));
});

test("translate: 中文整句走 ce 句子路径，返回翻译 + 可点词列表", () => {
  delete global.$file;
  global.$http = { get: ({ handler }) => handler({ data: ceSent }) };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "今天天气不错", onCompletion: (p) => { out = p; } });
  assert.ok(out.result.toDict);
  assert.match(out.result.toDict.parts[0].means[0], /weather/);
  const words = out.result.toDict.relatedWordParts[0].words.map(w => w.word.toLowerCase());
  assert.ok(words.includes("weather"));
});

test("supportLanguages / pluginTimeoutInterval", () => {
  const mod = loadFresh();
  assert.ok(mod.supportLanguages().includes("en"));
  assert.equal(typeof mod.pluginTimeoutInterval(), "number");
});
