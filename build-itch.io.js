#!/usr/bin/env -S deno run -A
/**
 * itch.io 向けパス置換 + collections.json 生成 + MIDI 本体コピー
 *
 * 使い方:
 *   deno run -A build-itch.io.js <target-dir>
 *
 * drop-inline-css のあと、bundle / minify の前に実行すること。
 */

import { copy, walk } from "jsr:@std/fs@1";
import { join, relative } from "jsr:@std/path@1";

const targetDir = Deno.args[0];
if (!targetDir) {
  console.error("Usage: deno run -A build-itch.io.js <target-dir>");
  Deno.exit(1);
}

const OFFICIAL_SITE = "https://marmooo.github.io/tip-tap-notes/";

/**
 * itch.io に同梱する MIDI コレクション id の一覧。
 * collections.json からこの id だけを残し、対応するディレクトリと en.json もコピーする。
 * フォルダを足すときはここに id を追加するだけでよい。
 */
const INCLUDE_COLLECTIONS = [
  "デジファミ音楽堂",
];

/** 元の collections.json（ビルド実行ディレクトリからの相対） */
const COLLECTIONS_SRC = "../midi-db/docs/collections.json";

/** MIDI 本体のルート（ビルド実行ディレクトリからの相対） */
const MIDI_DB_DOCS = "../midi-db/docs";

/** 言語 JSON のルート（ビルド実行ディレクトリからの相対） */
const MIDI_DB_JSON = "../midi-db/docs/json";

const TEXT_EXTS = new Set([
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".webmanifest",
  ".svg",
  ".txt",
  ".md",
]);

