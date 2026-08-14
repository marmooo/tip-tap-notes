/**
 * index.js — Rhythm Game application entry point (MIDI / 音声 両対応統合版)
 *
 * MIDI モード: Midy を直接操作してMIDI/SoundFontを再生し、extractNotesFromMidy() でノート抽出。
 * 音声モード: ネイティブ <audio> で音声ファイルを再生し、audio-beatmap.js + beatmap-worker.js で
 *            オンセット検出→テンポ推定→ビートトラッキング→拍グリッド吸着 により譜面を自動生成。
 *
 * どちらのモードも最終的には同じ形のノート配列 { noteNumber, startTime, endTime, channel,
 * programNumber } を rawNotes に格納し、そこから先（thinNotes によるレーン配置・
 * rhythm-game-worker.js での判定/描画）は完全に共通。
 */

import { Midy } from "https://cdn.jsdelivr.net/gh/marmooo/midy@0.6.1/dist/midy.min.js";
import { Modal } from "https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/+esm";
import {
  DIFFICULTIES,
  extractNotesFromMidy,
  thinNotes,
} from "./rhythm-game.js";
import { MidiLibrary } from "https://marmooo.github.io/free-midi/midi-library.js";
import { installIOSTouchGuards } from "/tip-tap-notes/ios-touch-guards.js";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const START_DELAY_MIDI = 3; // 秒。midy.startDelay と合わせる（音声モードは0でOK＝後述）

const JUDGMENT_WINDOWS = {
  perfect: 40,
  great: 80,
  good: 150,
};

// rhythm-game.js のレーン描画は perspective 分だけ台形状に収束する。
// pointerdown の座標→レーン変換もこれに合わせて逆変換する（#perspX の逆変換）。
const PERSPECTIVE = 0.78; // rhythm-game.js のコンストラクタ既定値と合わせる

const ANALYZE_TIMEOUT_MS = 30000;

// SHORT: 一般的な音ゲー尺（120秒）で強制終了。ORIGINAL: 曲の最後まで。
const SHORT_DURATION = 120; // 秒
const ENDING_FADE_DURATION = 2; // 秒。SHORT到達時のフェードアウト長

// btnPause の一時停止/再開アイコン。絵文字（⏸/▶）はフォント・OSによって
// サイズや縦位置が揺れて丸ボタンからはみ出す/欠けることがあるため、
// 固定サイズの SVG に置き換えている。
const ICON_PAUSE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" ' +
  'viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">' +
  '<path d="M555-200v-560h175v560H555Zm-325 0v-560h175v560H230Z"></path>' +
  "</svg>";
const ICON_PLAY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" ' +
  'viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">' +
  '<path d="M320-203v-560l440 280-440 280Z"></path>' +
  "</svg>";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  laneCount: 4,
  scrollSpeed: 500,
  laneKeys: ["a", "s", "d", "f", "g", "h", "j", "k"],
  laneColors: [
    "#ff6666",
    "#66ccff",
    "#ffcc66",
    "#66ff99",
    "#cc66ff",
    "#ff9966",
    "#66ffcc",
    "#ff66cc",
  ],
  difficulty: "NORMAL",
  laneOpacity: 0.35, // 0(透明)〜1(最大まで濃い) の通常の opacity と同じスケール
  perspectiveEnabled: true, // 遠近感（画面上側が狭くなる表示）のON/OFF
  judgeOffset: 0, // ms (正=遅く/音が遅い環境, 負=早く)
  accentColor: "", // "" = 未設定（currentColor に自動追従。テーマ切替でも見えなくならない）
  judgeLineColor: "", // "" = 未設定（uiColor / currentColor に自動追従）
  laneLineColor: "", // "" = 未設定（uiColor / currentColor に自動追従）
  backgroundPreset: "./data/japan-sky.webp", // 初期値はJapan Sky。""=なし / プリセットURL / "custom"（本体は IndexedDB に保存）
  // Canvas 解像度の上限（devicePixelRatio をこの値でキャップ）。
  // 既定 1 = 負荷を抑えて安定優先。高いほどシャープだがメモリ/GPU 負荷が増え、モバイルで不安定になりやすい。
  maxPixelRatio: 1,
};

function loadConfig() {
  try {
    return {
      ...DEFAULT_CONFIG,
      ...JSON.parse(localStorage.getItem("TipTapNotesConfig") || "{}"),
    };
  } catch (err) {
    console.warn("Failed to load saved config, falling back to defaults:", err);
    return { ...DEFAULT_CONFIG };
  }
}
function saveConfig(c) {
  localStorage.setItem("TipTapNotesConfig", JSON.stringify(c));
}
// "rgb(r, g, b)" 形式（getComputedStyle が返す形式）を <input type=color> 用の
// "#rrggbb" に変換する。パースできない場合は null を返す。
function rgbToHex(rgbStr) {
  const m = rgbStr?.match(/\d+/g);
  if (!m || m.length < 3) return null;
  return "#" + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("");
}
let config = loadConfig();
// 旧設定や不正値を既定範囲に丸める
{
  const v = Number(config.maxPixelRatio);
  config.maxPixelRatio = Number.isFinite(v) ? Math.min(3, Math.max(1, v)) : 1;
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

// HTML側の #i18nStrings [data-key] からテキストを取得する（多言語化しやすくするため、
// alert/エラーメッセージ等 JS 側でしか組み立てられない文言もここ経由でHTMLから引く）。
// vars を渡すと文字列中の {key} をプレースホルダ置換する（例: t("analyzeTimeout", { seconds: 30 })）。
function t(key, vars) {
  const el = document.querySelector(`#i18nStrings [data-key="${key}"]`);
  let text = el ? el.textContent : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, v);
  }
  return text;
}

const canvasWrap = document.getElementById("canvasWrap");
let noteCanvas = document.getElementById("noteCanvas");
let particleCanvas = document.getElementById("particleCanvas");
let uiCanvas = document.getElementById("uiCanvas");
const screenStart = document.getElementById("screenStart");
const screenReady = document.getElementById("screenReady");
const screenAnalyzing = document.getElementById("screenAnalyzing");
const screenResult = document.getElementById("screenResult");
const screenSettings = document.getElementById("screenSettings");
const pauseOverlay = document.getElementById("pauseOverlay");
const btnPause = document.getElementById("btnPause");
const player = document.getElementById("player"); // 音声モード用 <audio>

// MIDI / SoundFont ライブラリ、設定画面はすべて Bootstrap の modal で表示する
const libraryModal = Modal.getOrCreateInstance(
  document.getElementById("screenLibrary"),
);
const soundFontModal = Modal.getOrCreateInstance(
  document.getElementById("soundFontLibraryModal"),
);
const settingsModal = Modal.getOrCreateInstance(screenSettings);
const htmlLang = document.documentElement.lang || "en";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Canvas の実効 DPR。devicePixelRatio を config.maxPixelRatio でキャップする。
// 既定は 2（Retina 相当）で、高 DPI 端末でのメモリ/GPU 負荷を抑えて落ちにくくする。
// 設定画面から変更可能。変更時は Worker / OffscreenCanvas を再構築する。
function computeDpr() {
  const device = globalThis.devicePixelRatio || 1;
  const cap = Number(config.maxPixelRatio);
  if (!Number.isFinite(cap) || cap <= 0) return device;
  return Math.min(device, cap);
}
let dpr = computeDpr();
let mode = null; // null | "midi" | "audio" — 最初のファイル読込までは未確定
let rawNotes = []; // NoteData[]（midy由来 or 音声解析由来。形は共通）
let laneNotes = []; // thinNotes済み
let worker = null;
let beatWorker = null; // 音声モードの解析ワーカー（コーディネーター）
let rafId = null;
let tickIntervalId = null; // バックグラウンドでも tick / 終了判定を回すための interval
let gamePhase = "start"; // start | ready | analyzing | playing | result
let isPaused = false; // gamePhase==="playing" 中の一時停止フラグ

let playLength = "short"; // "short" | "original"
let maxDuration = Infinity; // applyNotes() 実行時に playLength から算出される、現在有効な上限秒数
let endingFadeStarted = false; // SHORTモードでの強制終了フェードを開始済みか
let endingFadeStartPerf = 0; // フェード開始時点の performance.now()（下記参照）
let endingFadeTimeoutId = null; // rAF停止時でもフェード完了→showResultを保証するタイマー

// applyNotes の再計算・Worker への再送を抑えるキー。リプレイ時に同じ譜面を
// 何度も thinNotes + structured clone するとピークメモリが跳ねるため、
// 設定・譜面が変わっていないときは再計算/再送をスキップする。
let lastApplyKey = "";
let notesPostedToWorker = false; // 現在の Worker に laneNotes が載っているか

let notesReady = false; // 音声モード: 現在の設定で譜面生成済みか
let notesStale = true; // 音声モード: 設定変更等で再生成が必要か
let isAnalyzing = false; // 音声モード: 解析中の多重起動防止（gamePhaseとは別管理）
let suppressPauseHandling = false; // 音声モード: 自前pause()をuser-pauseと誤認しないためのフラグ

let lastResult = {
  score: 0,
  combo: 0,
  perfect: 0,
  great: 0,
  good: 0,
  miss: 0,
  total: 0,
};
let pendingAnalysisResolve = null;
let pendingAnalysisReject = null;

// ---------------------------------------------------------------------------
// Canvas sizing
// ---------------------------------------------------------------------------

function setWrapHeight() {
  // #topnav は position:fixed で canvas の上に透過オーバーレイとして
  // 浮かせているだけでレイアウト上の高さを消費しないため、canvasWrap の
  // 高さからは差し引かない（iPhone SE の横置きのような縦が狭い端末でも
  // canvas を画面いっぱいに使えるようにするため）。
  // ただし #topnav のブランドロゴ／ボタンは canvas と同じ左上・右上の
  // コーナーに重なって浮いているため、btnPause やスコア表示など
  // canvas 側の左右上隅の UI 要素はこの高さぶんだけ避けてやる必要がある。
  // その受け渡し用に --topbar-h を CSS 変数として置いておく。
  const topbarH = document.getElementById("topnav")?.offsetHeight ?? 0;
  document.documentElement.style.setProperty("--topbar-h", topbarH + "px");

  // 将来 footer を追加する場合に備え、#pagefooter があれば高さを差し引く対象に含める
  // （中身が空 / hidden の間は offsetHeight が 0 になるだけなので、今は何もしなくてよい）
  const footerH = document.getElementById("pagefooter")?.offsetHeight ?? 0;

  // ファイル選択パネルは screenStart のオーバーレイ内にあり、canvasWrap 自体の
  // レイアウト（高さ）には影響しない。gamePhase によってサイズを変えると
  // 画面遷移のたびにガクッとリサイズされて見た目が悪いので、常に
  // 「プレイ中と同じ画面いっぱいのサイズ」（フッター分だけ差し引く）に固定する。
  canvasWrap.style.height = Math.max(300, globalThis.innerHeight - footerH) +
    "px";
  // 狭い画面では attribution の高さぶん pause / スコアを下げる（--attr-h）
  syncAttributionStackHeight();
  resizeCanvases();
}
globalThis.addEventListener("resize", setWrapHeight);

