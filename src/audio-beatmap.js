/**
 * audio-beatmap.js
 * ---------------------------------------------------------------------------
 * 音声ファイル(PCM)から音ゲー用の譜面(ノート配列)を自動生成する。
 *
 * 方針（音高推定はしない）：
 *   1. いつ鳴ったか   … Onset Detection (Spectral Flux)
 *   2. どのくらい強いか … Energy Detection (RMS)
 *   3. テンポ         … Beat Tracking (自己相関 + 位相同期ループ)
 *   4. どの音域か     … Spectral Centroid（レーン分散の補助情報。おまけ）
 *
 * 出力ノートは extractNotesFromMidy() と同じ形 { noteNumber, startTime,
 * endTime, channel, programNumber } にしてあるので、rhythm-game.js の
 * thinNotes() / RhythmGame にそのまま渡せる。
 *
 * このファイルは DOM/AudioContext に依存しない純粋関数群なので、
 * メインスレッドからも Worker からも同じように呼び出せる。
 * （実際の解析は重いので beatmap-worker.js 経由で使うことを推奨）
 */

// ---------------------------------------------------------------------------
// FFT (radix-2 Cooley-Tukey, in-place, size は 2 の冪のみ対応)
// ---------------------------------------------------------------------------

function fftInPlace(re, im) {
  const n = re.length;

  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }

  // butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = -2 * Math.PI / len;
    const wr0 = Math.cos(ang), wi0 = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWr = 1, curWi = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k], aIm = im[i + k];
        const bRe = re[i + k + half], bIm = im[i + k + half];
        const vRe = bRe * curWr - bIm * curWi;
        const vIm = bRe * curWi + bIm * curWr;
        re[i + k] = aRe + vRe;
        im[i + k] = aIm + vIm;
        re[i + k + half] = aRe - vRe;
        im[i + k + half] = aIm - vIm;
        const nwr = curWr * wr0 - curWi * wi0;
        const nwi = curWr * wi0 + curWi * wr0;
        curWr = nwr;
        curWi = nwi;
      }
    }
  }
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// ---------------------------------------------------------------------------
// 実数入力向け高速化：N点の実数FFTを N/2点の複素FFT 1回 + アンパックで求める。
// （フルサイズの複素FFTをそのまま使うより蝶々演算がおよそ半分で済む。
//   出力される振幅スペクトルは通常の複素FFT[0..N/2-1]と数値誤差の範囲で一致する）
// ---------------------------------------------------------------------------

function precomputeUnpackTwiddles(fftSize) {
  const M = fftSize >> 1;
  const wr = new Float64Array(M);
  const wi = new Float64Array(M);
  for (let k = 0; k < M; k++) {
    const ang = (-2 * Math.PI * k) / fftSize;
    wr[k] = Math.cos(ang);
    wi[k] = Math.sin(ang);
  }
  return { wr, wi };
}

/**
 * windowed: 長さ fftSize の実数（窓関数適用済み）サンプル
 * reBuf/imBuf: 長さ fftSize/2 の再利用バッファ（呼び出し側で確保）
 * twiddles: precomputeUnpackTwiddles(fftSize) の戻り値
 * outMag: 長さ fftSize/2 の出力先（呼び出し側で確保、振幅スペクトル）
 */
function realFFTMagnitudesInto(windowed, reBuf, imBuf, twiddles, outMag) {
  const N = windowed.length;
  const M = N >> 1;

  // 実数2点を1つの複素数に詰めて FFT サイズを半分にする
  for (let n = 0; n < M; n++) {
    reBuf[n] = windowed[2 * n];
    imBuf[n] = windowed[2 * n + 1];
  }
  fftInPlace(reBuf, imBuf);

  const { wr: twr, wi: twi } = twiddles;
  for (let k = 0; k < M; k++) {
    const km = (M - k) % M;
    const zRe = reBuf[k], zIm = imBuf[k];
    const zmRe = reBuf[km], zmIm = imBuf[km];

    // 偶数項・奇数項に分離
    const xeRe = (zRe + zmRe) * 0.5;
    const xeIm = (zIm - zmIm) * 0.5;
    const dRe = zRe - zmRe;
    const dIm = zIm + zmIm;
    const xoRe = dIm * 0.5;
    const xoIm = -dRe * 0.5;

    // X[k] = Xe[k] + Xo[k]・W_N^k
    const wrK = twr[k], wiK = twi[k];
    const xRe = xeRe + xoRe * wrK - xoIm * wiK;
    const xIm = xeIm + xoRe * wiK + xoIm * wrK;
    outMag[k] = Math.sqrt(xRe * xRe + xIm * xIm);
  }
}

