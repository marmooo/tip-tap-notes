/**
 * rhythm-game-worker.js
 * Worker adapter for RhythmGame.
 */

import { RhythmGame } from "./rhythm-game.js";

let game = null;

self.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      game = new RhythmGame(
        {
          note: msg.noteCanvas,
          particle: msg.particleCanvas,
          ui: msg.uiCanvas,
        },
        msg.options ?? {},
      );
      game.onJudgment = (judgment, combo, score) => {
        self.postMessage({ type: "judgment", judgment, combo, score });
      };
      game.onEnded = () => {
        // 詳細カウントを送ってから ended
        self.postMessage({
          type: "judgmentDetail",
          score: game.score,
          combo: game.maxCombo,
          perfect: game.perfectCount,
          great: game.greatCount,
          good: game.goodCount,
          miss: game.missCount,
        });
        self.postMessage({ type: "ended" });
      };
      break;
    }

    case "setNotes": {
      if (!game) break;
      const n = game.setNotesRaw(msg.notes);
      self.postMessage({ type: "noteCount", count: n });
      break;
    }

    case "start": {
      if (game) game.resetState();
      break;
    }

    case "tick": {
      if (!game) break;
      game.tick(msg.currentTime);
      break;
    }

    case "stop": {
      if (game) game.stop();
      break;
    }

    case "pressLane": {
      if (game) game.pressLane(msg.lane, msg.pressedAt);
      break;
    }

    case "releaseLane": {
      if (game) game.releaseLane(msg.lane);
      break;
    }

    case "updateOptions": {
      if (game) game.updateOptions(msg.patch);
      break;
    }

    case "resize": {
      if (game) game.resize(msg.width, msg.height);
      break;
    }
  }
};
