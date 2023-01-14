function loadConfig(){localStorage.getItem("darkMode")==1&&(document.documentElement.dataset.theme="dark")}function toggleDarkMode(){localStorage.getItem("darkMode")==1?(localStorage.setItem("darkMode",0),delete document.documentElement.dataset.theme):(localStorage.setItem("darkMode",1),document.documentElement.dataset.theme="dark")}function dropFileEvent(a){a.preventDefault();const b=a.dataTransfer.files[0],c=new DataTransfer;c.items.add(b);const d=document.getElementById("inputFile");d.files=c.files,convertFromBlob(b)}function convertFileEvent(a){convertFromBlob(a.target.files[0])}function convertUrlEvent(a){convertFromUrl(a.target.value)}async function convertFromUrlParams(){const a=parseQuery(location.search);ns=await core.urlToNoteSequence(a.url),convert(ns)}async function convertFromBlob(a){ns=await core.blobToNoteSequence(a),convert(ns)}async function convertFromUrl(a){ns=await core.urlToNoteSequence(a),convert(ns)}function convert(a){a.totalTime+=3,a.notes.forEach(a=>{a.startTime+=3,a.endTime+=3}),nsCache=core.sequences.clone(a),setToolbar(),initVisualizer(),changeButtons(),initPlayer()}function getScale(a){const b=a.parentElement.getBoundingClientRect(),c=a.getSize();return b.width/c.width}function redraw(a,b){if(a.drawn||a.draw(),!b)return null;const c=a.parentElement;a.clearActiveNotes(),c.style.paddingTop=c.style.height;const e=getScale(a),d=a.noteSequence.notes;for(let f=0;f<d.length;f++){const g=d[f],i=b&&a.isPaintingActiveNote(g,b);if(!i)continue;const h=a.svg.querySelector(`rect[data-index="${f}"]`);if(a.fillActiveRect(h,g),g===b){const a=parseFloat(h.getAttribute("y")),b=parseFloat(h.getAttribute("height"));return c.scrollTop=(a+b)*e,a}}return null}function styleToViewBox(a){const b=a.style,c=parseFloat(b.width),d=parseFloat(b.height),e=`0 0 ${c} ${d}`;a.setAttribute("viewBox",e),a.removeAttribute("style")}function calcPixelsPerTimeStep(){let a=0;return ns.notes.forEach(b=>{a+=b.endTime-b.startTime}),a/=ns.notes.length,30/a}function initVisualizer(){const b=document.getElementById("gamePanel"),c={showOnlyOctavesUsed:!0,pixelsPerTimeStep:calcPixelsPerTimeStep()};visualizer=new core.WaterfallSVGVisualizer(ns,b,c),styleToViewBox(visualizer.svg),styleToViewBox(visualizer.svgPiano),visualizer.svgPiano.classList.add("d-none"),[...visualizer.svg.children].forEach(a=>{a.setAttribute("fill","rgba(0, 0, 0, 0.5)")});const a=visualizer.parentElement;a.style.width="100%",a.style.height="60vh",a.style.overflowY="hidden",a.scrollTop=a.scrollHeight,changeVisualizerPositions(visualizer)}async function initPlayer(){const a="https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus",b={run:a=>redraw(visualizer,a),stop:()=>{visualizer.clearActiveNotes(),clearPlayer();const a=visualizer.parentElement;a.scrollTop=a.scrollHeight;const b=document.getElementById("repeat"),c=b.classList.contains("active");c&&(player.start(ns),setSmoothScroll(),initSeekbar(ns,0)),scoring(),scoreModal.show(),[...visualizer.svg.childNodes].forEach(a=>{a.classList.contains("scored")&&a.classList.remove("scored")})}};stop(),player=new core.SoundFontPlayer(a,void 0,void 0,void 0,b),await player.loadSamples(ns)}function setSmoothScroll(){let a=0;const b=10,d=Date.now()+ns.totalTime*1e3,c=visualizer.parentElement;scrollInterval=setInterval(()=>{if(Date.now()<d){{const d=c.scrollHeight,e=d/ns.totalTime*b/1e3;if(a+=e,a>=1){const b=Math.floor(a);c.scrollTop-=b,a-=b}}}else clearInterval(scrollInterval)},b)}function play(){switch(perfectCount=greatCount=0,document.getElementById("play").classList.add("d-none"),document.getElementById("pause").classList.remove("d-none"),player.getPlayState()){case"stopped":if(player.getPlayState()=="started")return;setSpeed(ns),player.start(ns),setSmoothScroll(),initSeekbar(ns,0);break;case"paused":{player.resume();const a=parseInt(document.getElementById("seekbar").value);setSeekbarInterval(a),setSmoothScroll()}}}function pause(){player.pause(),clearPlayer()}function stop(){player&&player.isPlaying()&&(document.getElementById("currentTime").textContent=formatTime(0),player.stop(),clearPlayer())}function clearPlayer(){document.getElementById("play").classList.remove("d-none"),document.getElementById("pause").classList.add("d-none"),clearInterval(seekbarInterval),clearInterval(scrollInterval)}function getCheckboxString(b,a){return`
<div class="form-check form-check-inline">
  <label class="form-check-label">
    <input class="form-check-input" name="${b}" value="${a}" type="checkbox" checked>
    ${a}
  </label>
</div>`}function setInstrumentsCheckbox(){const a=new Set;ns.notes.forEach(b=>{a.add(b.instrument)}),instrumentStates=new Map;let b="";a.forEach(a=>{b+=getCheckboxString("instrument",a),instrumentStates.set(a,!0)});const d=(new DOMParser).parseFromString(b,"text/html"),c=document.getElementById("filterInstruments");c.replaceChildren(...d.body.childNodes),[...c.querySelectorAll("input")].forEach(a=>{a.addEventListener("change",()=>{const b=a.value;[...visualizer.svg.children].forEach(a=>{a.dataset.instrument==b&&a.classList.toggle("d-none")}),visualizer&&ns&&changeVisualizerPositions(visualizer);const c=parseInt(b),d=instrumentStates.get(c);instrumentStates.set(parseInt(c),!d)})})}function setProgramsCheckbox(){const a=new Set;ns.notes.forEach(b=>{a.add(b.program)}),programStates=new Map;let b="";a.forEach(a=>{b+=getCheckboxString("program",a),programStates.set(a,!0)});const d=(new DOMParser).parseFromString(b,"text/html"),c=document.getElementById("filterPrograms");c.replaceChildren(...d.body.childNodes),[...c.querySelectorAll("input")].forEach(a=>{a.addEventListener("change",()=>{const b=a.value;[...visualizer.svg.children].forEach(a=>{a.dataset.program==b&&a.classList.toggle("d-none")}),visualizer&&ns&&changeVisualizerPositions(visualizer);const c=parseInt(b),d=programStates.get(c);programStates.set(parseInt(c),!d)})})}function setToolbar(){setProgramsCheckbox(),setInstrumentsCheckbox()}function speedDown(){const a=document.getElementById("speed"),b=parseInt(a.value)-10;b<0?a.value=0:a.value=b,document.getElementById("speedDown").disabled=!0,changeSpeed(),document.getElementById("speedDown").disabled=!1}function speedUp(){const a=document.getElementById("speed");a.value=parseInt(a.value)+10,document.getElementById("speedUp").disabled=!0,changeSpeed(),document.getElementById("speedUp").disabled=!1}function changeSpeed(){if(perfectCount=greatCount=0,!ns)return;switch(player.getPlayState()){case"started":{player.stop(),clearInterval(seekbarInterval),clearInterval(scrollInterval);const b=ns.totalTime;setSpeed(ns);const c=b/ns.totalTime,d=parseInt(document.getElementById("seekbar").value),a=d/c;player.start(ns,void 0,a),setSmoothScroll(),initSeekbar(ns,a);break}case"paused":{speedChanged=!0;break}}}function setSpeed(b){const e=document.getElementById("speed"),a=parseInt(e.value)/100,f=nsCache.controlChanges;b.controlChanges.forEach((b,c)=>{b.time=f[c].time/a});const c=nsCache.tempos;b.tempos.forEach((b,d)=>{b.time=c[d].time/a,b.qpm=c[d].qpm*a});const d=nsCache.notes;b.notes.forEach((b,c)=>{b.startTime=d[c].startTime/a,b.endTime=d[c].endTime/a}),b.totalTime=nsCache.totalTime/a}function repeat(){document.getElementById("repeat").classList.toggle("active")}function volumeOnOff(){const b=document.getElementById("volumeOnOff").firstElementChild,a=document.getElementById("volumebar");b.classList.contains("bi-volume-up-fill")?(b.className="bi bi-volume-mute-fill",a.dataset.value=a.value,a.value=-50,player.output.mute=!0):(b.className="bi bi-volume-up-fill",a.value=a.dataset.value,player.output.mute=!1)}function changeVolumebar(){const a=document.getElementById("volumebar"),b=a.value;a.dataset.value=b,player.output.volume.value=b}function formatTime(a){a=Math.floor(a);const c=a%60,b=(a-c)/60,d=(a-c-60*b)/3600,e=String(c).padStart(2,"0"),f=b>9||!d?`${b}:`:`0${b}:`,g=d?`${d}:`:"";return`${g}${f}${e}`}function changeSeekbar(b){perfectCount=greatCount=0,clearInterval(seekbarInterval);const a=parseInt(b.target.value);document.getElementById("currentTime").textContent=formatTime(a),resizeScroll(),player.isPlaying()&&(player.seekTo(a),player.getPlayState()=="started"&&setSeekbarInterval(a))}function updateSeekbar(a){const b=document.getElementById("seekbar");b.value=a;const c=formatTime(a);document.getElementById("currentTime").textContent=c}function initSeekbar(a,b){document.getElementById("seekbar").max=a.totalTime,document.getElementById("seekbar").value=b,document.getElementById("totalTime").textContent=formatTime(a.totalTime),clearInterval(seekbarInterval),setSeekbarInterval(b)}function setSeekbarInterval(a){seekbarInterval=setInterval(()=>{updateSeekbar(a),a+=1},1e3)}function resizeScroll(){const b=parseInt(document.getElementById("seekbar").value),a=visualizer.parentElement,c=(ns.totalTime-b/ns.totalTime)*a.scrollHeight;a.scrollTop=c}function getMinMaxPitch(){let a=1/0,b=-(1/0);return ns.notes.forEach(c=>{c.pitch<a&&(a=c.pitch),b<c.pitch&&(b=c.pitch)}),[a,b]}function changeVisualizerPositions(a){const[b,i]=getMinMaxPitch(),e=i-b+1,d=document.getElementById("levelOption").selectedIndex,f=e/d,g=a.svg.getAttribute("viewBox").split(" "),h=parseFloat(g[2]),c=h/d;[...a.svg.childNodes].filter(a=>!a.classList.contains("d-none")).forEach(a=>{const d=parseInt(a.dataset.pitch),e=Math.floor((d-b)/f);a.setAttribute("x",Math.ceil(e*c)),a.setAttribute("width",c)})}function typeEvent(a){switch(a.code){case"Space":a.preventDefault(),player.getPlayState()=="started"?pause():play();break;default:return typeEventKey(a.key)}}function typeEventKey(b){const c=Array.from("AWSEDRFTGYHUJIKOLP;@".toLowerCase()),e=document.getElementById("playPanel"),a=[...e.querySelectorAll("button")],d=a.length>9?c.slice(0,a.length):c.filter((b,a)=>a%2==0).slice(0,a.length);if(d.includes(b)){const c=d.indexOf(b);a[c].click()}}function setButtonEvent(c,a,d,b){c.onclick=()=>{tapCount+=1;const f=visualizer.svg.getBoundingClientRect().height,e=visualizer.parentElement.scrollTop/f;let c="MISS";switch([...visualizer.svg.childNodes].filter(a=>d==parseInt(a.getAttribute("x"))).filter(a=>!a.classList.contains("d-none")).filter(a=>!a.classList.contains("scored")).forEach(a=>{const d=parseFloat(a.getAttribute("y")),j=parseFloat(a.getAttribute("height")),f=2,g=(d-f)/b,h=(d+j+f)/b,i=(g+h)/2;i<=e&&e<=h?(c="PERFECT",a.classList.add("scored"),perfectCount+=1):g<=e&&e<i&&(c="GREAT",a.classList.add("scored"),greatCount+=1)}),c){case"PERFECT":a.textContent=c,a.className="badge bg-primary";break;case"GREAT":a.textContent=c,a.className="badge bg-success";break;case"MISS":a.className="badge bg-danger";break}setTimeout(()=>{a.textContent="MISS",a.className="badge"},200)}}function changeButtons(){tapCount=perfectCount=greatCount=0;const b=Array.from("AWSEDRFTGYHUJIKOLP;@"),a=document.getElementById("levelOption").selectedIndex,c=document.getElementById("playPanel");c.replaceChildren();const d=visualizer.svg.getAttribute("viewBox").split(" "),e=parseFloat(d[2]),f=parseFloat(d[3]),g=e/a;for(let d=0;d<a;d++){const j=Math.ceil(d*g),h=document.createElement("div");h.className="w-100";const i=document.createElement("span");i.className="badge",i.textContent="MISS";const e=document.createElement("button");e.className="w-100 btn btn-lg btn-outline-secondary",e.role="button",e.textContent=a>9?b[d]:b[d*2],setButtonEvent(e,i,j,f),h.appendChild(e),h.appendChild(i),c.appendChild(h)}document.removeEventListener("keydown",typeEvent),document.addEventListener("keydown",typeEvent),visualizer&&ns&&changeVisualizerPositions(visualizer)}function filterNotes(){return ns.notes.filter(a=>instrumentStates.get(a.instrument)).filter(a=>programStates.get(a.program))}function scoring(){const a=filterNotes().length,l=(perfectCount+greatCount)/tapCount,c=a-perfectCount-greatCount,i=Math.ceil(perfectCount/a*1e4)/100,e=Math.ceil(greatCount/a*1e4)/100,f=Math.ceil(c/a*1e4)/100,g=perfectCount*2+greatCount,h=parseInt(document.getElementById("speed").value),d=document.getElementById("levelOption").selectedIndex,j=Array.from(programStates.values()).filter(a=>a).length,k=Array.from(instrumentStates.values()).filter(a=>a).length,b=parseInt(g*h*j*k*d*l);document.getElementById("perfectCount").textContent=perfectCount,document.getElementById("greatCount").textContent=greatCount,document.getElementById("missCount").textContent=c,document.getElementById("perfectRate").textContent=i+"%",document.getElementById("greatRate").textContent=e+"%",document.getElementById("missRate").textContent=f+"%",document.getElementById("score").textContent=b;const m=`title composer`,n=encodeURIComponent(`Tip Tap Notes! ${m}: ${b}`),o="https://marmooo.github.com/tip-tap-notes/",p=`https://twitter.com/intent/tweet?text=${n}&url=${o}&hashtags=TipTapNotes`;document.getElementById("twitter").href=p}let ns,nsCache,seekbarInterval,scrollInterval,player,visualizer,programStates,instrumentStates,perfectCount=0,greatCount=0;loadConfig(),location.search?convertFromUrlParams():convertFromUrl("abt.mid");const scoreModal=new bootstrap.Modal("#scorePanel",{backdrop:"static",keyboard:!1});document.getElementById("toggleDarkMode").onclick=toggleDarkMode,document.ondragover=a=>{a.preventDefault()},document.ondrop=dropFileEvent,document.getElementById("inputFile").onchange=convertFileEvent,document.getElementById("inputUrl").onchange=convertUrlEvent,document.getElementById("play").onclick=play,document.getElementById("pause").onclick=pause,document.getElementById("speed").onchange=changeSpeed,document.getElementById("speedDown").onclick=speedDown,document.getElementById("speedUp").onclick=speedUp,document.getElementById("repeat").onclick=repeat,document.getElementById("volumeOnOff").onclick=volumeOnOff,document.getElementById("volumebar").onchange=changeVolumebar,document.getElementById("seekbar").onchange=changeSeekbar,document.getElementById("levelOption").onchange=changeButtons,window.addEventListener("resize",resizeScroll)