function hannWindow(size) {
  const w = new Float32Array(size);
  const denom = size - 1 || 1;
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom);
  }
  return w;
}

// ---------------------------------------------------------------------------
// STFT
// ---------------------------------------------------------------------------

/**
 * @param {Float32Array} samples モノラルPCM (-1..1)
 * @param {number} sampleRate
 * @param {object} opts { fftSize=2048, hopSize=512 }
 * @returns {{
 *   magnitudes: Float32Array[],   // 各フレームの振幅スペクトル (長さ fftSize/2)
 *   frameTimes: Float64Array,     // 各フレームの中心時刻(秒)
 *   frameRate:  number,           // フレーム/秒
 *   fftSize: number, hopSize: number, sampleRate: number,
 * }}
 */
export function computeSTFT(samples, sampleRate, opts = {}) {
  const fftSize = nextPow2(opts.fftSize ?? 2048);
  const hopSize = opts.hopSize ?? (fftSize >> 2);
  const win = hannWindow(fftSize);
  const half = fftSize >> 1;
  const twiddles = precomputeUnpackTwiddles(fftSize);

  const numFrames = Math.max(0, Math.floor((samples.length - 1) / hopSize) + 1);
  const magnitudes = new Array(numFrames);
  const frameTimes = new Float64Array(numFrames);

  const windowed = new Float64Array(fftSize);
  const reBuf = new Float64Array(half);
  const imBuf = new Float64Array(half);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    for (let i = 0; i < fftSize; i++) {
      const s = start + i;
      windowed[i] = (s < samples.length ? samples[s] : 0) * win[i];
    }
    const mag = new Float32Array(half);
    realFFTMagnitudesInto(windowed, reBuf, imBuf, twiddles, mag);
    magnitudes[f] = mag;
    frameTimes[f] = (start + fftSize / 2) / sampleRate;
  }

  return {
    magnitudes,
    frameTimes,
    frameRate: sampleRate / hopSize,
    fftSize,
    hopSize,
    sampleRate,
  };
}

/**
 * 1フレーム分だけ振幅スペクトルを計算する（オンセット確定後の
 * スペクトル重心の遅延計算などに使う軽量版）。
 */
function computeFrameMagnitude(
  samples,
  frame,
  fftSize,
  hopSize,
  win,
  twiddles,
) {
  const half = fftSize >> 1;
  const start = frame * hopSize;
  const windowed = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const s = start + i;
    windowed[i] = (s < samples.length ? samples[s] : 0) * win[i];
  }
  const reBuf = new Float64Array(half);
  const imBuf = new Float64Array(half);
  const mag = new Float32Array(half);
  realFFTMagnitudesInto(windowed, reBuf, imBuf, twiddles, mag);
  return mag;
}

/**
 * そのフレームのスペクトル重心(Hz)だけを計算する。
 * generateBeatmap() では「最終的に採用されたノートの分だけ」遅延計算するために使う
 * （全フレームぶん重心を求めるのは無駄が大きいため）。
 */
function computeFrameCentroid(
  samples,
  sampleRate,
  frame,
  fftSize,
  hopSize,
  win,
  twiddles,
) {
  const mag = computeFrameMagnitude(
    samples,
    frame,
    fftSize,
    hopSize,
    win,
    twiddles,
  );
  const binHz = sampleRate / fftSize;
  let magSum = 0, weighted = 0;
  for (let k = 0; k < mag.length; k++) {
    const m = mag[k];
    magSum += m;
    weighted += m * (k * binHz);
  }
  return magSum > 1e-9 ? weighted / magSum : 0;
}

// ---------------------------------------------------------------------------
// STFT + オンセット特徴量（生値・未平滑化）を計算する。
//
// frameStart/frameEnd を指定すると、その範囲のフレームだけを計算できる
// （マルチスレッド化のためのチャンク分割用）。チャンクの先頭では直前フレーム
// （チャンク境界の外側）を「ウォームアップ」として計算し、prevLogMag を
// 正しい値で初期化してから出力を始めるので、フレーム分割してもSpectral Fluxの
// 差分計算はシングルスレッド版とビット単位で同一になる。
//
// 全フレーム分の振幅/対数振幅配列は保持しない
// （直前フレームぶんの対数振幅だけをその場で上書きしながら使う）。
// スペクトル重心はここでは計算しない（採用ノート分だけ後で遅延計算する）。
// ---------------------------------------------------------------------------

