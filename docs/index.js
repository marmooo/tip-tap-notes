function loadConfig(){localStorage.getItem("darkMode")==1&&(document.documentElement.dataset.theme="dark")}function toggleDarkMode(){localStorage.getItem("darkMode")==1?(localStorage.setItem("darkMode",0),delete document.documentElement.dataset.theme):(localStorage.setItem("darkMode",1),document.documentElement.dataset.theme="dark")}function getRandomInt(a,b){return a=Math.ceil(a),b=Math.floor(b),Math.floor(Math.random()*(b-a))+a}function getRectColor(){if(colorful){const a=getRandomInt(0,127),b=getRandomInt(0,127),c=getRandomInt(0,127);return`rgba(${a}, ${b}, ${c}, 0.5)`}return"rgba(0, 0, 0, 0.5)"}function setRectColor(){[...visualizer.svg.children].forEach(a=>{const b=getRectColor();a.setAttribute("fill",b)})}function toggleRectColor(){colorful=!colorful,setRectColor()}function dropFileEvent(a){a.preventDefault();const b=a.dataTransfer.files[0],c=new DataTransfer;c.items.add(b);const d=document.getElementById("inputMIDIFile");d.files=c.files,loadMIDIFromBlob(b)}function loadMIDIFileEvent(a){loadMIDIFromBlob(a.target.files[0])}function loadMIDIUrlEvent(a){loadMIDIFromUrl(a.target.value)}async function loadMIDIFromUrlParams(){const a=new URLSearchParams(location.search);ns=await core.urlToNoteSequence(a.get("url")),convert(ns,a)}async function loadMIDIFromBlob(a,b){ns=await core.blobToNoteSequence(a),convert(ns,b)}async function loadMIDIFromUrl(a,b){ns=await core.urlToNoteSequence(a),convert(ns,b)}function setMIDIInfo(a){if(a instanceof URLSearchParams){const f=a.get("title"),c=a.get("composer"),b=a.get("maintainer"),d=a.get("web"),e=a.get("license");if(document.getElementById("midiTitle").textContent=f,c!=b&&(document.getElementById("composer").textContent=c),d){const a=document.createElement("a");a.href=d,a.textContent=b,document.getElementById("maintainer").replaceChildren(a)}else document.getElementById("maintainer").textContent=b;try{new URL(e)}catch{document.getElementById("license").textContent=e}}else document.getElementById("midiTitle").textContent="",document.getElementById("composer").textContent="",document.getElementById("maintainer").textContent="",document.getElementById("license").textContent=""}function convert(a,c){const b=3;longestDuration=-(1/0),a.totalTime+=b,a.notes.forEach(a=>{a.startTime+=b,a.endTime+=b;const c=a.endTime-a.startTime;longestDuration<c&&(longestDuration=c)}),a.controlChanges.forEach(a=>{a.time+=b}),a.tempos.slice(1).forEach(a=>{a.time+=b}),a.timeSignatures.slice(1).forEach(a=>{a.time+=b}),a.notes=a.notes.sort((a,b)=>a.startTime<b.startTime?-1:a.startTime>b.startTime?1:0),nsCache=core.sequences.clone(a),setMIDIInfo(c),setToolbar(),initVisualizer(),changeButtons(),initPlayer()}async function loadSoundFontFileEvent(a){if(player){document.getElementById("soundfonts").options[0].selected=!0;const b=a.target.files[0],c=await b.arrayBuffer();await player.loadSoundFontBuffer(c)}}async function loadSoundFontUrlEvent(a){if(player){document.getElementById("soundfonts").options[0].selected=!0;const b=await fetch(a.target.value),c=await b.arrayBuffer();await player.loadSoundFontBuffer(c)}}function styleToViewBox(a){const b=a.style,c=parseFloat(b.width),d=parseFloat(b.height),e=`0 0 ${c} ${d}`;a.setAttribute("viewBox",e),a.removeAttribute("style")}function calcPixelsPerTimeStep(){let a=0;return ns.notes.forEach(b=>{a+=b.endTime-b.startTime}),a/=ns.notes.length,noteHeight/a}const MIN_NOTE_LENGTH=1;class WaterfallSVGVisualizer extends core.BaseSVGVisualizer{NOTES_PER_OCTAVE=12;WHITE_NOTES_PER_OCTAVE=7;LOW_C=12;firstDrawnOctave=0;lastDrawnOctave=8;constructor(d,b,a={}){if(super(d,a),!(b instanceof HTMLDivElement))throw new Error("This visualizer requires a <div> element to display the visualization");this.config.whiteNoteWidth=a.whiteNoteWidth||20,this.config.blackNoteWidth=a.blackNoteWidth||this.config.whiteNoteWidth*2/3,this.config.whiteNoteHeight=a.whiteNoteHeight||70,this.config.blackNoteHeight=a.blackNoteHeight||2*70/3,this.config.showOnlyOctavesUsed=a.showOnlyOctavesUsed,this.setupDOM(b);const c=this.getSize();this.width=c.width,this.height=c.height,this.svg.style.width=`${this.width}px`,this.svg.style.height=`${this.height}px`,this.svgPiano.style.width=`${this.width}px`,this.svgPiano.style.height=`${this.config.whiteNoteHeight}px`,this.parentElement.style.width=`${this.width+this.config.whiteNoteWidth}px`,this.parentElement.scrollTop=this.parentElement.scrollHeight,this.clear(),this.drawPiano(),this.draw()}setupDOM(a){this.parentElement=document.createElement("div"),this.parentElement.classList.add("waterfall-notes-container");const b=Math.max(a.getBoundingClientRect().height,200);this.parentElement.style.paddingTop=`${b-this.config.whiteNoteHeight}px`,this.parentElement.style.height=`${b-this.config.whiteNoteHeight}px`,this.parentElement.style.boxSizing="border-box",this.parentElement.style.overflowX="hidden",this.parentElement.style.overflowY="auto",this.svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),this.svgPiano=document.createElementNS("http://www.w3.org/2000/svg","svg"),this.svg.classList.add("waterfall-notes"),this.svgPiano.classList.add("waterfall-piano"),this.parentElement.appendChild(this.svg),a.innerHTML="",a.appendChild(this.parentElement),a.appendChild(this.svgPiano)}redraw(a,b){if(this.drawn||this.draw(),!a)return null;this.clearActiveNotes(),this.parentElement.style.paddingTop=this.parentElement.style.height;for(let c=0;c<this.noteSequence.notes.length;c++){const b=this.noteSequence.notes[c],e=a&&this.isPaintingActiveNote(b,a);if(!e)continue;const d=this.svg.querySelector(`rect[data-index="${c}"]`);this.fillActiveRect(d,b);const f=this.svgPiano.querySelector(`rect[data-pitch="${b.pitch}"]`);if(this.fillActiveRect(f,b),b===a){const a=parseFloat(d.getAttribute("y")),b=parseFloat(d.getAttribute("height"));return a<this.parentElement.scrollTop-b&&(this.parentElement.scrollTop=a+b),a}}return null}getSize(){this.updateMinMaxPitches(!0);let a=52;if(this.config.showOnlyOctavesUsed){let b=!1,c=!1;for(let a=1;a<7;a++){const d=this.LOW_C+this.NOTES_PER_OCTAVE*a;!b&&d>this.config.minPitch&&(this.firstDrawnOctave=a-1,b=!0),!c&&d>this.config.maxPitch&&(this.lastDrawnOctave=a-1,c=!0)}a=(this.lastDrawnOctave-this.firstDrawnOctave+1)*this.WHITE_NOTES_PER_OCTAVE}const c=a*this.config.whiteNoteWidth,b=this.noteSequence.totalTime;if(!b)throw new Error("The sequence you are using with the visualizer does not have a totalQuantizedSteps or totalTime field set, so the visualizer can't be horizontally sized correctly.");const d=Math.max(b*this.config.pixelsPerTimeStep,MIN_NOTE_LENGTH);return{width:c,height:d}}getNotePosition(a,h){const b=this.svgPiano.querySelector(`rect[data-pitch="${a.pitch}"]`);if(!b)return null;const e=this.getNoteEndTime(a)-this.getNoteStartTime(a),f=Number(b.getAttribute("x")),g=Number(b.getAttribute("width")),c=Math.max(this.config.pixelsPerTimeStep*e-this.config.noteSpacing,MIN_NOTE_LENGTH),d=this.height-this.getNoteStartTime(a)*this.config.pixelsPerTimeStep-c;return{x:f,y:d,w:g,h:c}}drawPiano(){this.svgPiano.innerHTML="";const c=this.config.whiteNoteWidth-this.config.blackNoteWidth/2,d=[1,3,6,8,10];let b=0,a=0;this.config.showOnlyOctavesUsed?a=this.firstDrawnOctave*this.NOTES_PER_OCTAVE+this.LOW_C:(a=this.LOW_C-3,this.drawWhiteKey(a,b),this.drawWhiteKey(a+2,this.config.whiteNoteWidth),a+=3,b=2*this.config.whiteNoteWidth);for(let c=this.firstDrawnOctave;c<=this.lastDrawnOctave;c++)for(let c=0;c<this.NOTES_PER_OCTAVE;c++)d.indexOf(c)===-1&&(this.drawWhiteKey(a,b),b+=this.config.whiteNoteWidth),a++;this.config.showOnlyOctavesUsed?(a=this.firstDrawnOctave*this.NOTES_PER_OCTAVE+this.LOW_C,b=-this.config.whiteNoteWidth):(this.drawWhiteKey(a,b),a=this.LOW_C-3,this.drawBlackKey(a+1,c),a+=3,b=this.config.whiteNoteWidth);for(let e=this.firstDrawnOctave;e<=this.lastDrawnOctave;e++)for(let e=0;e<this.NOTES_PER_OCTAVE;e++)d.indexOf(e)!==-1?this.drawBlackKey(a,b+c):b+=this.config.whiteNoteWidth,a++}drawWhiteKey(b,c){const a=document.createElementNS("http://www.w3.org/2000/svg","rect");return a.dataset.pitch=String(b),a.setAttribute("x",String(c)),a.setAttribute("y","0"),a.setAttribute("width",String(this.config.whiteNoteWidth)),a.setAttribute("height",String(this.config.whiteNoteHeight)),a.setAttribute("fill","white"),a.setAttribute("original-fill","white"),a.setAttribute("stroke","black"),a.setAttribute("stroke-width","3px"),a.classList.add("white"),this.svgPiano.appendChild(a),a}drawBlackKey(b,c){const a=document.createElementNS("http://www.w3.org/2000/svg","rect");return a.dataset.pitch=String(b),a.setAttribute("x",String(c)),a.setAttribute("y","0"),a.setAttribute("width",String(this.config.blackNoteWidth)),a.setAttribute("height",String(this.config.blackNoteHeight)),a.setAttribute("fill","black"),a.setAttribute("original-fill","black"),a.setAttribute("stroke","black"),a.setAttribute("stroke-width","3px"),a.classList.add("black"),this.svgPiano.appendChild(a),a}clearActiveNotes(){super.unfillActiveRect(this.svg);const a=this.svgPiano.querySelectorAll("rect.active");for(let b=0;b<a.length;++b){const c=a[b];c.setAttribute("fill",c.getAttribute("original-fill")),c.classList.remove("active")}}}function initVisualizer(){const b=document.getElementById("gamePanel"),c={showOnlyOctavesUsed:!0,pixelsPerTimeStep:calcPixelsPerTimeStep()};visualizer=new WaterfallSVGVisualizer(ns,b,c),styleToViewBox(visualizer.svg),styleToViewBox(visualizer.svgPiano),visualizer.svgPiano.classList.add("d-none"),setRectColor();const a=visualizer.parentElement;a.style.width="100%",a.style.height="50vh",a.style.paddingTop="50vh",a.style.overflowY="hidden",resize(),changeVisualizerPositions(visualizer)}class MagentaPlayer extends core.SoundFontPlayer{constructor(a,b,c){const d="https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus",e={run:a=>b(a),stop:()=>c()};super(d,void 0,void 0,void 0,e),this.ns=a,this.output.volume.value=20*Math.log(.5)/Math.log(10)}loadSamples(a){return super.loadSamples(a).then(()=>{this.synth=!0})}start(a){return super.start(a)}restart(a){return a&&super.start(ns,void 0,a/ns.ticksPerQuarter),this.start(this.ns)}stop(a){a||super.stop()}resume(a){super.resume(),this.seekTo(a)}changeVolume(a){a==0?a=-100:a=20*Math.log(a/100)/Math.log(10),this.output.volume.value=a}changeMute(a){this.output.mute=a}}class SoundFontPlayer{constructor(a){this.context=new AudioContext,this.state="stopped",this.callStop=!1,this.stopCallback=a,this.prevGain=.5,this.cacheUrls=new Array(128)}async loadSoundFontDir(b,c){const a=new Set;b.notes.forEach(b=>a.add(b.program)),b.notes.some(a=>a.isDrum)&&a.add(128);const d=[...a].map(a=>{const d=a.toString().padStart(3,"0"),b=`${c}/${d}.sf3`;return this.cacheUrls[a]==b||(this.cacheUrls[a]=b,this.fetchBuffer(b))}),e=await Promise.all(d);for(const a of e)a instanceof ArrayBuffer&&await this.loadSoundFontBuffer(a)}async fetchBuffer(b){const a=await fetch(b);return a.status==200?await a.arrayBuffer():void 0}async loadSoundFontUrl(a){const b=await this.fetchBuffer(a),c=await this.loadSoundFontBuffer(b);return c}async loadSoundFontBuffer(a){if(!this.synth){await this.context.audioWorklet.addModule("https://cdn.jsdelivr.net/npm/js-synthesizer@1.8.5/externals/libfluidsynth-2.3.0-with-libsndfile.min.js"),await this.context.audioWorklet.addModule("https://cdn.jsdelivr.net/npm/js-synthesizer@1.8.5/dist/js-synthesizer.worklet.min.js"),this.synth=new JSSynth.AudioWorkletNodeSynthesizer,this.synth.init(this.context.sampleRate);const a=this.synth.createAudioNode(this.context);a.connect(this.context.destination)}const b=await this.synth.loadSFont(a);return b}async loadNoteSequence(a){await this.synth.resetPlayer(),this.ns=a;const b=core.sequenceProtoToMidi(a);return player.synth.addSMFDataToPlayer(b)}resumeContext(){this.context.resume()}async restart(a){this.state="started",await this.synth.playPlayer(),this.seekTo(a),await this.synth.waitForPlayerStopped(),await this.synth.waitForVoicesStopped(),this.callStop&&(this.stopCallback(),this.callStop=!1)}async start(a,c,b){a&&await this.loadNoteSequence(a),b&&this.seekTo(b),this.restart()}stop(a){this.isPlaying()?(this.state="stopped",this.callStop=a,this.synth.stopPlayer(),this.seekTo(0)):a&&(this.callStop=a,this.seekTo(0),this.stopCallback())}pause(){this.state="paused",this.synth.stopPlayer()}resume(a){this.restart(a)}changeVolume(a){a=a/100,this.synth.setGain(a)}changeMute(a){a?(this.prevGain=this.synth.getGain(),this.synth.setGain(0)):this.synth.setGain(this.prevGain)}calcTick(d){let a=0,b=0,c=120;for(const f of this.ns.tempos){const e=f.time,g=f.qpm;if(e<d){const d=e-b;a+=c/60*d*this.ns.ticksPerQuarter}else{const e=d-b;return a+=c/60*e*this.ns.ticksPerQuarter,a}b=e,c=g}const e=d-b;return a+=c/60*e*this.ns.ticksPerQuarter,a}seekTo(a){const b=this.calcTick(a);this.synth.seekPlayer(b)}isPlaying(){return!!this.synth&&this.synth.isPlaying()}getPlayState(){return this.synth?this.synth.isPlaying()?"started":this.state:"stopped"}}function stopCallback(){clearPlayer();const a=document.getElementById("repeat"),b=a.classList.contains("active");b&&(initSeekbar(ns,0),setLoadingTimer(0),player.restart()),scoring(),scoreModal.show(),[...visualizer.svg.getElementsByClassName("fade")].forEach(a=>{a.classList.remove("fade")})}async function initPlayer(){disableController(),player&&player.isPlaying()&&stop(),currentTime=0,initSeekbar(ns,0),player=new SoundFontPlayer(stopCallback),firstRun?(firstRun=!1,await loadSoundFont("GeneralUser_GS_v1.471")):await loadSoundFont(),enableController()}async function loadSoundFont(a){if(player instanceof SoundFontPlayer){if(!a){const b=document.getElementById("soundfonts");a=b.options[b.selectedIndex].value}const b=`https://soundfonts.pages.dev/${a}`;await player.loadSoundFontDir(ns,b),await player.loadNoteSequence(ns)}}function setTimer(b){const c=1,d=Date.now()-b*1e3,a=ns.totalTime;clearInterval(timer),timer=setInterval(()=>{const b=(Date.now()-d)/1e3;if(Math.floor(currentTime)!=Math.floor(b)&&updateSeekbar(b),currentTime=b,currentTime<a){const b=1-currentTime/a;visualizer.parentElement.scrollTop=currentScrollHeight*b}else stop(!0),clearInterval(timer),currentTime=0,visualizer.parentElement.scrollTop=visualizer.parentElement.scrollHeight},c)}function setLoadingTimer(a){const b=setInterval(()=>{player.isPlaying()&&(clearInterval(b),player.seekTo(a),setTimer(a),enableController())},10)}function disableController(){controllerDisabled=!0;const a=document.getElementById("controller").querySelectorAll("button, input");[...a].forEach(a=>{a.disabled=!0})}function enableController(){controllerDisabled=!1;const a=document.getElementById("controller").querySelectorAll("button, input");[...a].forEach(a=>{a.disabled=!1})}function unlockAudio(){player.resumeContext()}function play(){switch(tapCount=perfectCount=greatCount=0,disableController(),document.getElementById("play").classList.add("d-none"),document.getElementById("pause").classList.remove("d-none"),player.getPlayState()){case"started":case"stopped":setLoadingTimer(currentTime),player.restart();break;case"paused":player.resume(currentTime),setTimer(currentTime),enableController();break}window.scrollTo({top:document.getElementById("playPanel").getBoundingClientRect().top,behavior:"auto"})}function pause(){player.pause(),clearPlayer()}function stop(a){document.getElementById("currentTime").textContent=formatTime(0),player.stop(a),clearPlayer()}function clearPlayer(){clearInterval(timer),document.getElementById("play").classList.remove("d-none"),document.getElementById("pause").classList.add("d-none")}function getCheckboxString(b,a){return`
<div class="form-check form-check-inline">
  <label class="form-check-label">
    <input class="form-check-input" name="${b}" value="${a}" type="checkbox" checked>
    ${a}
  </label>
</div>`}function setInstrumentsCheckbox(){const a=new Set;ns.notes.forEach(b=>{a.add(b.instrument)}),instrumentStates=new Map;let b="";a.forEach(a=>{b+=getCheckboxString("instrument",a),instrumentStates.set(a,!0)});const d=(new DOMParser).parseFromString(b,"text/html"),c=document.getElementById("filterInstruments");c.replaceChildren(...d.body.children),[...c.querySelectorAll("input")].forEach(a=>{a.addEventListener("change",()=>{tapCount=perfectCount=greatCount=0;const b=a.value;[...visualizer.svg.children].forEach(a=>{a.dataset.instrument==b&&a.classList.toggle("d-none")});const c=parseInt(b),d=instrumentStates.get(c);instrumentStates.set(parseInt(c),!d),visualizer&&ns&&changeVisualizerPositions(visualizer)})})}function setProgramsCheckbox(){const a=new Set;ns.notes.forEach(b=>{a.add(b.program)}),programStates=new Map;let b="";a.forEach(a=>{b+=getCheckboxString("program",a),programStates.set(a,!0)});const d=(new DOMParser).parseFromString(b,"text/html"),c=document.getElementById("filterPrograms");c.replaceChildren(...d.body.children),[...c.querySelectorAll("input")].forEach(a=>{a.addEventListener("change",()=>{tapCount=perfectCount=greatCount=0;const b=a.value;[...visualizer.svg.children].forEach(a=>{a.dataset.program==b&&a.classList.toggle("d-none")});const c=parseInt(b),d=programStates.get(c);programStates.set(parseInt(c),!d),visualizer&&ns&&changeVisualizerPositions(visualizer)})})}function setToolbar(){setProgramsCheckbox(),setInstrumentsCheckbox()}function speedDown(){player.isPlaying()&&disableController();const a=document.getElementById("speed"),b=parseInt(a.value)-10,c=b<=0?1:b;a.value=c,changeSpeed(c)}function speedUp(){player.isPlaying()&&disableController();const a=document.getElementById("speed"),b=parseInt(a.value)+10;a.value=b,changeSpeed(b)}async function changeSpeed(b){if(perfectCount=greatCount=0,!ns)return;const c=player.getPlayState();player.stop(),clearInterval(timer);const d=nsCache.totalTime/ns.totalTime,e=d/(b/100),a=currentTime*e;setSpeed(ns,b),initSeekbar(ns,a),c=="started"?(setLoadingTimer(a),player.start(ns)):player instanceof SoundFontPlayer&&(await player.loadNoteSequence(ns),player.seekTo(a))}function changeSpeedEvent(a){player.isPlaying()&&disableController();const b=parseInt(a.target.value);changeSpeed(b)}function setSpeed(b,a){a<=0&&(a=1),a/=100;const e=nsCache.controlChanges;b.controlChanges.forEach((b,c)=>{b.time=e[c].time/a});const c=nsCache.tempos;b.tempos.forEach((b,d)=>{b.time=c[d].time/a,b.qpm=c[d].qpm*a});const f=nsCache.timeSignatures;b.timeSignatures.forEach((b,c)=>{b.time=f[c].time/a});const d=nsCache.notes;b.notes.forEach((b,c)=>{b.startTime=d[c].startTime/a,b.endTime=d[c].endTime/a}),b.totalTime=nsCache.totalTime/a}function repeat(){document.getElementById("repeat").classList.toggle("active")}function volumeOnOff(){const b=document.getElementById("volumeOnOff").firstElementChild,a=document.getElementById("volumebar");b.classList.contains("bi-volume-up-fill")?(b.className="bi bi-volume-mute-fill",a.dataset.value=a.value,a.value=0,player.changeMute(!0)):(b.className="bi bi-volume-up-fill",a.value=a.dataset.value,player.changeMute(!1))}function changeVolumebar(){const a=document.getElementById("volumebar"),b=parseInt(a.value);a.dataset.value=b,player.changeVolume(b)}function formatTime(a){a=Math.floor(a);const c=a%60,b=(a-c)/60,d=(a-c-60*b)/3600,e=String(c).padStart(2,"0"),f=b>9||!d?`${b}:`:`0${b}:`,g=d?`${d}:`:"";return`${g}${f}${e}`}function changeSeekbar(a){perfectCount=greatCount=0,clearInterval(timer),[...visualizer.svg.getElementsByClassName("fade")].forEach(a=>{a.classList.remove("fade")}),currentTime=parseInt(a.target.value),document.getElementById("currentTime").textContent=formatTime(currentTime),seekScroll(currentTime),player.getPlayState()=="started"&&(player.seekTo(currentTime),setTimer(currentTime))}function updateSeekbar(a){const b=document.getElementById("seekbar");b.value=a;const c=formatTime(a);document.getElementById("currentTime").textContent=c}function initSeekbar(a,b){document.getElementById("seekbar").max=a.totalTime,document.getElementById("seekbar").value=b,document.getElementById("totalTime").textContent=formatTime(a.totalTime),document.getElementById("currentTime").textContent=formatTime(b)}function loadSoundFontList(){return fetch("https://soundfonts.pages.dev/list.json").then(a=>a.json()).then(a=>{const b=document.getElementById("soundfonts");a.forEach(c=>{const a=document.createElement("option");a.textContent=c.name,c.name=="GeneralUser_GS_v1.471"&&(a.selected=!0),b.appendChild(a)})})}async function changeConfig(){switch(player.getPlayState()){case"started":{player.stop(),await loadSoundFont();const b=parseInt(document.getElementById("speed").value);setSpeed(ns,b);const a=parseInt(document.getElementById("seekbar").value);initSeekbar(ns,a),setLoadingTimer(a),player.start(ns);break}case"paused":configChanged=!0;break}}function resize(){const a=visualizer.parentElement,b=a.getBoundingClientRect().height;currentScrollHeight=a.scrollHeight-b,seekScroll(currentTime)}function seekScroll(a){const b=(ns.totalTime-a)/ns.totalTime;visualizer.parentElement.scrollTop=currentScrollHeight*b}function getMinMaxPitch(){let a=1/0,b=-(1/0);return ns.notes.filter(a=>instrumentStates.get(a.instrument)).filter(a=>programStates.get(a.program)).forEach(c=>{c.pitch<a&&(a=c.pitch),b<c.pitch&&(b=c.pitch)}),[a,b]}function changeVisualizerPositions(a){const[b,i]=getMinMaxPitch(),e=i-b+1,d=document.getElementById("courseOption").selectedIndex,f=e/d,g=a.svg.getAttribute("viewBox").split(" "),h=parseFloat(g[2]),c=h/d;[...a.svg.children].filter(a=>!a.classList.contains("d-none")).forEach(a=>{const d=parseInt(a.dataset.pitch),e=Math.floor((d-b)/f);a.setAttribute("x",Math.ceil(e*c)),a.setAttribute("width",c)})}function typeEvent(a){if(!player||!player.synth)return;if(controllerDisabled)return;switch(player.resumeContext(),a.code){case"Space":a.preventDefault(),player.getPlayState()=="started"?pause():play();break;default:return typeEventKey(a.key)}}function typeEventKey(d){const a=document.getElementById("courseOption").selectedIndex,b=Array.from("AWSEDRFTGYHUJIKOLP;@".toLowerCase()),e=a>10?b.slice(0,a):b.filter((b,a)=>a%2==0).slice(0,a),c=e.indexOf(d);c!=-1&&keyEvents[c]()}function searchNotePosition(b,e){let c=0,d=b.length-1,a;while(c<=d)if(a=Math.floor((c+d)/2),b[a].startTime>e)d=a-1;else if(b[a].startTime<e)c=a+1;else return a;return a}function buttonEvent(a,f,d){tapCount+=1;const g=visualizer.svg.getBoundingClientRect().height,c=visualizer.parentElement.scrollTop/g;let b="MISS";const e=1,h=currentTime-longestDuration-e,i=searchNotePosition(ns.notes,h),j=currentTime+e,k=searchNotePosition(ns.notes,j)+1;switch([...visualizer.svg.children].slice(i,k).filter(a=>f==parseInt(a.getAttribute("x"))).filter(a=>!a.classList.contains("d-none")).filter(a=>!a.classList.contains("fade")).forEach(a=>{const e=parseFloat(a.getAttribute("y")),j=parseFloat(a.getAttribute("height")),f=2,g=(e-f)/d,h=(e+j+f)/d,i=(g+h)/2;i<=c&&c<=h?(b="PERFECT",a.classList.add("fade"),perfectCount+=1):g<=c&&c<i&&(b="GREAT",a.classList.add("fade"),greatCount+=1)}),b){case"PERFECT":a.textContent=b,a.className="badge bg-primary";break;case"GREAT":a.textContent=b,a.className="badge bg-success";break;case"MISS":a.className="badge bg-danger";break}setTimeout(()=>{a.textContent="MISS",a.className="badge"},200)}function setButtonEvent(b,c,d,e){const a=()=>{buttonEvent(c,d,e)};"ontouchstart"in window?b.ontouchstart=a:b.onclick=a,keyEvents.push(a)}function changeButtons(){tapCount=perfectCount=greatCount=0,keyEvents=[];const b=Array.from("AWSEDRFTGYHUJIKOLP;@"),a=document.getElementById("courseOption").selectedIndex,c=document.getElementById("playPanel");c.replaceChildren();const d=visualizer.svg.getAttribute("viewBox").split(" "),e=parseFloat(d[2]),f=parseFloat(d[3]),g=e/a;for(let d=0;d<a;d++){const j=Math.ceil(d*g),h=document.createElement("div");h.className="w-100";const i=document.createElement("span");i.className="badge",i.textContent="MISS";const e=document.createElement("button");e.className="w-100 btn btn-light btn-tap",e.role="button",e.textContent=a>10?b[d]:b[d*2],setButtonEvent(e,i,j,f),h.appendChild(e),h.appendChild(i),c.appendChild(h)}document.removeEventListener("keydown",typeEvent),document.addEventListener("keydown",typeEvent),visualizer&&ns&&changeVisualizerPositions(visualizer)}function countNotes(){return ns.notes.filter(a=>instrumentStates.get(a.instrument)).filter(a=>programStates.get(a.program)).length}function getAccuracy(){return tapCount==0?0:(perfectCount+greatCount)/tapCount}function scoring(){const a=countNotes(),l=getAccuracy(),c=a-perfectCount-greatCount,j=Math.ceil(perfectCount/a*1e4)/100,e=Math.ceil(greatCount/a*1e4)/100,f=Math.ceil(c/a*1e4)/100,g=perfectCount*2+greatCount,h=parseInt(document.getElementById("speed").value),i=document.getElementById("courseOption").selectedIndex,d=Array.from(programStates.values()).filter(a=>a).length,k=Array.from(instrumentStates.values()).filter(a=>a).length,b=parseInt(g*h*d*k*i*l);document.getElementById("perfectCount").textContent=perfectCount,document.getElementById("greatCount").textContent=greatCount,document.getElementById("missCount").textContent=c,document.getElementById("perfectRate").textContent=j+"%",document.getElementById("greatRate").textContent=e+"%",document.getElementById("missRate").textContent=f+"%",document.getElementById("score").textContent=b;const m=document.getElementById("midiTitle").textContent,n=document.getElementById("composer").textContent,o=`${m} ${n}`,p=encodeURIComponent(`Tip Tap Notes! ${o}: ${b}`),q="https://marmooo.github.com/tip-tap-notes/",r=`https://twitter.com/intent/tweet?text=${p}&url=${q}&hashtags=TipTapNotes`;document.getElementById("twitter").href=r}function initQuery(){const a=new URLSearchParams;return a.set("title","When the Swallows Homeward Fly (Agathe)"),a.set("composer","Franz Wilhelm Abt"),a.set("maintainer","Stan Sanderson"),a.set("license","Public Domain"),a}const noteHeight=30;let controllerDisabled,keyEvents=[],colorful=!0,currentTime=0,currentScrollHeight,longestDuration,ns,nsCache,timer,player,visualizer,programStates,instrumentStates,tapCount=0,perfectCount=0,greatCount=0,firstRun=!0;if(loadConfig(),location.search)loadMIDIFromUrlParams();else{const a=initQuery();loadMIDIFromUrl("abt.mid",a)}loadSoundFontList();const scoreModal=new bootstrap.Modal("#scorePanel",{backdrop:"static",keyboard:!1});document.getElementById("toggleDarkMode").onclick=toggleDarkMode,document.getElementById("toggleColor").onclick=toggleRectColor,document.ondragover=a=>{a.preventDefault()},document.ondrop=dropFileEvent,document.getElementById("play").onclick=play,document.getElementById("pause").onclick=pause,document.getElementById("speed").onchange=changeSpeedEvent,document.getElementById("speedDown").onclick=speedDown,document.getElementById("speedUp").onclick=speedUp,document.getElementById("repeat").onclick=repeat,document.getElementById("volumeOnOff").onclick=volumeOnOff,document.getElementById("volumebar").onchange=changeVolumebar,document.getElementById("seekbar").onchange=changeSeekbar,document.getElementById("inputMIDIFile").onchange=loadMIDIFileEvent,document.getElementById("inputMIDIUrl").onchange=loadMIDIUrlEvent,document.getElementById("inputSoundFontFile").onchange=loadSoundFontFileEvent,document.getElementById("inputSoundFontUrl").onchange=loadSoundFontUrlEvent,document.getElementById("soundfonts").onchange=changeConfig,document.getElementById("courseOption").onchange=changeButtons,window.addEventListener("resize",resize),document.addEventListener("click",unlockAudio,{once:!0,useCapture:!0})