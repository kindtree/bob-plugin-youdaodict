#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
OUT="wordtier.bobplugin"
rm -f "$OUT"
# .bobplugin 是 zip；info.json 与 main.js 必须位于压缩包根部（-j 去掉目录层级）
zip -j "$OUT" info.json main.js
echo "built $OUT"
unzip -l "$OUT"
