#!/usr/bin/env bash
# 发布：打包 -> 算 sha256 -> 写回 appcast.json 当前版本条目。
# 之后你需要：1) 把 .bobplugin 上传到 GitHub Release；2) 把 info.json/appcast.json 里的
# USERNAME 换成你的 GitHub 用户名，确保 appcast.json 的 url 指向真实下载地址；3) 推送仓库。
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(python3 -c "import json;print(json.load(open('info.json'))['version'])")
bash build.sh >/dev/null
OUT="youdaodict.bobplugin"
SHA=$(shasum -a 256 "$OUT" | awk '{print $1}')

# 写回 appcast.json 中匹配版本的 sha256
python3 - "$VERSION" "$SHA" <<'PY'
import json, sys
ver, sha = sys.argv[1], sys.argv[2]
ac = json.load(open("appcast.json"))
hit = next((v for v in ac["versions"] if v["version"] == ver), None)
if hit is None:
    raise SystemExit(f"appcast.json 缺少版本 {ver} 的条目，请先补上")
hit["sha256"] = sha
json.dump(ac, open("appcast.json", "w"), ensure_ascii=False, indent=2)
open("appcast.json", "a").write("\n")
print(f"appcast.json 已更新：{ver} sha256={sha}")
PY

echo "打包完成：$OUT (v$VERSION, sha256=$SHA)"
echo "下一步：上传 $OUT 到 GitHub Release，并把 info.json/appcast.json 里的 USERNAME 改成你的用户名。"
