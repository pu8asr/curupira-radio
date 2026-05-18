const playlist = [
  {
    title: "SoundHelix Song 1",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
  },
  {
    title: "SoundHelix Song 2",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"
  },
  {
    title: "SoundHelix Song 3",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3"
  }
];

let currentIndex = 0;

const player = document.getElementById('player');
const nowPlaying = document.getElementById('nowPlaying');

const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');

function loadTrack(index) {
  const track = playlist[index];
  player.src = track.url;
  nowPlaying.textContent = "🎵 Tocando: " + track.title;
}

function playTrack() {
  player.play();
}

function pauseTrack() {
  player.pause();
}

function nextTrack() {
  currentIndex = (currentIndex + 1) % playlist.length;
  loadTrack(currentIndex);
  playTrack();
}

function prevTrack() {
  currentIndex =
    (currentIndex - 1 + playlist.length) % playlist.length;
  loadTrack(currentIndex);
  playTrack();
}

playBtn.addEventListener('click', playTrack);
pauseBtn.addEventListener('click', pauseTrack);
nextBtn.addEventListener('click', nextTrack);
prevBtn.addEventListener('click', prevTrack);

player.addEventListener('ended', nextTrack);

loadTrack(currentIndex);