function resizeCanvases() {
  const r = canvasWrap.getBoundingClientRect();
  const w = Math.round(r.width * dpr);
  const h = Math.round(r.height * dpr);
  // rhythm-game-worker.js 側でスコア等の右上 HUD を描く際、canvas 座標系
  // （dpr 込み）でどれだけ避ければ #topnav と重ならないかを渡す。
  // buttonZoneHeight / dpr も一緒に送り、向き変更時も見た目比率を保つ。
  if (worker) {
    worker.postMessage({
      type: "resize",
      width: w,
      height: h,
      topInset: computeTopInset(),
      buttonZoneHeight: Math.round(h * 0.2),
      dpr,
    });
  }
  try {
    noteCanvas.width = w;
    noteCanvas.height = h;
    particleCanvas.width = w;
    particleCanvas.height = h;
    uiCanvas.width = w;
    uiCanvas.height = h;
  } catch {
    /* skip: transferControlToOffscreen 済みのcanvasはメインスレッドから幅高さを変更できない */
  }
  return [w, h];
}

// ---------------------------------------------------------------------------
// currentGameTime: モードによって時間の基準が異なる
// ---------------------------------------------------------------------------

// midy.currentTime() は resume 直後に startTime が確定するまで不安定になることがあり、
// これが原因で resume 後しばらく判定（PERFECT/MISS等）がおかしくなる不具合があった。
// → resume直後は「resume時点のゲーム内時刻 + 経過した壁時計時間」で近似した値を使い、
//   実測値（midy.currentTime()）がその近似値に実際に収束するまで待ってから切り替える。
//   固定時間待つだけだと、内部の startTime 確定が重い曲/遅い端末などでその時間を
//   超えた場合に「まだ不安定な実測値」へ早く切り替わってしまい、ノーツが一瞬
//   ジャンプ/消えたように見えることがあったため、実測値どうしを比較して収束を
//   確認する方式にしてある（安全弁として最大待ち時間も設けておく）。
let _pausedAt = 0;
let _resumeBaseGameTime = 0;
let _resumeBasePerf = 0;
let _resumeStabilizeMinUntil = 0; // performance.now() 基準：最低でもここまでは近似値を使う
let _resumeStabilizeMaxUntil = 0; // performance.now() 基準：ここを過ぎたら実測値が
// 収束していなくても強制的に切り替える（安全弁）
const RESUME_STABILIZE_MIN_MS = 50;
const RESUME_STABILIZE_MAX_MS = 500;
const RESUME_STABILIZE_TOLERANCE_SEC = 0.05; // 実測値と近似値の許容差（50ms）

function currentGameTime() {
  if (mode === "midi") {
    const now = performance.now();
    const approx = _resumeBaseGameTime + (now - _resumeBasePerf) / 1000;
    if (now < _resumeStabilizeMinUntil) {
      return approx;
    }
    const real = midy.currentTime() - START_DELAY_MIDI;
    if (
      now < _resumeStabilizeMaxUntil &&
      Math.abs(real - approx) > RESUME_STABILIZE_TOLERANCE_SEC
    ) {
      return approx; // 実測値がまだ近似値と乖離＝startTime未確定とみなす
    }
    return real;
  }
  return player.currentTime; // 音声モードはネイティブ<audio>の再生位置をそのまま使う
}

// ---------------------------------------------------------------------------
// Worker 管理（rhythm-game-worker.js をそのまま使用。MIDI/音声共通）
// ---------------------------------------------------------------------------

// #topnav は canvas の上に浮く透過オーバーレイのため、rhythm-game-worker.js
// 側で右上 HUD（スコア等）を描くときに、navbar の高さぶんだけ避けないと
// 🌓（ダークモード切替）ボタンと重なってしまう。canvas は dpr 込みの
// 座標系なので dpr を掛けて渡す。
// 狭い画面で attribution を pause/スコアの上に積むときは --attr-h も加算する。
function computeTopInset() {
  const topbarH = document.getElementById("topnav")?.offsetHeight ?? 0;
  const attrH = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--attr-h"),
  ) || 0;
  return Math.round((topbarH + attrH) * dpr);
}

/** 狭い画面で attribution 表示中だけ、その高さぶん pause / HUD を下げる。
 *  --attr-h を更新するだけ。Worker への反映は resizeCanvases() 側。 */
function syncAttributionStackHeight() {
  const root = document.getElementById("trackAttribution");
  const narrow = globalThis.matchMedia(
    "(max-width: 576px), (max-height: 420px)",
  ).matches;
  let attrH = 0;
  if (
    narrow && root && !root.classList.contains("hidden") &&
    root.offsetParent !== null
  ) {
    // attribution 本体 + わずかな隙間
    attrH = Math.ceil(root.getBoundingClientRect().height) + 4;
  }
  document.documentElement.style.setProperty("--attr-h", attrH + "px");
}

function buildWorkerOptions() {
  const laneCount = config.laneCount;
  const keys = config.laneKeys.slice(0, laneCount);
  while (keys.length < laneCount) keys.push(String(keys.length + 1));
  const h = Math.round(canvasWrap.getBoundingClientRect().height * dpr);
  return {
    laneCount,
    // scrollSpeed / noteHeight は論理px（dpr=1基準）。Worker 側で dpr を掛けて描画する。
    scrollSpeed: config.scrollSpeed,
    dpr,
    laneColors: config.laneColors.slice(0, laneCount),
    keys,
    judgmentWindows: {
      perfect: JUDGMENT_WINDOWS.perfect / 1000,
      great: JUDGMENT_WINDOWS.great / 1000,
      good: JUDGMENT_WINDOWS.good / 1000,
    },
    difficulty: DIFFICULTIES[config.difficulty] ?? DIFFICULTIES.NORMAL,
    judgeOffset: (config.judgeOffset ?? 0) / 1000,
    startDelay: mode === "midi" ? START_DELAY_MIDI : 0,
    laneOpacity: config.laneOpacity ?? 0.35,
    buttonZoneHeight: Math.round(h * 0.2),
    perspective: (config.perspectiveEnabled ?? true) ? PERSPECTIVE : 0,
    uiColor: computeUiColor(),
    judgeLineColor: config.judgeLineColor || "",
    laneLineColor: config.laneLineColor || "",
    accentColor: config.accentColor || "",
    // canvas 座標系（dpr込み）での navbar 回避量。HUD 描画開始 y に加算する。
    topInset: computeTopInset(),
  };
}

// rhythm-game.js（Worker内で実行される）は Canvas なので CSS の currentColor を
// 直接参照できない。そのためメインスレッド側で「今の文字色」を計算して渡す。
// data-bs-theme を切り替えても常に見えるレーン区切り線・判定ライン・キーラベル・
// HUD文字の土台色として使われる。
function computeUiColor() {
  return getComputedStyle(document.body).color || "#ffffff";
}

function initWorker() {
  if (worker) {
    try {
      worker.terminate();
    } catch {
      /* ignore */
    }
    worker = null;
  }
  notesPostedToWorker = false;
  replaceCanvases();

  worker = new Worker("./rhythm-game-worker.js", { type: "module" });
  worker.onmessage = onWorkerMessage;
  // Worker が落ちた場合は参照を捨て、次回 ensureWorker / startGameMidi で
  // 再構築できるようにする（null のまま残すとリプレイが永久に動かなくなる）。
  worker.onerror = (err) => {
    console.error("rhythm-game-worker crashed:", err);
    try {
      worker?.terminate();
    } catch {
      /* ignore */
    }
    worker = null;
    notesPostedToWorker = false;
  };

  const r = canvasWrap.getBoundingClientRect();
  const w = Math.round(r.width * dpr);
  const h = Math.round(r.height * dpr);
  noteCanvas.width = w;
  noteCanvas.height = h;
  particleCanvas.width = w;
  particleCanvas.height = h;
  uiCanvas.width = w;
  uiCanvas.height = h;

  const noteOff = noteCanvas.transferControlToOffscreen();
  const particleOff = particleCanvas.transferControlToOffscreen();
  const uiOff = uiCanvas.transferControlToOffscreen();

  worker.postMessage(
    {
      type: "init",
      noteCanvas: noteOff,
      particleCanvas: particleOff,
      uiCanvas: uiOff,
      options: buildWorkerOptions(),
    },
    [noteOff, particleOff, uiOff],
  );
}

function replaceCanvases() {
  for (const id of ["noteCanvas", "particleCanvas", "uiCanvas"]) {
    const old = document.getElementById(id);
    const neo = document.createElement("canvas");
    neo.id = id;
    neo.className = old.className;
    old.replaceWith(neo);
    if (id === "noteCanvas") noteCanvas = neo;
    if (id === "particleCanvas") particleCanvas = neo;
    if (id === "uiCanvas") {
      uiCanvas = neo;
      uiCanvas.tabIndex = -1; // フォーカス可能に（キーボード操作を確実に拾うため）
      // pointer-events / outline は #uiCanvas に対する CSS 側で指定済み
      bindPointerEvents(neo);
    }
  }
}

