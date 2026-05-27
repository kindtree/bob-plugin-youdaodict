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

test("resolveLlmModel: menu 选预设 → 直接返回 menu 值", () => {
  const mod = loadFresh();
  assert.equal(mod.resolveLlmModel("deepseek-chat", ""), "deepseek-chat");
  assert.equal(mod.resolveLlmModel("deepseek-reasoner", "ignored"), "deepseek-reasoner");
});

test("resolveLlmModel: menu = __custom__ + 文本非空 → 用 custom", () => {
  const mod = loadFresh();
  assert.equal(mod.resolveLlmModel("__custom__", "deepseek-v3.2"), "deepseek-v3.2");
  assert.equal(mod.resolveLlmModel("__custom__", "  deepseek-v3.2  "), "deepseek-v3.2");
});

test("resolveLlmModel: menu = __custom__ 但文本为空/纯空格/undefined → 回退默认 v4-flash", () => {
  const mod = loadFresh();
  assert.equal(mod.resolveLlmModel("__custom__", ""), "deepseek-v4-flash");
  assert.equal(mod.resolveLlmModel("__custom__", "   "), "deepseek-v4-flash");
  assert.equal(mod.resolveLlmModel("__custom__", undefined), "deepseek-v4-flash");
});

test("resolveLlmModel: 缺省 menu → 回退 deepseek-v4-flash", () => {
  const mod = loadFresh();
  assert.equal(mod.resolveLlmModel(undefined, undefined), "deepseek-v4-flash");
  assert.equal(mod.resolveLlmModel("", ""), "deepseek-v4-flash");
});

test("resolveLlmModel: 旧别名 deepseek-chat / deepseek-reasoner 仍按字面值透传", () => {
  // 兼容期内官方仍接受这两个别名,老用户残留配置不受影响。
  const mod = loadFresh();
  assert.equal(mod.resolveLlmModel("deepseek-chat", ""), "deepseek-chat");
  assert.equal(mod.resolveLlmModel("deepseek-reasoner", ""), "deepseek-reasoner");
});

test("translate: 自定义模型 ID 被传给 DeepSeek 请求体", () => {
  delete global.$file;
  let sentModel = null;
  const llmReply = {
    choices: [{ message: { content: JSON.stringify({
      translation: "Hello world.", words: [{ word: "hello", level: "初中" }]
    })}}]
  };
  global.$http = {
    get: () => {},
    request: ({ body, handler }) => {
      sentModel = body.model;
      handler({ data: llmReply, response: { statusCode: 200 } });
    }
  };
  global.$option = {
    llmProvider: "deepseek", deepseekApiKey: "sk-test",
    deepseekModel: "__custom__", deepseekModelCustom: "deepseek-v3.2"
  };
  const mod = loadFresh();
  mod.translate({ text: "你好世界今天真不错", onCompletion: () => {} });
  assert.equal(sentModel, "deepseek-v3.2");
  delete global.$option;
});

test("resolveLlmEndpoint: 空/纯空格 → deepseek 官方", () => {
  const mod = loadFresh();
  assert.equal(mod.resolveLlmEndpoint(""), "https://api.deepseek.com/chat/completions");
  assert.equal(mod.resolveLlmEndpoint("   "), "https://api.deepseek.com/chat/completions");
  assert.equal(mod.resolveLlmEndpoint(undefined), "https://api.deepseek.com/chat/completions");
});

test("resolveLlmEndpoint: base 形态各异都正确拼出 /chat/completions", () => {
  const mod = loadFresh();
  assert.equal(mod.resolveLlmEndpoint("https://api.siliconflow.cn/v1"),
    "https://api.siliconflow.cn/v1/chat/completions");
  assert.equal(mod.resolveLlmEndpoint("https://api.siliconflow.cn/v1/"),
    "https://api.siliconflow.cn/v1/chat/completions");
  assert.equal(mod.resolveLlmEndpoint("https://api.siliconflow.cn/v1///"),
    "https://api.siliconflow.cn/v1/chat/completions");
  // 已带完整路径的不重复拼
  assert.equal(mod.resolveLlmEndpoint("https://api.siliconflow.cn/v1/chat/completions"),
    "https://api.siliconflow.cn/v1/chat/completions");
});

test("translate: 自定义 baseURL 被打到对应端点", () => {
  delete global.$file;
  let sentUrl = null;
  global.$http = {
    get: () => {},
    request: ({ url, handler }) => {
      sentUrl = url;
      handler({ data: { choices: [{ message: { content: JSON.stringify({
        translation: "OK", words: []
      })}}] }, response: { statusCode: 200 } });
    }
  };
  global.$option = {
    llmProvider: "deepseek", deepseekApiKey: "sk-test",
    deepseekBaseUrl: "https://api.siliconflow.cn/v1"
  };
  const mod = loadFresh();
  mod.translate({ text: "今天天气不错下午要开会", onCompletion: () => {} });
  assert.equal(sentUrl, "https://api.siliconflow.cn/v1/chat/completions");
  delete global.$option;
});

test("buildLlmErrorAddition: 含 status/model/endpoint/upstream", () => {
  const mod = loadFresh();
  const add = mod.buildLlmErrorAddition({
    message: "Unauthorized", status: 401, model: "deepseek-chat",
    endpoint: "https://api.deepseek.com/chat/completions",
    upstream: { message: "Invalid token" }
  });
  assert.equal(add.name, "LLM 调试");
  assert.match(add.value, /Unauthorized/);
  assert.match(add.value, /HTTP 401/);
  assert.match(add.value, /model=deepseek-chat/);
  assert.match(add.value, /api\.deepseek\.com/);
  assert.match(add.value, /Invalid token/);
});

