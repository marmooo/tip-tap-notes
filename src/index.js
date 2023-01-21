function loadConfig() {
  if (localStorage.getItem("darkMode") == 1) {
    document.documentElement.dataset.theme = "dark";
  }
}

function toggleDarkMode() {
  if (localStorage.getItem("darkMode") == 1) {
    localStorage.setItem("darkMode", 0);
    delete document.documentElement.dataset.theme;
  } else {
    localStorage.setItem("darkMode", 1);
    document.documentElement.dataset.theme = "dark";
  }
}

function dropFileEvent(event) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById("inputFile");
  input.files = dt.files;
  convertFromBlob(file);
}

function convertFileEvent(event) {
  convertFromBlob(event.target.files[0]);
}

function convertUrlEvent(event) {
  convertFromUrl(event.target.value);
}

async function convertFromUrlParams() {
  const query = parseQuery(location.search);
  ns = await core.urlToNoteSequence(query.url);
  convert(ns);
}

async function convertFromBlob(file) {
  ns = await core.blobToNoteSequence(file);
  convert(ns);
}

async function convertFromUrl(midiUrl) {
  ns = await core.urlToNoteSequence(midiUrl);
  convert(ns);
}

function convert(ns) {
  ns.totalTime += 3;
  ns.notes.forEach((note) => {
    note.startTime += 3;
    note.endTime += 3;
  });
  nsCache = core.sequences.clone(ns);
  setToolbar();
  initVisualizer();
  changeButtons();
  initPlayer();
}

function getScale(visualizer) {
  const rect = visualizer.parentElement.getBoundingClientRect();
  const size = visualizer.getSize();
  return rect.width / size.width;
}

function styleToViewBox(svg) {
  const style = svg.style;
  const width = parseFloat(style.width);
  const height = parseFloat(style.height);
  const viewBox = `0 0 ${width} ${height}`;
  svg.setAttribute("viewBox", viewBox);
  svg.removeAttribute("style");
}

function calcPixelsPerTimeStep() {
  let averageTime = 0;
  ns.notes.forEach((note) => {
    averageTime += note.endTime - note.startTime;
  });
  averageTime /= ns.notes.length;
  return noteHeight / averageTime;
}

function initVisualizer() {
  const gamePanel = document.getElementById("gamePanel");
  const config = {
    showOnlyOctavesUsed: true,
    pixelsPerTimeStep: calcPixelsPerTimeStep(),
  };
  visualizer = new core.WaterfallSVGVisualizer(ns, gamePanel, config);
  styleToViewBox(visualizer.svg);
  styleToViewBox(visualizer.svgPiano);
  visualizer.svgPiano.classList.add("d-none");
  [...visualizer.svg.children].forEach((rect) => {
    rect.setAttribute("fill", "rgba(0, 0, 0, 0.5)");
  });
  const parentElement = visualizer.parentElement;
  parentElement.style.width = "100%";
  parentElement.style.height = "50vh";
  parentElement.style.paddingTop = "50vh";
  parentElement.style.overflowY = "hidden";
  parentElement.scrollTop = parentElement.scrollHeight;
  currentScrollTop = parentElement.scrollTop;
  changeVisualizerPositions(visualizer);
}

async function initPlayer() {
  const soundFont =
    "https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus";
  const playerCallback = {
    run: (_note) => null,
    stop: () => {
      clearPlayer();
      const parentElement = visualizer.parentElement;
      parentElement.scrollTop = parentElement.scrollHeight;
      const repeatObj = document.getElementById("repeat");
      const repeat = repeatObj.classList.contains("active");
      if (repeat) {
        player.start(ns);
        setSmoothScroll();
        initSeekbar(ns, 0);
        clearInterval(seekbarInterval);
        setSeekbarInterval(0);
      }
      scoring();
      scoreModal.show();
      [...visualizer.svg.getElementsByClassName("fade")].forEach((rect) => {
        rect.classList.remove("fade");
      });
    },
  };
  stop();
  player = new core.SoundFontPlayer(
    soundFont,
    undefined,
    undefined,
    undefined,
    playerCallback,
  );
  await player.loadSamples(ns);
}

function setSmoothScroll(seconds) {
  const delay = 1;
  const totalTime = ns.totalTime;
  const startTime = Date.now() - seconds * 1000;
  const parentElement = visualizer.parentElement;
  scrollInterval = setInterval(() => {
    currentTime = (Date.now() - startTime) / 1000;
    if (currentTime < totalTime) {
      const rate = 1 - currentTime / totalTime;
      parentElement.scrollTop = currentScrollTop * rate;
    } else {
      clearInterval(scrollInterval);
      currentTime = 0;
    }
  }, delay);
}