function onWorkerMessage(e) {
  const msg = e.data;
  switch (msg.type) {
    case "judgment":
      lastResult.score = msg.score;
      lastResult.combo = Math.max(lastResult.combo, msg.combo);
      break;
    case "judgmentDetail":
      lastResult = { ...lastResult, ...msg };
      break;
    case "noteCount":
      document.getElementById("noteCountLabel").textContent = msg.count;
      document.getElementById("diffLabel").textContent = config.difficulty;
      lastResult.total = msg.count;
      break;
    case "ended": {
      // ORIGINAL: ノート消化で終了 → 即スコア画面
      // SHORT: 長い曲を 120s で切る場合は handleShortEnding に任せる。
      //        曲自体が SHORT_DURATION 以下でも、即 showResult せず
      //        maxDuration を現在時刻に揃えて handleShortEnding の
      //        フェード（ENDING_FADE_DURATION 秒）を経由してから終了する。
      //        （ノート消化時点の t が maxDuration にわずかに届かない／
      //         再生側が止まって t が進まないケースでもフェードを開始できる）
      //        バックグラウンドでは rAF が止まるため、ここで即 handleShortEnding
      //        を呼んで setTimeout による完了保証を仕掛ける。
      if (gamePhase !== "playing") break;
      if (maxDuration === Infinity) {
        stopRaf();
        showResult();
      } else {
        const songDuration = getSongDuration();
        const isWholeSongShort = songDuration > 0 &&
          songDuration <= SHORT_DURATION + 0.5;
        if (isWholeSongShort || currentGameTime() >= maxDuration - 0.1) {
          maxDuration = Math.min(maxDuration, currentGameTime());
          handleShortEnding(currentGameTime());
        }
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// thinNotes をメインスレッドで実行して Worker に渡す（MIDI/音声共通）
// ---------------------------------------------------------------------------

// MIDIモードでの曲の実尺（＝最後のノートの終了時刻）を返す。
// rawNotes は startTime/endTime とも currentGameTime() と同じ時間軸（startDelay
// を含まない）なので、maxDuration の算出やSHORT/ORIGINAL表示にそのまま使える。
function getMidiSongDuration() {
  let max = 0;
  for (const n of rawNotes) {
    if (n.endTime > max) max = n.endTime;
  }
  return max;
}

// SHORT/ORIGINAL表示、および音声モードでの曲の実尺算出に使う。
// MIDIモードは rawNotes 由来（getMidiSongDuration）、音声モードは
// decodeAudioData 済みの audioBuffer.duration をそのまま使う。
function getSongDuration() {
  if (mode === "midi") return getMidiSongDuration();
  return audioBuffer ? audioBuffer.duration : 0;
}

function applyNotes(forceResend = false) {
  if (!worker || rawNotes.length === 0) return;
  // 曲の実尺が SHORT_DURATION 未満の場合、maxDuration を SHORT_DURATION 固定に
  // してしまうと t が maxDuration に到達せず handleShortEnding() が発火しない
  // （= フェードアウト/pause/showResult に進めず終了できない）。
  // 実尺で頭打ちにして、SHORTでも曲が最後まで鳴り切ったタイミングで
  // 正しく終了処理に入れるようにする。
  if (playLength === "short") {
    // MIDI / 音声どちらも getSongDuration() で実尺を取る。
    // 以前は音声モードで 0 固定だったため、曲が SHORT_DURATION 未満だと
    // maxDuration が 120 のままになり handleShortEnding() が発火しなかった。
    const songDuration = getSongDuration();
    maxDuration = songDuration > 0
      ? Math.min(SHORT_DURATION, songDuration)
      : SHORT_DURATION;
  } else {
    maxDuration = Infinity;
  }

  // 同じ譜面・同じ設定なら thinNotes の再計算を省略する。
  // リプレイ時に毎回フル配列を structured clone するとピークメモリが跳ねるので、
  // Worker に既に載っている場合は postMessage 自体もスキップする。
  const applyKey = [
    playLength,
    maxDuration,
    config.laneCount,
    config.difficulty,
    rawNotes.length,
  ].join("|");
  if (applyKey === lastApplyKey && laneNotes.length > 0) {
    if (forceResend || !notesPostedToWorker) {
      worker.postMessage({ type: "setNotes", notes: laneNotes });
      notesPostedToWorker = true;
    }
    return;
  }

  const diff = DIFFICULTIES[config.difficulty] ?? DIFFICULTIES.NORMAL;
  // sort は破壊的なのでコピーしてから並べる（rawNotes の順序を壊さない）
  const notes = rawNotes
    .filter((n) => n.startTime < maxDuration)
    .sort((a, b) => a.startTime - b.startTime);
  laneNotes = thinNotes(notes, config.laneCount, diff);
  lastApplyKey = applyKey;
  worker.postMessage({ type: "setNotes", notes: laneNotes });
  notesPostedToWorker = true;
}

// ---------------------------------------------------------------------------
// rAF ループ
// ---------------------------------------------------------------------------

// メインスレッドから Worker へ現在時刻を送り、SHORT終了判定も行う。
// rAF（描画用）と setInterval（バックグラウンド耐性）の両方から呼ばれる。
function gameLogicTick() {
  if (gamePhase !== "playing" || isPaused) return;
  const t = currentGameTime();
  try {
    worker?.postMessage({ type: "tick", currentTime: t });
  } catch (err) {
    console.error("tick postMessage failed:", err);
  }
  if (maxDuration !== Infinity) handleShortEnding(t);
}

function startRaf() {
  if (rafId !== null) return;
  function loop() {
    gameLogicTick();
    // handleShortEnding() が showResult()→stopRaf() を呼んで rafId を null に
    // していたら、ここで再度スケジュールしてしまわないようにする。
    if (rafId !== null) rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  // タブがバックグラウンドだと rAF が停止／大幅間引きされる。
  // Worker のノート進行・ended 判定、SHORT の maxDuration 到達判定が止まるため、
  // setInterval でも同じロジックを回す（裏で音楽が鳴っていても終了→スコア画面へ）。
  if (tickIntervalId === null) {
    tickIntervalId = setInterval(gameLogicTick, 250);
  }
}
function stopRaf() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (tickIntervalId !== null) {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
  }
}

// SHORTモード：maxDuration到達でフェードアウトしつつ一時停止する。
// stop() ではなく pause() を使うことでキャッシュを保持し、
// 再プレイ時は resume() で即座に再開できる（SoundFont の再読み込みも不要）。
// pause 後に seekTo(0) して位置を先頭に戻す処理は "paused" イベントハンドラで行う。
// gamePhase を先に "result" にしてから pause()/player.pause() を呼ぶことで、
// pause イベントハンドラが「ユーザーによる一時停止」と誤認しないようにする
// （既存の gamePhase==="playing" ガードにそのまま乗る）。
//
// 注意：フェード完了判定には壁時計（performance.now()）を使う。
// maxDuration を曲の実尺（rawNotes 由来）でキャップしている場合、
// フェード開始とほぼ同時に midy 自身が自然終了（isPlaying=false）してしまい、
// currentTime()（延いては t=currentGameTime()）がそこで止まってしまう
// （isPlaying=false の間 currentTime() は resumeTime を返し続け、進まなくなる）。
// t の進行に依存して "maxDuration + ENDING_FADE_DURATION" 判定をしていると、
// 曲が自然終了した瞬間に t の増加も止まり、いつまでも条件を満たせず
// showResult() が呼ばれない（＝スコア画面が出ない）不具合になるため。
//
// さらに、タブがバックグラウンドのときは requestAnimationFrame が停止するため、
// フェード開始時に setTimeout でも完了を予約し、音楽が裏で鳴り続けていても
// 確実にスコア画面へ遷移させる。
function completeShortEnding() {
  if (gamePhase !== "playing") return;
  if (endingFadeTimeoutId !== null) {
    clearTimeout(endingFadeTimeoutId);
    endingFadeTimeoutId = null;
  }
  stopRaf();
  showResult();
  if (mode === "midi") {
    midy.pause().catch((err) => console.error("midy.pause failed:", err));
  } else {
    player.pause();
  }
}

function handleShortEnding(t) {
  if (t < maxDuration) return;
  if (!endingFadeStarted) {
    endingFadeStarted = true;
    endingFadeStartPerf = performance.now();
    if (mode === "midi") midy.fadeOutMasterVolume(ENDING_FADE_DURATION);
    // rAF が止まってもフェード完了→showResult を保証（+50ms の余裕）
    if (endingFadeTimeoutId !== null) clearTimeout(endingFadeTimeoutId);
    endingFadeTimeoutId = setTimeout(() => {
      endingFadeTimeoutId = null;
      completeShortEnding();
    }, ENDING_FADE_DURATION * 1000 + 50);
  }
  // 音量フェードは壁時計ベース（曲が実尺で終わって t が止まっても確実に下がる）
  const fadeElapsed = (performance.now() - endingFadeStartPerf) / 1000;
  if (mode === "audio") {
    player.volume = Math.max(0, 1 - fadeElapsed / ENDING_FADE_DURATION);
  }
  if (fadeElapsed >= ENDING_FADE_DURATION) {
    completeShortEnding();
  }
}

// ---------------------------------------------------------------------------
// buildGame：Worker 再起動＋設定適用（MIDI/音声共通）
// ---------------------------------------------------------------------------

function buildGame() {
  initWorker();
  renderKeyHints();
}

// Worker が無いときだけ構築する。リプレイや 2 回目以降の start では
// 既存の OffscreenCanvas + Worker を再利用し、Canvas×3 の破棄・再確保による
// メモリ/GPU スパイクを避ける。
function ensureWorker() {
  if (!worker) buildGame();
}

function beginPlayback() {
  endingFadeStarted = false;
  endingFadeStartPerf = 0;
  if (endingFadeTimeoutId !== null) {
    clearTimeout(endingFadeTimeoutId);
    endingFadeTimeoutId = null;
  }
  // 音量の復元は startMidiPlayback() 内（midy.start() 直前）で行うため、
  // ここでは MIDI モードの setMasterVolume は不要。audio モードは即時復元で OK。
  if (mode === "audio") player.volume = 1;
  lastResult = {
    score: 0,
    combo: 0,
    perfect: 0,
    great: 0,
    good: 0,
    miss: 0,
    total: laneNotes.length,
  };
  worker.postMessage({ type: "start" });
  gamePhase = "playing";
  for (
    const s of [
      screenStart,
      screenReady,
      screenAnalyzing,
      screenResult,
    ]
  ) {
    s.classList.add("hidden");
  }
  libraryModal.hide();
  soundFontModal.hide();
  settingsModal.hide();
  isPaused = false;
  pauseOverlay.classList.add("hidden");
  btnPause.classList.remove("hidden");
  btnPause.innerHTML = ICON_PAUSE;
  setWrapHeight(); // gamePhase="playing" になったので、ここでキャンバスを画面いっぱいに広げる
  updateTrackAttributionUI();
  startRaf();
  uiCanvas.focus({ preventScroll: true });
}

function applyConfigToGame(cfg) {
  const laneCountChanged = cfg.laneCount !== config.laneCount;
  const laneOrDiffChanged = laneCountChanged ||
    cfg.difficulty !== config.difficulty;
  // レーン数・遠近感・スクロール速度など描画構造に関わる変更だけ Worker を
  // 作り直す。色やキー割り当てだけなら updateOptions で足りるが、現状の
  // Worker 契約は setNotes 再送と reset を兼ねた rebuild の方が安全なため、
  // 構造変更時のみ rebuild、それ以外のプレイ中変更は rebuild せずオプション更新。
  const dprChanged = Number(cfg.maxPixelRatio) !== Number(config.maxPixelRatio);
  const structuralChanged = laneCountChanged ||
    dprChanged ||
    (cfg.perspectiveEnabled ?? true) !== (config.perspectiveEnabled ?? true) ||
    cfg.scrollSpeed !== config.scrollSpeed ||
    (cfg.laneOpacity ?? 0.35) !== (config.laneOpacity ?? 0.35) ||
    JSON.stringify(cfg.laneColors?.slice(0, cfg.laneCount)) !==
      JSON.stringify(config.laneColors?.slice(0, config.laneCount)) ||
    JSON.stringify(cfg.laneKeys?.slice(0, cfg.laneCount)) !==
      JSON.stringify(config.laneKeys?.slice(0, config.laneCount));

  config = cfg;
  // maxPixelRatio 変更時は実効 dpr を更新（構造変更時は後続の buildGame で反映）
  if (dprChanged) dpr = computeDpr();

  if (mode === "audio" && laneOrDiffChanged) {
    // 音声モードは難易度/レーン数がビートマップ生成自体に影響するため、
    // 次回再生時に自動で再生成させる（今すぐの再生成はしない＝プレビューはthinNotesの範囲で反映）
    notesStale = true;
  }

  if (gamePhase === "playing" && !endingFadeStarted) {
    if (structuralChanged || laneOrDiffChanged) {
      // 譜面配置やレーン構造が変わるので Worker を立て直して notes を再送
      stopRaf();
      buildGame();
      applyNotes();
      worker.postMessage({ type: "start" });
      lastResult = {
        score: 0,
        combo: 0,
        perfect: 0,
        great: 0,
        good: 0,
        miss: 0,
        total: laneNotes.length,
      };
      startRaf();
      gamePhase = "playing";
    } else {
      // 色・オフセット等のみ：既存 Worker にパッチを送るだけ（Canvas 再確保しない）
      worker?.postMessage({
        type: "updateOptions",
        patch: {
          laneColors: config.laneColors.slice(0, config.laneCount),
          keys: config.laneKeys.slice(0, config.laneCount),
          judgeOffset: (config.judgeOffset ?? 0) / 1000,
          uiColor: computeUiColor(),
          judgeLineColor: config.judgeLineColor || "",
          laneLineColor: config.laneLineColor || "",
          accentColor: config.accentColor || "",
          laneOpacity: config.laneOpacity ?? 0.35,
        },
      });
    }
  } else if (gamePhase !== "playing") {
    // 非プレイ中は構造が変わっていなくても設定プレビュー用に Worker を
    // 揃えておく。ただし既に Worker があり構造不変なら rebuild 不要。
    if (!worker || structuralChanged || laneOrDiffChanged) {
      buildGame();
    } else {
      worker.postMessage({
        type: "updateOptions",
        patch: {
          laneColors: config.laneColors.slice(0, config.laneCount),
          keys: config.laneKeys.slice(0, config.laneCount),
          judgeOffset: (config.judgeOffset ?? 0) / 1000,
          uiColor: computeUiColor(),
          judgeLineColor: config.judgeLineColor || "",
          laneLineColor: config.laneLineColor || "",
          accentColor: config.accentColor || "",
          laneOpacity: config.laneOpacity ?? 0.35,
          scrollSpeed: config.scrollSpeed,
          perspective: (config.perspectiveEnabled ?? true) ? PERSPECTIVE : 0,
        },
      });
    }
    if (rawNotes.length > 0) applyNotes();
  }
  // gamePhase==="playing" && endingFadeStarted の場合は何もしない。
  // まもなく結果画面に遷移するため、ここで譜面を再構築して lastResult を
  // ゼロリセットすると、フェード完了時の showResult() が直前までのスコアを
  // 消してしまう（設定変更は次回プレイから反映されれば十分）。
  renderKeyHints();
}

// ---------------------------------------------------------------------------
// Screen management
// ---------------------------------------------------------------------------

function showScreen(name) {
  if (name === "settings") {
    settingsModal.show();
    return;
  }
  if (name === "library") {
    libraryModal.show();
    return;
  }
  gamePhase = name;
  screenStart.classList.toggle("hidden", name !== "start");
  screenReady.classList.toggle("hidden", name !== "ready");
  screenAnalyzing.classList.toggle("hidden", name !== "analyzing");
  screenResult.classList.toggle("hidden", name !== "result");
  settingsModal.hide();
  libraryModal.hide();
  soundFontModal.hide();
  isPaused = false;
  pauseOverlay.classList.add("hidden");
  btnPause.classList.add("hidden");
  setWrapHeight(); // gamePhase が変わったので、フルスクリーン⇄通常レイアウトを再計算する
  updateTrackAttributionUI();
}

function showResult() {
  if (gamePhase === "result") return; // 二重呼び出し防止
  if (endingFadeTimeoutId !== null) {
    clearTimeout(endingFadeTimeoutId);
    endingFadeTimeoutId = null;
  }
  // stop で描画ループ・アクティブ判定を止める。
  // 譜面配列自体は Worker に残し、リプレイ時の setNotes 再送（structured clone）を
  // 避ける。高負荷 MIDI ではこの clone がピークメモリを押し上げる一因になる。
  try {
    worker?.postMessage({ type: "stop" });
  } catch (err) {
    console.error("worker stop failed:", err);
  }
  gamePhase = "result";
  isPaused = false;
  pauseOverlay.classList.add("hidden");
  btnPause.classList.add("hidden");
  setWrapHeight(); // フルスクリーン表示から通常レイアウトに戻す

  const judged = lastResult.perfect + lastResult.great + lastResult.good +
    lastResult.miss;
  const acc = judged > 0
    ? (lastResult.perfect * 100 + lastResult.great * 80 +
      lastResult.good * 50) / judged
    : 0;
  const accStr = acc.toFixed(1);
  const a = parseFloat(accStr);
  const [grade, cls] = a >= 95
    ? ["S", "grade-S"]
    : a >= 80
    ? ["A", "grade-A"]
    : a >= 65
    ? ["B", "grade-B"]
    : a >= 50
    ? ["C", "grade-C"]
    : ["D", "grade-D"];

  const gradeEl = document.getElementById("resultGrade");
  gradeEl.classList.remove(
    "grade-S",
    "grade-A",
    "grade-B",
    "grade-C",
    "grade-D",
  );
  gradeEl.classList.add(cls);
  gradeEl.textContent = grade;
  document.getElementById("rScore").textContent = String(lastResult.score)
    .padStart(7, "0");
  document.getElementById("rAccuracy").textContent = accStr + "%";
  document.getElementById("rCombo").textContent = lastResult.combo;
  document.getElementById("rPerfect").textContent = lastResult.perfect;
  document.getElementById("rGreat").textContent = lastResult.great;
  document.getElementById("rGood").textContent = lastResult.good;
  document.getElementById("rMiss").textContent = lastResult.miss;

  showScreen("result");
}

// ---------------------------------------------------------------------------
// Key hints
// ---------------------------------------------------------------------------

function renderKeyHints() {
  ["keyHintStart", "keyHintReady"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = "";
    for (let l = 0; l < config.laneCount; l++) {
      const chip = document.createElement("span");
      chip.className = "lane-key-chip";
      chip.textContent = (config.laneKeys[l] ?? l + 1).toString().toUpperCase();
      const c = config.laneColors[l % config.laneColors.length];
      // 色そのものは .lane-key-chip 側の CSS（color-mix + currentColor）で
      // テーマに応じたコントラストに調整されるので、ここではレーン色を変数で渡すだけ。
      chip.style.cssText = `--lane-color:${c}`;
      el.appendChild(chip);
    }
  });
}

// ---------------------------------------------------------------------------
// Play length toggle（SHORT: 120秒で強制終了 / ORIGINAL: 曲の最後まで）
// ---------------------------------------------------------------------------

const playLengthLabels = {
  short: document.querySelector(
    '#playLengthToggle label[for="playLengthShort"]',
  ),
  original: document.querySelector(
    '#playLengthToggle label[for="playLengthOriginal"]',
  ),
};

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

// ファイル読込直後（rawNotes/audioBuffer 確定後）に呼び、SHORT/ORIGINALの
// トグルラベルへ再生時間を反映する。元ファイルが SHORT_DURATION 未満の
// 場合は SHORT側にもその実尺を表示する。
function updatePlayLengthLabels() {
  const songDuration = getSongDuration();
  if (songDuration <= 0) return;
  const shortDuration = Math.min(SHORT_DURATION, songDuration);
  playLengthLabels.short.innerHTML = `SHORT<br>(${
    formatDuration(shortDuration)
  })`;
  playLengthLabels.original.innerHTML = `ORIGINAL<br>(${
    formatDuration(songDuration)
  })`;
}

document.querySelectorAll("#playLengthToggle input[data-length]").forEach(
  (input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      playLength = input.dataset.length;
      if (rawNotes.length > 0) applyNotes(); // noteCountLabel 更新のため
    });
  },
);

// ---------------------------------------------------------------------------
// Settings panel（MIDI/音声共通。背景・ダークモードも含む）
// ---------------------------------------------------------------------------

let configSnapshot = null;

function readSettingsUI() {
  const gv = (id) => document.getElementById(id)?.value ?? "";
  const colors = [
    ...document.querySelectorAll("#laneColorPickers input[type=color]"),
  ]
    .map((i) => i.value);
  return {
    ...config,
    laneCount: parseInt(gv("laneCount"), 10) || 4,
    scrollSpeed: parseInt(gv("scrollSpeed"), 10) || 500,
    laneKeys: [...document.querySelectorAll("#laneKeyInputs input[type=text]")]
      .map((i) => i.value.trim()).filter(Boolean),
    laneColors: colors,
    // accentColor 用の <input type=color> は常に何らかの16進値を持ってしまう
    // （空値を表現できない）ため、ユーザーが実際に触った場合だけ値を採用し、
    // 触っていなければ既存の config.accentColor（"" = 自動）をそのまま維持する。
    accentColor: document.getElementById("accentColor")?.dataset.touched === "1"
      ? gv("accentColor")
      : config.accentColor ?? "",
    // judgeLineColor も同様に、触った場合だけ採用（"" = uiColor に自動追従）。
    judgeLineColor:
      document.getElementById("judgeLineColor")?.dataset.touched === "1"
        ? gv("judgeLineColor")
        : config.judgeLineColor ?? "",
    laneLineColor:
      document.getElementById("laneLineColor")?.dataset.touched === "1"
        ? gv("laneLineColor")
        : config.laneLineColor ?? "",
    perspectiveEnabled:
      document.getElementById("perspectiveEnabled")?.checked ?? true,
    laneOpacity: parseFloat(
      document.getElementById("laneOpacity")?.value ?? "0.35",
    ),
    difficulty: document.getElementById("difficulty")?.value || "NORMAL",
    judgeOffset:
      parseInt(document.getElementById("judgeOffset")?.value ?? "0", 10) || 0,
    maxPixelRatio: parseFloat(
      document.getElementById("maxPixelRatio")?.value ?? "1",
    ) || 1,
  };
}

function openSettings() {
  configSnapshot = { ...config, laneColors: [...config.laneColors] };
  // 前回の未確定プレビューが残らないようにする
  pendingBackground = null;

  const sv = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  const st = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  sv("laneCount", config.laneCount);
  st("laneCountVal", config.laneCount);
  sv("scrollSpeed", config.scrollSpeed);
  st("scrollSpeedVal", config.scrollSpeed);
  sv("maxPixelRatio", config.maxPixelRatio ?? 1);
  st("maxPixelRatioVal", config.maxPixelRatio ?? 1);
  sv("difficulty", config.difficulty);
  const persEl = document.getElementById("perspectiveEnabled");
  if (persEl) persEl.checked = config.perspectiveEnabled ?? true;
  const joEl = document.getElementById("judgeOffset");
  if (joEl) {
    joEl.value = config.judgeOffset ?? 0;
    const jvEl = document.getElementById("judgeOffsetVal");
    if (jvEl) jvEl.textContent = (config.judgeOffset ?? 0) + "ms";
  }
  const loEl = document.getElementById("laneOpacity");
  if (loEl) {
    loEl.value = config.laneOpacity ?? 0.35;
    st("laneOpacityVal", (config.laneOpacity ?? 0.35).toFixed(2));
  }
  const acEl = document.getElementById("accentColor");
  if (acEl) {
    // <input type=color> は空値を表示できないため、未設定時は現在の文字色を
    // 算出して初期表示用に見せるだけにする（config.accentColor 自体は "" のまま）。
    acEl.value = config.accentColor ||
      rgbToHex(getComputedStyle(document.body).color) || "#ffc107";
    acEl.dataset.touched = "0"; // パネルを開き直すたびにリセット
  }
  const jlEl = document.getElementById("judgeLineColor");
  if (jlEl) {
    // 同様に未設定時は現在の文字色（uiColor 相当）を初期表示用に見せるだけにする。
    jlEl.value = config.judgeLineColor ||
      rgbToHex(getComputedStyle(document.body).color) || "#ffffff";
    jlEl.dataset.touched = "0";
  }
  const llEl = document.getElementById("laneLineColor");
  if (llEl) {
    llEl.value = config.laneLineColor ||
      rgbToHex(getComputedStyle(document.body).color) || "#ffffff";
    llEl.dataset.touched = "0";
  }

  document.getElementById("audioDiffNote")?.classList.toggle(
    "hidden",
    mode !== "audio",
  );

  const keyInputs = document.querySelectorAll(
    "#laneKeyInputs input[type=text]",
  );
  for (let l = 0; l < keyInputs.length; l++) {
    keyInputs[l].value = config.laneKeys[l] ?? "";
  }

  const colorInputs = document.querySelectorAll(
    "#laneColorPickers input[type=color]",
  );
  for (let l = 0; l < colorInputs.length; l++) {
    colorInputs[l].value = config.laneColors[l] ??
      DEFAULT_CONFIG.laneColors[l % DEFAULT_CONFIG.laneColors.length];
  }

  showScreen("settings");
}

function onSettingsInput() {
  applyConfigToGame(readSettingsUI());
  saveConfig(config);
}

function applySettings() {
  applyConfigToGame(readSettingsUI());
  // 背景はプレビューのみ即時反映しているため、ここで初めて永続化する
  commitPendingBackground();
  saveConfig(config);
  configSnapshot = null; // 適用済みなので hide.bs.modal 側の巻き戻しを無効化
  settingsModal.hide();
}

// ✕ボタン・キャンセルボタン（どちらも data-bs-dismiss="modal"）・背景クリック・
// Escキー、すべて Bootstrap モーダルの hide.bs.modal に集約されるので、
// 未適用の変更を巻き戻す処理はここに一本化する。
// （適用時は applySettings() が configSnapshot を先に null にしているので二重には走らない）
screenSettings.addEventListener("hide.bs.modal", () => {
  if (configSnapshot) {
    applyConfigToGame(configSnapshot);
    saveConfig(configSnapshot);
    // 背景プレビューもスナップショット時点の表示へ戻す（config 文字列だけでなく
    // 実際の画像/動画と <select> の選択状態も巻き戻す）
    revertPendingBackground(configSnapshot.backgroundPreset ?? "");
    configSnapshot = null;
  }
});

const settingsPanelEl = document.getElementById("settingsPanel");
settingsPanelEl.addEventListener("input", onSettingsInput);
settingsPanelEl.addEventListener("change", onSettingsInput);

document.getElementById("accentColor")?.addEventListener("input", (e) => {
  e.target.dataset.touched = "1";
});

document.getElementById("btnResetAccentColor")?.addEventListener(
  "click",
  () => {
    applyConfigToGame({ ...readSettingsUI(), accentColor: "" });
    saveConfig(config);
    const acEl = document.getElementById("accentColor");
    if (acEl) {
      acEl.value = rgbToHex(getComputedStyle(document.body).color) || "#ffc107";
      acEl.dataset.touched = "0";
    }
  },
);

document.getElementById("judgeLineColor")?.addEventListener("input", (e) => {
  e.target.dataset.touched = "1";
});

document.getElementById("btnResetJudgeLineColor")?.addEventListener(
  "click",
  () => {
    applyConfigToGame({ ...readSettingsUI(), judgeLineColor: "" });
    saveConfig(config);
    const jlEl = document.getElementById("judgeLineColor");
    if (jlEl) {
      jlEl.value = rgbToHex(getComputedStyle(document.body).color) || "#ffffff";
      jlEl.dataset.touched = "0";
    }
  },
);

document.getElementById("laneLineColor")?.addEventListener("input", (e) => {
  e.target.dataset.touched = "1";
});

document.getElementById("btnResetLaneLineColor")?.addEventListener(
  "click",
  () => {
    applyConfigToGame({ ...readSettingsUI(), laneLineColor: "" });
    saveConfig(config);
    const llEl = document.getElementById("laneLineColor");
    if (llEl) {
      llEl.value = rgbToHex(getComputedStyle(document.body).color) || "#ffffff";
      llEl.dataset.touched = "0";
    }
  },
);

[
  ["laneCount", "laneCountVal"],
  ["scrollSpeed", "scrollSpeedVal"],
  ["laneOpacity", "laneOpacityVal"],
  ["judgeOffset", "judgeOffsetVal"],
  ["maxPixelRatio", "maxPixelRatioVal"],
].forEach(([sid, lid]) => {
  document.getElementById(sid)?.addEventListener("input", (e) => {
    const el = document.getElementById(lid);
    if (el) {
      el.textContent = sid === "laneOpacity"
        ? parseFloat(e.target.value).toFixed(2)
        : sid === "judgeOffset"
        ? e.target.value + "ms"
        : e.target.value;
    }
  });
});

function goToStartScreen() {
  if (gamePhase === "playing") stopRaf();
  stopAllPlayback();
  clearTrackMeta();
  showScreen("start");
}
document.getElementById("btnChangeFileReady").addEventListener(
  "click",
  goToStartScreen,
);
document.getElementById("btnChangeFileResult").addEventListener(
  "click",
  goToStartScreen,
);
document.getElementById("btnSettings").addEventListener("click", openSettings);
// レーンキー入力は静的な8個をまとめて委譲で処理（1文字入力→次の欄へフォーカス移動）
document.getElementById("laneKeyInputs").addEventListener("keydown", (e) => {
  const inp = e.target;
  if (inp.tagName !== "INPUT" || e.key.length !== 1) return;
  e.preventDefault();
  inp.value = e.key;
  const inputs = [
    ...document.querySelectorAll("#laneKeyInputs input[type=text]"),
  ];
  const next = inputs[inputs.indexOf(inp) + 1];
  if (next) next.focus();
  onSettingsInput();
});
document.getElementById("btnApplySettings").addEventListener(
  "click",
  applySettings,
);

// ---------------------------------------------------------------------------
// Dark mode
// ---------------------------------------------------------------------------

function toggleDarkMode() {
  const html = document.documentElement;
  const newTheme = html.getAttribute("data-bs-theme") === "dark"
    ? "light"
    : "dark";
  html.setAttribute("data-bs-theme", newTheme);
  localStorage.setItem("darkMode", newTheme);
}

function changeLang() {
  const langObj = document.getElementById("lang");
  const lang = langObj.options[langObj.selectedIndex].value;
  location.href = `/tip-tap-notes/${lang}/`;
}

document.getElementById("toggleDarkMode").addEventListener("click", () => {
  toggleDarkMode();
  // ゲーム進行中でもレーン区切り線・判定ライン・HUD文字が見えなくならないよう、
  // 稼働中の worker にも新しいテーマ文字色を反映する
  // （rhythm-game-worker.js の "updateOptions" は msg.patch を読む契約なので合わせる）。
  worker?.postMessage({
    type: "updateOptions",
    patch: { uiColor: computeUiColor() },
  });
});
document.getElementById("lang").onchange = changeLang;

// ---------------------------------------------------------------------------
// Keyboard input（MIDI/音声共通）
// ---------------------------------------------------------------------------

const pressedKeys = new Set();
document.addEventListener("keydown", (e) => {
  if (
    e.repeat || e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA"
  ) return;
  if (e.code === "Space") {
    if (gamePhase === "playing") {
      e.preventDefault(); // ページスクロールを防ぐ
      togglePause();
    } else if (gamePhase === "ready" || gamePhase === "result") {
      // btnBigStart / btnBigReplay と同じ操作をキーボードからも行えるようにする
      e.preventDefault();
      startOrReplay();
    }
    return;
  }
  const key = e.key.toLowerCase();
  if (pressedKeys.has(key)) return;
  pressedKeys.add(key);
  if (gamePhase !== "playing" || isPaused) return;
  const lane = config.laneKeys.indexOf(key);
  if (lane >= 0) {
    worker?.postMessage({
      type: "pressLane",
      lane,
      pressedAt: currentGameTime(),
    });
  }
}, { capture: true });
document.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  pressedKeys.delete(key);
  if (gamePhase !== "playing" || isPaused) return;
  const lane = config.laneKeys.indexOf(key);
  if (lane >= 0) worker?.postMessage({ type: "releaseLane", lane });
}, { capture: true });

