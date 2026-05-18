const playlist = [

{
title:"SoundHelix 1",
url:"https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
},

{
title:"SoundHelix 2",
url:"https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"
},

{
title:"SoundHelix 3",
url:"https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3"
}

];

let index = 0;

const player =
document.getElementById("player");

const title =
document.getElementById("trackTitle");

const status =
document.getElementById("status");

const musicSlider =
document.getElementById("musicVolume");

const micSlider =
document.getElementById("micVolume");

const audioContext =
new AudioContext();

const musicSource =
audioContext.createMediaElementSource(player);

const musicGain =
audioContext.createGain();

musicSource.connect(musicGain);
musicGain.connect(audioContext.destination);

let micGain = null;
let micSource = null;
let micStream = null;

musicSlider.addEventListener("input", ()=>{

musicGain.gain.value =
musicSlider.value;

});

function loadTrack(){

player.src =
playlist[index].url;

title.textContent =
playlist[index].title;

}

function playCurrent(){

audioContext.resume();

player.play();

status.textContent =
"AO VIVO";

}

function togglePlay(){

if(player.paused){

playCurrent();

}else{

player.pause();

status.textContent =
"PAUSADO";

}

}

function nextMusic(){

index =
(index + 1) %
playlist.length;

loadTrack();

playCurrent();

}

player.addEventListener(
"ended",
nextMusic
);

async function toggleMic(){

if(micStream){

micStream
.getTracks()
.forEach(
track=>track.stop()
);

micStream = null;

status.textContent =
"MIC OFF";

return;

}

try{

micStream =
await navigator
.mediaDevices
.getUserMedia({
audio:true
});

micSource =
audioContext
.createMediaStreamSource(
micStream
);

micGain =
audioContext.createGain();

micSource.connect(micGain);

micGain.connect(
audioContext.destination
);

micSlider.addEventListener(
"input",
()=>{

micGain.gain.value =
micSlider.value;

});

status.textContent =
"MIC ON";

}catch(err){

alert(
"Erro ao acessar microfone"
);

console.log(err);

}

}

loadTrack();