function play() {
  tapCount = perfectCount = greatCount = 0;
  document.getElementById("play").classList.add("d-none");
  document.getElementById("pause").classList.remove("d-none");
  switch (player.getPlayState()) {
    case "stopped":
      if (player.getPlayState() == "started") return;
      setSpeed(ns);
      player.start(ns);
      setSmoothScroll(0);
      initSeekbar(ns, 0);
      clearInterval(seekbarInterval);
      setSeekbarInterval(0);
      break;
    case "paused": {
      player.resume();
      setSmoothScroll(currentTime);
      setSeekbarInterval(currentTime);
    }
  }
  window.scrollTo({
    top: document.getElementById("playPanel").getBoundingClientRect().top,
    behavior: "auto",
  });
}

function pause() {
  player.pause();
  clearPlayer();
}

function stop() {
  if (player && player.isPlaying()) {
    document.getElementById("currentTime").textContent = formatTime(0);
    player.stop();
    clearPlayer();
  }
}

function clearPlayer() {
  clearInterval(scrollInterval);
  clearInterval(seekbarInterval);
  document.getElementById("play").classList.remove("d-none");
  document.getElementById("pause").classList.add("d-none");
}

function getCheckboxString(name, label) {
  return `
<div class="form-check form-check-inline">
  <label class="form-check-label">
    <input class="form-check-input" name="${name}" value="${label}" type="checkbox" checked>
    ${label}
  </label>
</div>`;
}

function setInstrumentsCheckbox() {
  const set = new Set();
  ns.notes.forEach((note) => {
    set.add(note.instrument);
  });
  instrumentStates = new Map();
  let str = "";
  set.forEach((instrumentId) => {
    str += getCheckboxString("instrument", instrumentId);
    instrumentStates.set(instrumentId, true);
  });
  const doc = new DOMParser().parseFromString(str, "text/html");
  const node = document.getElementById("filterInstruments");
  node.replaceChildren(...doc.body.children);
  [...node.querySelectorAll("input")].forEach((input) => {
    input.addEventListener("change", () => {
      perfectCount = greatCount = 0;
      const instrumentId = input.value;
      [...visualizer.svg.children].forEach((rect) => {
        if (rect.dataset.instrument == instrumentId) {
          rect.classList.toggle("d-none");
        }
      });
      const instrument = parseInt(instrumentId);
      const currState = instrumentStates.get(instrument);
      instrumentStates.set(parseInt(instrument), !currState);
      if (visualizer && ns) {
        changeVisualizerPositions(visualizer);
      }
    });
  });
}

function setProgramsCheckbox() {
  const set = new Set();
  ns.notes.forEach((note) => {
    set.add(note.program);
  });
  programStates = new Map();
  let str = "";
  set.forEach((programId) => {
    str += getCheckboxString("program", programId);
    programStates.set(programId, true);
  });
  const doc = new DOMParser().parseFromString(str, "text/html");
  const node = document.getElementById("filterPrograms");
  node.replaceChildren(...doc.body.children);
  [...node.querySelectorAll("input")].forEach((input) => {
    input.addEventListener("change", () => {
      perfectCount = greatCount = 0;
      const programId = input.value;
      [...visualizer.svg.children].forEach((rect) => {
        if (rect.dataset.program == programId) {
          rect.classList.toggle("d-none");
        }
      });
      const program = parseInt(programId);
      const currState = programStates.get(program);
      programStates.set(parseInt(program), !currState);
      if (visualizer && ns) {
        changeVisualizerPositions(visualizer);
      }
    });
  });
}

function setToolbar() {
  setProgramsCheckbox();
  setInstrumentsCheckbox();
}

function speedDown() {
  const input = document.getElementById("speed");
  const speed = parseInt(input.value) - 10;
  if (speed < 0) {
    input.value = 0;
  } else {
    input.value = speed;
  }
  document.getElementById("speedDown").disabled = true;
  changeSpeed();
  document.getElementById("speedDown").disabled = false;
}

function speedUp() {
  const input = document.getElementById("speed");
  input.value = parseInt(input.value) + 10;
  document.getElementById("speedUp").disabled = true;
  changeSpeed();
  document.getElementById("speedUp").disabled = false;
}