export function computeRawOnsetEnvelope(samples, sampleRate, opts = {}) {
  const fftSize = nextPow2(opts.fftSize ?? 2048);
  const hopSize = opts.hopSize ?? (fftSize >> 2);
  const win = hannWindow(fftSize);
  const half = fftSize >> 1;
  const twiddles = precomputeUnpackTwiddles(fftSize);

  const totalFrames = Math.max(
    0,
    Math.floor((samples.length - 1) / hopSize) + 1,
  );
  const frameStart = opts.frameStart ?? 0;
  const frameEnd = opts.frameEnd ?? totalFrames;
  const numOut = Math.max(0, frameEnd - frameStart);

  const odf = new Float64Array(numOut);
  const energy = new Float64Array(numOut);
  const frameTimes = new Float64Array(numOut);

  const windowed = new Float64Array(fftSize);
  const reBuf = new Float64Array(half);
  const imBuf = new Float64Array(half);
  const mag = new Float32Array(half);
  const prevLogMag = new Float32Array(half);

  function computeFrameMagInto(f) {
    const start = f * hopSize;
    for (let i = 0; i < fftSize; i++) {
      const s = start + i;
      windowed[i] = (s < samples.length ? samples[s] : 0) * win[i];
    }
    realFFTMagnitudesInto(windowed, reBuf, imBuf, twiddles, mag);
  }

  // チャンクの先頭がフレーム0でない場合、直前フレームだけ計算して
  // prevLogMag を正しい値にウォームアップする（出力はしない）
  if (frameStart > 0) {
    computeFrameMagInto(frameStart - 1);
    for (let k = 0; k < half; k++) prevLogMag[k] = Math.log1p(50 * mag[k]);
  }

  for (let idx = 0; idx < numOut; idx++) {
    const f = frameStart + idx;
    computeFrameMagInto(f);

    let fluxSum = 0, energySum = 0;
    for (let k = 0; k < half; k++) {
      const m = mag[k];
      const lm = Math.log1p(50 * m);
      const d = lm - prevLogMag[k];
      if (d > 0) fluxSum += d;
      prevLogMag[k] = lm;
      energySum += m * m;
    }
    odf[idx] = fluxSum;
    energy[idx] = Math.sqrt(energySum / half);
    frameTimes[idx] = (f * hopSize + fftSize / 2) / sampleRate;
  }

  return {
    odf,
    energy,
    frameTimes,
    frameStart,
    frameEnd,
    totalFrames,
    frameRate: sampleRate / hopSize,
    fftSize,
    hopSize,
    sampleRate,
    _win: win,
    _twiddles: twiddles,
  };
}

// ---------------------------------------------------------------------------
// 生のonset強度関数を平滑化・正規化する（チャンクをマージした後に1回だけ呼ぶ）
// ---------------------------------------------------------------------------

export function finalizeOnsetEnvelope(raw) {
  const {
    odf,
    energy,
    frameTimes,
    frameRate,
    fftSize,
    hopSize,
    sampleRate,
    _win,
    _twiddles,
  } = raw;
  const numFrames = odf.length;

  const smoothed = new Float64Array(numFrames);
  const SMOOTH_R = 1;
  for (let f = 0; f < numFrames; f++) {
    let sum = 0, cnt = 0;
    for (let d = -SMOOTH_R; d <= SMOOTH_R; d++) {
      const idx = f + d;
      if (idx >= 0 && idx < numFrames) {
        sum += odf[idx];
        cnt++;
      }
    }
    smoothed[f] = sum / cnt;
  }

  let maxVal = 1e-9;
  for (let f = 0; f < numFrames; f++) {
    if (smoothed[f] > maxVal) maxVal = smoothed[f];
  }
  for (let f = 0; f < numFrames; f++) smoothed[f] /= maxVal;

  const normEnergy = new Float64Array(numFrames);
  let maxEnergy = 1e-9;
  for (let f = 0; f < numFrames; f++) {
    if (energy[f] > maxEnergy) maxEnergy = energy[f];
  }
  for (let f = 0; f < numFrames; f++) normEnergy[f] = energy[f] / maxEnergy;

  return {
    odf: smoothed,
    energy: normEnergy,
    frameTimes,
    frameRate,
    fftSize,
    hopSize,
    sampleRate,
    _win,
    _twiddles,
  };
}