// ---------------------------------------------------------------------------
// タッチ・ポインター入力（perspective の逆変換つき。MIDI/音声共通）
// ---------------------------------------------------------------------------

function pointerToLane(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;

  const W = canvas.width;
  const H = canvas.height; // btnBot（画面最下端）と一致
  const cx = W / 2;
  const p = (config.perspectiveEnabled ?? true) ? PERSPECTIVE : 0;

  const sc = Math.max(0.05, 1 - p + p * (y / H));
  const xFull = cx + (x - cx) / sc;

  const laneW = W / config.laneCount;
  const lane = Math.floor(xFull / laneW);
  return Math.max(0, Math.min(config.laneCount - 1, lane));
}

function bindPointerEvents(canvas) {
  canvas.addEventListener("pointerdown", (e) => {
    if (gamePhase !== "playing" || isPaused) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    const lane = pointerToLane(canvas, e.clientX, e.clientY);
    const pressedAt = currentGameTime();
    worker?.postMessage({ type: "pressLane", lane, pressedAt });
    (canvas._pl ??= {})[e.pointerId] = lane;
  });
  ["pointerup", "pointercancel"].forEach((ev) => {
    canvas.addEventListener(ev, (e) => {
      const lane = canvas._pl?.[e.pointerId];
      if (lane !== undefined) {
        worker?.postMessage({ type: "releaseLane", lane });
        delete canvas._pl[e.pointerId];
      }
    });
  });
}
bindPointerEvents(uiCanvas);

