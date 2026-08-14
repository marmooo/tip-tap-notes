/**
 * beatmap-worker.js
 * audio-beatmap.js の解析処理をメインスレッドから切り離して実行する。
 *
 * ボトルネックであるSTFT/オンセット強度の計算（computeRawOnsetEnvelope）は
 * フレーム単位で独立に計算できるため、CPUコア数ぶんの stft-chunk-worker.js
 * に分割して並列実行し、結果をマージしてから残り（テンポ推定・ビート
 * トラッキング・拍グリッド吸着・ノート生成）を行う。
 * 短い音声やシングルコア環境では、Worker起動オーバーヘッドの方が大きいため
 * 単一スレッド版 (generateBeatmap) にフォールバックする。
 */

import {
  beatmapFromEnvelope,
  finalizeOnsetEnvelope,
  generateBeatmap,
} from "./audio-beatmap.js";

const MIN_FRAMES_FOR_PARALLEL = 4000; // これ未満は並列化のオーバーヘッドの方が大きい
const MAX_WORKERS = 8;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type !== "analyze") return;

  const { samples, sampleRate, difficulty, fftSize = 2048, hopSize = 512 } =
    msg;
  const onProgress = (p) => self.postMessage({ type: "progress", ...p });

  runAnalysis(samples, sampleRate, { difficulty, fftSize, hopSize, onProgress })
    .then((result) => self.postMessage({ type: "result", ...result }))
    .catch((err) =>
      self.postMessage({ type: "error", message: String(err?.message ?? err) })
    );
};

async function runAnalysis(samples, sampleRate, options) {
  const { fftSize, hopSize } = options;
  const totalFrames = Math.max(
    0,
    Math.floor((samples.length - 1) / hopSize) + 1,
  );
  const cores = self.navigator?.hardwareConcurrency || 4;
  const numWorkers = Math.max(1, Math.min(MAX_WORKERS, cores));

  if (numWorkers <= 1 || totalFrames < MIN_FRAMES_FOR_PARALLEL) {
    // 並列化しても割に合わない場合はシングルスレッド版
    return generateBeatmap(samples, sampleRate, options);
  }

  const env = await computeOnsetEnvelopeParallel(
    samples,
    sampleRate,
    fftSize,
    hopSize,
    totalFrames,
    numWorkers,
    options.onProgress,
  );
  return beatmapFromEnvelope(env, samples, sampleRate, options);
}

function computeOnsetEnvelopeParallel(
  samples,
  sampleRate,
  fftSize,
  hopSize,
  totalFrames,
  numWorkers,
  onProgress,
) {
  return new Promise((resolve, reject) => {
    const chunkSize = Math.ceil(totalFrames / numWorkers);
    const ranges = [];
    for (let c = 0; c < numWorkers; c++) {
      const frameStart = c * chunkSize;
      const frameEnd = Math.min(totalFrames, frameStart + chunkSize);
      if (frameStart < frameEnd) ranges.push({ frameStart, frameEnd });
    }

    const mergedOdf = new Float64Array(totalFrames);
    const mergedEnergy = new Float64Array(totalFrames);
    const mergedFrameTimes = new Float64Array(totalFrames);

    let completed = 0;
    let win = null, twiddles = null;
    const workers = ranges.map(() =>
      new Worker("/tip-tap-notes/stft-chunk-worker.js", { type: "module" })
    );

    function cleanup() {
      for (const w of workers) w.terminate();
    }

    workers.forEach((worker, i) => {
      const { frameStart, frameEnd } = ranges[i];
      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === "chunkError") {
          cleanup();
          reject(new Error(msg.message));
          return;
        }
        if (msg.type !== "chunkResult") return;

        mergedOdf.set(msg.odf, msg.frameStart);
        mergedEnergy.set(msg.energy, msg.frameStart);
        mergedFrameTimes.set(msg.frameTimes, msg.frameStart);
        if (!win) {
          win = msg.win;
          twiddles = { wr: msg.twiddleWr, wi: msg.twiddleWi };
        }

        completed++;
        onProgress?.({
          stage: "stft",
          progress: 0.05 + 0.45 * (completed / ranges.length),
        });

        if (completed === ranges.length) {
          cleanup();
          const env = finalizeOnsetEnvelope({
            odf: mergedOdf,
            energy: mergedEnergy,
            frameTimes: mergedFrameTimes,
            frameRate: sampleRate / hopSize,
            fftSize,
            hopSize,
            sampleRate,
            _win: win,
            _twiddles: twiddles,
          });
          resolve(env);
        }
      };
      worker.onerror = (err) => {
        cleanup();
        reject(err);
      };
      // samples は複数ワーカーで共有するため transfer せず複製して渡す
      worker.postMessage({
        type: "computeChunk",
        chunkId: i,
        samples,
        sampleRate,
        fftSize,
        hopSize,
        frameStart,
        frameEnd,
      });
    });

    onProgress?.({ stage: "stft", progress: 0.05 });
  });
}