test("buildLlmErrorAddition: null/undefined → null", () => {
  const mod = loadFresh();
  assert.equal(mod.buildLlmErrorAddition(null), null);
  assert.equal(mod.buildLlmErrorAddition(undefined), null);
});

test("cachePath: prefix 默认 'yd',不同 prefix 隔离不同 schema 的缓存文件", () => {
  const mod = loadFresh();
  assert.equal(mod.cachePath("good"), "$sandbox/cache/yd_good.json");
  assert.equal(mod.cachePath("good", "yd"), "$sandbox/cache/yd_good.json");
  assert.equal(mod.cachePath("今天天气不错", "llm-all"), "$sandbox/cache/llm-all_今天天气不错.json");
  assert.equal(mod.cachePath("今天天气不错", "llm-雅思"), "$sandbox/cache/llm-雅思_今天天气不错.json");
});

test("translate: LLM 缓存命中 → 不调 $http.request,additions 含'缓存命中'", () => {
  const cached = JSON.stringify({
    ts: Date.now(),
    data: { translation: "It's nice today.", words: [{ word: "nice", level: "初中" }] }
  });
  let networkCalled = false;
  global.$http = {
    get: () => { networkCalled = true; },
    request: () => { networkCalled = true; }
  };
  global.$file = {
    exists: (path) => path.includes("llm-all_"),
    read: () => ({ toUTF8: () => cached })
  };
  global.$option = { llmProvider: "deepseek", deepseekApiKey: "sk-test" };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "今天天气不错下午开会", onCompletion: (p) => { out = p; } });
  assert.equal(networkCalled, false, "命中缓存绝不应发任何网络请求");
  const cacheRow = out.result.toDict.additions.find(a => a.name === "缓存");
  assert.ok(cacheRow, "additions 必须含'缓存'行");
  assert.match(cacheRow.value, /命中/);
  delete global.$file;
  delete global.$option;
});

test("translate: LLM 成功 → 写入 llm-<targetLevel> 前缀的缓存文件", () => {
  let written = null;
  global.$file = {
    exists: () => false,
    read: () => null,
    mkdir: () => {},
    write: ({ path, data }) => { written = { path: path, data: data }; }
  };
  global.$data = { fromUTF8: (s) => ({ raw: s, toUTF8: () => s }) };
  global.$http = {
    get: () => {},
    request: ({ handler }) => {
      handler({ data: { choices: [{ message: { content: JSON.stringify({
        translation: "Today is nice.", words: [{ word: "nice", level: "雅思" }]
      })}}] }, response: { statusCode: 200 } });
    }
  };
  global.$option = {
    llmProvider: "deepseek", deepseekApiKey: "sk-test", targetLevel: "雅思"
  };
  const mod = loadFresh();
  mod.translate({ text: "今天天气真不错下午开会", onCompletion: () => {} });
  assert.ok(written, "成功必须写缓存");
  assert.match(written.path, /llm-雅思_/, "文件名必须含 targetLevel 前缀");
  delete global.$file;
  delete global.$data;
  delete global.$option;
});

test("translate: LLM 失败 → 不写缓存(避免坏数据污染)", () => {
  let written = null;
  global.$file = {
    exists: () => false,
    read: () => null,
    mkdir: () => {},
    write: ({ path }) => { written = path; }
  };
  global.$data = { fromUTF8: (s) => s };
  global.$http = {
    get: ({ handler }) => handler({ data: ceSent }),
    request: ({ handler }) => handler({
      data: { error: { message: "rate limited" } },
      response: { statusCode: 429 }
    })
  };
  global.$option = { llmProvider: "deepseek", deepseekApiKey: "sk-test" };
  const mod = loadFresh();
  mod.translate({ text: "今天天气不错下午开会", onCompletion: () => {} });
  // 失败不应该往 llm-* 写,但 jsonapi 兜底可能写 yd_ 缓存,这是正常的
  if (written) assert.doesNotMatch(written, /llm-/, "LLM 失败不应写 llm 缓存");
  delete global.$file;
  delete global.$data;
  delete global.$option;
});

test("translate: LLM 失败 → jsonapi 兜底结果 additions 含 LLM 调试信息", () => {
  delete global.$file;
  global.$http = {
    get: ({ handler }) => handler({ data: ceSent }),
    request: ({ handler }) => {
      // 模拟 401 上游错误
      handler({
        data: { error: { message: "Invalid API key" } },
        response: { statusCode: 401 }
      });
    }
  };
  global.$option = {
    llmProvider: "deepseek", deepseekApiKey: "sk-bad",
    deepseekBaseUrl: "https://api.siliconflow.cn/v1",
    deepseekModel: "__custom__", deepseekModelCustom: "qwen2.5"
  };
  const mod = loadFresh();
  let out;
  mod.translate({ text: "今天天气不错下午要开会", onCompletion: (p) => { out = p; } });
  assert.ok(out.result.toDict, "应有 jsonapi 兜底结果");
  const debugRow = out.result.toDict.additions.find(a => a.name === "LLM 调试");
  assert.ok(debugRow, "additions 必须含 LLM 调试行");
  assert.match(debugRow.value, /Invalid API key/);
  assert.match(debugRow.value, /HTTP 401/);
  assert.match(debugRow.value, /model=qwen2\.5/);
  assert.match(debugRow.value, /siliconflow/);
  delete global.$option;
});