function changeSpeed() {
  perfectCount = greatCount = 0;
  if (!ns) return;
  switch (player.getPlayState()) {
    case "started": {
      player.stop();
      clearInterval(seekbarInterval);
      clearInterval(scrollInterval);
      setSpeed(ns);
      const speed = nsCache.totalTime / ns.totalTime;
      const newSeconds = currentTime / speed;
      initSeekbar(ns, newSeconds);
      player.start(ns, undefined, newSeconds);
      setSmoothScroll(newSeconds);
      clearInterval(seekbarInterval);
      setSeekbarInterval(newSeconds);
      break;
    }
    case "paused": {
      setSpeed(ns);
      const speed = nsCache.totalTime / ns.totalTime;
      const newSeconds = currentTime / speed;
      initSeekbar(ns, newSeconds);
      break;
    }
  }
}

function setSpeed(ns) {
  const input = document.getElementById("speed");
  const speed = parseInt(input.value) / 100;
  const controlChanges = nsCache.controlChanges;
  ns.controlChanges.forEach((n, i) => {
    n.time = controlChanges[i].time / speed;
  });
  const tempos = nsCache.tempos;
  ns.tempos.forEach((n, i) => {
    n.time = tempos[i].time / speed;
    n.qpm = tempos[i].qpm * speed;
  });
  const notes = nsCache.notes;
  ns.notes.forEach((n, i) => {
    n.startTime = notes[i].startTime / speed;
    n.endTime = notes[i].endTime / speed;
  });
  ns.totalTime = nsCache.totalTime / speed;
}

function repeat() {
  document.getElementById("repeat").classList.toggle("active");
}

function volumeOnOff() {
  const i = document.getElementById("volumeOnOff").firstElementChild;
  const volumebar = document.getElementById("volumebar");
  if (i.classList.contains("bi-volume-up-fill")) {
    i.className = "bi bi-volume-mute-fill";
    volumebar.dataset.value = volumebar.value;
    volumebar.value = -50;
    player.output.mute = true;
  } else {
    i.className = "bi bi-volume-up-fill";
    volumebar.value = volumebar.dataset.value;
    player.output.mute = false;
  }
}

function changeVolumebar() {
  const volumebar = document.getElementById("volumebar");
  const volume = volumebar.value;
  volumebar.dataset.value = volume;
  player.output.volume.value = volume;
}

function formatTime(seconds) {
  seconds = Math.floor(seconds);
  const s = seconds % 60;
  const m = (seconds - s) / 60;
  const h = (seconds - s - 60 * m) / 3600;
  const ss = String(s).padStart(2, "0");
  const mm = (m > 9 || !h) ? `${m}:` : `0${m}:`;
  const hh = h ? `${h}:` : "";
  return `${hh}${mm}${ss}`;
}

function changeSeekbar(event) {
  perfectCount = greatCount = 0;
  clearInterval(seekbarInterval);
  clearInterval(scrollInterval);
  [...visualizer.svg.getElementsByClassName("fade")].forEach((rect) => {
    rect.classList.remove("fade");
  });
  const seconds = parseInt(event.target.value);
  document.getElementById("currentTime").textContent = formatTime(seconds);
  currentTime = seconds;
  resizeScroll(seconds);
  if (player.isPlaying()) {
    player.seekTo(seconds);
    if (player.getPlayState() == "started") {
      setSmoothScroll(seconds);
      setSeekbarInterval(seconds);
    }
  }
}

function updateSeekbar(seconds) {
  const seekbar = document.getElementById("seekbar");
  seekbar.value = seconds;
  const time = formatTime(seconds);
  document.getElementById("currentTime").textContent = time;
}

function initSeekbar(ns, seconds) {
  document.getElementById("seekbar").max = ns.totalTime;
  document.getElementById("seekbar").value = seconds;
  document.getElementById("totalTime").textContent = formatTime(ns.totalTime);
  document.getElementById("currentTime").textContent = formatTime(seconds);
}

function setSeekbarInterval(seconds) {
  seekbarInterval = setInterval(() => {
    updateSeekbar(seconds);
    seconds += 1;
  }, 1000);
}

function resize() {
  const parentElement = visualizer.parentElement;
  parentElement.scrollTop = parentElement.scrollHeight;
  currentScrollTop = parentElement.scrollTop;
}