/**
 * シングルスレッド版の便利ラッパー（全フレームを1回で計算）。
 * 複数Workerに分割しない場合はこれで十分。
 */
export function computeOnsetEnvelope(samples, sampleRate, opts = {}) {
  const raw = computeRawOnsetEnvelope(samples, sampleRate, opts);
  return finalizeOnsetEnvelope(raw);
}

// ---------------------------------------------------------------------------
// Onset detection function: spectral flux + RMS energy + spectral centroid
// ---------------------------------------------------------------------------

/**
 * @param {ReturnType<typeof computeSTFT>} stft
 * @returns {{ odf: Float64Array, energy: Float64Array, centroid: Float64Array }}
 */
export function computeOnsetFeatures(stft) {
  const { magnitudes, sampleRate, fftSize } = stft;
  const n = magnitudes.length;
  const half = fftSize >> 1;
  const odf = new Float64Array(n);
  const energy = new Float64Array(n);
  const centroid = new Float64Array(n);
  const binHz = sampleRate / fftSize;

  // 対数圧縮した振幅（知覚に近い & 大音量フレームの支配を抑える）
  const logMag = new Array(n);
  for (let f = 0; f < n; f++) {
    const mag = magnitudes[f];
    const lm = new Float32Array(half);
    let energySum = 0, weighted = 0, magSum = 0;
    for (let k = 0; k < half; k++) {
      const m = mag[k];
      lm[k] = Math.log1p(50 * m);
      energySum += m * m;
      weighted += m * (k * binHz);
      magSum += m;
    }
    logMag[f] = lm;
    energy[f] = Math.sqrt(energySum / half);
    centroid[f] = magSum > 1e-9 ? weighted / magSum : 0;
  }

  // spectral flux（半波整流した差分の総和）
  for (let f = 1; f < n; f++) {
    const cur = logMag[f], prev = logMag[f - 1];
    let sum = 0;
    for (let k = 0; k < half; k++) {
      const d = cur[k] - prev[k];
      if (d > 0) sum += d;
    }
    odf[f] = sum;
  }

  // 軽い移動平均で平滑化（クリック的なノイズを抑える）
  const smoothed = new Float64Array(n);
  const SMOOTH_R = 1;
  for (let f = 0; f < n; f++) {
    let sum = 0, cnt = 0;
    for (let d = -SMOOTH_R; d <= SMOOTH_R; d++) {
      const idx = f + d;
      if (idx >= 0 && idx < n) {
        sum += odf[idx];
        cnt++;
      }
    }
    smoothed[f] = sum / cnt;
  }

  // 0..1 に正規化
  let maxVal = 1e-9;
  for (let f = 0; f < n; f++) if (smoothed[f] > maxVal) maxVal = smoothed[f];
  for (let f = 0; f < n; f++) smoothed[f] /= maxVal;

  let maxEnergy = 1e-9;
  for (let f = 0; f < n; f++) if (energy[f] > maxEnergy) maxEnergy = energy[f];
  for (let f = 0; f < n; f++) energy[f] /= maxEnergy;

  return { odf: smoothed, energy, centroid };
}

// ---------------------------------------------------------------------------
// Peak picking (Bello/Dixon 式の適応的閾値によるオンセット検出)
// ---------------------------------------------------------------------------

/**
 * @param {Float64Array} odf 0..1 に正規化済みのオンセット強度関数
 * @param {Float64Array} frameTimes
 * @param {object} opts { preAvg, postAvg, preMax, postMax, delta, waitSec }
 * @returns {{ frame:number, time:number, strength:number }[]}
 */
