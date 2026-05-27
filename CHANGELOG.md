# Changelog

本项目版本号遵循 [SemVer](https://semver.org/lang/zh-CN/);格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [2.1.0] - 2026-05-27

### 新增
- **自定义模型 ID**:DeepSeek 模型下拉新增「自定义」选项 + 独立「自定义模型 ID」文本框,出新模型不用等插件升级。响应 #1 社区反馈(maxfong)。
- **自定义 API Base URL**:支持指向任意 OpenAI 兼容服务(SiliconFlow / 火山方舟 / OpenRouter / 自托管代理 等)。智能拼接 `/chat/completions`,用户填 base 即可,无需带完整路径。
- **LLM 错误透明化**:LLM 调用失败时除了走 jsonapi 兜底,把详细错误信息(endpoint / model / HTTP status / 上游 message)塞进卡片 `additions` 里显示。配置错了立刻能看到,而不是静默退化。
- **LLM 路径加缓存**:补上 v1.7 CHANGELOG 里说要做但一直没做的 LLM 缓存。中文整句 LLM 翻译结果按 `(text, targetLevel)` 联合键写 `$sandbox/cache/llm-<level>_<key>.json`,7 天 TTL,同句二次划词直接命中、不走 API、不收费。命中时卡片 `additions` 显示「缓存:命中(未走 API · 7 天 TTL)」。LLM 仅在调用**成功**时才写缓存,失败/解析异常都不写,避免坏数据污染。

### 变更
- **模型清单升级到 V4**:DeepSeek 官方 2026-04-24 升级 V4,新增 `deepseek-v4-flash` / `deepseek-v4-pro`。旧 `deepseek-chat` / `deepseek-reasoner` 沦为 v4-flash 非思考 / 思考模式别名,**官方公告(api-docs.deepseek.com/news/news260424) 将于 2026-07-24 15:59 UTC 完全下线**,之后调用立即失败。menu 改为:`deepseek-v4-flash`(默认,1M 上下文,推荐) / `deepseek-v4-pro`(更强,~3× 价) / `deepseek-reasoner`(思考模式,标硬下线日期) / 自定义。
- 默认 `defaultValue` 从 `deepseek-chat` 改为 `deepseek-v4-flash`。
- 自定义模型 ID 字段 desc 明确标注:**DeepSeek 官方不接受 `deepseek-v3` / `deepseek-v3.2` 等 V3 字面值**——chat/reasoner 别名一路滚动指向 V3 → V3-0324 → V3.1 → V3.1-Terminus → V3.2-Exp → V3.2 → V4-flash,但具体版本号字面值从未作为公开 model id 暴露,只能填 v4-flash / v4-pro;第三方 OpenAI 兼容服务可填对方文档列出的任意名(qwen2.5-72b-instruct / glm-4.5 等)。
- 抽 `cachePath(word, prefix?)` 纯函数,jsonapi (`yd_`) 和 LLM (`llm-<level>_`) 两套 schema 文件名隔离,互不冲突。

### 不变(兼容)
- `identifier`(`com.alex.bob.youdaodict`)不变,**老用户升级无感**——已配置的 deepseek-chat 字符串值兼容期内(至 2026-07-24)仍可调通(测试已覆盖透传);7-24 之后插件的 LLM 失败 additions 调试行会清晰告知用户原因(就是这个机制存在的意义)。设置 / 缓存 / API key 全部保留。
- 默认行为:不填 BaseURL 仍打 deepseek 官方;不选自定义仍走 menu 值;核心查词路径与 v2.0 一致。
- 老用户沙箱里的 jsonapi 缓存文件路径从 `<key>.json` 变为 `yd_<key>.json` → 升级当天失效一次,次日命中率自动恢复。属于一次性代价,jsonapi 单次往返成本低、可接受。

### TODO(提醒后续版本)
- 2026-07-01 前发 v2.2.0,把 `deepseek-reasoner` 从 menu 移除(下线后选了必报错)。

## [2.0.0] - 2026-05-23

### 变更
- **GitHub 仓库改名**:`kindtree/bob-plugin-youdaodict` → `kindtree/bob-plugin-wordtier`;旧 URL 由 GitHub 自动 301 重定向,现有外部链接/v1.x 用户的 appcast 拉取继续工作。
- **`.bobplugin` 文件名改名**:`youdaodict.bobplugin` → `wordtier.bobplugin`(从 v2.0.0 release 起;v1.x 老 release 文件名保留)。
- **appcast.json 中所有 v1.x 版本的 url** 已批量更新到新仓库 URL(GitHub release 资产跟着仓库改名自动跟过去)。
- **`info.json` 的 `appcast` URL** 改为新仓库 raw URL。v1.x 老用户首次升到 v2.0+ 后,后续自动更新完全脱离旧 URL。

### 不变
- Bob 内部 `identifier`(`com.alex.bob.youdaodict`)保持不变,**现有用户升级无感**(设置、缓存、目标级别、DeepSeek key 全部继续工作)。
- 功能/接口/数据源 v2.0.0 没有任何变化,只改 URL 和文件名。SemVer 升 major 是为对外标识"品牌正式定型"。

## [1.9.0] - 2026-05-23

### 变更
- **改名**:从「有道词典(单词)」改为「**词阶 WordTier**」,更准确反映核心差异化(按学习级别分组的可点词列表)。
- **License 升级**:MIT → **Apache 2.0**;`main.js` 顶部加 SPDX-License-Identifier + 仓库链接 + 作者声明;README 加 attribution 提醒。

### 不变
- `identifier`(`com.alex.bob.youdaodict`)保持不变,**现有用户升级无感**(设置、缓存、appcast 自动更新全部继续工作)。
- v1.9.0 当时仓库名仍是 `kindtree/bob-plugin-youdaodict`(v2.0.0 才改名)。

## [1.8.0] - 2026-05-23 (beta)

### 新增
- **等级细分到 10 档**:把 v1.7 的"基础"拆为"小学 / 初中 / 高中",其它保留。完整列表:小学 / 初中 / 高中 / CET4 / CET6 / 考研 / 雅思 / 托福 / GRE / 其它。
- **新增设置项「我的目标学习级别」**:用户选自己当前在攻克的级别(默认"不偏好")。
- **新增设置项「可点词显示范围」**:`目标级别及以上(默认)/ 仅目标级别 / 全部级别`,把列表收敛到学习者关心的范围。
- **LLM Prompt 个性化**:当目标级别非"不偏好"时,prompt 加学习者级别提示,LLM 翻译选词会**倾向该级别常考词汇**(避免过分简单或刻意拔高)。来源标注会显示`目标:雅思`等。

### 变更
- LLM 路径相关纯函数签名调整:`buildLlmPrompt(text, targetLevel)`、`buildLlmSentenceResult(llm, text, opts)`、`callDeepseek(opts, text, onDone)`。
- `LEVEL_ORDER` 从 8 项变为 10 项,顺序仍是难→易。

### 已知 / 心智预期
- LLM 是否真的按 `targetLevel` 调整选词,取决于模型遵守 prompt 指令的程度。`deepseek-chat` 大体能跟随,但偶尔仍会用相邻级别的词。属于 LLM 输出不确定性。
- 等级标注的客观准确度同 v1.7(AI 估算,非考纲查询),细分到 10 档没有让 LLM 更准,只是粒度更细。

## [1.7.0] - 2026-05-23 (beta)

### 新增
- **整句翻译可选接入 DeepSeek**(`info.json` 设置中"整句翻译服务"选 DeepSeek + 填 API key 开启;默认关闭)。开启后,中文整句路径优先调 DeepSeek 拿翻译,并按 **CET4 / CET6 / 考研 / 雅思 / 托福 / GRE / 基础** 等级把句中可点词分组渲染到 `relatedWordParts`。点任意词跳查完整词典。
- 模型可选 `deepseek-chat`(V3,推荐)或 `deepseek-reasoner`(R1,推理强但慢)。
- LLM 调用失败 / JSON 解析失败 → 自动回退 v1.6 的 jsonapi 行为,用户始终有结果。
- 改善未配置 LLM 时的中文整句回退提示,引导用户开启 Bob 内置智谱翻译或本插件 LLM 设置。

### 已知 / 心智预期
- 等级标注由 DeepSeek 推理,**不是权威考纲查询**,可能漂移(同一词不同次调用偶尔给出不同等级)。`additions` 已标注"AI 估算等级,仅供参考"。
- 每次划词 1 次 LLM 调用(`deepseek-chat` 单次约 ¥0.001),启用前注意预算。
- 本版本暂未为 LLM 加缓存(同句多次调用每次都收费),后续 v1.8 会加。
- README 的"无 key 零依赖"承诺已软化为:**核心词典功能仍无 key**,整句翻译为可选解锁。

## [1.6.0] - 2026-05-23

### 新增
- 中文整句翻译:输入含汉字且超过 4 字的内容(如"今天天气不错"),走 jsonapi 的 `ce` 整句模式,返回主译 + 最多 2 条备选译法 + 翻译里所有内容词组成的可点击词列表(自动过滤 `the / is / a` 等英文停用词)。
- 路由扩展:输入分为英文单词 / 中文短词(1-4 字) / 中文整句(其余含汉字)三条路径,各自匹配最合适的有道字段。

### 已知限制
- 部分长句 jsonapi 不在 `ce` 节返回(可能在 `fanyi` 或 `web_trans`),目前会回退提示"未查询到翻译"。后续考虑增加 `fanyi.tran` 作为补充。

## [1.5.0] - 2026-05-23

### 新增
- 中文短词查英文候选:输入 1-4 个汉字(如 `影响`),按词性分组渲染英文候选(`n. influence / effect`、`vt. affect / impact / impress`),英文词为可点蓝字,点击触发新查;附拼音和中文补充释义。

### 改进
- `cleanInput` 不再误伤中文,中文路径保留原文。
- `cacheKey` 兼容中文字符(原来非 ASCII 一律替换成下划线)。
- 非词输入回退提示更新为"请输入单个英文单词,或 1-4 个汉字"。

## [1.4.0] - 2026-05-23

### 新增
- 拼错词模糊匹配:输入 `serendipty` 等带拼写错误的词时,返回有道候选词(如 `serendipity`)与简短中文释义,而非"未查询到"。

## [1.3.0] - 2026-05-23

### 新增
- 同根衍生词:渲染到 Bob `toDict.relatedWordParts` 字段,按词性分组。
- 考试标签:CET4 / CET6 / 考研 等(`ec.exam_type`)。

## [1.2.0] - 2026-05-22

### 新增
- 输入净化(`cleanInput`):划词带的首尾标点/引号自动去除,如 `good.`、`"good"`、`(well-being)` 都能识别为单词。
- 结果缓存:7 天本地文件缓存,同词秒出。缓存层全程 try/catch 兜底,失败退回联网。
- 网络健壮性:加 `Referer` 头,失败/4xx 自动重试一次。
- 柯林斯英文释义(可在设置中关闭)。
- 同义词(按词性分组)、常用词组、词频星级。

### 改进
- 例句优先选简短句,解决冷门词例句过长问题(如 serendipity)。

## [1.1.0] - 2026-05-21

### 新增
- 设置项:发音口音优先(美/英)、例句数量(1-3 条)、柯林斯英文释义开关。

## [1.0.0] - 2026-05-21

### 新增
- 首个版本:单词查询、英美双发音(有道 dictvoice)、双语例句、词形变化、整句友好回退。
