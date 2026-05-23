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

test("translate: LLM 启用 + 成功 → 渲染分组词列表，不走 jsonapi", () => {
  delete global.$file;
  let jsonapiCalled = false;
  const llmReply = {
    choices: [{
      message: {
        content: JSON.stringify({
          translation: "The interview today went well.",
          words: [
            {word:"interview", level:"CET6"},
            {word:"today", level:"初中"},
            {word:"went", level:"初中"},
            {word:"well", level:"初中"}
          ]
        })
      }
    }]
  };
  global.$http = {
    get: () => { jsonapiCalled = true; },
    request: ({ url, handler }) => {
      assert.match(url, /deepseek\.com/);
      handler({ data: llmReply, response: { statusCode: 200 } });
    }
  };
  global.$option = { llmProvider: "deepseek", deepseekApiKey: "sk-test", deepseekModel: "deepseek-chat" };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "今天面试很顺利", onCompletion: (p) => { out = p; } });
  assert.ok(out.result.toDict);
  assert.match(out.result.toDict.parts[0].means[0], /interview/);
  const partNames = out.result.toDict.relatedWordParts.map(g => g.part);
  assert.ok(partNames.includes("CET6"));
  assert.ok(partNames.includes("初中"));
  assert.equal(jsonapiCalled, false, "LLM 成功不应再走 jsonapi");
  delete global.$option;
});

test("translate: LLM 启用 + targetLevel=雅思/above → 过滤分组,prompt 含级别提示", () => {
  delete global.$file;
  let capturedPrompt = null;
  const llmReply = {
    choices: [{ message: { content: JSON.stringify({
      translation: "The discussion was insightful.",
      words: [
        {word:"discussion", level:"CET6"},
        {word:"insightful", level:"雅思"},
        {word:"was", level:"初中"}
      ]
    })}}]
  };
  global.$http = {
    get: () => {},
    request: ({ body, handler }) => {
      capturedPrompt = body.messages[1].content;
      handler({ data: llmReply, response: { statusCode: 200 } });
    }
  };
  global.$option = {
    llmProvider: "deepseek", deepseekApiKey: "sk-test",
    targetLevel: "雅思", levelRange: "above"
  };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "讨论很有启发性", onCompletion: (p) => { out = p; } });
  // prompt 里应含目标级别提示
  assert.match(capturedPrompt, /学习者当前正在准备：雅思/);
  // above 模式:雅思及更难 → 保留雅思,过滤掉 CET6 和初中
  const partNames = out.result.toDict.relatedWordParts.map(g => g.part);
  assert.deepEqual(partNames, ["雅思"]);
  delete global.$option;
});

test("translate: LLM 启用 + 失败 → 兜底走 jsonapi (v1.6 行为)", () => {
  delete global.$file;
  let jsonapiCalled = false;
  global.$http = {
    get: ({ handler }) => { jsonapiCalled = true; handler({ data: ceSent }); },
    request: ({ handler }) => handler({ error: { message: "network down" } })
  };
  global.$option = { llmProvider: "deepseek", deepseekApiKey: "sk-test" };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "今天天气不错", onCompletion: (p) => { out = p; } });
  assert.equal(jsonapiCalled, true, "LLM 失败应回退 jsonapi");
  assert.ok(out.result.toDict);
  assert.match(out.result.toDict.parts[0].means[0], /weather/);
  delete global.$option;
});

test("translate: 未配 LLM (默认) → 保持 v1.6 行为,不调 deepseek", () => {
  delete global.$file;
  delete global.$option;
  let requestCalled = false;
  global.$http = {
    get: ({ handler }) => handler({ data: ceSent }),
    request: () => { requestCalled = true; }
  };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "今天天气不错", onCompletion: (p) => { out = p; } });
  assert.equal(requestCalled, false, "未配 LLM 不应调用 chat completions");
  assert.ok(out.result.toDict);
});

test("supportLanguages / pluginTimeoutInterval", () => {
  const mod = loadFresh();
  assert.ok(mod.supportLanguages().includes("en"));
  assert.equal(typeof mod.pluginTimeoutInterval(), "number");
});
