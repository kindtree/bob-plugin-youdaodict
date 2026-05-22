# Bob 有道词典(单词)插件

[Bob](https://bobtranslate.com/) 翻译插件。输入**单个英文单词**时返回:释义、双语例句、英/美发音(可点喇叭出声);划句子时友好回退。用于替代金山词霸"查不到单词"的问题。

## 功能

- 中文释义(按词性分组)
- 英/美音标 + 真人发音(有道 dictvoice 音源,无需 API key)
- 双语例句(柯林斯简洁例句优先)
- 柯林斯英文释义(可在插件设置中关闭)
- 词形变化(复数/比较级/最高级等)
- 发音口音偏好、例句数量可在插件设置中调整

## 数据源

- 释义/例句/词形:有道 `dict.youdao.com/jsonapi`
- 发音:有道 `dict.youdao.com/dictvoice`

均为公开接口,无需 key。

## 开发

```bash
node --test tests/*.test.js   # 跑单测（零依赖，用真实抓取的夹具）
bash build.sh                 # 打包成 youdaodict.bobplugin
```

`main.js` 分两层:纯函数(jsonapi -> Bob toDict,可单测)+ 薄胶水(`translate`/`$http`)。

## 安装

双击 `youdaodict.bobplugin` -> Bob 偏好设置 -> 服务 中启用。
