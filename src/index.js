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

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

function getRectColor() {
  if (colorful) {
    const r = getRandomInt(0, 127);
    const g = getRandomInt(0, 127);
    const b = getRandomInt(0, 127);
    return `rgba(${r}, ${g}, ${b}, 0.5)`;
  } else {
    return "rgba(0, 0, 0, 0.5)";
  }
}

function setRectColor() {
  [...visualizer.svg.children].forEach((rect) => {
    const color = getRectColor();
    rect.setAttribute("fill", color);
  });
}

function toggleRectColor() {
  colorful = !colorful;
  setRectColor();
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
  const query = new URLSearchParams(location.search);
  ns = await core.urlToNoteSequence(query.get("url"));
  convert(ns, query);
}

async function convertFromBlob(file, query) {
  ns = await core.blobToNoteSequence(file);
  convert(ns, query);
}

async function convertFromUrl(midiUrl, query) {
  ns = await core.urlToNoteSequence(midiUrl);
  convert(ns, query);
}

function setMIDIInfo(query) {
  if (query instanceof URLSearchParams) {
    const title = query.get("title");
    const composer = query.get("composer");
    const maintainer = query.get("maintainer");
    const web = query.get("web");
    const license = query.get("license");
    document.getElementById("midiTitle").textContent = title;
    if (composer != maintainer) {
      document.getElementById("composer").textContent = composer;
    }
    if (web) {
      const a = document.createElement("a");
      a.href = web;
      a.textContent = maintainer;
      document.getElementById("maintainer").replaceChildren(a);
    } else {
      document.getElementById("maintainer").textContent = maintainer;
    }
    try {
      new URL(license);
    } catch {
      document.getElementById("license").textContent = license;
    }
  } else {
    document.getElementById("midiTitle").textContent = "";
    document.getElementById("composer").textContent = "";
    document.getElementById("maintainer").textContent = "";
    document.getElementById("license").textContent = "";
  }
}

