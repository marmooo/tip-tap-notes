#!/bin/bash
set -euo pipefail

# itch.io 向けビルド（英語 index.html のみ・多言語ディレクトリなし）
# 前提:
#   - free-soundfonts / midi-db / marmooo.github.io が適切な相対位置にあること
#   - drop-inline-css, minify, deno が PATH にあること
#
# 順序:
#   1. copy（ja/en/zh 除外）
#   2. drop-inline-css
#   3. transform + collections.json 生成 + MIDI 本体コピー（INCLUDE_COLLECTIONS）
#   4. bundle
#   5. minify（index.js 除外）

OUT=itch.io
ZIP=itch.io.zip

rm -rf "$OUT" "$ZIP"
mkdir -p "$OUT"

# --- 付属データ ---
cp -r ../marmooo.github.io/docs/terms "$OUT/"

mkdir -p "$OUT/soundfont"
cp -r ../free-soundfonts/docs/GeneralUser_GS_v2.0.3 "$OUT/soundfont/"

# MIDI 本体フォルダ・en.json・collections.json は Deno 側（build-itch.io.js）で
# INCLUDE_COLLECTIONS に基づいてコピー／生成する

# --- ソースをコピー（言語ディレクトリは除外） ---
cp -r src/* "$OUT/"
rm -rf "$OUT/ja" "$OUT/en" "$OUT/zh"

# --- CSS インライン化 ---
drop-inline-css -r src -o "$OUT"
rm -rf "$OUT/ja" "$OUT/en" "$OUT/zh"

# --- パス置換 + collections.json 生成 + MIDI コピー ---
deno run -A build-itch.io.js "$OUT"

# --- JS バンドル ---
deno bundle --minify --allow-import \
  --platform=browser \
  --format=esm \
  -o "$OUT/index.js" \
  "$OUT/index.js"

# --- ミニファイ（bundle 済み index.js は除外） ---
(
  cd "$OUT"
  find . -type f \
    ! -name 'index.js' \
    \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.svg' -o -name '*.json' -o -name '*.webmanifest' \) \
    -print0 |
  while IFS= read -r -d '' f; do
    minify -o "$f" "$f" 2>/dev/null || true
  done
)

# --- zip ---
cd "$OUT"
zip -qr "../$ZIP" .

echo ""
echo "Build complete: $OUT/  →  $ZIP"