function resizeScroll(time) {
  const parentElement = visualizer.parentElement;
  parentElement.scrollTop = parentElement.scrollHeight;
  currentScrollTop = parentElement.scrollTop;
  const ratio = (ns.totalTime - time) / ns.totalTime;
  parentElement.scrollTop = ratio * currentScrollTop;
}

function getMinMaxPitch() {
  let min = Infinity;
  let max = -Infinity;
  ns.notes
    .filter((note) => instrumentStates.get(note.instrument))
    .filter((note) => programStates.get(note.program))
    .forEach((note) => {
      if (note.pitch < min) min = note.pitch;
      if (max < note.pitch) max = note.pitch;
    });
  return [min, max];
}

function changeVisualizerPositions(visualizer) {
  const [minPitch, maxPitch] = getMinMaxPitch();
  const pitchRange = maxPitch - minPitch + 1;
  const course = document.getElementById("courseOption").selectedIndex;
  const courseStep = pitchRange / course;
  const viewBox = visualizer.svg.getAttribute("viewBox").split(" ");
  const svgWidth = parseFloat(viewBox[2]);
  const widthStep = svgWidth / course;
  [...visualizer.svg.children]
    .filter((rect) => !rect.classList.contains("d-none"))
    .forEach((rect) => {
      const pitch = parseInt(rect.dataset.pitch);
      const n = Math.floor((pitch - minPitch) / courseStep);
      rect.setAttribute("x", Math.ceil(n * widthStep));
      rect.setAttribute("width", widthStep);
    });
}

function typeEvent(event) {
  switch (event.code) {
    case "Space":
      event.preventDefault();
      if (player.getPlayState() == "started") {
        pause();
      } else {
        play();
      }
      break;
    default:
      return typeEventKey(event.key);
  }
}

function typeEventKey(key) {
  const keys = Array.from("AWSEDRFTGYHUJIKOLP;@".toLowerCase());
  const playPanel = document.getElementById("playPanel");
  const buttons = [...playPanel.querySelectorAll("button")];
  const targetKeys = (buttons.length > 9)
    ? keys.slice(0, buttons.length)
    : keys.filter((_, i) => i % 2 == 0).slice(0, buttons.length);
  if (targetKeys.includes(key)) {
    const pos = targetKeys.indexOf(key);
    buttons[pos].click();
  }
}

function buttonEvent(state, width, svgHeight) {
  tapCount += 1;
  const waterfallHeight = visualizer.svg.getBoundingClientRect().height;
  const scrollRatio = visualizer.parentElement.scrollTop / waterfallHeight;
  let stateText = "MISS";
  [...visualizer.svg.children]
    .filter((rect) => width == parseInt(rect.getAttribute("x")))
    .filter((rect) => !rect.classList.contains("d-none"))
    .filter((rect) => !rect.classList.contains("fade"))
    .forEach((rect) => {
      const y = parseFloat(rect.getAttribute("y"));
      const height = parseFloat(rect.getAttribute("height"));
      const loosePixel = 2;
      const minRatio = (y - loosePixel) / svgHeight;
      const maxRatio = (y + height + loosePixel) / svgHeight;
      const avgRatio = (minRatio + maxRatio) / 2;
      if (avgRatio <= scrollRatio && scrollRatio <= maxRatio) {
        stateText = "PERFECT";
        rect.classList.add("fade");
        perfectCount += 1;
      } else if (minRatio <= scrollRatio && scrollRatio < avgRatio) {
        stateText = "GREAT";
        rect.classList.add("fade");
        greatCount += 1;
      }
    });
  switch (stateText) {
    case "PERFECT":
      state.textContent = stateText;
      state.className = "badge bg-primary";
      break;
    case "GREAT":
      state.textContent = stateText;
      state.className = "badge bg-success";
      break;
    case "MISS":
      state.className = "badge bg-danger";
      break;
  }
  setTimeout(() => {
    state.textContent = "MISS";
    state.className = "badge";
  }, 200);
}

function setButtonEvent(button, state, width, svgHeight) {
  if ("ontouchstart" in window) {
    button.ontouchstart = () => {
      buttonEvent(state, width, svgHeight);
    };
  } else {
    button.onclick = () => {
      buttonEvent(state, width, svgHeight);
    };
  }
}

