/**
 * ios-touch-guards.js
 *
 * iOS / iPadOS Safari 向けのタッチジェスチャ抑制ユーティリティ。
 * 音ゲー・キャンバスアプリなど、マルチタッチ操作とシステムジェスチャが衝突する用途向け。
 *
 * できること:
 *   - ピンチズーム / ダブルタップズーム / 長押しコールアウト系の抑制（CSS と連携）
 *   - 2本指以上のデフォルト動作を preventDefault
 *   - 端スワイプによるヒストリ戻る/進むの抑制
 *   - 指定セレクタ上では何もしない（UI の click を殺さない）
 *   - プレイ中など「抑制モード」のときだけゲーム面で preventDefault
 *
 * できないこと:
 *   - 四本指/五本指のマルチタスクジェスチャ（OS レベルのため不可）
 *
 * CSS 側は #iosTouchGuardsStyle（または任意 id）の <style>/<link> を
 * disabled で on/off する想定。本モジュールは JS リスナーと CSS の連動を担う。
 *
 * @example
 *   import { installIOSTouchGuards } from "./ios-touch-guards.js";
 *
 *   const guards = installIOSTouchGuards({
 *     // 抑制を強める領域（キャンバス等）
 *     surfaceSelector: "#canvasWrap, canvas",
 *     // 触っても preventDefault しない UI
 *     uiSelector: "#topnav, #btnPause, .overlay, .modal, button, a, input, select",
 *     // true のとき surface 上の単指も止める（プレイ中など）
 *     shouldBlockSurface: () => gamePhase === "playing",
 *     styleElementId: "iosTouchGuardsStyle",
 *   });
 *
 *   guards.setEnabled(false);
 *   guards.uninstall();
 */

const DEFAULT_UI_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[data-bs-toggle]",
  "[data-bs-dismiss]",
  "[role='button']",
].join(", ");

const DEFAULT_SURFACE_SELECTOR = "canvas";
const DEFAULT_STYLE_ID = "iosTouchGuardsStyle";
const DEFAULT_EDGE_PX = 24;

function isIOSLike() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function toElement(target) {
  if (!target) return null;
  return target.nodeType === 1 ? target : target.parentElement;
}

function matchesSelector(el, selector) {
  if (!el || !selector) return false;
  try {
    return !!el.closest(selector);
  } catch {
    return false;
  }
}

/**
 * @typedef {object} IOSTouchGuardsOptions
 * @property {string}  [surfaceSelector="canvas"]
 *   抑制対象のゲーム面セレクタ（単指 block の判定に使用）
 * @property {string}  [uiSelector]
 *   除外する UI セレクタ。未指定時は button/a/input 等の汎用セット
 * @property {() => boolean} [shouldBlockSurface]
 *   true のとき surface 上の単指タッチも preventDefault する
 *   未指定時は常に false（マルチタッチと端スワイプのみ）
 * @property {string}  [styleElementId="iosTouchGuardsStyle"]
 *   連動して disabled を切り替える <style> / <link> の id
 * @property {boolean} [enabled=true] 初期状態
 * @property {boolean} [blockEdgeSwipe=true] 端スワイプでのヒストリ操作を抑制
 * @property {number}  [edgePx=24] 端判定の幅（px）
 * @property {boolean} [blockMultiTouch=true] 2本指以上を抑制
 * @property {boolean} [blockDoubleTapZoom=true] dblclick を抑制
 * @property {boolean} [blockGestureEvents=true] gesture* を抑制
 * @property {boolean} [onlyWhenIOS=true] iOS 系以外では no-op
 * @property {EventTarget} [root=document] リスナーを張る対象
 */

/**
 * @param {IOSTouchGuardsOptions} [options]
 * @returns {{
 *   setEnabled: (on: boolean) => void,
 *   isEnabled: () => boolean,
 *   uninstall: () => void,
 *   isIOS: boolean,
 * }}
 */
export function installIOSTouchGuards(options = {}) {
  const {
    surfaceSelector = DEFAULT_SURFACE_SELECTOR,
    uiSelector = DEFAULT_UI_SELECTOR,
    shouldBlockSurface = () => false,
    styleElementId = DEFAULT_STYLE_ID,
    enabled: initialEnabled = true,
    blockEdgeSwipe = true,
    edgePx = DEFAULT_EDGE_PX,
    blockMultiTouch = true,
    blockDoubleTapZoom = true,
    blockGestureEvents = true,
    onlyWhenIOS = true,
    root = document,
  } = options;

  const isIOS = isIOSLike();

  if (onlyWhenIOS && !isIOS) {
    return {
      setEnabled() {},
      isEnabled: () => false,
      uninstall() {},
      isIOS: false,
    };
  }

  const listenerOpts = { passive: false, capture: true };
  let enabled = false;
  const cleanups = [];

  function setStyleEnabled(on) {
    if (!styleElementId) return;
    const el = document.getElementById(styleElementId);
    if (el) el.disabled = !on;
  }

  function isUI(target) {
    return matchesSelector(toElement(target), uiSelector);
  }

  function isSurface(target) {
    return matchesSelector(toElement(target), surfaceSelector);
  }

  function onDblClick(e) {
    if (!enabled || !blockDoubleTapZoom || isUI(e.target)) return;
    e.preventDefault();
  }

  function onTouch(e) {
    if (!enabled) return;
    if (isUI(e.target)) return;

    const touchCount = e.touches?.length ?? 0;

    if (blockMultiTouch && touchCount >= 2) {
      e.preventDefault();
      return;
    }

    // 単指: 抑制モード中かつゲーム面上のみ
    if (touchCount <= 1 && shouldBlockSurface() && isSurface(e.target)) {
      e.preventDefault();
    }
  }

  function onGesture(e) {
    if (!enabled || !blockGestureEvents || isUI(e.target)) return;
    e.preventDefault();
  }

  function onEdgeSwipe(e) {
    if (!enabled || !blockEdgeSwipe) return;
    if (isUI(e.target)) return;
    if (!e.touches || e.touches.length !== 1) return;

    const x = e.touches[0].clientX;
    const w = window.innerWidth;
    if (x < edgePx || x > w - edgePx) {
      e.preventDefault();
    }
  }

  function add(type, handler) {
    root.addEventListener(type, handler, listenerOpts);
    cleanups.push(() => root.removeEventListener(type, handler, listenerOpts));
  }

  function setEnabled(on) {
    enabled = !!on;
    setStyleEnabled(enabled);
  }

  function uninstall() {
    setEnabled(false);
    while (cleanups.length) cleanups.pop()();
  }

  if (blockDoubleTapZoom) add("dblclick", onDblClick);
  add("touchstart", onTouch);
  add("touchmove", onTouch);
  if (blockGestureEvents) {
    add("gesturestart", onGesture);
    add("gesturechange", onGesture);
    add("gestureend", onGesture);
  }
  if (blockEdgeSwipe) add("touchstart", onEdgeSwipe);

  setEnabled(initialEnabled);

  return {
    setEnabled,
    isEnabled: () => enabled,
    uninstall,
    isIOS,
  };
}

/**
 * CSS だけ on/off（JS リスナーは触らない）
 * @param {boolean} on
 * @param {string} [styleElementId]
 */
export function setIOSTouchGuardsStyleEnabled(
  on,
  styleElementId = DEFAULT_STYLE_ID,
) {
  const el = document.getElementById(styleElementId);
  if (el) el.disabled = !on;
}

export function detectIOSLike() {
  return isIOSLike();
}