export function pickOnsets(odf, frameTimes, opts = {}) {
  const preMax = opts.preMax ?? 2;
  const postMax = opts.postMax ?? 2;
  const preAvg = opts.preAvg ?? 6;
  const postAvg = opts.postAvg ?? 6;
  const delta = opts.delta ?? 0.05;
  const waitSec = opts.waitSec ?? 0.05; // 最小オンセット間隔(50ms) 二重検出防止

  const n = odf.length;
  const onsets = [];
  let lastOnsetTime = -1e9;

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - preMax);
    const hi = Math.min(n - 1, i + postMax);
    let localMax = -Infinity;
    for (let k = lo; k <= hi; k++) if (odf[k] > localMax) localMax = odf[k];
    if (odf[i] < localMax) continue; // 局所最大でなければ棄却

    const aLo = Math.max(0, i - preAvg);
    const aHi = Math.min(n - 1, i + postAvg);
    let sum = 0, cnt = 0;
    for (let k = aLo; k <= aHi; k++) {
      sum += odf[k];
      cnt++;
    }
    const localMean = sum / cnt;

    if (odf[i] < localMean + delta) continue;

    const t = frameTimes[i];
    if (t - lastOnsetTime < waitSec) continue;

    onsets.push({ frame: i, time: t, strength: odf[i] });
    lastOnsetTime = t;
  }
  return onsets;
}

// ---------------------------------------------------------------------------
// Tempo estimation（自己相関 + 120BPM付近を優先する対数正規分布の重み）
// ---------------------------------------------------------------------------

export function estimateTempo(odf, frameRate, opts = {}) {
  const minBPM = opts.minBPM ?? 60;
  const maxBPM = opts.maxBPM ?? 200;
  const step = opts.step ?? 0.5;
  const n = odf.length;

  let bestBPM = 120, bestScore = -Infinity;
  for (let bpm = minBPM; bpm <= maxBPM; bpm += step) {
    const lag = Math.round((frameRate * 60) / bpm);
    if (lag < 1 || lag >= n) continue;
    let sum = 0, cnt = 0;
    for (let i = 0; i + lag < n; i++) {
      sum += odf[i] * odf[i + lag];
      cnt++;
    }
    if (cnt === 0) continue;
    const corr = sum / cnt;
    // オクターブ誤り対策: 120BPM近辺をやや優遇する対数正規の事前分布
    const z = Math.log(bpm / 120) / 0.65;
    const prior = Math.exp(-0.5 * z * z);
    const score = corr * prior;
    if (score > bestScore) {
      bestScore = score;
      bestBPM = bpm;
    }
  }
  return bestBPM;
}

// ---------------------------------------------------------------------------
// Beat tracking（位相探索 + 簡易PLLでテンポのゆらぎに追従）
// ---------------------------------------------------------------------------

/**
 * @returns {{ beatTimes:number[], bpm:number }}
 */