// ---------------------------------------------------------------------------
// 一時停止（スペースキー / 画面左上のポーズボタン、MIDI/音声共通）
//
// 実際の一時停止/再開の状態管理は、既存の midy "paused"/"resumed" イベントと
// player の "pause"/"play" イベント（下の方の各リスナー内）に一本化してある。
// ここでは「操作のきっかけ」を作るだけ。
// ---------------------------------------------------------------------------

function updatePauseUi(paused) {
  isPaused = paused;
  pauseOverlay.classList.toggle("hidden", !paused);
  btnPause.innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
}

function togglePause() {
  if (gamePhase !== "playing") return;
  if (mode === "midi") {
    try {
      if (midy.isPaused) {
        const result = midy.resume();
        if (result && typeof result.catch === "function") {
          result.catch((err) => console.error("midy.resume failed:", err));
        }
      } else {
        midy.pause();
      }
    } catch (err) {
      console.error("midy.pause/resume failed:", err);
    }
  } else if (mode === "audio") {
    if (player.paused) {
      player.play().catch((err) => console.error("player.play failed:", err));
    } else {
      player.pause();
    }
  }
}
btnPause.addEventListener("click", togglePause);

// ---------------------------------------------------------------------------
// モード切り替え
// ---------------------------------------------------------------------------

