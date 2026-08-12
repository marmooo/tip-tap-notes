/**
 * stft-chunk-worker.js
 * beatmap-worker.js から複数スポーンされ、音声全体のうち割り当てられた
 * フレーム範囲だけの STFT/Onset強度/エネルギーを計算して返す。
 * （マルチコアでのSTFT並列化のための最小ワーカー）
 */

import { computeRawOnsetEnvelope } from "./audio-beatmap.js";

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type !== "computeChunk") return;

  const {
    samples,
    sampleRate,
    fftSize,
    hopSize,
    frameStart,
    frameEnd,
    chunkId,
  } = msg;

  try {
    const raw = computeRawOnsetEnvelope(samples, sampleRate, {
      fftSize,
      hopSize,
      frameStart,
      frameEnd,
    });
    self.postMessage(
      {
        type: "chunkResult",
        chunkId,
        frameStart: raw.frameStart,
        frameEnd: raw.frameEnd,
        odf: raw.odf,
        energy: raw.energy,
        frameTimes: raw.frameTimes,
        // fftSize が同じなら全チャンクで値は同一（決定的）。合成側で env を
        // 組み立てる際に必要になるため一緒に返す（小さいので複製コストは無視できる）。
        win: raw._win,
        twiddleWr: raw._twiddles.wr,
        twiddleWi: raw._twiddles.wi,
      },
      [raw.odf.buffer, raw.energy.buffer, raw.frameTimes.buffer],
    );
  } catch (err) {
    self.postMessage({
      type: "chunkError",
      chunkId,
      message: String(err?.message ?? err),
    });
  }
};
