function loadConfig(){localStorage.getItem("darkMode")==1&&(document.documentElement.dataset.theme="dark")}function toggleDarkMode(){localStorage.getItem("darkMode")==1?(localStorage.setItem("darkMode",0),delete document.documentElement.dataset.theme):(localStorage.setItem("darkMode",1),document.documentElement.dataset.theme="dark")}function getRandomInt(a,b){return a=Math.ceil(a),b=Math.floor(b),Math.floor(Math.random()*(b-a))+a}function getRectColor(){if(colorful){const a=getRandomInt(0,127),b=getRandomInt(0,127),c=getRandomInt(0,127);return`rgba(${a}, ${b}, ${c}, 0.5)`}return"rgba(0, 0, 0, 0.5)"}function setRectColor(){[...visualizer.svg.children].forEach(a=>{const b=getRectColor();a.setAttribute("fill",b)})}function toggleRectColor(){colorful=!colorful,setRectColor()}function dropFileEvent(a){a.preventDefault();const b=a.dataTransfer.files[0],c=new DataTransfer;c.items.add(b);const d=document.getElementById("inputFile");d.files=c.files,convertFromBlob(b)}function convertFileEvent(a){convertFromBlob(a.target.files[0])}function convertUrlEvent(a){convertFromUrl(a.target.value)}async function convertFromUrlParams(){const a=new URLSearchParams(location.search);ns=await core.urlToNoteSequence(a.get("url")),convert(ns,a)}async function convertFromBlob(a,b){ns=await core.blobToNoteSequence(a),convert(ns,b)}async function convertFromUrl(a,b){ns=await core.urlToNoteSequence(a),convert(ns,b)}function setMIDIInfo(a){if(!(a instanceof URLSearchParams))return;const f=a.get("title"),c=a.get("composer"),b=a.get("maintainer"),d=a.get("web"),e=a.get("license");if(document.getElementById("midiTitle").textContent=f,c!=b&&(document.getElementById("composer").textContent=c),d){const a=document.createElement("a");a.href=d,a.textContent=b,document.getElementById("maintainer").replaceChildren(a)}else document.getElementById("maintainer").textContent=b;try{new URL(e)}catch{document.getElementById("license").textContent=e}}function convert(a,b){a.totalTime+=3,a.notes.forEach(a=>{a.startTime+=3,a.endTime+=3}),nsCache=core.sequences.clone(a),setMIDIInfo(b),setToolbar(),initVisualizer(),changeButtons(),initPlayer()}function styleToViewBox(a){const b=a.style,c=parseFloat(b.width),d=parseFloat(b.height),e=`0 0 ${c} ${d}`;a.setAttribute("viewBox",e),a.removeAttribute("style")}function calcPixelsPerTimeStep(){let a=0;return ns.notes.forEach(b=>{a+=b.endTime-b.startTime}),a/=ns.notes.length,noteHeight/a}function initVisualizer(){const b=document.getElementById("gamePanel"),c={showOnlyOctavesUsed:!0,pixelsPerTimeStep:calcPixelsPerTimeStep()};visualizer=new core.WaterfallSVGVisualizer(ns,b,c),styleToViewBox(visualizer.svg),styleToViewBox(visualizer.svgPiano),visualizer.svgPiano.classList.add("d-none"),setRectColor();const a=visualizer.parentElement;a.style.width="100%",a.style.height="50vh",a.style.paddingTop="50vh",a.style.overflowY="hidden",a.scrollTop=a.scrollHeight,currentScrollTop=a.scrollTop,changeVisualizerPositions(visualizer)}async function initPlayer(){const a="https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus",b={run:a=>null,stop:()=>{clearPlayer();const a=visualizer.parentElement;a.scrollTop=a.scrollHeight;const b=document.getElementById("repeat"),c=b.classList.contains("active");c&&(player.start(ns),setTimer(0),initSeekbar(ns,0)),scoring(),scoreModal.show(),[...visualizer.svg.getElementsByClassName("fade")].forEach(a=>{a.classList.remove("fade")})}};stop(),player=new core.SoundFontPlayer(a,void 0,void 0,void 0,b),await player.loadSamples(ns)}function setTimer(b){const c=1,d=Date.now()-b*1e3,a=ns.totalTime,e=visualizer.parentElement;timer=setInterval(()=>{const b=(Date.now()-d)/1e3;if(Math.floor(currentTime)!=Math.floor(b)&&updateSeekbar(b),currentTime=b,currentTime<a){const b=1-currentTime/a;e.scrollTop=currentScrollTop*b}else clearInterval(timer),currentTime=0},c)}function play(){switch(tapCount=perfectCount=greatCount=0,document.getElementById("play").classList.add("d-none"),document.getElementById("pause").classList.remove("d-none"),player.getPlayState()){case"stopped":{if(player.getPlayState()=="started")return;const a=parseInt(document.getElementById("speed").value);setSpeed(ns,a),player.start(ns),setTimer(0),initSeekbar(ns,0);break}case"paused":player.resume(),setTimer(currentTime)}window.scrollTo({top:document.getElementById("playPanel").getBoundingClientRect().top,behavior:"auto"})}function pause(){player.pause(),clearPlayer()}function stop(){player&&player.isPlaying()&&(document.getElementById("currentTime").textContent=formatTime(0),player.stop(),clearPlayer())}function clearPlayer(){clearInterval(timer),document.getElementById("play").classList.remove("d-none"),document.getElementById("pause").classList.add("d-none")}function getCheckboxString(b,a){return`
<div class="form-check form-check-inline">
  <label class="form-check-label">
    <input class="form-check-input" name="${b}" value="${a}" type="checkbox" checked>
    ${a}
  </label>
</div>`}function setInstrumentsCheckbox(){const a=new Set;ns.notes.forEach(b=>{a.add(b.instrument)}),instrumentStates=new Map;let b="";a.forEach(a=>{b+=getCheckboxString("instrument",a),instrumentStates.set(a,!0)});const d=(new DOMParser).parseFromString(b,"text/html"),c=document.getElementById("filterInstruments");c.replaceChildren(...d.body.children),[...c.querySelectorAll("input")].forEach(a=>{a.addEventListener("change",()=>{tapCount=perfectCount=greatCount=0;const b=a.value;[...visualizer.svg.children].forEach(a=>{a.dataset.instrument==b&&a.classList.toggle("d-none")});const c=parseInt(b),d=instrumentStates.get(c);instrumentStates.set(parseInt(c),!d),visualizer&&ns&&changeVisualizerPositions(visualizer)})})}function setProgramsCheckbox(){const a=new Set;ns.notes.forEach(b=>{a.add(b.program)}),programStates=new Map;let b="";a.forEach(a=>{b+=getCheckboxString("program",a),programStates.set(a,!0)});const d=(new DOMParser).parseFromString(b,"text/html"),c=document.getElementById("filterPrograms");c.replaceChildren(...d.body.children),[...c.querySelectorAll("input")].forEach(a=>{a.addEventListener("change",()=>{tapCount=perfectCount=greatCount=0;const b=a.value;[...visualizer.svg.children].forEach(a=>{a.dataset.program==b&&a.classList.toggle("d-none")});const c=parseInt(b),d=programStates.get(c);programStates.set(parseInt(c),!d),visualizer&&ns&&changeVisualizerPositions(visualizer)})})}function setToolbar(){setProgramsCheckbox(),setInstrumentsCheckbox()}function speedDown(){const a=document.getElementById("speed"),b=parseInt(a.value)-10,c=b<0?0:b;a.value=c,document.getElementById("speedDown").disabled=!0,changeSpeed(c),document.getElementById("speedDown").disabled=!1}function speedUp(){const a=document.getElementById("speed"),b=parseInt(a.value)+10;a.value=b,document.getElementById("speedUp").disabled=!0,changeSpeed(b),document.getElementById("speedUp").disabled=!1}function changeSpeed(a){if(perfectCount=greatCount=0,!ns)return;switch(player.getPlayState()){case"started":{player.stop(),clearInterval(timer);const c=nsCache.totalTime/ns.totalTime,d=c/(a/100),b=currentTime*d;setSpeed(ns,a),initSeekbar(ns,b),player.start(ns,void 0,b),setTimer(b);break}case"paused":{setSpeed(ns,a);const b=nsCache.totalTime/ns.totalTime,c=b/(a/100),d=currentTime*c;initSeekbar(ns,d);break}}}function changeSpeedEvent(a){const b=parseInt(a.target.value);changeSpeed(b)}function setSpeed(b,a){a/=100;const e=nsCache.controlChanges;b.controlChanges.forEach((b,c)=>{b.time=e[c].time/a});const c=nsCache.tempos;b.tempos.forEach((b,d)=>{b.time=c[d].time/a,b.qpm=c[d].qpm*a});const d=nsCache.notes;b.notes.forEach((b,c)=>{b.startTime=d[c].startTime/a,b.endTime=d[c].endTime/a}),b.totalTime=nsCache.totalTime/a}function repeat(){document.getElementById("repeat").classList.toggle("active")}function volumeOnOff(){const b=document.getElementById("volumeOnOff").firstElementChild,a=document.getElementById("volumebar");b.classList.contains("bi-volume-up-fill")?(b.className="bi bi-volume-mute-fill",a.dataset.value=a.value,a.value=-50,player.output.mute=!0):(b.className="bi bi-volume-up-fill",a.value=a.dataset.value,player.output.mute=!1)}function changeVolumebar(){const a=document.getElementById("volumebar"),b=a.value;a.dataset.value=b,player.output.volume.value=b}function formatTime(a){a=Math.floor(a);const c=a%60,b=(a-c)/60,d=(a-c-60*b)/3600,e=String(c).padStart(2,"0"),f=b>9||!d?`${b}:`:`0${b}:`,g=d?`${d}:`:"";return`${g}${f}${e}`}function changeSeekbar(b){perfectCount=greatCount=0,clearInterval(timer),[...visualizer.svg.getElementsByClassName("fade")].forEach(a=>{a.classList.remove("fade")});const a=parseInt(b.target.value);document.getElementById("currentTime").textContent=formatTime(a),currentTime=a,resizeScroll(a),player.isPlaying()&&(player.seekTo(a),player.getPlayState()=="started"&&setTimer(a))}function updateSeekbar(a){const b=document.getElementById("seekbar");b.value=a;const c=formatTime(a);document.getElementById("currentTime").textContent=c}function initSeekbar(a,b){document.getElementById("seekbar").max=a.totalTime,document.getElementById("seekbar").value=b,document.getElementById("totalTime").textContent=formatTime(a.totalTime),document.getElementById("currentTime").textContent=formatTime(b)}function resize(){const a=visualizer.parentElement;a.scrollTop=a.scrollHeight,currentScrollTop=a.scrollTop}function resizeScroll(b){const a=visualizer.parentElement;a.scrollTop=a.scrollHeight,currentScrollTop=a.scrollTop;const c=(ns.totalTime-b)/ns.totalTime;a.scrollTop=c*currentScrollTop}function getMinMaxPitch(){let a=1/0,b=-(1/0);return ns.notes.filter(a=>instrumentStates.get(a.instrument)).filter(a=>programStates.get(a.program)).forEach(c=>{c.pitch<a&&(a=c.pitch),b<c.pitch&&(b=c.pitch)}),[a,b]}function changeVisualizerPositions(a){const[b,i]=getMinMaxPitch(),e=i-b+1,d=document.getElementById("courseOption").selectedIndex,f=e/d,g=a.svg.getAttribute("viewBox").split(" "),h=parseFloat(g[2]),c=h/d;[...a.svg.children].filter(a=>!a.classList.contains("d-none")).forEach(a=>{const d=parseInt(a.dataset.pitch),e=Math.floor((d-b)/f);a.setAttribute("x",Math.ceil(e*c)),a.setAttribute("width",c)})}function typeEvent(a){switch(a.code){case"Space":a.preventDefault(),player.getPlayState()=="started"?pause():play();break;default:return typeEventKey(a.key)}}function typeEventKey(b){const c=Array.from("AWSEDRFTGYHUJIKOLP;@".toLowerCase()),e=document.getElementById("playPanel"),a=[...e.querySelectorAll("button")],d=a.length>9?c.slice(0,a.length):c.filter((b,a)=>a%2==0).slice(0,a.length);if(d.includes(b)){const c=d.indexOf(b);a[c].click()}}function buttonEvent(a,e,d){tapCount+=1;const f=visualizer.svg.getBoundingClientRect().height,c=visualizer.parentElement.scrollTop/f;let b="MISS";switch([...visualizer.svg.children].filter(a=>e==parseInt(a.getAttribute("x"))).filter(a=>!a.classList.contains("d-none")).filter(a=>!a.classList.contains("fade")).forEach(a=>{const e=parseFloat(a.getAttribute("y")),j=parseFloat(a.getAttribute("height")),f=2,g=(e-f)/d,h=(e+j+f)/d,i=(g+h)/2;i<=c&&c<=h?(b="PERFECT",a.classList.add("fade"),perfectCount+=1):g<=c&&c<i&&(b="GREAT",a.classList.add("fade"),greatCount+=1)}),b){case"PERFECT":a.textContent=b,a.className="badge bg-primary";break;case"GREAT":a.textContent=b,a.className="badge bg-success";break;case"MISS":a.className="badge bg-danger";break}setTimeout(()=>{a.textContent="MISS",a.className="badge"},200)}function setButtonEvent(a,b,c,d){"ontouchstart"in window?a.ontouchstart=()=>{buttonEvent(b,c,d)}:a.onclick=()=>{buttonEvent(b,c,d)}}function changeButtons(){tapCount=perfectCount=greatCount=0;const b=Array.from("AWSEDRFTGYHUJIKOLP;@"),a=document.getElementById("courseOption").selectedIndex,c=document.getElementById("playPanel");c.replaceChildren();const d=visualizer.svg.getAttribute("viewBox").split(" "),e=parseFloat(d[2]),f=parseFloat(d[3]),g=e/a;for(let d=0;d<a;d++){const j=Math.ceil(d*g),h=document.createElement("div");h.className="w-100";const i=document.createElement("span");i.className="badge",i.textContent="MISS";const e=document.createElement("button");e.className="w-100 btn btn-light btn-tap",e.role="button",e.textContent=a>9?b[d]:b[d*2],setButtonEvent(e,i,j,f),h.appendChild(e),h.appendChild(i),c.appendChild(h)}document.removeEventListener("keydown",typeEvent),document.addEventListener("keydown",typeEvent),visualizer&&ns&&changeVisualizerPositions(visualizer)}function countNotes(){return ns.notes.filter(a=>instrumentStates.get(a.instrument)).filter(a=>programStates.get(a.program)).length}function getAccuracy(){return tapCount==0?0:(perfectCount+greatCount)/tapCount}function scoring(){const a=countNotes(),l=getAccuracy(),c=a-perfectCount-greatCount,j=Math.ceil(perfectCount/a*1e4)/100,e=Math.ceil(greatCount/a*1e4)/100,f=Math.ceil(c/a*1e4)/100,g=perfectCount*2+greatCount,h=parseInt(document.getElementById("speed").value),i=document.getElementById("courseOption").selectedIndex,d=Array.from(programStates.values()).filter(a=>a).length,k=Array.from(instrumentStates.values()).filter(a=>a).length,b=parseInt(g*h*d*k*i*l);document.getElementById("perfectCount").textContent=perfectCount,document.getElementById("greatCount").textContent=greatCount,document.getElementById("missCount").textContent=c,document.getElementById("perfectRate").textContent=j+"%",document.getElementById("greatRate").textContent=e+"%",document.getElementById("missRate").textContent=f+"%",document.getElementById("score").textContent=b;const m=document.getElementById("midiTitle").textContent,n=document.getElementById("composer").textContent,o=`${m} ${n}`,p=encodeURIComponent(`Tip Tap Notes! ${o}: ${b}`),q="https://marmooo.github.com/tip-tap-notes/",r=`https://twitter.com/intent/tweet?text=${p}&url=${q}&hashtags=TipTapNotes`;document.getElementById("twitter").href=r}function initQuery(){const a=new URLSearchParams;return a.set("title","When the Swallows Homeward Fly (Agathe)"),a.set("composer","Franz Wilhelm Abt"),a.set("maintainer","Stan Sanderson"),a.set("license","Public Domain"),a}const noteHeight=30;let colorful=!0,currentTime=0,currentScrollTop,ns,nsCache,timer,player,visualizer,programStates,instrumentStates,tapCount=0,perfectCount=0,greatCount=0;if(loadConfig(),location.search)convertFromUrlParams();else{const a=initQuery();convertFromUrl("abt.mid",a)}const scoreModal=new bootstrap.Modal("#scorePanel",{backdrop:"static",keyboard:!1});document.getElementById("toggleDarkMode").onclick=toggleDarkMode,document.getElementById("toggleColor").onclick=toggleRectColor,document.ondragover=a=>{a.preventDefault()},document.ondrop=dropFileEvent,document.getElementById("inputFile").onchange=convertFileEvent,document.getElementById("inputUrl").onchange=convertUrlEvent,document.getElementById("play").onclick=play,document.getElementById("pause").onclick=pause,document.getElementById("speed").onchange=changeSpeedEvent,document.getElementById("speedDown").onclick=speedDown,document.getElementById("speedUp").onclick=speedUp,document.getElementById("repeat").onclick=repeat,document.getElementById("volumeOnOff").onclick=volumeOnOff,document.getElementById("volumebar").onchange=changeVolumebar,document.getElementById("seekbar").onchange=changeSeekbar,document.getElementById("courseOption").onchange=changeButtons,window.addEventListener("resize",resize)