export function trackBeats(odf, frameTimes, frameRate, bpmGuess, duration) {
  const n = odf.length;
  const basePeriod = 60 / bpmGuess;

  // 最初の拍の位相を全体探索で決める
  const PHASE_STEPS = 200;
  let bestPhase = 0, bestScore = -Infinity;
  for (let s = 0; s < PHASE_STEPS; s++) {
    const phase = (s / PHASE_STEPS) * basePeriod;
    let score = 0;
    for (let t = phase; t < duration; t += basePeriod) {
      const idx = Math.round(t * frameRate);
      if (idx >= 0 && idx < n) score += odf[idx];
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  // PLL: 各拍の予測位置の近傍で最も強いオンセット強度のフレームに軽く同期
  const beatTimes = [];
  let period = basePeriod;
  let t = bestPhase;
  const tol = basePeriod * 0.12;
  const gain = 0.15; // テンポ追従の強さ（大きいほど敏感、暴れやすい）

  while (t < duration) {
    const i0 = Math.max(0, Math.round((t - tol) * frameRate));
    const i1 = Math.min(n - 1, Math.round((t + tol) * frameRate));
    let bestIdx = -1, bestVal = 0.04; // ノイズに反応しない下限
    for (let i = i0; i <= i1; i++) {
      if (odf[i] > bestVal) {
        bestVal = odf[i];
        bestIdx = i;
      }
    }
    let actual = t;
    if (bestIdx >= 0) {
      actual = frameTimes[bestIdx];
      const err = actual - t;
      period += gain * err;
      period = Math.max(basePeriod * 0.85, Math.min(basePeriod * 1.15, period));
    }
    beatTimes.push(actual);
    t = actual + period;
  }

  return { beatTimes, bpm: 60 / period };
}

// ---------------------------------------------------------------------------
// 拍グリッド生成（拍を difficulty に応じて等分割）
// ---------------------------------------------------------------------------

export function buildBeatGrid(beatTimes, subdivisions = 1) {
  const grid = [];
  for (let i = 0; i < beatTimes.length - 1; i++) {
    const a = beatTimes[i], b = beatTimes[i + 1];
    for (let s = 0; s < subdivisions; s++) {
      grid.push(a + ((b - a) * s) / subdivisions);
    }
  }
  if (beatTimes.length > 0) grid.push(beatTimes[beatTimes.length - 1]);
  return grid;
}

// ---------------------------------------------------------------------------
// オンセットを拍グリッドに吸着（同一グリッド点は最強の1つだけ残す）
// ---------------------------------------------------------------------------

export function snapToGrid(onsets, grid) {
  if (grid.length === 0) return [];
  const slots = new Map(); // gridIndex -> onset (最強のもの)
  let gi = 0;
  for (const onset of onsets) {
    while (
      gi < grid.length - 1 &&
      Math.abs(grid[gi + 1] - onset.time) <= Math.abs(grid[gi] - onset.time)
    ) {
      gi++;
    }
    const existing = slots.get(gi);
    if (!existing || onset.strength > existing.strength) {
      slots.set(gi, { ...onset, time: grid[gi] });
    }
  }
  return [...slots.values()].sort((a, b) => a.time - b.time);
}

// ---------------------------------------------------------------------------
// 難易度に応じた間引き（強い音だけ残す）
// ---------------------------------------------------------------------------

export function filterByStrength(onsets, keepRatio) {
  if (keepRatio >= 1) return onsets.slice();
  const sorted = onsets.slice().sort((a, b) => b.strength - a.strength);
  const keepCount = Math.max(1, Math.round(sorted.length * keepRatio));
  const kept = new Set(sorted.slice(0, keepCount));
  return onsets.filter((o) => kept.has(o));
}

// ---------------------------------------------------------------------------
// 音域(スペクトル重心) → 疑似ノート番号（レーン分散用。音程精度は問わない）
// ---------------------------------------------------------------------------

export function centroidToNoteNumber(hz) {
  if (!hz || hz <= 0) return 60;
  const n = 69 + 12 * Math.log2(hz / 440);
  return Math.max(21, Math.min(108, Math.round(n)));
}

// ---------------------------------------------------------------------------
// 難易度プリセット（譜面生成側。レーン割り/間引きは rhythm-game.js の
// DIFFICULTIES / thinNotes に別途渡す2段構え）
// ---------------------------------------------------------------------------

export const AUDIO_DIFFICULTIES = {
  EASY: { subdivisions: 1, keepRatio: 0.30, sustainEnabled: false },
  BASIC: { subdivisions: 2, keepRatio: 0.50, sustainEnabled: true },
  NORMAL: { subdivisions: 2, keepRatio: 0.72, sustainEnabled: true },
  HARD: { subdivisions: 4, keepRatio: 0.95, sustainEnabled: true },
};

// ---------------------------------------------------------------------------
// サステイン検出（音が伸びていたらホールドノート候補にする）
// ---------------------------------------------------------------------------

function estimateSustain(onset, energy, frameTimes, nextOnsetTime) {
  const n = energy.length;
  const startFrame = onset.frame;
  const startEnergy = energy[startFrame] || 0.001;
  const threshold = startEnergy * 0.5;
  const maxEndTime = Math.min(
    nextOnsetTime ?? Infinity,
    frameTimes[startFrame] + 2.5, // ホールド上限2.5秒
  );
  let f = startFrame;
  while (
    f + 1 < n && energy[f + 1] >= threshold && frameTimes[f + 1] < maxEndTime
  ) f++;
  return frameTimes[f];
}

// ---------------------------------------------------------------------------
// ノート配列の構築（extractNotesFromMidy() と同じ形にする）
// ---------------------------------------------------------------------------

function buildNotes(onsets, energy, frameTimes, sustainEnabled) {
  const notes = [];
  for (let i = 0; i < onsets.length; i++) {
    const o = onsets[i];
    const nextTime = i + 1 < onsets.length ? onsets[i + 1].time : undefined;
    const tapEnd = o.time + 0.12;
    let endTime = tapEnd;
    if (sustainEnabled) {
      const sustainEnd = estimateSustain(o, energy, frameTimes, nextTime);
      if (sustainEnd > tapEnd) endTime = sustainEnd;
    }
    notes.push({
      noteNumber: centroidToNoteNumber(o.centroidHz),
      startTime: o.time,
      endTime,
      channel: 0,
      programNumber: 0,
    });
  }
  return notes;
}

// ---------------------------------------------------------------------------
// トップレベル：音声(PCM) → 譜面ノート配列
// ---------------------------------------------------------------------------

/**
 * @param {Float32Array} samples モノラルPCM
 * @param {number} sampleRate
 * @param {object} options { difficulty='NORMAL', fftSize=2048, hopSize=512, onProgress }
 * @returns {{ notes: Array, bpm: number, beatTimes: number[], duration: number }}
 */
/**
 * onset envelope（computeOnsetEnvelope / 複数チャンクをマージしたもの）から
 * 譜面ノートを組み立てる。単一スレッド版・並列版の両方から共有される。
 *
 * @param {ReturnType<typeof computeOnsetEnvelope>} env
 * @param {Float32Array} samples モノラルPCM（スペクトル重心の遅延計算に使う）
 * @param {number} sampleRate
 * @param {object} options { difficulty='NORMAL', onProgress }
 */
export function beatmapFromEnvelope(env, samples, sampleRate, options = {}) {
  const difficulty = options.difficulty ?? "NORMAL";
  const cfg = AUDIO_DIFFICULTIES[difficulty] ?? AUDIO_DIFFICULTIES.NORMAL;
  const onProgress = options.onProgress ?? (() => {});

  onProgress({ stage: "onset", progress: 0.45 });
  const rawOnsets = pickOnsets(env.odf, env.frameTimes);

  onProgress({ stage: "tempo", progress: 0.60 });
  const duration = samples.length / sampleRate;
  const bpmGuess = estimateTempo(env.odf, env.frameRate);
  const { beatTimes, bpm } = trackBeats(
    env.odf,
    env.frameTimes,
    env.frameRate,
    bpmGuess,
    duration,
  );

  onProgress({ stage: "grid", progress: 0.75 });
  const grid = buildBeatGrid(beatTimes, cfg.subdivisions);
  const snapped = snapToGrid(rawOnsets, grid);
  const filtered = filterByStrength(snapped, cfg.keepRatio);

  onProgress({ stage: "notes", progress: 0.90 });
  // スペクトル重心は最終的に採用されたノートの分だけ遅延計算する
  // （全フレームぶん求めていた旧実装より計算量が大幅に少ない）
  for (const o of filtered) {
    o.centroidHz = computeFrameCentroid(
      samples,
      sampleRate,
      o.frame,
      env.fftSize,
      env.hopSize,
      env._win,
      env._twiddles,
    );
  }
  const notes = buildNotes(
    filtered,
    env.energy,
    env.frameTimes,
    cfg.sustainEnabled,
  );

  onProgress({ stage: "done", progress: 1 });
  return { notes, bpm, beatTimes, duration };
}

/**
 * @param {Float32Array} samples モノラルPCM
 * @param {number} sampleRate
 * @param {object} options { difficulty='NORMAL', fftSize=2048, hopSize=512, onProgress }
 * @returns {{ notes: Array, bpm: number, beatTimes: number[], duration: number }}
 */
export function generateBeatmap(samples, sampleRate, options = {}) {
  const fftSize = nextPow2(options.fftSize ?? 2048);
  const hopSize = options.hopSize ?? 512;
  const onProgress = options.onProgress ?? (() => {});

  // STFT・オンセット強度・エネルギーを1パスで算出（全フレームぶんの
  // 振幅/対数振幅は保持しない。スペクトル重心もまだ計算しない）
  onProgress({ stage: "stft", progress: 0.05 });
  const env = computeOnsetEnvelope(samples, sampleRate, { fftSize, hopSize });

  return beatmapFromEnvelope(env, samples, sampleRate, options);
}

// ---------------------------------------------------------------------------
// AudioBuffer → モノラルFloat32Array（メインスレッド側のヘルパー）
// ---------------------------------------------------------------------------

export function audioBufferToMono(audioBuffer) {
  const ch = audioBuffer.numberOfChannels;
  if (ch === 1) return audioBuffer.getChannelData(0).slice();
  const len = audioBuffer.length;
  const out = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i] / ch;
  }
  return out;
}
