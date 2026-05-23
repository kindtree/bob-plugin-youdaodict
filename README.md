# Bob 有道词典(单词)插件

[Bob](https://bobtranslate.com/) 翻译插件。输入**单个英文单词**时返回:释义、双语例句、英/美发音(可点喇叭出声);划句子时友好回退。用于替代金山词霸"查不到单词"的问题。

## 功能

- 中文释义(按词性分组)
- 英/美音标 + 真人发音(有道 dictvoice 音源,无需 API key)
- 双语例句(柯林斯简洁例句优先,过长例句自动让位短句)
- 柯林斯英文释义(可在插件设置中关闭)
- 近义词(按词性)、常用词组、词频星级(柯林斯)
- 同根衍生词(按词性分组)、考试标签(CET4/CET6/考研等)
- 词形变化(复数/比较级/最高级等)
- 输入净化:划词带的首尾标点/引号(如 `good.`、`"good"`)自动去除
- 结果缓存(7 天)+ 网络失败自动重试一次
- 发音口音偏好、例句数量可在插件设置中调整

## 数据源

- 释义/例句/词形/近义/词组:有道 `dict.youdao.com/jsonapi`
- 发音:有道 `dict.youdao.com/dictvoice`

均为公开接口,无需 key。

## 开发

```bash
node --test tests/*.test.js   # 跑单测（零依赖，用真实抓取的夹具）
bash build.sh                 # 打包成 youdaodict.bobplugin
```

`main.js` 分两层:纯函数(jsonapi -> Bob toDict,可单测)+ 薄胶水(`translate`/`$http`/`$file`)。
缓存层(`$file`/`$data`)全程 try/catch 兜底,任何缓存异常都退回联网,不影响查词。

> 注:缓存与文件读写依赖 Bob 沙箱注入的 `$file`/`$data`,只能在 Bob 内最终验证;
> 纯逻辑(缓存键、TTL、所有内容构建)已由单测覆盖。

## 安装

双击 `youdaodict.bobplugin` -> Bob 偏好设置 -> 服务 中启用。

## 自动更新(可选)

1. 把 `info.json` 和 `appcast.json` 里的 `USERNAME` 改成你的 GitHub 用户名。
2. 运行 `bash release.sh`:打包并把 sha256 写回 `appcast.json`。
3. 把 `youdaodict.bobplugin` 上传到 GitHub Release(地址需与 `appcast.json` 的 `url` 一致),推送仓库。

之后 Bob 会按 `info.json` 的 `appcast` 地址检查更新。

> 图标:`info.json` 的 `icon` 目前用内置编号 `001`(Bob 内置 001~149)。自定义图片图标官方未提供文档,暂不支持。