function isTextFile(path) {
  const lower = path.toLowerCase();
  for (const ext of TEXT_EXTS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function transform(content) {
  let s = content;

  // --- Analytics ---
  s = s.replace(
    /<!--\s*Global site tag[\s\S]*?<\/script>\s*<script>[\s\S]*?gtag\s*\(\s*['"]config['"][\s\S]*?<\/script>/gi,
    "",
  );
  s = s.replace(
    /<script[^>]*src=["'][^"']*googletagmanager\.com\/gtag\/js[^"']*["'][^>]*>\s*<\/script>/gi,
    "",
  );
  s = s.replace(
    /<script>\s*window\.dataLayer[\s\S]*?gtag\s*\(\s*['"]config[''][\s\S]*?<\/script>/gi,
    "",
  );

  // --- AdSense ---
  s = s.replace(/<script[^>]*data-ad-client[^>]*>\s*<\/script>/gi, "");
  s = s.replace(
    /<script[^>]*src=["'][^"']*pagead2\.googlesyndication\.com[^"']*["'][^>]*>\s*<\/script>/gi,
    "",
  );

  // --- openSoundFontLibrary → d-none ---
  s = s.replace(
    /(<button\b[^>]*\bid=["']openSoundFontLibrary["'][^>]*\bclass=["'])([^"']*)(["'])/gi,
    (_, a, cls, b) =>
      /\bd-none\b/.test(cls) ? a + cls + b : a + cls + " d-none" + b,
  );
  s = s.replace(
    /(<button\b[^>]*\bclass=["'])([^"']*)(["'][^>]*\bid=["']openSoundFontLibrary["'])/gi,
    (_, a, cls, b) =>
      /\bd-none\b/.test(cls) ? a + cls + b : a + cls + " d-none" + b,
  );

  // --- 言語セレクトを非表示 ---
  s = s.replace(
    /(<select\b[^>]*\bid=["']lang["'][^>]*\bclass=["'])([^"']*)(["'])/gi,
    (_, a, cls, b) =>
      /\bd-none\b/.test(cls) ? a + cls + b : a + cls + " d-none" + b,
  );
  s = s.replace(
    /(<select\b[^>]*\bclass=["'])([^"']*)(["'][^>]*\bid=["']lang["'])/gi,
    (_, a, cls, b) =>
      /\bd-none\b/.test(cls) ? a + cls + b : a + cls + " d-none" + b,
  );

  // --- Home → Official Site ---
  s = s.replace(
    /<a\s+class=["']px-1["']\s+href=["']\/["']\s*>\s*Home\s*<\/a>/gi,
    `<a class="px-1" href="${OFFICIAL_SITE}" target="_blank" rel="noopener">Official Site</a>`,
  );
  s = s.replace(
    /href=["']\/["']\s*>\s*Home\s*<\/a>/gi,
    `href="${OFFICIAL_SITE}" target="_blank" rel="noopener">Official Site</a>`,
  );

  // --- SOUNDFONT_BASE ---
  s = s.replace(
    /const SOUNDFONT_BASE = "https:\/\/soundfonts\.pages\.dev"/g,
    `const SOUNDFONT_BASE = "./soundfont"`,
  );

  // --- midi-db ---
  s = s.replace(
    /const MIDI_DB = "https:\/\/midi-db\.pages\.dev"/g,
    `const MIDI_DB = "./midi-db"`,
  );

  // --- /tip-tap-notes/ → ./ ---
  s = s.replaceAll("/tip-tap-notes/", "./");
  s = s.replace(/\/tip-tap-notes(?=["'\s>`])/g, ".");

  // --- 残りのルート絶対パス ---
  s = s.replace(
    /(href|src|content)=["']\/(?!\/)([^"']+)["']/gi,
    (_, attr, path) => `${attr}="./${path}"`,
  );
  s = s.replace(
    /new\s+Worker\(\s*["']\/(?!\/)([^"']+)["']/g,
    `new Worker("./$1"`,
  );
  s = s.replace(
    /from\s+["']\/(?!\/)([^"']+)["']/g,
    `from "./$1"`,
  );
  s = s.replace(
    /import\(\s*["']\/(?!\/)([^"']+)["']\s*\)/g,
    `import("./$1")`,
  );

  s = s.replace(/href=["']\/terms\/["']/gi, `href="./terms/"`);

  s = s.replace(
    /location\.href\s*=\s*[`'"]\.\/\$\{lang\}\/[`'"]/g,
    "location.href = `./`",
  );
  s = s.replace(
    /location\.href\s*=\s*[`'"]\/tip-tap-notes\/\$\{lang\}\/[`'"]/g,
    "location.href = `./`",
  );

  return s;
}

/** INCLUDE_COLLECTIONS に載っているエントリだけを OUT/midi-db/collections.json に書く */
async function writeFilteredCollections(absTarget) {
  const outPath = join(absTarget, "midi-db", "collections.json");
  await Deno.mkdir(join(absTarget, "midi-db"), { recursive: true });

  const all = JSON.parse(await Deno.readTextFile(COLLECTIONS_SRC));
  if (!Array.isArray(all)) {
    throw new Error(`${COLLECTIONS_SRC} is not a JSON array`);
  }

  const allow = new Set(INCLUDE_COLLECTIONS);
  const filtered = all.filter((entry) => entry && allow.has(entry.id));

  await Deno.writeTextFile(
    outPath,
    JSON.stringify(filtered, null, "\t") + "\n",
  );
  console.log(
    `collections.json: ${filtered.length} entr${
      filtered.length === 1 ? "y" : "ies"
    } → ${relative(absTarget, outPath)}`,
  );
  for (const e of filtered) {
    console.log(`  - ${e.id}`);
  }
}

/**
 * INCLUDE_COLLECTIONS の各 id について:
 *   - 本体: ../midi-db/docs/<id>/ → OUT/midi-db/<id>/
 *   - en.json: ../midi-db/docs/json/<id>/en.json → OUT/midi-db/json/<id>/en.json
 */
async function copyCollectionDirs(absTarget) {
  const outMidiDb = join(absTarget, "midi-db");
  await Deno.mkdir(outMidiDb, { recursive: true });

  for (const id of INCLUDE_COLLECTIONS) {
    const srcDir = join(MIDI_DB_DOCS, id);
    const destDir = join(outMidiDb, id);
    await copy(srcDir, destDir, { overwrite: true });
    console.log(`  copied dir: ${srcDir} → ${relative(absTarget, destDir)}`);

    const srcEn = join(MIDI_DB_JSON, id, "en.json");
    const destEn = join(outMidiDb, "json", id, "en.json");
    await Deno.mkdir(join(outMidiDb, "json", id), { recursive: true });
    await Deno.copyFile(srcEn, destEn);
    console.log(`  copied en.json: ${srcEn} → ${relative(absTarget, destEn)}`);
  }
}

async function main() {
  const absTarget = await Deno.realPath(targetDir);
  console.log(`Transforming files under: ${absTarget}`);

  let count = 0;
  for await (const entry of walk(absTarget, { includeDirs: false })) {
    if (!isTextFile(entry.path)) continue;
    const text = await Deno.readTextFile(entry.path);
    const transformed = transform(text);
    if (transformed !== text) {
      await Deno.writeTextFile(entry.path, transformed);
      count++;
      console.log(`  updated: ${relative(absTarget, entry.path)}`);
    }
  }
  console.log(`Done. ${count} file(s) modified.`);

  console.log("Copying MIDI collections…");
  await copyCollectionDirs(absTarget);
  await writeFilteredCollections(absTarget);
}

main().catch((err) => {
  console.error(err);
  Deno.exit(1);
});