function stopAllPlayback() {
  stopRaf();
  if (endingFadeTimeoutId !== null) {
    clearTimeout(endingFadeTimeoutId);
    endingFadeTimeoutId = null;
  }
  endingFadeStarted = false;
  try {
    if (!midy.isPaused) midy.pause();
  } catch (err) {
    console.error("midy.pause failed:", err);
  }
  try {
    if (!player.paused) player.pause();
  } catch (err) {
    console.error("player.pause failed:", err);
  }
  worker?.postMessage({ type: "stop" });
}

function switchMode(next) {
  if (mode === next) return;
  stopAllPlayback();
  mode = next;

  // html[data-mode] は readyHintAudio（音声モードの案内）だけがCSS側で参照している。
  // start画面のタイトル/説明はモードに関わらず常に固定表示。
  document.documentElement.dataset.mode = mode;

  rawNotes = [];
  laneNotes = [];
  lastApplyKey = "";
  notesPostedToWorker = false;
  notesReady = false;
  notesStale = true;
  clearTrackMeta();
  buildGame();
  showScreen("start");
  setTimeout(setWrapHeight, 30);
}

// ---------------------------------------------------------------------------
// MIDI playback
// ---------------------------------------------------------------------------

const audioContext = new AudioContext();
const midy = new Midy(audioContext);
midy.cacheMode = "chunk";
midy.startDelay = START_DELAY_MIDI;

const SOUNDFONT_BASE = "https://soundfonts.pages.dev/";
// 現在選択中のサウンドフォントのベースURL（ディレクトリ）。
// 例: "https://soundfonts.pages.dev/GeneralUser_GS_v1.471"
// サウンドフォントライブラリで選択が変わると soundFontURL だけ更新し、
// 実際の読み込みは次回の startMidiPlayback() 時にまとめて行う。
let soundFontURL = SOUNDFONT_BASE + "GeneralUser_GS_v1.471";

// 読み込み済みの楽器はスキップしつつ、今回のMIDIで実際に使われている楽器に
// 対応する .sf3 のパス一覧を作る。
function getSoundFontPaths() {
  const paths = [];
  for (const instrument of midy.instruments) {
    const [bank, program] = instrument.split(":");
    const bankNumber = Number(bank);
    const programNumber = Number(program);
    const index = midy.soundFontTable[programNumber]?.[bankNumber];
    if (index !== undefined) continue;
    const baseName = bankNumber === 128 ? "128" : program;
    paths.push(`${soundFontURL}/${baseName}.sf3`);
  }
  return paths;
}

// 別の曲を読み込む前（loadMIDIBytes / switchMode）に確実に停止させる。
// SHORT終了後の再プレイは pause()+resume() で行うためここは通らない。
async function ensureMidiStopped() {
  if (!midy.isPlaying && !midy.isPaused) return;
  try {
    await midy.stop();
  } catch (err) {
    console.error("midy.stop failed:", err);
  }
}

// startMidiPlayback() で一度でも midy.start() を呼んだかどうか。
// 「一度も再生していない曲への初回 start」と「自然終了後のリプレイ start」を
// 区別するために使う（詳細は startMidiPlayback() 内のコメント参照）。
let midiHasStartedOnce = false;

async function startMidiPlayback() {
  // SHORT終了後は pause() で止めているので resume() で先頭から再開できる。
  // キャッシュが保持されているため SoundFont の再読み込みも不要。
  // ※ これは意図的な高速リプレイ用の分岐なので変更しない。
  if (midy.isPaused) {
    await midy.resume();
    return;
  }
  // ORIGINAL 完走時や、曲が SHORT_DURATION 未満で自然終了したときは
  // pause() ではなく stop 相当の自然終了（isPlaying=false, isPaused=false）になる。
  // この状態から ensureMidiStopped() を呼んでも、そのガード
  // 「!isPlaying && !isPaused なら何もしない」に引っかかって
  // 実際には midy.stop() が一度も呼ばれない。
  // そのため内部の再生状態（スケジュール済みノート／アクティブボイス等）が
  // リセットされないまま次の midy.start() が積み重なり、2回目以降の
  // リプレイで処理が追いつかずハングする原因になっていた。
  // 「一度でも再生したことがある」場合は、isPlaying/isPaused の値に関わらず
  // 必ず stop() してから start() し直す（初回の未再生インスタンスに対しては
  // 従来通り stop() を呼ばない＝ensureMidiStopped() のガードを維持する）。
  if (midiHasStartedOnce) {
    try {
      await midy.stop();
    } catch (err) {
      console.error("midy.stop failed:", err);
    }
  } else {
    await ensureMidiStopped();
  }
  await midy.loadSoundFont(getSoundFontPaths());
  midy.setMasterVolume(1, audioContext.currentTime);
  await midy.start();
  midiHasStartedOnce = true;
}

async function loadMIDIBytes(bytes, meta = null) {
  switchMode("midi");
  await ensureMidiStopped();
  await midy.loadMIDI(bytes);
  rawNotes = extractNotesFromMidy(midy);
  lastApplyKey = "";
  notesPostedToWorker = false;
  // switchMode() が clearTrackMeta() するので、MIDI 読込後に改めて設定する
  setTrackMeta(meta);
  buildGame();
  applyNotes(true);
  updatePlayLengthLabels();
  showScreen("ready");
}

// ---------------------------------------------------------------------------
// 統合ファイル選択：拡張子/MIMEタイプから MIDI / SoundFont / 音声 を自動判別
// ---------------------------------------------------------------------------

const AUDIO_EXTS = new Set([
  "mp3",
  "wav",
  "ogg",
  "oga",
  "m4a",
  "aac",
  "flac",
  "opus",
  "weba",
  "wma",
]);

function detectFileKind(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "sf2" || ext === "sf3") return "soundfont";
  if (ext === "mid" || ext === "midi") return "midi";
  if (file.type?.startsWith("audio/")) return "audio";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return null;
}

async function loadFile(file) {
  if (!file) return;
  const kind = detectFileKind(file);
  if (kind === "soundfont") {
    const buf = await file.arrayBuffer();
    await midy.loadSoundFont(new Uint8Array(buf));
    // SoundFont単体ではモードは変えない（既にMIDIが読み込み済みならそのまま反映される）
    return;
  }
  if (kind === "midi") {
    const buf = await file.arrayBuffer();
    // ローカル MIDI にはライブラリ由来の著作権情報がない（ファイル名のみ表示しない）
    await loadMIDIBytes(new Uint8Array(buf), null);
    return;
  }
  if (kind === "audio") {
    await loadAudioFile(file);
    return;
  }
  alert(t("unsupportedFileType"));
}

document.getElementById("selectFile").addEventListener(
  "click",
  () => document.getElementById("inputFile").click(),
);
document.getElementById("inputFile").addEventListener("change", (e) => {
  loadFile(e.target.files[0]);
  e.target.value = "";
});
document.addEventListener("paste", (e) => {
  const f = e.clipboardData?.items[0]?.getAsFile();
  if (f) loadFile(f);
});

const selectPanel = document.getElementById("selectPanel");
let dragN = 0;
selectPanel.addEventListener("dragenter", (e) => {
  e.preventDefault();
  if (++dragN === 1) {
    selectPanel.classList.add("drag-active");
  }
});
selectPanel.addEventListener("dragleave", (e) => {
  e.preventDefault();
  if (--dragN === 0) {
    selectPanel.classList.remove("drag-active");
  }
});
selectPanel.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
selectPanel.addEventListener("drop", (e) => {
  e.preventDefault();
  dragN = 0;
  selectPanel.classList.remove("drag-active");
  loadFile(e.dataTransfer.files[0]);
});

// ---------------------------------------------------------------------------
// MIDI library（Bootstrap modal 内に MidiLibrary で一覧表示）
// ---------------------------------------------------------------------------

const midiLibrary = new MidiLibrary({
  table: "libraryTable",
  pagination: "libraryPagination",
  columns: "libraryColumns",
  collections: "libraryCollections",
  instruments: "libraryInstruments",
  lang: htmlLang,
  onSelect: async (row) => {
    const buf = await (await fetch(`https://midi-db.pages.dev/${row.file}`))
      .arrayBuffer();
    await loadMIDIBytes(new Uint8Array(buf), trackMetaFromLibraryRow(row));
    libraryModal.hide();
  },
});
midiLibrary.load();

// ---------------------------------------------------------------------------
// 楽曲メタデータ（タイトル / 作者 / サイト / ライセンス）表示
// MIDI ライブラリ由来の曲で著作権表示を満たすために、ready / playing / result
// の間は画面上部に表示する。ローカルファイル読込時はクリアする。
// ---------------------------------------------------------------------------

/** @type {{ title: string, composer: string, siteName: string, web: string, license: string } | null} */
let currentTrackMeta = null;

