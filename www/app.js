const playlist = [
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3"
];

let index = 0;
const player = document.getElementById("player");

function playMusic() {
  player.src = playlist[index];
  player.play();
}

function nextMusic() {
  index = (index + 1) % playlist.length;
  playMusic();
}

player.addEventListener("ended", nextMusic);