function convert(ns, query) {
  ns.totalTime += 3;
  ns.notes.forEach((note) => {
    note.startTime += 3;
    note.endTime += 3;
  });
  nsCache = core.sequences.clone(ns);
  setMIDIInfo(query);
  setToolbar();
  initVisualizer();
  changeButtons();
  initPlayer();
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

const MIN_NOTE_LENGTH = 1;
class WaterfallSVGVisualizer extends core.BaseSVGVisualizer {
  // The default range is 21 < pitch <= 108, which only considers piano,
  // however we need 9 < pitch <= 120 when considering all instruments.
  NOTES_PER_OCTAVE = 12;
  WHITE_NOTES_PER_OCTAVE = 7;
  LOW_C = 12;
  firstDrawnOctave = 0;
  lastDrawnOctave = 8;

  // svgPiano;
  // config;

  constructor(sequence, parentElement, config = {}) {
    super(sequence, config);

    if (!(parentElement instanceof HTMLDivElement)) {
      throw new Error(
        "This visualizer requires a <div> element to display the visualization",
      );
    }

    // Some sensible defaults.
    this.config.whiteNoteWidth = config.whiteNoteWidth || 20;
    this.config.blackNoteWidth = config.blackNoteWidth ||
      this.config.whiteNoteWidth * 2 / 3;
    this.config.whiteNoteHeight = config.whiteNoteHeight || 70;
    this.config.blackNoteHeight = config.blackNoteHeight || (2 * 70 / 3);
    this.config.showOnlyOctavesUsed = config.showOnlyOctavesUsed;

    this.setupDOM(parentElement);

    const size = this.getSize();
    this.width = size.width;
    this.height = size.height;

    // Make sure that if we've used this svg element before, it's now emptied.
    this.svg.style.width = `${this.width}px`;
    this.svg.style.height = `${this.height}px`;

    this.svgPiano.style.width = `${this.width}px`;
    this.svgPiano.style.height = `${this.config.whiteNoteHeight}px`;

    // Add a little bit of padding to the right, so that the scrollbar
    // doesn't overlap the last note on the piano.
    this.parentElement.style.width = `${
      this.width + this.config.whiteNoteWidth
    }px`;
    this.parentElement.scrollTop = this.parentElement.scrollHeight;

    this.clear();
    this.drawPiano();
    this.draw();
  }

  setupDOM(container) {
    this.parentElement = document.createElement("div");
    this.parentElement.classList.add("waterfall-notes-container");

    const height = Math.max(container.getBoundingClientRect().height, 200);

    // Height and padding-top must match for this to work.
    this.parentElement.style.paddingTop = `${
      height - this.config.whiteNoteHeight
    }px`;
    this.parentElement.style.height = `${
      height - this.config.whiteNoteHeight
    }px`;

    this.parentElement.style.boxSizing = "border-box";
    this.parentElement.style.overflowX = "hidden";
    this.parentElement.style.overflowY = "auto";

    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svgPiano = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    this.svg.classList.add("waterfall-notes");
    this.svgPiano.classList.add("waterfall-piano");

    this.parentElement.appendChild(this.svg);
    container.innerHTML = "";
    container.appendChild(this.parentElement);
    container.appendChild(this.svgPiano);
  }
  /**
   * Redraws the entire note sequence if it hasn't been drawn before,
   * optionally painting a note as active
   * @param activeNote (Optional) If specified, this `Note` will be painted
   * in the active color.
   * @param scrollIntoView (Optional) If specified and the note being
   * painted is offscreen, the parent container will be scrolled so that
   * the note is in view.
   * @returns The x position of the painted active note. Useful for
   * automatically advancing the visualization if the note was painted
   * outside of the screen.
   */
  redraw(activeNote, _scrollIntoView) {
    if (!this.drawn) {
      this.draw();
    }

    if (!activeNote) {
      return null;
    }

    // Remove the current active note, if one exists.
    this.clearActiveNotes();
    this.parentElement.style.paddingTop = this.parentElement.style.height;

    for (let i = 0; i < this.noteSequence.notes.length; i++) {
      const note = this.noteSequence.notes[i];
      const isActive = activeNote &&
        this.isPaintingActiveNote(note, activeNote);

      // We're only looking to re-paint the active notes.
      if (!isActive) {
        continue;
      }

      // Activate this note.
      const el = this.svg.querySelector(`rect[data-index="${i}"]`);
      this.fillActiveRect(el, note);

      // And on the keyboard.
      const key = this.svgPiano.querySelector(
        `rect[data-pitch="${note.pitch}"]`,
      );
      this.fillActiveRect(key, note);

      if (note === activeNote) {
        const y = parseFloat(el.getAttribute("y"));
        const height = parseFloat(el.getAttribute("height"));

        // Scroll the waterfall.
        if (y < (this.parentElement.scrollTop - height)) {
          this.parentElement.scrollTop = y + height;
        }

        // This is the note we wanted to draw.
        return y;
      }
    }
    return null;
  }

  getSize() {
    this.updateMinMaxPitches(true);

    let whiteNotesDrawn = 52; // For a full piano.
    if (this.config.showOnlyOctavesUsed) {
      // Go through each C note and see which is the one right below and
      // above our sequence.
      let foundFirst = false, foundLast = false;
      for (let i = 1; i < 7; i++) {
        const c = this.LOW_C + this.NOTES_PER_OCTAVE * i;
        // Have we found the lowest pitch?
        if (!foundFirst && c > this.config.minPitch) {
          this.firstDrawnOctave = i - 1;
          foundFirst = true;
        }
        // Have we found the highest pitch?
        if (!foundLast && c > this.config.maxPitch) {
          this.lastDrawnOctave = i - 1;
          foundLast = true;
        }
      }

      whiteNotesDrawn = (this.lastDrawnOctave - this.firstDrawnOctave + 1) *
        this.WHITE_NOTES_PER_OCTAVE;
    }

    const width = whiteNotesDrawn * this.config.whiteNoteWidth;

    // Calculate a nice width based on the length of the sequence we're
    // playing.
    // Warn if there's no totalTime or quantized steps set, since it leads
    // to a bad size.
    const endTime = this.noteSequence.totalTime;
    if (!endTime) {
      throw new Error(
        "The sequence you are using with the visualizer does not have a " +
          "totalQuantizedSteps or totalTime " +
          "field set, so the visualizer can't be horizontally " +
          "sized correctly.",
      );
    }

    const height = Math.max(
      endTime * this.config.pixelsPerTimeStep,
      MIN_NOTE_LENGTH,
    );
    return { width, height };
  }

  getNotePosition(note, _noteIndex) {
    const rect = this.svgPiano.querySelector(
      `rect[data-pitch="${note.pitch}"]`,
    );

    if (!rect) {
      return null;
    }

    // Size of this note.
    const len = this.getNoteEndTime(note) - this.getNoteStartTime(note);
    const x = Number(rect.getAttribute("x"));
    const w = Number(rect.getAttribute("width"));
    const h = Math.max(
      this.config.pixelsPerTimeStep * len - this.config.noteSpacing,
      MIN_NOTE_LENGTH,
    );

    // The svg' y=0 is at the top, but a smaller pitch is actually
    // lower, so we're kind of painting backwards.
    const y = this.height -
      (this.getNoteStartTime(note) * this.config.pixelsPerTimeStep) - h;
    return { x, y, w, h };
  }

  drawPiano() {
    this.svgPiano.innerHTML = "";

    const blackNoteOffset = this.config.whiteNoteWidth -
      this.config.blackNoteWidth / 2;
    const blackNoteIndexes = [1, 3, 6, 8, 10];

    // Dear future reader: I am sure there is a better way to do this, but
    // splitting it up makes it more readable and maintainable in case there's
    // an off by one key error somewhere.
    // Each note has an pitch. Pianos start on pitch 21 and end on 108.
    // First draw all the white notes, in this order:
    //    - if we're using all the octaves, pianos start on an A (so draw A,
    //    B)
    //    - ... the rest of the white keys per octave
    //    - if we started on an A, we end on an extra C.
    // Then draw all the black notes (so that these rects sit on top):
    //    - if the piano started on an A, draw the A sharp
    //    - ... the rest of the black keys per octave.

    let x = 0;
    let currentPitch = 0;
    if (this.config.showOnlyOctavesUsed) {
      // Starting on a C, and a bunch of octaves up.
      currentPitch = (this.firstDrawnOctave * this.NOTES_PER_OCTAVE) +
        this.LOW_C;
    } else {
      // Starting on the lowest A and B.
      currentPitch = this.LOW_C - 3;
      this.drawWhiteKey(currentPitch, x);
      this.drawWhiteKey(currentPitch + 2, this.config.whiteNoteWidth);
      currentPitch += 3;
      x = 2 * this.config.whiteNoteWidth;
    }

    // Draw the rest of the white notes.
    for (let o = this.firstDrawnOctave; o <= this.lastDrawnOctave; o++) {
      for (let i = 0; i < this.NOTES_PER_OCTAVE; i++) {
        // Black keys come later.
        if (blackNoteIndexes.indexOf(i) === -1) {
          this.drawWhiteKey(currentPitch, x);
          x += this.config.whiteNoteWidth;
        }
        currentPitch++;
      }
    }

    if (this.config.showOnlyOctavesUsed) {
      // Starting on a C, and a bunch of octaves up.
      currentPitch = (this.firstDrawnOctave * this.NOTES_PER_OCTAVE) +
        this.LOW_C;
      x = -this.config.whiteNoteWidth;
    } else {
      // Before we reset, add an extra C at the end because pianos.
      this.drawWhiteKey(currentPitch, x);

      // This piano started on an A, so draw the A sharp black key.
      currentPitch = this.LOW_C - 3;
      this.drawBlackKey(currentPitch + 1, blackNoteOffset);
      currentPitch += 3; // Next one is the LOW_C.
      x = this.config.whiteNoteWidth;
    }

    // Draw the rest of the black notes.
    for (let o = this.firstDrawnOctave; o <= this.lastDrawnOctave; o++) {
      for (let i = 0; i < this.NOTES_PER_OCTAVE; i++) {
        if (blackNoteIndexes.indexOf(i) !== -1) {
          this.drawBlackKey(currentPitch, x + blackNoteOffset);
        } else {
          x += this.config.whiteNoteWidth;
        }
        currentPitch++;
      }
    }
  }

  drawWhiteKey(index, x) {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.dataset.pitch = String(index);
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", "0");
    rect.setAttribute("width", String(this.config.whiteNoteWidth));
    rect.setAttribute("height", String(this.config.whiteNoteHeight));
    rect.setAttribute("fill", "white");
    rect.setAttribute("original-fill", "white");
    rect.setAttribute("stroke", "black");
    rect.setAttribute("stroke-width", "3px");
    rect.classList.add("white");
    this.svgPiano.appendChild(rect);
    return rect;
  }

  drawBlackKey(index, x) {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.dataset.pitch = String(index);
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", "0");
    rect.setAttribute("width", String(this.config.blackNoteWidth));
    rect.setAttribute("height", String(this.config.blackNoteHeight));
    rect.setAttribute("fill", "black");
    rect.setAttribute("original-fill", "black");
    rect.setAttribute("stroke", "black");
    rect.setAttribute("stroke-width", "3px");
    rect.classList.add("black");
    this.svgPiano.appendChild(rect);
    return rect;
  }

  clearActiveNotes() {
    super.unfillActiveRect(this.svg);
    // And the piano.
    const els = this.svgPiano.querySelectorAll("rect.active");
    for (let i = 0; i < els.length; ++i) {
      const el = els[i];
      el.setAttribute("fill", el.getAttribute("original-fill"));
      el.classList.remove("active");
    }
  }
}

function initVisualizer() {
  const gamePanel = document.getElementById("gamePanel");
  const config = {
    showOnlyOctavesUsed: true,
    pixelsPerTimeStep: calcPixelsPerTimeStep(),
  };
  visualizer = new WaterfallSVGVisualizer(ns, gamePanel, config);
  styleToViewBox(visualizer.svg);
  styleToViewBox(visualizer.svgPiano);
  visualizer.svgPiano.classList.add("d-none");
  setRectColor();
  const parentElement = visualizer.parentElement;
  parentElement.style.width = "100%";
  parentElement.style.height = "50vh";
  parentElement.style.paddingTop = "50vh";
  parentElement.style.overflowY = "hidden";
  resize();
  changeVisualizerPositions(visualizer);
}

async function initPlayer() {
  const soundFont =
    "https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus";
  const playerCallback = {
    run: (_note) => null,
    stop: () => {
      clearPlayer();
      const repeatObj = document.getElementById("repeat");
      const repeat = repeatObj.classList.contains("active");
      if (repeat) {
        initSeekbar(ns, 0);
        setLoadingTimer(0);
        player.start(ns);
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
  currentTime = 0;
  initSeekbar(ns, 0);
  await player.loadSamples(ns);
}

function setTimer(seconds) {
  const delay = 1;
  const startTime = Date.now() - seconds * 1000;
  const totalTime = ns.totalTime;
  timer = setInterval(() => {
    const nextTime = (Date.now() - startTime) / 1000;
    if (Math.floor(currentTime) != Math.floor(nextTime)) {
      updateSeekbar(nextTime);
    }
    currentTime = nextTime;
    if (currentTime < totalTime) {
      const rate = 1 - currentTime / totalTime;
      visualizer.parentElement.scrollTop = currentScrollHeight * rate;
    } else {
      clearInterval(timer);
      currentTime = 0;
    }
  }, delay);
}

// fix delay caused by player.start(ns) by seeking after playing
function setLoadingTimer(time) {
  const loadingTimer = setInterval(() => {
    if (player.isPlaying()) {
      clearInterval(loadingTimer);
      player.seekTo(currentTime);
      setTimer(currentTime);
    }
  }, 10);
}

function play() {
  tapCount = perfectCount = greatCount = 0;
  document.getElementById("play").classList.add("d-none");
  document.getElementById("pause").classList.remove("d-none");
  switch (player.getPlayState()) {
    case "started":
    case "stopped":
      setLoadingTimer(currentTime);
      player.start(ns);
      break;
    case "paused":
      player.resume();
      setTimer(currentTime);
      break;
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
  clearInterval(timer);
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
      tapCount = perfectCount = greatCount = 0;
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
      tapCount = perfectCount = greatCount = 0;
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
  const value = parseInt(input.value) - 10;
  const speed = (value <= 0) ? 1 : value;
  input.value = speed;
  document.getElementById("speedDown").disabled = true;
  changeSpeed(speed);
  document.getElementById("speedDown").disabled = false;
}

function speedUp() {
  const input = document.getElementById("speed");
  const speed = parseInt(input.value) + 10;
  input.value = speed;
  document.getElementById("speedUp").disabled = true;
  changeSpeed(speed);
  document.getElementById("speedUp").disabled = false;
}

function changeSpeed(speed) {
  perfectCount = greatCount = 0;
  if (!ns) return;
  const playState = player.getPlayState();
  player.stop();
  clearInterval(timer);
  const prevRate = nsCache.totalTime / ns.totalTime;
  const rate = prevRate / (speed / 100);
  const newSeconds = currentTime * rate;
  setSpeed(ns, speed);
  initSeekbar(ns, newSeconds);
  switch (playState) {
    case "started":
      setLoadingTimer(newSeconds);
      player.start(ns);
      break;
  }
}

function changeSpeedEvent(event) {
  const speed = parseInt(event.target.value);
  changeSpeed(speed);
}

function setSpeed(ns, speed) {
  if (speed <= 0) speed = 1;
  speed /= 100;
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
  const playState = player.getPlayState();
  player.stop();
  clearInterval(timer);
  [...visualizer.svg.getElementsByClassName("fade")].forEach((rect) => {
    rect.classList.remove("fade");
  });
  const seconds = parseInt(event.target.value);
  document.getElementById("currentTime").textContent = formatTime(seconds);
  currentTime = seconds;
  seekScroll(seconds);
  if (playState == "started") {
    setLoadingTimer(seconds);
    player.start(ns, undefined, currentTime - seconds);
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

function resize() {
  const parentElement = visualizer.parentElement;
  const rectHeight = parentElement.getBoundingClientRect().height;
  currentScrollHeight = parentElement.scrollHeight - rectHeight;
  seekScroll(currentTime);
}

function seekScroll(time) {
  const rate = (ns.totalTime - time) / ns.totalTime;
  visualizer.parentElement.scrollTop = currentScrollHeight * rate;
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
  const targetKeys = (buttons.length > 10)
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
    button.textContent = (course > 10) ? texts[i] : texts[i * 2];
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
  const title = document.getElementById("midiTitle").textContent;
  const composer = document.getElementById("composer").textContent;
  const info = `${title} ${composer}`;
  const text = encodeURIComponent(`Tip Tap Notes! ${info}: ${score}`);
  const url = "https://marmooo.github.com/tip-tap-notes/";
  const twitterUrl =
    `https://twitter.com/intent/tweet?text=${text}&url=${url}&hashtags=TipTapNotes`;
  document.getElementById("twitter").href = twitterUrl;
}

function initQuery() {
  const query = new URLSearchParams();
  query.set("title", "When the Swallows Homeward Fly (Agathe)");
  query.set("composer", "Franz Wilhelm Abt");
  query.set("maintainer", "Stan Sanderson");
  query.set("license", "Public Domain");
  return query;
}

const noteHeight = 30;
let colorful = true;
let currentTime = 0;
let currentScrollHeight;
let ns;
let nsCache;
let timer;
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
  const query = initQuery();
  convertFromUrl("abt.mid", query);
}

const scoreModal = new bootstrap.Modal("#scorePanel", {
  backdrop: "static",
  keyboard: false,
});

document.getElementById("toggleDarkMode").onclick = toggleDarkMode;
document.getElementById("toggleColor").onclick = toggleRectColor;
document.ondragover = (e) => {
  e.preventDefault();
};
document.ondrop = dropFileEvent;
document.getElementById("inputFile").onchange = convertFileEvent;
document.getElementById("inputUrl").onchange = convertUrlEvent;
document.getElementById("play").onclick = play;
document.getElementById("pause").onclick = pause;
document.getElementById("speed").onchange = changeSpeedEvent;
document.getElementById("speedDown").onclick = speedDown;
document.getElementById("speedUp").onclick = speedUp;
document.getElementById("repeat").onclick = repeat;
document.getElementById("volumeOnOff").onclick = volumeOnOff;
document.getElementById("volumebar").onchange = changeVolumebar;
document.getElementById("seekbar").onchange = changeSeekbar;
document.getElementById("courseOption").onchange = changeButtons;
window.addEventListener("resize", resize);
