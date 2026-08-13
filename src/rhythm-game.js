/**
 * rhythm-game.js
 * Rhythm game engine: note thinning, lane assignment, hit judgment, canvas rendering.
 */

// ---------------------------------------------------------------------------
// extractNotesFromMidy
// ---------------------------------------------------------------------------

export function extractNotesFromMidy(midy) {
  const inverseTempo = 1 / midy.tempo;
  const timeline = midy.timeline;
  const notes = [];
  const programs = new Uint8Array(16);
  const active = new Map();

  for (const event of timeline) {
    const sec = event.startTime * inverseTempo;
    switch (event.type) {
      case "programChange":
        if (event.channel != null) {
          programs[event.channel] = event.programNumber ?? 0;
        }
        break;
      case "noteOn": {
        const key = event.channel * 128 + event.noteNumber;
        if (event.velocity === 0) {
          const note = active.get(key);
          if (note) {
            note.endTime = sec;
            active.delete(key);
          }
          break;
        }
        const note = {
          noteNumber: event.noteNumber,
          startTime: sec,
          endTime: sec,
          channel: event.channel,
          programNumber: programs[event.channel],
        };
        notes.push(note);
        active.set(key, note);
        break;
      }
      case "noteOff": {
        const key = event.channel * 128 + event.noteNumber;
        const note = active.get(key);
        if (note) {
          note.endTime = sec;
          active.delete(key);
        }
        break;
      }
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Judgment enum
// ---------------------------------------------------------------------------

export const Judgment = Object.freeze({
  PERFECT: "perfect",
  GREAT: "great",
  GOOD: "good",
  MISS: "miss",
});

// ---------------------------------------------------------------------------
// Difficulty presets
// ---------------------------------------------------------------------------

/**
 * 難易度プリセット
 *
 * 【変更点】以前は minInterval / globalInterval を曲によらず固定の絶対秒数
 * で与えていたため、「高密度曲で実測した NPS」を前提にした値が、密度の低い
 * 曲では全く効かず（間引く対象がそもそも無い＝原曲密度がそのまま出る）、
 * 密度の高い曲では逆に一律の上限にへばりつく、という非対称な効き方をして
 * いた。結果として同じ NORMAL でも曲ごとの体感難易度が大きくばらついていた。
 *
 * 【方針】各譜面の難易度は「NPS（notes/sec）の帯」で定義し、間引きの強さ
 * （minInterval/globalInterval）は曲ごとに二分探索で逆算する。狙う帯は
 * osu!mania のスター評価がレーンごと・時間方向の密度をベースに算出して
 * いる考え方や、BMS 界隈で密度を「16分換算の相当BPM」に正規化して曲間を
 * 比較する難易度表の考え方を参考に、曲の生データの密度に依存しない基準と
 * した。ただし間引きは「削る」方向にしか働かないため、原曲密度が下限NPSに
 * 満たないスカスカな曲は無理に埋めず、その曲で出せる最大密度（＝間引きなし
 * に近い状態）に留める。これは仕様であり、疎な曲を人工的に混雑させない
 * ための意図的な非対称性。
 *
 * NPS目安（曲ごとに二分探索で実測値をこの帯に収める）:
 *   EASY  ≒ 1.0〜1.5 nps — 音ゲー未経験者
 *   BASIC ≒ 2.0〜3.0 nps — カジュアルプレイヤー
 *   NORMAL≒ 4.0〜5.0 nps — 一般的な音ゲーのNORMAL相当
 *   HARD  ≒ 6.0〜10  nps — 上級者向け
 *
 * NPS の測定は単純な「総ノート数/曲長」ではなく、windowSec 秒のスライド窓
 * ごとの密度を取り、その percentile 分位点を代表値とする（measureNps 参照）。
 * これにより「静かなイントロが長い曲」で全体平均が薄まって過小評価される
 * ことを避け、実際にプレイする密度帯に近い値で判定できる。
 *
 * globalIntervalRatio は探索する1変数（同一レーン間隔の基準値 iv）に対して
 * 全体最小間隔をどの比率で連動させるかを表す「形」のパラメータ。EASY/BASIC
 * は同時押しをほぼ許さない性格上わずかに広め（>1）、NORMAL/HARD は同時押し
 * を活かす分だけ全体間隔をやや詰める（<1）。密度の絶対量は targetNps 側が
 * 決めるため、ここは曲間で共通の「難易度ごとの手触り」だけを担う。
 *
 * 【楽器数が増えたときに NORMAL だけ体感難易度が急に上がる件について】
 * 実測してみると、二分探索そのものは連続的で「崖」は無い（候補ノートが
 * 増えるほど出力密度も滑らかに増える）。ただし帯の位置によって見え方が
 * 大きく違う：
 *   - EASY(1.0-1.5)/BASIC(2.0-3.0) は下限が低いので、楽器が1つでも
 *     大抵すぐ頭打ちになり、以降は楽器数を増やしても出力がほぼ変わらない
 *   - NORMAL(4.0-5.0) の下限4.0はちょうど「並の編成では届かないが、
 *     ある程度楽器が重なると届く」領域に位置しやすく、楽器数を増やす
 *     につれて出力密度がなだらかに、しかし目に見えて伸びていく
 *   - HARD(6.0-10.0) はさらに上で、多くの曲では下限にすら届かず頭打ち
 * つまり「NORMALだけ不連続に跳ね上がる」のではなく、「EASY/BASICは
 * どの曲でもすぐ頭打ちで動かず、HARDは逆にどの曲でも頭打ちで動かず、
 * 結果としてNORMALだけが編成の厚みに反応して伸び縮みする」という構図。
 * 曲ごとに実測した絶対密度で難易度を揃えるという設計自体は崩さず、
 * 対処としては以下の2点を反映した：
 *   1. HARD の下限を 6.0→5.0 に下げ、NORMAL の上限(5.0)と隣接させて
 *      「NORMALで頭打ちの曲がHARDでも全く同じ値に張り付く」幅を狭めた
 *      （HARD は excludeDrums:false によりドラムトラック分の候補が
 *      追加されるため、実際の曲ではこの隣接域でも大抵 NORMAL より
 *      いくらか高い値まで伸びる）
 *   2. 曲そのものの密度差（＝楽器の重なり方）が難易度を左右するのは
 *      物理的に避けられない部分なので、それでも急に感じる場合は
 *      NORMAL の帯そのものを曲間でさらに狭める（例:4.0-4.5等）調整も
 *      候補になる（要プレイ感の検証）
 *
 * レーン数によるスケール（thinNotes 内で動的適用、探索前と同じ）:
 *   maxSimultaneous = min(base, ceil(laneCount/2))
 *   minInterval     = iv * clamp(4/laneCount, 0.5, 2.0)
 *   → 少ないレーンほど同一レーンへの連続を減らし、
 *     多いレーンほど指の分散を活かした同時押しを増やす
 */
export const DIFFICULTIES = {
  EASY: {
    label: "EASY",
    minDuration: 0.25, // 250ms未満の短音除外（装飾音・経過音）
    targetNps: [1.0, 1.5],
    globalIntervalRatio: 1.15,
    maxSimultaneous: 1, // 同時押しなし（4レーン基準）
    excludeDrums: true,
  },
  BASIC: {
    label: "BASIC",
    minDuration: 0.15, // 150ms未満除外
    targetNps: [2.0, 3.0],
    globalIntervalRatio: 1.15,
    maxSimultaneous: 2, // 4レーン時は同時2まで
    excludeDrums: true,
  },
  NORMAL: {
    label: "NORMAL",
    minDuration: 0.08, // 80ms未満除外
    targetNps: [4.0, 5.0],
    globalIntervalRatio: 0.9,
    maxSimultaneous: 3, // 4レーン時は同時2まで（ceil(4/2)=2で制限）
    excludeDrums: true,
  },
  HARD: {
    label: "HARD",
    minDuration: 0.04, // 40ms未満のみ除外
    targetNps: [5.0, 10.0],
    globalIntervalRatio: 0.8,
    maxSimultaneous: 4, // レーン数に応じて増加
    excludeDrums: false,
  },
};

// ---------------------------------------------------------------------------
// Note density measurement
// ---------------------------------------------------------------------------

/**
 * windowSec 秒のスライド窓（1秒刻み）でノート数を数え、その percentile
 * 分位点を代表 NPS として返す。単純な平均（総数/曲長）だと、長い無音の
 * イントロ・アウトロや静かな間奏で全体が薄まり、サビなど実際にプレイする
 * 部分の密度感を過小評価してしまうため、分位点ベースにしている。
 * times は startTime 昇順であることを前提とする。
 */
function measureNps(times, duration, windowSec = 4, percentile = 0.7) {
  if (times.length === 0 || duration <= 0) return 0;
  if (duration <= windowSec) return times.length / duration;

  const hopSec = 1;
  const counts = [];
  let left = 0, right = 0;
  for (let t = 0; t + windowSec <= duration; t += hopSec) {
    while (left < times.length && times[left] < t) left++;
    if (right < left) right = left;
    while (right < times.length && times[right] < t + windowSec) right++;
    counts.push(right - left);
  }
  if (counts.length === 0) return times.length / duration;

  counts.sort((a, b) => a - b);
  const idx = Math.min(
    counts.length - 1,
    Math.floor(counts.length * percentile),
  );
  return counts[idx] / windowSec;
}

// ---------------------------------------------------------------------------
// Note thinning
// ---------------------------------------------------------------------------

/** Step 2（レーン割当）のみを取り出した関数。密度の二分探索から繰り返し呼ぶ。 */
function assignLanes(candidates, laneCount, minInterval, globalInterval) {
  const laneLastStart = new Float64Array(laneCount).fill(-1e9);
  const laneLastEnd = new Float64Array(laneCount).fill(-1e9);
  let globalLast = -1e9;
  const result = [];

  for (let ci = 0; ci < candidates.length; ci++) {
    const note = candidates[ci];
    const st = note.startTime;

    if (globalInterval > 0 && st - globalLast < globalInterval) continue;

    const preferred = note.noteNumber % laneCount;
    let bestLane = -1;

    for (let l = 0; l < laneCount; l++) {
      const lane = (preferred + l) % laneCount;
      if (st - laneLastStart[lane] >= minInterval && st >= laneLastEnd[lane]) {
        bestLane = lane;
        break;
      }
    }

    if (bestLane === -1) continue;

    globalLast = st;
    laneLastStart[bestLane] = st;
    laneLastEnd[bestLane] = note.endTime;

    result.push({
      noteNumber: note.noteNumber,
      startTime: st,
      endTime: note.endTime,
      channel: note.channel,
      programNumber: note.programNumber,
      lane: bestLane,
      duration: note.endTime - st,
      hit: false,
      missed: false,
      judgment: null,
    });
  }

  return result;
}

/**
 * candidates（クラスタ選別済みの候補ノート列）に対し、targetNps の帯に
 * 実測密度が収まるよう minInterval/globalInterval を二分探索で決定する。
 * iv（同一レーン間隔の基準値）を単一の探索変数とし、globalInterval は
 * cfg.globalIntervalRatio で連動させる。iv が大きいほど間引きが強くなり
 * 密度は単調非増加になるため、二分探索が成立する。
 * 原曲密度が下限 NPS に満たない場合は iv を下限側で打ち切り、無理に
 * ノートを水増ししない（削る方向にしか働かない設計のため）。
 */
function computeAdaptiveInterval(candidates, laneCount, cfg, laneScale) {
  const [targetMin, targetMax] = cfg.targetNps ?? [4.0, 5.0];
  const globalRatio = cfg.globalIntervalRatio ?? 1.0;

  const duration = candidates.length
    ? candidates[candidates.length - 1].startTime - candidates[0].startTime
    : 0;
  if (duration <= 0) return { minInterval: 0, globalInterval: 0 };

  let lo = 0.01, hi = 2.0;
  for (let iter = 0; iter < 18; iter++) {
    const iv = (lo + hi) / 2;
    const result = assignLanes(
      candidates,
      laneCount,
      iv * laneScale,
      iv * globalRatio,
    );
    const nps = measureNps(result.map((r) => r.startTime), duration);

    if (nps > targetMax) {
      lo = iv; // 密度が高すぎる → もっと間引く（iv を大きく）
    } else if (nps < targetMin) {
      hi = iv; // 密度が低すぎる → 間引きを弱める（iv を小さく）
    } else {
      return { minInterval: iv * laneScale, globalInterval: iv * globalRatio };
    }
  }
  // 帯に収まらず打ち切り：lo（帯を超えない直近の iv）を採用。
  // 原曲が疎な曲では lo ≈ 探索下限に張り付き、間引きはほぼ働かない。
  return { minInterval: lo * laneScale, globalInterval: lo * globalRatio };
}

export function thinNotes(
  notes,
  laneCount = 4,
  difficulty = DIFFICULTIES.NORMAL,
  extraOpts = {},
) {
  const cfg = { ...difficulty, ...extraOpts };
  const {
    minDuration = 0.08,
    excludeDrums = true,
  } = cfg;

  // レーン数によるスケール適用
  // maxSimultaneous: レーンが少ないほど減らす（上限=ceil(laneCount/2)）
  // minInterval: レーンが少ないほど広げる（同一レーン連打防止）
  //   スケール係数 = clamp(4/laneCount, 0.5, 2.0)
  const laneScale = Math.min(2.0, Math.max(0.5, 4 / laneCount));
  const maxSimultaneous = Math.max(
    1,
    Math.min(cfg.maxSimultaneous ?? 2, Math.ceil(laneCount / 2)),
  );

  if (!notes || notes.length === 0) return [];

  // Step 0: pre-filter
  const prefiltered = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (excludeDrums && n.channel === 9) continue;
    if (n.endTime - n.startTime < minDuration) continue;
    prefiltered.push(n);
  }

  // Step 1: cluster within 50ms, keep top maxSimultaneous by importance
  const CLUSTER_WIN = 0.05;
  const candidates = [];
  let i = 0;
  while (i < prefiltered.length) {
    const t = prefiltered[i].startTime;
    let j = i;
    while (
      j < prefiltered.length && prefiltered[j].startTime < t + CLUSTER_WIN
    ) j++;
    if (j - i === 1) {
      // 単音クラスタ：sort 不要
      candidates.push(prefiltered[i]);
    } else {
      const cluster = prefiltered.slice(i, j);
      cluster.sort((a, b) => {
        const durDiff = (b.endTime - b.startTime) - (a.endTime - a.startTime);
        if (Math.abs(durDiff) > 0.05) return durDiff > 0 ? 1 : -1;
        return Math.abs(a.noteNumber - 60) - Math.abs(b.noteNumber - 60);
      });
      const keep = Math.min(maxSimultaneous, cluster.length);
      for (let k = 0; k < keep; k++) candidates.push(cluster[k]);
    }
    i = j;
  }

  // Step 2: lane assignment
  // extraOpts で minInterval/globalInterval が明示指定された場合はそれを
  // そのまま使う（従来通りの手動指定・デバッグ用の抜け道として維持）。
  // 指定が無ければ targetNps の帯に収まるよう曲ごとに自動計算する。
  let minInterval, globalInterval;
  if (extraOpts.minInterval != null && extraOpts.globalInterval != null) {
    minInterval = extraOpts.minInterval * laneScale;
    globalInterval = extraOpts.globalInterval;
  } else {
    ({ minInterval, globalInterval } = computeAdaptiveInterval(
      candidates,
      laneCount,
      cfg,
      laneScale,
    ));
  }

  const result = assignLanes(
    candidates,
    laneCount,
    minInterval,
    globalInterval,
  );

  if (typeof cfg.onDensityMeasured === "function") {
    const duration = candidates.length
      ? candidates[candidates.length - 1].startTime - candidates[0].startTime
      : 0;
    cfg.onDensityMeasured(
      measureNps(result.map((r) => r.startTime), duration),
      cfg.targetNps,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Judgment windows
// ---------------------------------------------------------------------------

export const DEFAULT_JUDGMENT_WINDOWS = {
  perfect: 0.040,
  great: 0.080,
  good: 0.150,
};

/** 塗りつぶしのみのテキスト描画（fillColor で塗る）。 */
function drawText(ctx, text, x, y, fillColor) {
  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);
}
/**
 * "#rrggbb" / "rgb(r,g,b)" 形式の色に任意のアルファを付けて "rgba(r,g,b,a)" にする。
 * レーン区切り線・判定ライン・キーラベル・HUD文字など「白決め打ち」だった
 * UIパーツはここを経由させ、o.uiColor（呼び出し側が currentColor 相当として渡す
 * テーマの文字色）を土台にすることで、ダーク/ライト両テーマで見えるようにする。
 */
function withAlpha(color, alpha) {
  let r, g, b;
  if (color.startsWith("#")) {
    const n = parseInt(color.slice(1), 16);
    r = (n >> 16) & 0xff;
    g = (n >> 8) & 0xff;
    b = n & 0xff;
  } else {
    [r, g, b] = color.match(/\d+/g).map(Number);
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// RhythmGame
// ---------------------------------------------------------------------------

const DEFAULT_LANE_COLORS = [
  "#ff6666",
  "#66ccff",
  "#ffcc66",
  "#66ff99",
  "#cc66ff",
  "#ff9966",
  "#66ffcc",
  "#ff66cc",
];

// 判定FX の定義テーブル（毎フレームのswitch/文字列生成を回避）
// size は論理px（dpr=1基準）。描画時に o.dpr を掛ける。
const FX_TABLE = {
  [Judgment.PERFECT]: { text: "PERFECT", color: "#ffe066", size: 20 },
  [Judgment.GREAT]: { text: "GREAT", color: "#aaffaa", size: 19 },
  [Judgment.GOOD]: { text: "GOOD", color: "#66ccff", size: 17 },
  [Judgment.MISS]: { text: "MISS", color: "#ff6666", size: 16 },
};

export class RhythmGame {
  onJudgment = null;
  onEnded = null;

  #canvas;
  #ctx;
  #pCanvas;
  #pCtx;
  #uiCanvas;
  #uiCtx;
  #opts;
  #notes = [];
  #noteIndex = 0;
  // 描画開始カーソル（resolvedDrawStart の線形スキャンを O(1) に）
  #drawCursor = 0;
  #lanePressed = [];
  #laneLastEmpty = [];
  #judgmentFx = [];
  #fxHead = 0; // ring-buffer head (未使用スロット削減)
  #particles = [];
  #score = 0;
  #combo = 0;
  #maxCombo = 0;
  #judgedNotes = 0;
  #perfectCount = 0;
  #greatCount = 0;
  #goodCount = 0;
  #missCount = 0;
  #getTime = null;
  #animId = null;
  #lastFrameMs = 0;
  #lastTickTime = 0;
  #boundLoop = this.#loop.bind(this);

  // キャッシュ（フレームをまたいで再利用）
  #cachedW = 0;
  #cachedH = 0;
  #cachedHitY = 0;
  #cachedLaneW = 0;
  #cachedBtnFont = "";
  #cachedHUDFont = "";
  #cachedComboFont = "";
  #uiDirty = true; // UIレイヤーの再描画フラグ

  constructor(canvas, options = {}) {
    if (canvas && typeof canvas === "object" && "note" in canvas) {
      this.#canvas = canvas.note;
      this.#pCanvas = canvas.particle;
      this.#uiCanvas = canvas.ui;
    } else {
      this.#canvas = this.#pCanvas = this.#uiCanvas = canvas;
    }
    this.#ctx = this.#canvas.getContext("2d");
    this.#pCtx = this.#pCanvas.getContext("2d");
    this.#uiCtx = this.#uiCanvas.getContext("2d");

    const laneCount = options.laneCount ?? 4;
    // dpr: canvas バッファは CSS サイズ × dpr。論理px（dpr=1基準）の定数は
    // 描画時に dpr を掛けて、高DPIでも見た目サイズが PC と同じになるようにする。
    const dpr = Number(options.dpr) > 0 ? Number(options.dpr) : 1;
    this.#opts = {
      laneCount,
      dpr,
      glow: options.glow ?? false,
      // レーン（判定ボタン部分）の背景・境界線の不透明度スケール（1.0=デフォルトの強さ）。
      // ノート自体は常に不透明固定なので、これはレーン側だけの見え方を調整する
      // 独立した設定。
      laneOpacity: options.laneOpacity ?? 1.0,
      // scrollSpeed / noteHeight は論理px（dpr=1基準）。描画・落下計算で dpr を掛ける。
      scrollSpeed: options.scrollSpeed ?? 500,
      noteHeight: options.noteHeight ?? 36,
      buttonZoneHeight: options.buttonZoneHeight ?? 80,
      laneColors: options.laneColors ?? DEFAULT_LANE_COLORS.slice(0, laneCount),
      keys: options.keys ?? ["d", "f", "j", "k"],
      // レーン区切り線・判定ライン・キーラベル・HUD文字などの土台色。
      // CSS の currentColor 相当。呼び出し側（メインスレッド）でテーマの文字色
      // （例: getComputedStyle(document.body).color）を渡してもらう想定で、
      // 未指定時は従来どおり白（ダーク背景前提）にフォールバックする。
      uiColor: options.uiColor ?? "#ffffff",
      // 判定ライン専用の色。"" なら uiColor（テーマ文字色）にフォールバックする。
      judgeLineColor: options.judgeLineColor ?? "",
      // レーンキーラベル（ASDF等）の待機時の文字色。"" なら uiColor にフォールバックする。
      // 押下中はレーン色で表示するため、accentColor は待機時のみ影響する。
      accentColor: options.accentColor ?? "",
      // レーン区切り線（境界線・疑似床グラデーション）専用の色。
      // "" なら uiColor にフォールバックする。背景画像によっては uiColor だけでは
      // コントラストが足りず線が見えなくなることがあるため、独立して指定できるようにしている。
      laneLineColor: options.laneLineColor ?? "",
      windows: options.judgmentWindows ?? DEFAULT_JUDGMENT_WINDOWS,
      judgeOffset: options.judgeOffset ?? 0, // 秒 (正=遅く, 負=早く)
      startDelay: options.startDelay ?? 0, // 秒 (midy.startDelayと合わせる)
      totalNotes: 0,
      difficulty: options.difficulty ?? DIFFICULTIES.NORMAL,
      thinExtra: options.thinExtra ?? {},
      perspective: options.perspective ?? 0.78, // 0=平面, 1=強い遠近感
      // ホスト側（canvas の上に浮く透過ナビ等）が右上 HUD と重ならないように
      // 避けてほしい量。canvas 座標系（dpr込み）でのpx。0=従来通り詰める。
      topInset: options.topInset ?? 0,
    };
    this.#lanePressed = new Array(laneCount).fill(false);
    this.#laneLastEmpty = new Float64Array(laneCount).fill(-1e9);
  }

  // ---- Public API ---------------------------------------------------------

  setNotesRaw(laneNotes) {
    this.#notes = laneNotes;
    this.#noteIndex = 0;
    this.#drawCursor = 0;
    this.#opts.totalNotes = laneNotes.length;
    return laneNotes.length;
  }

  resetState() {
    this.#resetState();
  }

  setNotes(notes) {
    this.#notes = thinNotes(
      notes.slice().sort((a, b) => a.startTime - b.startTime),
      this.#opts.laneCount,
      this.#opts.difficulty,
      this.#opts.thinExtra,
    );
    this.#noteIndex = 0;
    this.#drawCursor = 0;
    this.#opts.totalNotes = this.#notes.length;
    return this.#notes.length;
  }

  start(getTime) {
    this.#resetState();
    this.#getTime = getTime ??
      (() => (performance.now() - this.#lastFrameMs) / 1000);
    this.#lastFrameMs = performance.now();
    this.#loop();
  }

  tick(t) {
    const now = performance.now();
    // pause 中は #lastFrameMs が止まったままなので再開後の dt が巨大になる。
    // 1フレーム分（約33ms）を上限にクランプして正常な範囲に保つ。
    const dt = Math.min((now - this.#lastFrameMs) / 1000, 0.033);
    this.#lastFrameMs = now;
    this.#lastTickTime = t;
    this.#checkMisses(t);
    this.#updateFx(dt);
    this.#draw(t);
    if (this.#noteIndex >= this.#notes.length && this.#particles.length === 0) {
      this.onEnded?.();
    }
  }

  stop() {
    if (this.#animId) {
      cancelAnimationFrame(this.#animId);
      this.#animId = null;
    }
    this.#getTime = null;
  }

  // pressedAt: メインスレッドがキー押下瞬間に記録した currentGameTime()
  //             渡されない場合は #lastTickTime にフォールバック
  pressLane(lane, pressedAt) {
    if (lane < 0 || lane >= this.#opts.laneCount || this.#lanePressed[lane]) {
      return;
    }
    this.#lanePressed[lane] = true;
    this.#uiDirty = true;
    const base = pressedAt !== undefined
      ? pressedAt
      : this.#getTime
      ? this.#getTime()
      : this.#lastTickTime;
    const t = base + (this.#opts.judgeOffset ?? 0);
    if (t >= 0) this.#judgePress(lane, t);
  }

  releaseLane(lane) {
    if (lane < 0 || lane >= this.#opts.laneCount) return;
    this.#lanePressed[lane] = false;
    this.#uiDirty = true;
  }

  resize(w, h, extra = {}) {
    this.#canvas.width = w;
    this.#canvas.height = h;
    if (this.#pCanvas !== this.#canvas) {
      this.#pCanvas.width = w;
      this.#pCanvas.height = h;
    }
    if (this.#uiCanvas !== this.#canvas) {
      this.#uiCanvas.width = w;
      this.#uiCanvas.height = h;
    }
    if (extra.topInset !== undefined) {
      this.#opts.topInset = extra.topInset;
    }
    if (extra.buttonZoneHeight !== undefined) {
      this.#opts.buttonZoneHeight = extra.buttonZoneHeight;
    }
    if (extra.dpr !== undefined && Number(extra.dpr) > 0) {
      this.#opts.dpr = Number(extra.dpr);
    }
    this.#invalidateCache();
  }

  updateOptions(patch = {}) {
    let dirty = false;
    if (patch.scrollSpeed !== undefined) {
      this.#opts.scrollSpeed = patch.scrollSpeed;
      dirty = true;
    }
    if (patch.noteHeight !== undefined) {
      this.#opts.noteHeight = patch.noteHeight;
      dirty = true;
    }
    if (patch.dpr !== undefined && Number(patch.dpr) > 0) {
      this.#opts.dpr = Number(patch.dpr);
      dirty = true;
    }
    if (patch.laneColors !== undefined) {
      this.#opts.laneColors = patch.laneColors;
      dirty = true;
    }
    if (patch.keys !== undefined) {
      this.#opts.keys = patch.keys;
      dirty = true;
    }
    if (patch.glow !== undefined) {
      this.#opts.glow = patch.glow;
      dirty = true;
    }
    if (patch.laneOpacity !== undefined) {
      this.#opts.laneOpacity = patch.laneOpacity;
      dirty = true;
    }
    if (patch.perspective !== undefined) {
      this.#opts.perspective = patch.perspective;
      dirty = true;
    }
    if (patch.uiColor !== undefined) {
      this.#opts.uiColor = patch.uiColor;
      dirty = true;
    }
    if (patch.judgeLineColor !== undefined) {
      this.#opts.judgeLineColor = patch.judgeLineColor;
      dirty = true;
    }
    if (patch.accentColor !== undefined) {
      this.#opts.accentColor = patch.accentColor;
      dirty = true;
    }
    if (patch.laneLineColor !== undefined) {
      this.#opts.laneLineColor = patch.laneLineColor;
      dirty = true;
    }
    if (patch.topInset !== undefined) {
      this.#opts.topInset = patch.topInset;
      dirty = true;
    }
    if (patch.buttonZoneHeight !== undefined) {
      this.#opts.buttonZoneHeight = patch.buttonZoneHeight;
      dirty = true;
    }
    if (patch.judgeOffset !== undefined) {
      this.#opts.judgeOffset = patch.judgeOffset;
    }
    if (patch.judgmentWindows !== undefined) {
      this.#opts.windows = { ...this.#opts.windows, ...patch.judgmentWindows };
    }
    if (dirty) {
      this.#invalidateCache();
      this.#uiDirty = true;
    }
  }

  get score() {
    return this.#score;
  }
  get combo() {
    return this.#combo;
  }
  get maxCombo() {
    return this.#maxCombo;
  }
  get totalNotes() {
    return this.#notes.length;
  }
  get judgedNotes() {
    return this.#judgedNotes;
  }
  get perfectCount() {
    return this.#perfectCount;
  }
  get greatCount() {
    return this.#greatCount;
  }
  get goodCount() {
    return this.#goodCount;
  }
  get missCount() {
    return this.#missCount;
  }
  get laneCount() {
    return this.#opts.laneCount;
  }
  get notes() {
    return this.#notes;
  }
  get accuracy() {
    if (!this.#judgedNotes) return 100;
    return (this.#perfectCount * 100 + this.#greatCount * 80 +
      this.#goodCount * 50) /
      this.#judgedNotes;
  }

  // ---- Private: reset / loop ---------------------------------------------

  #resetState() {
    this.#score = this.#combo = this.#maxCombo = 0;
    this.#judgedNotes =
      this.#perfectCount =
      this.#greatCount =
      this.#goodCount =
      this.#missCount =
        0;
    this.#noteIndex = 0;
    this.#drawCursor = 0;
    this.#lastTickTime = 0;
    this.#judgmentFx = [];
    this.#particles = [];
    this.#uiDirty = true;
    this.#lanePressed.fill(false);
    this.#laneLastEmpty.fill(-1e9);
    for (let i = 0; i < this.#notes.length; i++) {
      const n = this.#notes[i];
      n.hit = false;
      n.missed = false;
      n.judgment = null;
    }
  }

  #invalidateCache() {
    this.#cachedW = 0; // force recalculation
    this.#uiDirty = true;
  }

  #loop() {
    if (!this.#getTime) return;
    const now = performance.now();
    const dt = Math.min((now - this.#lastFrameMs) / 1000, 0.033);
    this.#lastFrameMs = now;
    const t = this.#getTime();
    this.#checkMisses(t);
    this.#updateFx(dt);
    this.#draw(t);
    if (this.#noteIndex >= this.#notes.length && this.#particles.length === 0) {
      this.stop();
      this.onEnded?.();
      return;
    }
    this.#animId = requestAnimationFrame(this.#boundLoop);
  }

  // ---- Private: judgment -------------------------------------------------

  #checkMisses(t) {
    const notes = this.#notes;
    const winGood = this.#opts.windows.good;
    while (this.#noteIndex < notes.length) {
      const note = notes[this.#noteIndex];
      if (t <= note.startTime + winGood) break;
      if (!note.hit) this.#applyJudgment(Judgment.MISS, note);
      this.#noteIndex++;
    }
  }

  #judgePress(lane, t) {
    const win = this.#opts.windows;
    const notes = this.#notes;
    let bestIdx = -1, bestDist = Infinity;
    const start = Math.max(0, this.#noteIndex);
    const limit = win.good + 0.05;

    for (let i = start; i < notes.length; i++) {
      const note = notes[i];
      if (note.startTime - t > limit) break;
      if (note.hit || note.missed || note.lane !== lane) continue;
      const dist = Math.abs(t - note.startTime);
      if (dist <= win.good && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      const last = this.#laneLastEmpty[lane];
      if (t - last < win.good) return;
      this.#laneLastEmpty[lane] = t;
      this.#combo = 0;
      this.#judgmentFx.push({ judgment: Judgment.MISS, lane, alpha: 1.0 });
      this.#uiDirty = true;
      return;
    }

    const note = notes[bestIdx];
    const judgment = bestDist <= win.perfect
      ? Judgment.PERFECT
      : bestDist <= win.great
      ? Judgment.GREAT
      : Judgment.GOOD;

    note.hit = true;
    this.#applyJudgment(judgment, note);
    this.#spawnParticles(lane, judgment);
  }

  #applyJudgment(judgment, note) {
    note.judgment = judgment;
    const basePerNote = this.#opts.totalNotes > 0
      ? 1_000_000 / this.#opts.totalNotes
      : 0;
    if (judgment === Judgment.MISS) {
      note.missed = true;
      this.#combo = 0;
      this.#missCount++;
    } else {
      this.#combo++;
      if (this.#combo > this.#maxCombo) this.#maxCombo = this.#combo;
      let ratio = 0;
      if (judgment === Judgment.PERFECT) {
        ratio = 1.00;
        this.#perfectCount++;
      } else if (judgment === Judgment.GREAT) {
        ratio = 0.80;
        this.#greatCount++;
      } else {
        ratio = 0.50;
        this.#goodCount++;
      }
      this.#score = Math.round(this.#score + basePerNote * ratio);
    }
    this.#judgedNotes++;
    this.#judgmentFx.push({ judgment, lane: note.lane, alpha: 1.0 });
    this.#uiDirty = true;
    this.onJudgment?.(judgment, this.#combo, this.#score);
  }

  // ---- Private: FX -------------------------------------------------------

  #updateFx(dt) {
    // in-place decay（filter で配列生成しない）
    let w = 0;
    for (let i = 0; i < this.#judgmentFx.length; i++) {
      const fx = this.#judgmentFx[i];
      fx.alpha -= dt * 2.0;
      if (fx.alpha > 0) {
        this.#judgmentFx[w++] = fx;
        this.#uiDirty = true;
      }
    }
    this.#judgmentFx.length = w;
    this.#updateParticles(dt);
  }

  #spawnParticles(lane, judgment) {
    const laneW = this.#canvas.width / this.#opts.laneCount;
    const x = lane * laneW + laneW / 2;
    const y = this.#canvas.height - this.#opts.buttonZoneHeight;
    const color = this.#opts.laneColors[lane % this.#opts.laneColors.length];
    const d = this.#opts.dpr || 1;

    // 判定の良さでエフェクトの規模を変える（PERFECTが一番派手）
    // 速度・サイズは論理px基準 × dpr（高DPIでも見た目の広がりが同じになる）
    const tier = judgment === Judgment.PERFECT
      ? 2
      : judgment === Judgment.GREAT
      ? 1
      : 0;
    const burstCount = 10 + tier * 4; // 10 / 14 / 18
    const shardCount = 6 + tier * 4; //  6 / 10 / 14
    const sparkCount = 2 + tier * 2; //  2 /  4 /  6
    const ringMax = (42 + tier * 16) * d; // 42 / 58 / 74

    // 1) 放射状バースト（丸い光の粒）
    for (let k = 0; k < burstCount; k++) {
      const ang = Math.random() * 6.2832;
      const spd = (120 + Math.random() * 260) * d;
      const life = 0.35 + Math.random() * 0.45;
      this.#particles.push({
        type: "burst",
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 90 * d,
        life,
        maxLife: life,
        color,
        size: (3 + Math.random() * 4) * d,
      });
    }

    // 2) シャード：回転しながら飛び散る菱形の破片（弾けた質感を出す）
    for (let k = 0; k < shardCount; k++) {
      const ang = Math.random() * 6.2832;
      const spd = (180 + Math.random() * 300) * d;
      const life = 0.28 + Math.random() * 0.35;
      this.#particles.push({
        type: "shard",
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 60 * d,
        life,
        maxLife: life,
        color,
        w: (3 + Math.random() * 3) * d,
        h: (9 + Math.random() * 10) * d,
        rot: Math.random() * 6.2832,
        rotSpeed: (Math.random() - 0.5) * 18,
      });
    }

    // 3) 衝撃波リング：ヒット位置から一瞬で広がって消える光の輪
    const ringLife = 0.28 + tier * 0.05;
    this.#particles.push({
      type: "ring",
      x,
      y,
      life: ringLife,
      maxLife: ringLife,
      color,
      maxRadius: ringMax,
    });

    // 4) スパーク：外側へ速く飛ぶ短い光の線（トレイル表現）
    for (let k = 0; k < sparkCount; k++) {
      const ang = Math.random() * 6.2832;
      const spd = (380 + Math.random() * 220) * d;
      const life = 0.16 + Math.random() * 0.12;
      this.#particles.push({
        type: "spark",
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life,
        maxLife: life,
        color,
      });
    }

    // 5) レーンビーム：レーンの端から端まで（幅いっぱい）光が一瞬上に伸びて消える
    const beamLife = 0.14 + tier * 0.04;
    this.#particles.push({
      type: "beam",
      x,
      y,
      lane,
      life: beamLife,
      maxLife: beamLife,
      color,
      height: (110 + tier * 60) * d,
    });

    // 6) インパクトスパイク：8方向に固定で伸びる星形フラッシュ（弾けた瞬間の「ズドン」感）
    const spikeCount = 8;
    const spikeLen = (34 + tier * 14) * d;
    const spikeLife = 0.16 + tier * 0.03;
    const spikeJitter = (Math.random() - 0.5) * 0.3; // 毎回同じ形にならないよう回転をわずかにずらす
    for (let k = 0; k < spikeCount; k++) {
      const ang = (k / spikeCount) * 6.2832 + spikeJitter;
      this.#particles.push({
        type: "spike",
        x,
        y,
        angle: ang,
        length: spikeLen,
        life: spikeLife,
        maxLife: spikeLife,
        color,
      });
    }

    // 7) PERFECT限定：中心が一瞬白く強く光るフラッシュ
    if (tier === 2) {
      this.#particles.push({
        type: "flash",
        x,
        y,
        life: 0.12,
        maxLife: 0.12,
        color: "#ffffff",
        radius: 46 * d,
      });
    }
  }

  #updateParticles(dt) {
    const g = 480 * (this.#opts.dpr || 1) * dt;
    let w = 0;
    for (let i = 0; i < this.#particles.length; i++) {
      const p = this.#particles[i];
      switch (p.type) {
        case "spark":
          // 空気抵抗で急減速させ、短い光跡らしい動きにする
          p.vx *= 1 - 6 * dt;
          p.vy *= 1 - 6 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          break;
        case "shard":
          p.vy += g * 0.6;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.rotSpeed * dt;
          break;
        case "ring":
        case "flash":
        case "beam":
        case "spike":
          // 位置は固定。life の減少だけで拡大／消滅を表現する
          break;
        case "burst":
        default:
          p.vy += g;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          break;
      }
      p.life -= dt;
      if (p.life > 0) this.#particles[w++] = p;
    }
    this.#particles.length = w;
  }

  // ---- Private: drawing --------------------------------------------------

  #draw(t) {
    const W = this.#canvas.width;
    const H = this.#canvas.height;
    const o = this.#opts;

    // キャッシュ更新（リサイズ時のみ再計算）
    // フォントサイズは論理px基準 × dpr で、高DPIでも CSS 上の見た目が同じになるようにする。
    if (W !== this.#cachedW || H !== this.#cachedH) {
      this.#cachedW = W;
      this.#cachedH = H;
      this.#cachedHitY = H - o.buttonZoneHeight;
      this.#cachedLaneW = W / o.laneCount;
      const d = o.dpr || 1;
      this.#cachedBtnFont = `bold ${
        Math.min(22 * d, this.#cachedLaneW * 0.28).toFixed(0)
      }px monospace`;
      this.#cachedHUDFont = `bold ${
        Math.min(26 * d, W * 0.05).toFixed(0)
      }px monospace`;
      this.#cachedComboFont = `bold ${
        Math.min(44 * d, W * 0.09).toFixed(0)
      }px sans-serif`;
      this.#uiDirty = true;
    }

    const hitY = this.#cachedHitY;
    const laneW = this.#cachedLaneW;
    const btnBot = hitY + o.buttonZoneHeight;

    // ノートレイヤー（毎フレーム）
    // ボタンもここに描くことで、missノートが後から重なり突き抜けて見える
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, W, H);
    this.#drawLaneSeparators(ctx, W, H, laneW, hitY, btnBot, o);
    this.#drawButtons(ctx, laneW, hitY, H, W, btnBot, o);
    this.#drawNotes(ctx, t, laneW, hitY, H, btnBot, o);

    // パーティクルレイヤー（毎フレーム）
    const pCtx = this.#pCtx;
    pCtx.clearRect(0, 0, W, H);
    if (this.#particles.length > 0) this.#drawParticles(pCtx, o);

    // UIレイヤー（状態変化時のみ）: HUD・判定FXのみ
    if (this.#uiDirty) {
      const uCtx = this.#uiCtx;
      uCtx.clearRect(0, 0, W, H);
      this.#drawJudgmentFx(uCtx, laneW, hitY, o);
      this.#drawHUD(uCtx, W, H, o);
      this.#uiDirty = false;
    }
  }

  // ---- Perspective helpers ------------------------------------------------
  // perspScale(y, hitY, p): y位置でのX方向スケール (p=0:変換なし, p=1:最大)
  #perspScale(y, hitY, p) {
    if (!p) return 1;
    const t = y / hitY;
    return 1 - p + p * t;
  }

  // 基準点を btnBot（画面最下端）にしてパース計算
  // y=btnBot → scale=1 → フル幅（左端0、右端W）
  // y=0      → scale=1-p → 中央に収束
  #perspX(laneIdx, laneW, W, y, hitY, p, btnBot) {
    const xFull = laneIdx * laneW; // laneW=W/N なので l=0→0, l=N→W
    if (!p) return xFull;
    const ref = btnBot ?? hitY; // 基準Y（ここでscale=1）
    const cx = W / 2;
    const sc = 1 - p + p * (y / ref);
    return cx + (xFull - cx) * sc;
  }

  #perspLaneW(laneW, _W, y, hitY, p, btnBot) {
    if (!p) return laneW;
    const ref = btnBot ?? hitY;
    return laneW * (1 - p + p * (y / ref));
  }

  #drawLaneSeparators(ctx, W, _H, laneW, hitY, btnBot, o) {
    const p = o.perspective ?? 0;
    const d = o.dpr || 1;
    // レーン区切り線・疑似床グラデーション用の色（未設定なら uiColor にフォールバック）
    const lineColor = o.laneLineColor || o.uiColor;
    // laneOpacity と連動させる。元は 0.10 固定で、レーンの不透明度設定を変えても
    // ほとんど見た目が変わらなかったため、0(透明)〜1(最大)でしっかり差が出る値にする。
    const t = Math.max(0, Math.min(1, o.laneOpacity ?? 0.35));

    // 外枠・内側境界線
    // 下端 = btnBot（画面最下端）で左端0・右端W、上端 y=0 で中央に収束
    ctx.strokeStyle = withAlpha(lineColor, 0.35 * t);
    ctx.lineWidth = 1 * d;
    for (let l = 0; l <= o.laneCount; l++) {
      const xBot = l === 0
        ? 0
        : l === o.laneCount
        ? W
        : this.#perspX(l, laneW, W, btnBot, hitY, p, btnBot);
      const xTop = this.#perspX(l, laneW, W, 0, hitY, p, btnBot);
      ctx.beginPath();
      ctx.moveTo(xBot, btnBot);
      ctx.lineTo(xTop, 0);
      ctx.stroke();
    }

    // 疑似床グラデーション
    if (p > 0) {
      const xTopL = this.#perspX(0, laneW, W, 0, hitY, p, btnBot);
      const xTopR = this.#perspX(o.laneCount, laneW, W, 0, hitY, p, btnBot);
      const grad = ctx.createLinearGradient(0, 0, 0, btnBot);
      grad.addColorStop(0, withAlpha(lineColor, 0.0));
      grad.addColorStop(1, withAlpha(lineColor, 0.14 * t));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(xTopL, 0);
      ctx.lineTo(xTopR, 0);
      ctx.lineTo(W, btnBot);
      ctx.lineTo(0, btnBot);
      ctx.closePath();
      ctx.fill();
    }

    // 常時発光する判定ライン（judgeLineColor 未設定時は uiColor にフォールバック）
    const judgeColor = o.judgeLineColor || o.uiColor;
    ctx.save();
    ctx.shadowColor = withAlpha(judgeColor, 0.9);
    ctx.shadowBlur = 18 * d;
    ctx.strokeStyle = withAlpha(judgeColor, 0.92);
    ctx.lineWidth = 3 * d;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(W, hitY);
    ctx.stroke();
    ctx.shadowBlur = 36 * d;
    ctx.strokeStyle = withAlpha(judgeColor, 0.35);
    ctx.lineWidth = 7 * d;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(W, hitY);
    ctx.stroke();
    ctx.restore();
  }

  #drawNotes(ctx, t, laneW, hitY, H, btnBot, o) {
    const notes = this.#notes;
    const d = o.dpr || 1;
    // scrollSpeed / noteHeight は論理px基準 → canvas 座標では dpr 倍
    const speed = o.scrollSpeed * d;
    const lookahead = H / speed + 0.3 + (o.startDelay ?? 0);
    // drawCursorスキップ判定用: 画面下端より下まで落下したノートを確認する秒数
    // const trailSec  = (H + o.buttonZoneHeight) / speed;

    // drawCursor スキップ条件:
    //   hit済み  → 即スキップ
    //   miss/未hit → startTime のY座標が画面底を抜けるまで保持
    while (this.#drawCursor < notes.length) {
      const n = notes[this.#drawCursor];
      if (n.hit) {
        this.#drawCursor++;
        continue;
      }
      const yBotTail = hitY - (n.startTime - t) * speed;
      if (yBotTail <= H) break;
      this.#drawCursor++;
    }

    const glow = o.glow;
    const laneColors = o.laneColors;
    const laneColorLen = laneColors.length;
    const noteHeight = o.noteHeight * d;
    const cW = this.#canvas.width;
    const p = o.perspective ?? 0;
    const pad = Math.max(2 * d, laneW * 0.05);

    const prevAlpha = ctx.globalAlpha;
    const prevShadow = ctx.shadowBlur;
    ctx.shadowBlur = glow ? 14 * d : 0;

    // 台形ノートを描くヘルパー（p=0 のとき roundRect にフォールバック）
    const drawTrap = (laneIdx, yTop, yBot, fillStyle, alpha, r) => {
      const scBot = this.#perspScale(yBot, hitY, p);
      const scTop = this.#perspScale(yTop, hitY, p);
      const xBotL = this.#perspX(laneIdx, laneW, cW, yBot, hitY, p, btnBot) +
        pad * scBot;
      const xBotR =
        this.#perspX(laneIdx + 1, laneW, cW, yBot, hitY, p, btnBot) -
        pad * scBot;
      const xTopL = this.#perspX(laneIdx, laneW, cW, yTop, hitY, p, btnBot) +
        pad * scTop;
      const xTopR =
        this.#perspX(laneIdx + 1, laneW, cW, yTop, hitY, p, btnBot) -
        pad * scTop;
      if (xBotR <= xBotL || xTopR <= xTopL) return;
      ctx.globalAlpha = alpha < 0 ? 0 : alpha;
      ctx.fillStyle = fillStyle;
      if (!p) {
        const h = yBot - yTop;
        ctx.beginPath();
        ctx.roundRect(
          xBotL,
          yTop,
          xBotR - xBotL,
          h,
          Math.min(r, (xBotR - xBotL) / 2, h / 2),
        );
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(xBotL, yBot);
        ctx.lineTo(xBotR, yBot);
        ctx.lineTo(xTopR, yTop);
        ctx.lineTo(xTopL, yTop);
        ctx.closePath();
        ctx.fill();
      }
    };

    for (let i = this.#drawCursor; i < notes.length; i++) {
      const note = notes[i];

      // hit済み → 描画不要
      if (note.hit) continue;

      const dt = note.startTime - t;
      if (dt > lookahead) break;

      const yBot = hitY - (note.startTime - t) * speed;

      if (yBot < 0) continue;

      const color = laneColors[note.lane % laneColorLen];
      const laneIdx = note.lane;
      const botNoteW = this.#perspLaneW(laneW, cW, yBot, hitY, p, btnBot) -
        pad * 2 * this.#perspScale(yBot, hitY, p);
      const r = Math.min(8 * d, botNoteW / 2);

      ctx.shadowColor = color;

      // ── miss / 判定ライン通過後の未hitノート ─────────────────────────
      if (note.missed || (!note.hit && yBot > hitY)) {
        const drawBot = yBot > H ? H : yBot;
        // 通過後もfixed高さのまま（duration由来の長さにしない）
        const drawTop = Math.max(0, drawBot - noteHeight);
        if (drawBot <= drawTop) continue;
        drawTrap(laneIdx, drawTop, drawBot, color, 0.55, r);
        continue;
      }

      // ── 通常（未hit タップノート） ──────────────────────
      const drawBot = yBot > hitY ? hitY : yBot;
      if (drawBot <= 0) continue;

      // 実際の duration に関わらず、見た目の高さは固定（noteHeight）。
      // 実演奏データでは noteOff と次の noteOn がほぼ密着しているケースが多く、
      // duration をそのまま長さにすると隣接ノート同士がくっついて見えてしまうため、
      // タップは常に短い固定長で描く。
      const tapBot = drawBot;
      const tapTop = Math.max(0, tapBot - noteHeight);
      drawTrap(laneIdx, tapTop, tapBot, color, 1, r);
      ctx.shadowBlur = glow ? 14 * d : 0;
    }

    ctx.globalAlpha = prevAlpha;
    ctx.shadowBlur = prevShadow;
  }

  #drawButtons(ctx, laneW, hitY, _H, W, btnBot, o) {
    const btnH = o.buttonZoneHeight;
    const glow = o.glow;
    const colors = o.laneColors;
    const font = this.#cachedBtnFont;
    const p = o.perspective ?? 0;
    const d = o.dpr || 1;
    // レーンの不透明度は 0(完全に透明)〜1(最大まで濃く)の通常の opacity と同じ考え方。
    // 元の16進アルファ決め打ち値（0d/44/40/88/22/cc 等）はどれも薄めだったため、
    // 1.0 のときにしっかり見える強さまで届くよう目標値を引き上げてある。
    const t = Math.max(0, Math.min(1, o.laneOpacity ?? 0.35));
    const fillIdleA = t * 0.6;
    const borderIdleA = t * 0.9;
    const fillPressedA = t * 0.75;
    const gradTopA = t * 0.9;
    const gradBottomA = t * 0.25;
    const borderPressedA = t;

    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // ボタン下端: 0〜W にフル幅で均等配置（フィールドの逆、外側に広がる）
    for (let l = 0; l < o.laneCount; l++) {
      const color = colors[l % colors.length];
      const pressed = this.#lanePressed[l];

      const topL = this.#perspX(l, laneW, W, hitY, hitY, p, btnBot);
      const topR = this.#perspX(l + 1, laneW, W, hitY, hitY, p, btnBot);
      const botL = this.#perspX(l, laneW, W, btnBot, hitY, p, btnBot);
      const botR = this.#perspX(l + 1, laneW, W, btnBot, hitY, p, btnBot);

      const trapPath = () => {
        ctx.beginPath();
        ctx.moveTo(topL, hitY);
        ctx.lineTo(topR, hitY);
        ctx.lineTo(botR, btnBot);
        ctx.lineTo(botL, btnBot);
        ctx.closePath();
      };

      if (pressed) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = (glow ? 30 : 12) * d;
        ctx.fillStyle = withAlpha(color, fillPressedA);
        trapPath();
        ctx.fill();
        const grad = ctx.createLinearGradient(0, hitY, 0, btnBot);
        grad.addColorStop(0, withAlpha(color, gradTopA));
        grad.addColorStop(0.4, withAlpha(color, gradBottomA));
        grad.addColorStop(1, "transparent");
        ctx.shadowBlur = 0;
        ctx.fillStyle = grad;
        trapPath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = withAlpha(color, fillIdleA);
        trapPath();
        ctx.fill();
      }

      // レーン境界線（全境界: 0〜laneCount）
      ctx.strokeStyle = withAlpha(
        color,
        pressed ? borderPressedA : borderIdleA,
      );
      ctx.lineWidth = 1 * d;
      // 左辺
      ctx.beginPath();
      ctx.moveTo(topL, hitY);
      ctx.lineTo(botL, btnBot);
      ctx.stroke();
      // 最右端レーンだけ右辺も
      if (l === o.laneCount - 1) {
        ctx.beginPath();
        ctx.moveTo(topR, hitY);
        ctx.lineTo(botR, btnBot);
        ctx.stroke();
      }

      // キーラベル：台形重心
      const cx = (topL + topR + botL + botR) / 4;
      const cy = hitY + btnH / 2;
      // 待機中は accentColor（設定可能・未設定なら uiColor）、押下中はレーン色で発光。
      ctx.shadowColor = color;
      ctx.shadowBlur = pressed ? (glow ? 16 : 8) * d : 0;
      drawText(
        ctx,
        (o.keys[l] ?? l + 1).toString().toUpperCase(),
        cx,
        cy,
        pressed ? color : (o.accentColor || o.uiColor),
      );
      ctx.shadowBlur = 0;
    }
  }

  #drawJudgmentFx(ctx, laneW, hitY, o) {
    if (!this.#judgmentFx.length) return;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const glow = o.glow;
    const d = o.dpr || 1;
    for (let i = 0; i < this.#judgmentFx.length; i++) {
      const fx = this.#judgmentFx[i];
      const def = FX_TABLE[fx.judgment];
      const x = fx.lane * laneW + laneW / 2;
      const y = hitY - (55 + (1 - fx.alpha) * 28) * d;
      ctx.globalAlpha = fx.alpha < 0 ? 0 : fx.alpha;
      ctx.shadowColor = def.color;
      ctx.shadowBlur = glow ? 10 * d : 0;
      ctx.font = `bold ${def.size * d}px sans-serif`;
      drawText(ctx, def.text, x, y, o.accentColor || o.uiColor);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  #drawParticles(ctx, o) {
    const glow = o.glow;
    const d = o.dpr || 1;
    const prevComposite = ctx.globalCompositeOperation;
    // 加算合成にすることで重なった光が明るく発光し、単なる不透明な粒より派手に見える
    ctx.globalCompositeOperation = "lighter";

    for (let i = 0; i < this.#particles.length; i++) {
      const p = this.#particles[i];
      const a = p.life / p.maxLife;
      const alpha = a < 0 ? 0 : a;
      ctx.globalAlpha = alpha;

      switch (p.type) {
        case "ring": {
          // 時間経過とともに半径が広がり、太さと不透明度が落ちていく光の輪
          const radius = p.maxRadius * (1 - a);
          ctx.shadowColor = p.color;
          ctx.shadowBlur = glow ? 14 * d : 0;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = (1 + 3 * a) * d;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.1, radius), 0, 6.2832);
          ctx.stroke();
          break;
        }
        case "beam": {
          // レーンを貫く光の柱：ヒット位置から上下に伸びて素早く消える
          // 台形パースが掛かっている場合、上端と下端でレーン幅が変わるため
          // #perspX で実際のレーン境界に追従させる（そうしないと上端がレーン外へはみ出す）
          ctx.shadowBlur = 0;
          const h = p.height * (1 - a * 0.25);
          const hitY = this.#cachedHitY;
          const laneW = this.#cachedLaneW;
          const W = this.#canvas.width;
          const btnBot = hitY + o.buttonZoneHeight;
          const persp = o.perspective ?? 0;
          const yBot = p.y + h * 0.15;
          const yTop = p.y - h;
          const xBotL = this.#perspX(
            p.lane,
            laneW,
            W,
            yBot,
            hitY,
            persp,
            btnBot,
          );
          const xBotR = this.#perspX(
            p.lane + 1,
            laneW,
            W,
            yBot,
            hitY,
            persp,
            btnBot,
          );
          const xTopL = this.#perspX(
            p.lane,
            laneW,
            W,
            yTop,
            hitY,
            persp,
            btnBot,
          );
          const xTopR = this.#perspX(
            p.lane + 1,
            laneW,
            W,
            yTop,
            hitY,
            persp,
            btnBot,
          );
          const grad = ctx.createLinearGradient(p.x, yBot, p.x, yTop);
          grad.addColorStop(0, withAlpha(p.color, 0.9));
          grad.addColorStop(0.5, withAlpha(p.color, 0.35));
          grad.addColorStop(1, withAlpha(p.color, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(xBotL, yBot);
          ctx.lineTo(xBotR, yBot);
          ctx.lineTo(xTopR, yTop);
          ctx.lineTo(xTopL, yTop);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "flash": {
          // 中心が一瞬強く光るラジアルグラデーション（PERFECT限定）
          ctx.shadowBlur = 0;
          const fr = p.radius ?? 46 * d;
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, fr);
          grad.addColorStop(0, p.color);
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, fr, 0, 6.2832);
          ctx.fill();
          break;
        }
        case "spark": {
          // 進行方向へ短い光跡を残しながら飛ぶ線パーティクル
          ctx.shadowColor = p.color;
          ctx.shadowBlur = glow ? 8 * d : 0;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2 * d;
          const trail = 0.02;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * trail, p.y - p.vy * trail);
          ctx.stroke();
          break;
        }
        case "spike": {
          // 8方向に伸びる先細りの光の棘：短時間で縮みながら消える「ズドン」演出
          const len = p.length * a;
          const dx = Math.cos(p.angle) * len;
          const dy = Math.sin(p.angle) * len;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = glow ? 12 * d : 0;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = (4 * a + 0.5) * d;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + dx, p.y + dy);
          ctx.stroke();
          break;
        }
        case "shard": {
          // 回転しながら飛び散る菱形の破片（弾けた質感）
          ctx.shadowColor = p.color;
          ctx.shadowBlur = glow ? 8 * d : 0;
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.moveTo(0, -p.h / 2);
          ctx.lineTo(p.w / 2, 0);
          ctx.lineTo(0, p.h / 2);
          ctx.lineTo(-p.w / 2, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case "burst":
        default: {
          const r = p.size * (0.5 + 0.5 * a);
          ctx.shadowColor = p.color;
          ctx.shadowBlur = glow ? 6 * d : 0;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, 6.2832);
          ctx.fill();
          break;
        }
      }
    }

    ctx.globalCompositeOperation = prevComposite;
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  #drawHUD(ctx, W, H, o) {
    ctx.textBaseline = "top";
    ctx.shadowBlur = 0;
    const textColor = o.accentColor || o.uiColor;
    const d = o.dpr || 1;

    if (this.#combo >= 2) {
      ctx.font = this.#cachedComboFont;
      ctx.shadowColor = textColor;
      ctx.shadowBlur = o.glow ? 12 * d : 0;
      ctx.textAlign = "center";
      drawText(ctx, `${this.#combo} COMBO`, W / 2, H * 0.10, textColor);
      ctx.shadowBlur = 0;
    }

    ctx.font = this.#cachedHUDFont;
    ctx.textAlign = "right";
    drawText(
      ctx,
      String(this.#score).padStart(7, "0"),
      W - 10 * d,
      10 * d + (o.topInset || 0),
      textColor,
    );
  }
}