function changeButtons() {
  tapCount = perfectCount = greatCount = 0;
  const texts = Array.from("AWSEDRFTGYHUJIKOLP;@");
  const course = document.getElementById("courseOption").selectedIndex;
  const playPanel = document.getElementById("playPanel");
  playPanel.replaceChildren();
  const viewBox = visualizer.svg.getAttribute("viewBox").split(" ");
  const svgWidth = parseFloat(viewBox[2]);
  const svgHeight = parseFloat(viewBox[3]);
  const widthStep = svgWidth / course;
  for (let i = 0; i < course; i++) {
    const width = Math.ceil(i * widthStep);
    const div = document.createElement("div");
    div.className = "w-100";
    const state = document.createElement("span");
    state.className = "badge";
    state.textContent = "MISS";
    const button = document.createElement("button");
    button.className = "w-100 btn btn-light btn-tap";
    button.role = "button";
    button.textContent = (course > 9) ? texts[i] : texts[i * 2];
    setButtonEvent(button, state, width, svgHeight);
    div.appendChild(button);
    div.appendChild(state);
    playPanel.appendChild(div);
  }
  document.removeEventListener("keydown", typeEvent);
  document.addEventListener("keydown", typeEvent);
  if (visualizer && ns) {
    changeVisualizerPositions(visualizer);
  }
}

function countNotes() {
  return ns.notes
    .filter((note) => instrumentStates.get(note.instrument))
    .filter((note) => programStates.get(note.program)).length;
}

function getAccuracy() {
  if (tapCount == 0) return 0;
  return (perfectCount + greatCount) / tapCount;
}

function scoring() {
  const totalCount = countNotes();
  const accuracy = getAccuracy();
  const missCount = totalCount - perfectCount - greatCount;
  const perfectRate = Math.ceil(perfectCount / totalCount * 10000) / 100;
  const greatRate = Math.ceil(greatCount / totalCount * 10000) / 100;
  const missRate = Math.ceil(missCount / totalCount * 10000) / 100;
  const tapped = perfectCount * 2 + greatCount;
  const speed = parseInt(document.getElementById("speed").value);
  const course = document.getElementById("courseOption").selectedIndex;
  const programs = Array.from(programStates.values())
    .filter((state) => state).length;
  const instruments = Array.from(instrumentStates.values())
    .filter((state) => state).length;
  const score = parseInt(
    tapped * speed * programs * instruments * course * accuracy,
  );
  document.getElementById("perfectCount").textContent = perfectCount;
  document.getElementById("greatCount").textContent = greatCount;
  document.getElementById("missCount").textContent = missCount;
  document.getElementById("perfectRate").textContent = perfectRate + "%";
  document.getElementById("greatRate").textContent = greatRate + "%";
  document.getElementById("missRate").textContent = missRate + "%";
  document.getElementById("score").textContent = score;
  const info = `title composer`;
  const text = encodeURIComponent(`Tip Tap Notes! ${info}: ${score}`);
  const url = "https://marmooo.github.com/tip-tap-notes/";
  const twitterUrl =
    `https://twitter.com/intent/tweet?text=${text}&url=${url}&hashtags=TipTapNotes`;
  document.getElementById("twitter").href = twitterUrl;
}

const noteHeight = 30;
let currentTime = 0;
let currentScrollTop;
let ns;
let nsCache;
let seekbarInterval;
let scrollInterval;
let player;
let visualizer;
let programStates;
let instrumentStates;
let tapCount = 0;
let perfectCount = 0;
let greatCount = 0;
loadConfig();
if (location.search) {
  convertFromUrlParams();
} else {
  convertFromUrl("abt.mid");
}

const scoreModal = new bootstrap.Modal("#scorePanel", {
  backdrop: "static",
  keyboard: false,
});

document.getElementById("toggleDarkMode").onclick = toggleDarkMode;
document.ondragover = (e) => {
  e.preventDefault();
};
document.ondrop = dropFileEvent;
document.getElementById("inputFile").onchange = convertFileEvent;
document.getElementById("inputUrl").onchange = convertUrlEvent;
document.getElementById("play").onclick = play;
document.getElementById("pause").onclick = pause;
document.getElementById("speed").onchange = changeSpeed;
document.getElementById("speedDown").onclick = speedDown;
document.getElementById("speedUp").onclick = speedUp;
document.getElementById("repeat").onclick = repeat;
document.getElementById("volumeOnOff").onclick = volumeOnOff;
document.getElementById("volumebar").onchange = changeVolumebar;
document.getElementById("seekbar").onchange = changeSeekbar;
document.getElementById("courseOption").onchange = changeButtons;
window.addEventListener("resize", resize);