function isProbablyUrl(s) {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** MIDI ライブラリ行 + コレクション情報から表示用メタデータを組み立てる */
function trackMetaFromLibraryRow(row) {
  if (!row) return null;
  const collectionId = String(row.file || "").split("/")[0] || "";
  const col = collectionId ? midiLibrary.collections.get(collectionId) : null;
  const web = row.web || col?.web || "";
  const siteName = row.collection || col?.name || collectionId || "";
  const license = row.license || col?.license || "";
  const title = row.title || "";
  const composer = row.composer || col?.composer || "";
  if (!title && !composer && !siteName && !license) return null;
  return { title, composer, siteName, web, license };
}

function clearTrackMeta() {
  currentTrackMeta = null;
  updateTrackAttributionUI();
}

function setTrackMeta(meta) {
  currentTrackMeta = meta && (meta.title || meta.composer || meta.siteName ||
      meta.license)
    ? {
      title: meta.title || "",
      composer: meta.composer || "",
      siteName: meta.siteName || "",
      web: meta.web || "",
      license: meta.license || "",
    }
    : null;
  updateTrackAttributionUI();
}

function updateTrackAttributionUI() {
  const root = document.getElementById("trackAttribution");
  const titleEl = document.getElementById("trackAttrTitle");
  const metaEl = document.getElementById("trackAttrMeta");
  if (!root || !titleEl || !metaEl) return;

  const meta = currentTrackMeta;
  // スタート画面では隠す。ready / playing / result / analyzing で表示
  const visible = !!meta && gamePhase !== "start";
  root.classList.toggle("hidden", !visible);
  if (!meta) {
    titleEl.textContent = "";
    metaEl.innerHTML = "";
    syncAttributionStackHeight();
    if (worker) resizeCanvases();
    return;
  }

  titleEl.textContent = meta.title || "Untitled";

  const parts = [];
  if (meta.composer) {
    parts.push(`<span>${escapeHtml(meta.composer)}</span>`);
  }
  if (meta.web && isProbablyUrl(meta.web)) {
    const label = escapeHtml(meta.siteName || meta.web);
    parts.push(
      `<span class="sep"><a href="${
        escapeHtml(meta.web)
      }" target="_blank" rel="noopener noreferrer">${label}</a></span>`,
    );
  } else if (meta.siteName) {
    parts.push(`<span class="sep">${escapeHtml(meta.siteName)}</span>`);
  }
  if (meta.license) {
    if (isProbablyUrl(meta.license)) {
      parts.push(
        `<span class="sep"><a href="${
          escapeHtml(meta.license)
        }" target="_blank" rel="noopener noreferrer">License</a></span>`,
      );
    } else {
      parts.push(`<span class="sep">${escapeHtml(meta.license)}</span>`);
    }
  }
  metaEl.innerHTML = parts.join("");
  // 表示後に高さを測って狭い画面の pause/スコア位置を更新し、HUD にも反映
  syncAttributionStackHeight();
  if (worker) resizeCanvases();
}

// ---------------------------------------------------------------------------
// 結果画面: MIDI ライブラリから 1 分以上の楽曲をランダム選曲
// ---------------------------------------------------------------------------

/** "M:SS" / "H:MM:SS" / 秒数 を秒に変換。パース不可は 0。 */
function parseMidiLibraryTime(timeStr) {
  if (timeStr == null || timeStr === "") return 0;
  if (typeof timeStr === "number" && Number.isFinite(timeStr)) return timeStr;
  const s = String(timeStr).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

const RANDOM_MIDI_MIN_SECONDS = 60;

async function playRandomLongMidi() {
  const btn = document.getElementById("btnRandomMidi");
  const data = midiLibrary.fullData;
  if (!data || data.length === 0) {
    alert("MIDI library is still loading. Please try again in a moment.");
    return;
  }
  const candidates = data.filter(
    (row) =>
      row?.file && parseMidiLibraryTime(row.time) >= RANDOM_MIDI_MIN_SECONDS,
  );
  if (candidates.length === 0) {
    alert("No songs longer than 1 minute found in the MIDI library.");
    return;
  }
  const row = candidates[Math.floor(Math.random() * candidates.length)];
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Loading…";
  }
  try {
    const buf = await (await fetch(`https://midi-db.pages.dev/${row.file}`))
      .arrayBuffer();
    await loadMIDIBytes(new Uint8Array(buf), trackMetaFromLibraryRow(row));
  } catch (err) {
    console.error("Random MIDI load failed:", err);
    alert("Failed to load random MIDI: " + (err?.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🎲 Random MIDI (≥1 min)";
    }
  }
}

document.getElementById("btnRandomMidi")?.addEventListener(
  "click",
  () => {
    playRandomLongMidi().catch((err) =>
      console.error("playRandomLongMidi failed:", err)
    );
  },
);

// ---------------------------------------------------------------------------
// SoundFont library（Bootstrap modal 内の一覧から選択。ラジオボタンなので
// 現在選択中の SoundFont が一目でわかる）
// ---------------------------------------------------------------------------

let soundFontListLoaded = false;

async function loadSoundFontLibrary() {
  const el = document.getElementById("soundFontLibraryList");
  try {
    const list = await (await fetch(`${SOUNDFONT_BASE}list.json`)).json();
    el.innerHTML = "";
    list.forEach((sf, i) => {
      const id = `soundFontLibraryItem-${i}`;
      const checked = sf.name === "GeneralUser_GS_v1.471";
      const wrap = document.createElement("div");
      wrap.className = "form-check";
      wrap.innerHTML =
        `<input class="form-check-input" type="radio" name="soundFontLibrary" id="${id}" value="${sf.name}" ${
          checked ? "checked" : ""
        }>` +
        `<label class="form-check-label" for="${id}">${sf.name}</label>`;
      el.appendChild(wrap);
      if (checked) soundFontURL = SOUNDFONT_BASE + sf.name;
    });
    soundFontListLoaded = true;
  } catch (err) {
    console.error("Failed to load SoundFont library:", err);
    el.textContent = t("soundFontLoadFailed");
  }
}

document.getElementById("soundFontLibraryList").addEventListener(
  "change",
  (e) => {
    if (e.target.name !== "soundFontLibrary") return;
    soundFontURL = SOUNDFONT_BASE + e.target.value;
  },
);

document.getElementById("openSoundFontLibrary").addEventListener(
  "click",
  () => {
    if (!soundFontListLoaded) loadSoundFontLibrary();
  },
);

// ---------------------------------------------------------------------------
// Midy playback events（MIDIモード）
// ---------------------------------------------------------------------------

function startGameMidi() {
  // リプレイ・2 回目以降の start では既存 Worker / OffscreenCanvas を再利用。
  // 毎回 initWorker() すると Canvas×3 の GPU バッファ破棄・再確保が走り、
  // メモリ/GPU のピークが跳ねやすい。
  ensureWorker();
  // 同一譜面なら thinNotes / structured clone はスキップされる。
  applyNotes();
  beginPlayback();
}

midy.addEventListener("started", startGameMidi);

midy.addEventListener("paused", () => {
  if (mode !== "midi") return;
  stopRaf();
  _pausedAt = currentGameTime();
  worker?.postMessage({ type: "tick", currentTime: _pausedAt });
  if (gamePhase === "playing") {
    updatePauseUi(true);
  } else if (gamePhase === "result") {
    // SHORTモード終了由来の pause。再プレイ時に先頭から再生できるよう
    // 再生位置を 0 に戻し、フェードアウトした音量も復元しておく。
    midy.seekTo(0);
    midy.setMasterVolume(1, audioContext.currentTime);
  }
});

midy.addEventListener("resumed", () => {
  if (mode !== "midi") return;
  if (gamePhase === "playing") {
    updatePauseUi(false);
    _resumeBaseGameTime = _pausedAt;
    _resumeBasePerf = performance.now();
    _resumeStabilizeMinUntil = _resumeBasePerf + RESUME_STABILIZE_MIN_MS;
    _resumeStabilizeMaxUntil = _resumeBasePerf + RESUME_STABILIZE_MAX_MS;
    startRaf();
    return;
  }
  startGameMidi();
});

midy.addEventListener("stopped", () => {
  if (mode !== "midi") return;
  worker?.postMessage({ type: "stop" });
  // プレイ中の自然終了:
  // - すでにフェード中なら setTimeout / completeShortEnding に完了を任せる
  //   （バックグラウンドで rAF が止まっていてもタイムアウトで showResult される）
  // - 未フェードなら音楽は既に止まっているのでスコア画面へ
  if (gamePhase === "playing") {
    if (endingFadeStarted) {
      return;
    }
    stopRaf();
    showResult();
  } else {
    stopRaf();
  }
});

midy.addEventListener("seeked", () => {
  if (mode !== "midi" || gamePhase !== "playing") return;
  worker.postMessage({ type: "start" });
  lastResult = { ...lastResult, score: 0, combo: 0 };
  worker.postMessage({
    type: "tick",
    currentTime: midy.resumeTime - START_DELAY_MIDI,
  });
});

midy.addEventListener("looped", () => {
  if (mode !== "midi") return;
  worker.postMessage({ type: "start" });
  lastResult = {
    score: 0,
    combo: 0,
    perfect: 0,
    great: 0,
    good: 0,
    miss: 0,
    total: laneNotes.length,
  };
});

midy.addEventListener("tempoChanged", () => {
  if (mode !== "midi") return;
  rawNotes = extractNotesFromMidy(midy);
  if (gamePhase !== "playing") {
    applyNotes();
    updatePlayLengthLabels();
  }
});

midy.addEventListener("started", () => midiLibrary.setPlayState("playing"));
midy.addEventListener("resumed", () => midiLibrary.setPlayState("playing"));
midy.addEventListener("paused", () => midiLibrary.setPlayState("paused"));
midy.addEventListener("stopped", () => midiLibrary.setPlayState("stopped"));

// ---------------------------------------------------------------------------
// 音声モード：譜面自動生成（beatmap-worker.js 経由）
// ---------------------------------------------------------------------------

let audioBuffer = null; // decodeAudioData 済みのバッファ（解析用）

function setAnalyzeUI(stage, progress) {
  document.getElementById("analyzingProgressBar").style.width = `${
    Math.round(progress * 100)
  }%`;
  document.getElementById("analyzingStage").textContent = stageLabel(stage);
}
function stageLabel(stage) {
  const known = new Set(["stft", "onset", "tempo", "grid", "notes", "done"]);
  return t(known.has(stage) ? `stage-${stage}` : "stage-default");
}

function audioBufferToMonoLocal(ab) {
  const ch = ab.numberOfChannels;
  if (ch === 1) return ab.getChannelData(0).slice();
  const len = ab.length;
  const out = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const data = ab.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i] / ch;
  }
  return out;
}

function analyze() {
  return new Promise((resolve, reject) => {
    if (!audioBuffer || !beatWorker) {
      reject(new Error(t("audioNotLoaded")));
      return;
    }

    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      pendingAnalysisResolve = pendingAnalysisReject = null;
      reject(
        new Error(t("analyzeTimeout", { seconds: ANALYZE_TIMEOUT_MS / 1000 })),
      );
    }, ANALYZE_TIMEOUT_MS);

    pendingAnalysisResolve = (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(msg);
    };
    pendingAnalysisReject = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(err);
    };

    setAnalyzeUI("stft", 0.02);
    const mono = audioBufferToMonoLocal(audioBuffer);
    beatWorker.postMessage(
      {
        type: "analyze",
        samples: mono,
        sampleRate: audioBuffer.sampleRate,
        difficulty: config.difficulty,
      },
      [mono.buffer],
    );
  });
}

function initBeatWorker() {
  if (beatWorker) beatWorker.terminate();
  beatWorker = new Worker("./beatmap-worker.js", { type: "module" });
  beatWorker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "progress") {
      setAnalyzeUI(msg.stage, msg.progress);
    } else if (msg.type === "result") {
      if (msg.notes.length === 0) {
        pendingAnalysisReject?.(new Error(t("noOnsetDetected")));
        pendingAnalysisResolve = pendingAnalysisReject = null;
        return;
      }
      rawNotes = msg.notes;
      applyNotes();
      notesReady = true;
      notesStale = false;
      pendingAnalysisResolve?.(msg);
      pendingAnalysisResolve = pendingAnalysisReject = null;
    } else if (msg.type === "error") {
      pendingAnalysisReject?.(new Error(msg.message));
      pendingAnalysisResolve = pendingAnalysisReject = null;
    }
  };
  beatWorker.onerror = (err) => {
    console.error("beatmap-worker crashed:", err);
    const message = err?.message
      ? t("analyzeWorkerErrorPrefix") + err.message
      : t("analyzeWorkerErrorUnknown");
    pendingAnalysisReject?.(new Error(message));
    pendingAnalysisResolve = pendingAnalysisReject = null;
  };
}

async function loadAudioFile(file) {
  if (!file) return;
  switchMode("audio");
  const buf = await file.arrayBuffer();
  const ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
  audioBuffer = await ctx.decodeAudioData(buf.slice(0));
  player.src = URL.createObjectURL(file);
  player.load();
  notesReady = false;
  notesStale = true;
  rawNotes = [];
  // ローカル音声にはライブラリ由来の著作権情報がない
  clearTrackMeta();
  buildGame();
  updatePlayLengthLabels();
  showScreen("ready");
}

async function analyzeThenPlay() {
  isAnalyzing = true;
  try {
    buildGame();
    showScreen("analyzing");
    await analyze();
    isAnalyzing = false; // ここで解除してから再度play()しないと自分自身のガードで弾かれる
    player.currentTime = 0;
    await player.play();
  } catch (err) {
    isAnalyzing = false;
    console.error(err);
    alert(t("beatmapGenerationFailedPrefix") + err.message);
    showScreen("ready");
  }
}

