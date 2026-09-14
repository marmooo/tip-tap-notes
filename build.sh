mkdir -p docs
cp -r src/* docs
drop-inline-css -r src -o docs
minify -r docs -o .
deno bundle --minify --allow-import \
  --platform=browser \
  --format=esm \
  -o docs/index.js \
  --external=https://marmooo.github.io/* \
  src/index.js