player.addEventListener("play", () => {
  if (mode !== "audio") return;
  if (!audioBuffer) {
    player.pause();
    return;
  }
  if (isAnalyzing) {
    player.pause();
    return;
  }

  if (notesStale || !notesReady) {
    suppressPauseHandling = true;
    player.pause();
    analyzeThenPlay();
    return;
  }

  if (gamePhase === "playing") {
    updatePauseUi(false);
    startRaf();
    uiCanvas.focus({ preventScroll: true });
  } else {
    beginPlayback();
  }
});

player.addEventListener("pause", () => {
  if (mode !== "audio") return;
  if (suppressPauseHandling) {
    suppressPauseHandling = false;
    return;
  }
  if (gamePhase === "playing") {
    stopRaf();
    updatePauseUi(true);
  }
});

player.addEventListener("ended", () => {
  if (mode !== "audio") return;
  if (gamePhase === "playing") {
    stopRaf();
    showResult();
  }
});

// 準備完了画面中央の「スタート」ボタン、およびリザルト画面の「もう一度プレイ」ボタン。
// 音声モードはネイティブ <audio> の play()。MIDIモードは startMidiPlayback()
// （split soundfont の読み込み → midy.start()）を直接呼ぶ。

async function startOrReplay() {
  try {
    if (audioContext.state !== "running") await audioContext.resume();
  } catch (err) {
    console.error("audioContext.resume failed:", err);
  }
  if (mode === "audio") {
    player.currentTime = 0;
    player.play().catch((err) => console.error("player.play failed:", err));
  } else if (mode === "midi") {
    try {
      await startMidiPlayback();
    } catch (err) {
      console.error("startMidiPlayback failed:", err);
    }
  }
}

document.getElementById("btnBigStart").addEventListener("click", startOrReplay);
document.getElementById("btnBigReplay").addEventListener(
  "click",
  startOrReplay,
);

// ---------------------------------------------------------------------------
// Background（MIDI/音声共通）
// ---------------------------------------------------------------------------

const backgroundImage = document.getElementById("backgroundImage");
const backgroundVideo = document.getElementById("backgroundVideo");
const VIDEO_EXTS = new Set(["mp4", "webm", "ogv", "ogg", "mov"]);

function hideBackground() {
  backgroundImage.hidden = true;
  backgroundVideo.hidden = true;
  backgroundVideo.pause();
  backgroundVideo.removeAttribute("src");
  backgroundImage.removeAttribute("src");
}
function showImageBackground(src) {
  backgroundVideo.hidden = true;
  backgroundVideo.removeAttribute("src");
  backgroundImage.src = src;
  backgroundImage.hidden = false;
}
function showVideoBackground(src) {
  backgroundImage.hidden = true;
  backgroundImage.removeAttribute("src");
  backgroundVideo.src = src;
  backgroundVideo.hidden = false;
  backgroundVideo.play().catch((err) =>
    console.warn(
      "Background video playback failed (likely autoplay policy):",
      err,
    )
  );
}
function loadBackgroundUrl(url) {
  VIDEO_EXTS.has(url.split(".").pop().toLowerCase())
    ? showVideoBackground(url)
    : showImageBackground(url);
}

// カスタム背景ファイルの永続化（IndexedDB）。
// URL.createObjectURL() の Blob URL はページを閉じると無効になるため、
// リロード後も同じ背景を復元できるよう、ファイル本体を IndexedDB に保存しておく。
// プリセット背景（./data/... のURL）は文字列なので config 経由で localStorage に保存すればよい。
const BG_DB_NAME = "TipTapNotesBackground";
const BG_STORE = "files";
function openBackgroundDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BG_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(BG_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveBackgroundFile(blob) {
  const db = await openBackgroundDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BG_STORE, "readwrite");
    tx.objectStore(BG_STORE).put(blob, "custom");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function loadBackgroundFile() {
  const db = await openBackgroundDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BG_STORE, "readonly");
    const req = tx.objectStore(BG_STORE).get("custom");
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
async function clearBackgroundFile() {
  const db = await openBackgroundDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BG_STORE, "readwrite");
    tx.objectStore(BG_STORE).delete("custom");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 設定モーダル中の背景変更はプレビューのみ。適用ボタンで初めて永続化し、
// キャンセル（hide.bs.modal + configSnapshot あり）では表示も config も元に戻す。
// pendingBackground: null = 未変更 / { preset: string, file?: File }
// （preset は "" | "custom" | プリセットURL）
let pendingBackground = null;
let pendingBackgroundObjectUrl = null;

function revokePendingBackgroundObjectUrl() {
  if (pendingBackgroundObjectUrl) {
    URL.revokeObjectURL(pendingBackgroundObjectUrl);
    pendingBackgroundObjectUrl = null;
  }
}

function setBackgroundSelectValue(preset) {
  const presetEl = document.getElementById("backgroundPreset");
  if (presetEl) presetEl.value = preset || "";
}

/** 表示だけ更新する（config / IndexedDB は触らない） */
function previewBackground(preset, file = null) {
  setBackgroundSelectValue(preset);
  revokePendingBackgroundObjectUrl();
  if (!preset) {
    hideBackground();
    return;
  }
  if (preset === "custom") {
    if (file) {
      pendingBackgroundObjectUrl = URL.createObjectURL(file);
      file.type.startsWith("video/")
        ? showVideoBackground(pendingBackgroundObjectUrl)
        : showImageBackground(pendingBackgroundObjectUrl);
    } else {
      // 保存済みカスタムを表示（キャンセルで元の custom に戻すとき等）
      loadBackgroundFile()
        .then((blob) => {
          if (!blob) {
            hideBackground();
            return;
          }
          pendingBackgroundObjectUrl = URL.createObjectURL(blob);
          blob.type.startsWith("video/")
            ? showVideoBackground(pendingBackgroundObjectUrl)
            : showImageBackground(pendingBackgroundObjectUrl);
        })
        .catch((err) => {
          console.error("背景ファイルの復元に失敗:", err);
          hideBackground();
        });
    }
    return;
  }
  loadBackgroundUrl(preset);
}

/** 適用時: pending を config + IndexedDB に書き込む */
function commitPendingBackground() {
  if (!pendingBackground) return;
  const { preset, file } = pendingBackground;
  config.backgroundPreset = preset;
  if (preset === "custom" && file) {
    saveBackgroundFile(file).catch((err) =>
      console.error("背景ファイルの保存に失敗:", err)
    );
  } else if (!preset) {
    clearBackgroundFile().catch((err) =>
      console.error("背景ファイルの削除に失敗:", err)
    );
  }
  // プリセットURLへ切り替えた場合は IndexedDB の custom をクリアして容量を戻す
  if (preset && preset !== "custom") {
    clearBackgroundFile().catch((err) =>
      console.error("背景ファイルの削除に失敗:", err)
    );
  }
  pendingBackground = null;
  // object URL は表示中に使っているので revoke しない（ページ離脱時に破棄される）
  pendingBackgroundObjectUrl = null;
}

/** キャンセル時: スナップショットの preset 表示へ戻し、pending を破棄 */
function revertPendingBackground(snapshotPreset) {
  pendingBackground = null;
  // file input も空にして、次回同じファイルを選べるようにする
  const fileEl = document.getElementById("backgroundFile");
  if (fileEl) fileEl.value = "";
  previewBackground(snapshotPreset ?? "");
}

document.getElementById("backgroundPreset")?.addEventListener("change", (e) => {
  const v = e.currentTarget.value;
  if (v === "custom") {
    // ファイル選択ダイアログへ。確定は backgroundFile の change、
    // ダイアログキャンセル時は select を pending / config の値に戻す。
    document.getElementById("backgroundFile").click();
    // ダイアログをキャンセルすると change が来ないため、select が "custom" のまま
    // 残るのを防ぐ。既に pending で custom を選んでいればそのまま、
    // そうでなければ直前の確定値（または pending の preset）に戻す。
    const fallback = pendingBackground?.preset ?? config.backgroundPreset ?? "";
    if (fallback !== "custom") {
      // ファイル選択の結果を待ってから、選ばれなかった場合だけ戻す。
      // （change が発火すれば pending が custom になる。発火しなければ戻す）
      const onFocusBack = () => {
        globalThis.removeEventListener("focus", onFocusBack);
        setTimeout(() => {
          if (pendingBackground?.preset !== "custom") {
            setBackgroundSelectValue(
              pendingBackground?.preset ?? config.backgroundPreset ?? "",
            );
          }
        }, 300);
      };
      globalThis.addEventListener("focus", onFocusBack);
    }
    return;
  }
  pendingBackground = { preset: v };
  previewBackground(v);
});
document.getElementById("backgroundFile")?.addEventListener(
  "change",
  (e) => {
    const f = e.target.files[0];
    if (!f) {
      // ファイル未選択（キャンセル相当）→ select を元に戻す
      setBackgroundSelectValue(
        pendingBackground?.preset ?? config.backgroundPreset ?? "",
      );
      return;
    }
    pendingBackground = { preset: "custom", file: f };
    previewBackground("custom", f);
  },
);

// ページ読み込み時、保存されている背景設定を復元してスタート画面にも反映する
async function restoreBackground() {
  const v = config.backgroundPreset;
  if (!v) {
    setBackgroundSelectValue("");
    return;
  }
  if (v === "custom") {
    try {
      const blob = await loadBackgroundFile();
      if (blob) {
        const url = URL.createObjectURL(blob);
        blob.type.startsWith("video/")
          ? showVideoBackground(url)
          : showImageBackground(url);
        setBackgroundSelectValue("custom");
      }
    } catch (err) {
      console.error("背景ファイルの復元に失敗:", err);
    }
  } else {
    loadBackgroundUrl(v);
    setBackgroundSelectValue(v);
  }
}

// ---------------------------------------------------------------------------
// タブの表示/非表示
// バックグラウンドでは AudioContext が suspend されやすく、復帰時に resume しないと
// MIDI の currentTime が進まない。また、表示に戻った瞬間に logic tick を1回走らせて
// 終了判定を取りこぼさないようにする。
// ---------------------------------------------------------------------------
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (audioContext.state === "suspended") {
    audioContext.resume().catch((err) =>
      console.error("audioContext.resume on visibility failed:", err)
    );
  }
  if (gamePhase === "playing" && !isPaused) {
    gameLogicTick();
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

initBeatWorker();
buildGame();
showScreen("start");
restoreBackground();
setTimeout(setWrapHeight, 80);

installIOSTouchGuards({
  surfaceSelector: "#canvasWrap, #uiCanvas, canvas",
  uiSelector: [
    "#topnav",
    ".navbar-brand",
    "#btnPause",
    "#pauseOverlay",
    "#screenStart",
    "#screenReady",
    "#screenAnalyzing",
    "#screenResult",
    ".overlay",
    ".modal",
    ".modal-backdrop",
    "button",
    "a",
    "input",
    "select",
    "textarea",
    "label",
  ].join(", "),
  shouldBlockSurface: () => gamePhase === "playing",
  styleElementId: "iosTouchGuardsStyle",
});
