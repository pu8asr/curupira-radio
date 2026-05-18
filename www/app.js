/* =========================
   ICECAST CONFIG (carregada do localStorage)
========================= */
let ICECAST = {
  host: "s01.brascast.com",
  port: 31112,
  mount: "/live",
  password: ""
};

function loadConfig() {
  const saved = localStorage.getItem("curupira_config");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      ICECAST = { ...ICECAST, ...parsed };
    } catch (e) {
      console.error("Erro ao carregar config:", e);
    }
  }
}

function saveConfigToStorage() {
  localStorage.setItem("curupira_config", JSON.stringify(ICECAST));
}

loadConfig();

/* =========================
   INDEXEDDB PARA PLAYLIST
========================= */
const DB_NAME = "CurupiraRadioDB";
const DB_VERSION = 1;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("playlist")) {
        db.createObjectStore("playlist", { keyPath: "id", autoIncrement: true });
      }
    };
    
    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
    
    request.onerror = (event) => {
      console.error("Erro IndexedDB:", event.target.error);
      reject(event.target.error);
    };
  });
}

function savePlaylistToDB(tracks) {
  return new Promise(async (resolve, reject) => {
    if (!db) await openDB();
    
    const transaction = db.transaction(["playlist"], "readwrite");
    const store = transaction.objectStore("playlist");
    
    store.clear();
    
    tracks.forEach((track, index) => {
      store.add({
        id: index,
        name: track.name,
        data: track.data
      });
    });
    
    transaction.oncomplete = () => {
      console.log("✅ Playlist salva no IndexedDB:", tracks.length, "músicas");
      resolve();
    };
    
    transaction.onerror = (event) => {
      console.error("Erro ao salvar playlist:", event.target.error);
      reject(event.target.error);
    };
  });
}

function loadPlaylistFromDB() {
  return new Promise(async (resolve, reject) => {
    if (!db) await openDB();
    
    const transaction = db.transaction(["playlist"], "readonly");
    const store = transaction.objectStore("playlist");
    const request = store.getAll();
    
    request.onsuccess = (event) => {
      const savedTracks = event.target.result;
      
      const tracks = savedTracks.map(track => {
        const blob = new Blob([track.data], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        return {
          name: track.name,
          url: url,
          data: track.data,
          played: false
        };
      });
      
      console.log("✅ Playlist carregada do IndexedDB:", tracks.length, "músicas");
      resolve(tracks);
    };
    
    request.onerror = (event) => {
      console.error("Erro ao carregar playlist:", event.target.error);
      reject(event.target.error);
    };
  });
}

function clearPlaylistFromDB() {
  return new Promise(async (resolve, reject) => {
    if (!db) await openDB();
    
    const transaction = db.transaction(["playlist"], "readwrite");
    const store = transaction.objectStore("playlist");
    store.clear();
    
    transaction.oncomplete = () => {
      console.log("✅ Playlist limpa do IndexedDB");
      resolve();
    };
    
    transaction.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

/* =========================
   AUDIO ENGINE
========================= */
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContextClass();
  }
  return audioContext;
}

/* =========================
   STATE
========================= */
let playlist = [];
let index = 0;
let isPlaying = false;
let isBroadcasting = false;
let isMicOn = false;
let currentTrackName = "Nenhuma música";
let playMode = "sequential"; // "sequential" ou "random"
let inactivityTimer = null; // Timer de inatividade
const INACTIVITY_TIMEOUT = 60000; // 1 minuto

/* =========================
   ELEMENTOS
========================= */
const player = document.getElementById("player");
const statusEl = document.getElementById("status");
const trackTitleEl = document.getElementById("trackTitle");
const btnPlayPause = document.getElementById("btnPlayPause");
const progressBar = document.getElementById("progressBar");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");
const volumeSlider = document.getElementById("volumeSlider");
const btnMic = document.getElementById("btnMic");
const btnBroadcast = document.getElementById("btnBroadcast");
const btnMode = document.getElementById("btnMode");
const playlistInfo = document.getElementById("playlistInfo");

/* =========================
   STREAM BUS
========================= */
let streamBus = null;

function getStreamBus() {
  if (!streamBus) {
    const ctx = getAudioContext();
    streamBus = ctx.createMediaStreamDestination();
  }
  return streamBus;
}

/* =========================
   MUSIC SOURCE COM FADE
========================= */
let musicSource = null;
let musicGain = null;
let fadeInterval = null;

function ensureMusicSource() {
  if (!musicSource) {
    const ctx = getAudioContext();
    musicSource = ctx.createMediaElementSource(player);
    musicGain = ctx.createGain();
    musicGain.gain.value = 1;
    
    musicSource.connect(musicGain);
    musicGain.connect(ctx.destination);
    musicGain.connect(getStreamBus());
  }
}

function fadeOut(duration = 2000) {
  return new Promise(resolve => {
    if (!musicGain) {
      resolve();
      return;
    }
    
    clearInterval(fadeInterval);
    const startVolume = musicGain.gain.value;
    const steps = 20;
    const stepTime = duration / steps;
    const volumeStep = startVolume / steps;
    let currentStep = 0;
    
    fadeInterval = setInterval(() => {
      currentStep++;
      const newVolume = startVolume - (volumeStep * currentStep);
      musicGain.gain.value = Math.max(0, newVolume);
      
      if (currentStep >= steps) {
        clearInterval(fadeInterval);
        musicGain.gain.value = 0;
        resolve();
      }
    }, stepTime);
  });
}

function fadeIn(duration = 2000) {
  return new Promise(resolve => {
    if (!musicGain) {
      resolve();
      return;
    }
    
    clearInterval(fadeInterval);
    const targetVolume = 1;
    const steps = 20;
    const stepTime = duration / steps;
    const volumeStep = targetVolume / steps;
    let currentStep = 0;
    
    musicGain.gain.value = 0;
    
    fadeInterval = setInterval(() => {
      currentStep++;
      musicGain.gain.value = Math.min(targetVolume, volumeStep * currentStep);
      
      if (currentStep >= steps) {
        clearInterval(fadeInterval);
        musicGain.gain.value = targetVolume;
        resolve();
      }
    }, stepTime);
  });
}

/* =========================
   INACTIVITY TIMER
========================= */
function resetInactivityTimer() {
  // Limpa timer existente
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  
  // Se está transmitindo e não está tocando música
  if (isBroadcasting && !isPlaying && !isMicOn) {
    inactivityTimer = setTimeout(() => {
      console.log("⏰ Timeout de inatividade - encerrando transmissão");
      setStatus("⏰ Transmissão encerrada por inatividade");
      stopBroadcast();
    }, INACTIVITY_TIMEOUT);
  }
}

function stopBroadcast() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }
  isBroadcasting = false;
  btnBroadcast.textContent = "📡 Transmitir";
  btnBroadcast.classList.remove("active");
  
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
    isMicOn = false;
    btnMic.textContent = "🎤 Mic Off";
    btnMic.classList.remove("active");
  }
  
  updateButtonsState();
}

/* =========================
   CHECK ALL PLAYED
========================= */
function allTracksPlayed() {
  return playlist.length > 0 && playlist.every(t => t.played);
}

function getUnplayedTracks() {
  return playlist
    .map((t, i) => ({ track: t, index: i }))
    .filter(item => !item.track.played);
}

/* =========================
   UPDATE BUTTONS STATE
========================= */
function updateButtonsState() {
  if (btnBroadcast) {
    btnBroadcast.disabled = (playlist.length === 0);
  }
  
  if (btnMic) {
    btnMic.disabled = !isBroadcasting;
  }
}

/* =========================
   UPDATE MODE BUTTON
========================= */
function updateModeButton() {
  if (!btnMode) return;
  
  if (playMode === "sequential") {
    btnMode.innerHTML = "🔁";
    btnMode.title = "Modo: Sequencial - Clique para Aleatório";
    btnMode.className = "btn-mode mode-sequential";
  } else {
    btnMode.innerHTML = "🔀";
    btnMode.title = "Modo: Aleatório - Clique para Sequencial";
    btnMode.className = "btn-mode mode-random";
  }
}

function toggleMode() {
  if (playMode === "sequential") {
    playMode = "random";
    setStatus("🔀 Modo: Aleatório");
  } else {
    playMode = "sequential";
    setStatus("🔁 Modo: Sequencial");
  }
  updateModeButton();
}

/* =========================
   CONFIG INIT
========================= */
function initConfig() {
  const hostInput = document.getElementById("host");
  const portInput = document.getElementById("port");
  const mountInput = document.getElementById("mount");
  const passwordInput = document.getElementById("password");
  
  if (hostInput) hostInput.value = ICECAST.host;
  if (portInput) portInput.value = ICECAST.port;
  if (mountInput) mountInput.value = ICECAST.mount;
  if (passwordInput) passwordInput.value = ICECAST.password;
  
  updateFieldsState();
}

async function saveConfig() {
  const hostInput = document.getElementById("host");
  const portInput = document.getElementById("port");
  const mountInput = document.getElementById("mount");
  const passwordInput = document.getElementById("password");
  
  const password = passwordInput.value.trim();
  
  if (password.toUpperCase() === "CUSTOM") {
    if (hostInput) hostInput.disabled = false;
    if (portInput) portInput.disabled = false;
    if (mountInput) mountInput.disabled = false;
    
    showSaveStatus("🔓 Campos liberados para edição. Altere e salve novamente.", "info");
    return;
  }
  
  ICECAST.host = hostInput.value.trim() || ICECAST.host;
  ICECAST.port = parseInt(portInput.value) || ICECAST.port;
  ICECAST.mount = mountInput.value.trim() || ICECAST.mount;
  ICECAST.password = password;
  
  saveConfigToStorage();
  
  try {
    await savePlaylistToDB(playlist);
    showSaveStatus("✅ Configurações e playlist salvas!", "success");
  } catch (err) {
    console.error("Erro ao salvar playlist:", err);
    showSaveStatus("⚠ Config salva, mas erro na playlist: " + err.message, "error");
  }
  
  updateFieldsState();
  
  setTimeout(() => {
    show('main');
    const statusDiv = document.querySelector(".save-status");
    if (statusDiv) statusDiv.remove();
  }, 1000);
}

function updateFieldsState() {
  const hostInput = document.getElementById("host");
  const portInput = document.getElementById("port");
  const mountInput = document.getElementById("mount");
  
  if (hostInput) hostInput.disabled = true;
  if (portInput) portInput.disabled = true;
  if (mountInput) mountInput.disabled = true;
}

function showSaveStatus(message, type) {
  const oldStatus = document.querySelector(".save-status");
  if (oldStatus) oldStatus.remove();
  
  const statusDiv = document.createElement("div");
  statusDiv.className = "save-status " + type;
  statusDiv.textContent = message;
  
  const saveBtn = document.querySelector(".btn-save");
  if (saveBtn && saveBtn.parentNode) {
    saveBtn.parentNode.insertBefore(statusDiv, saveBtn);
  }
}

initConfig();

/* =========================
   TELAS
========================= */
function show(screen) {
  document.getElementById("main").classList.add("hidden");
  document.getElementById("config").classList.add("hidden");
  document.getElementById(screen).classList.remove("hidden");
  
  if (screen === 'main') {
    renderMainPlaylist();
  }
}

/* =========================
   STATUS
========================= */
function setStatus(t) {
  if (statusEl) statusEl.innerText = t;
}

/* =========================
   UPDATE TITLE
========================= */
function updateTitle() {
  if (!playlist.length) {
    if (trackTitleEl) trackTitleEl.innerText = "Nenhuma música";
    currentTrackName = "Nenhuma música";
    return;
  }
  const name = playlist[index].name;
  if (trackTitleEl) trackTitleEl.innerText = name;
  currentTrackName = name;
}

/* =========================
   UPDATE PLAY/PAUSE BUTTON
========================= */
function updatePlayButton() {
  if (!btnPlayPause) return;
  
  if (isPlaying) {
    btnPlayPause.innerHTML = "⏸";
    btnPlayPause.classList.add("playing");
  } else {
    btnPlayPause.innerHTML = "▶";
    btnPlayPause.classList.remove("playing");
  }
}

/* =========================
   UPDATE PROGRESS BAR
========================= */
function updateProgress() {
  if (!player.duration) return;
  
  const progress = (player.currentTime / player.duration) * 100;
  progressBar.value = progress;
  
  currentTimeEl.textContent = formatTime(player.currentTime);
  durationEl.textContent = formatTime(player.duration);
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function seekAudio() {
  const seekTime = (progressBar.value / 100) * player.duration;
  player.currentTime = seekTime;
}

/* =========================
   UPDATE VOLUME
========================= */
function updateVolume() {
  if (musicGain) {
    musicGain.gain.value = volumeSlider.value / 100;
  }
}

/* =========================
   UPDATE PLAYLIST INFO
========================= */
function updatePlaylistInfo() {
  if (!playlistInfo) return;
  const unplayed = getUnplayedTracks().length;
  playlistInfo.textContent = `${unplayed}/${playlist.length} não tocadas`;
}

/* =========================
   LOAD TRACK
========================= */
function loadTrack() {
  if (!playlist.length) return;

  const track = playlist[index];
  if (!track || !track.url) return;

  player.src = track.url;
  player.load();
  updateTitle();
  renderAllPlaylists();
  updatePlaylistInfo();
  setStatus("🎵 " + track.name);
}

/* =========================
   MARK AS PLAYED
========================= */
function markAsPlayed(i) {
  if (playlist[i]) {
    playlist[i].played = true;
  }
}

/* =========================
   GET NEXT INDEX
========================= */
function getNextIndex() {
  if (playlist.length === 0) return 0;
  
  const unplayed = getUnplayedTracks();
  
  // Se todas já foram tocadas
  if (unplayed.length === 0) {
    return -1; // Sinaliza que acabou
  }
  
  if (playMode === "sequential") {
    // Próximo índice não tocado a partir do atual
    for (let i = 1; i <= playlist.length; i++) {
      const nextIdx = (index + i) % playlist.length;
      if (!playlist[nextIdx].played) {
        return nextIdx;
      }
    }
  } else {
    // Aleatório entre as não tocadas
    const randomUnplayed = unplayed[Math.floor(Math.random() * unplayed.length)];
    return randomUnplayed.index;
  }
  
  return -1;
}

/* =========================
   GET PREV INDEX
========================= */
function getPrevIndex() {
  if (playlist.length === 0) return 0;
  
  // Volta para a anterior na lista (cíclico)
  return (index - 1 + playlist.length) % playlist.length;
}

/* =========================
   PLAY / PAUSE
========================= */
async function togglePlay() {
  if (!playlist.length) {
    setStatus("⚠ Nenhuma música na playlist");
    return;
  }

  // Se todas já foram tocadas e estamos tentando dar play
  if (allTracksPlayed() && player.paused) {
    setStatus("⚠ Todas as músicas já foram reproduzidas");
    return;
  }

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  if (player.paused) {
    ensureMusicSource();

    try {
      await player.play();
      isPlaying = true;
      updatePlayButton();
      
      if (musicGain && musicGain.gain.value < 1) {
        fadeIn(1000);
      }
      
      resetInactivityTimer();
      setStatus("▶ Tocando: " + playlist[index].name);
    } catch (err) {
      console.error("Erro ao tocar:", err);
      setStatus("❌ Erro: " + err.message);
    }
  } else {
    await fadeOut(500);
    player.pause();
    isPlaying = false;
    updatePlayButton();
    resetInactivityTimer();
    setStatus("⏸ Pausado");
  }
  
  renderAllPlaylists();
}

/* =========================
   STOP
========================= */
async function stop() {
  if (musicGain) {
    await fadeOut(300);
  }
  player.pause();
  player.currentTime = 0;
  isPlaying = false;
  updatePlayButton();
  progressBar.value = 0;
  currentTimeEl.textContent = "00:00";
  resetInactivityTimer();
  setStatus("⏹ Parado");
  renderAllPlaylists();
}

/* =========================
   NEXT
========================= */
async function next() {
  if (!playlist.length) return;
  
  // Marca atual como tocada
  markAsPlayed(index);
  
  const nextIndex = getNextIndex();
  
  // Se não há mais músicas não tocadas
  if (nextIndex === -1) {
    if (isPlaying) {
      await fadeOut(1500);
      player.pause();
    }
    isPlaying = false;
    updatePlayButton();
    progressBar.value = 0;
    currentTimeEl.textContent = "00:00";
    
    // Encerra transmissão se estiver ativa
    if (isBroadcasting) {
      setStatus("⏹ Todas as músicas foram tocadas - Encerrando transmissão");
      stopBroadcast();
    } else {
      setStatus("⏹ Todas as músicas foram tocadas");
    }
    
    renderAllPlaylists();
    updatePlaylistInfo();
    return;
  }
  
  // Fade out da atual
  if (isPlaying) {
    await fadeOut(1500);
    player.pause();
  }
  
  index = nextIndex;
  loadTrack();
  
  if (isPlaying) {
    try {
      await player.play();
      await fadeIn(1500);
      resetInactivityTimer();
    } catch (err) {
      console.error("Erro next:", err);
    }
  }
}

/* =========================
   PREV
========================= */
async function prev() {
  if (!playlist.length) return;
  
  // Se já passou 3 segundos, volta pro início da música atual
  if (player.currentTime > 3) {
    player.currentTime = 0;
    return;
  }
  
  if (isPlaying) {
    await fadeOut(1500);
    player.pause();
  }
  
  index = getPrevIndex();
  loadTrack();
  
  if (isPlaying) {
    try {
      await player.play();
      await fadeIn(1500);
      resetInactivityTimer();
    } catch (err) {
      console.error("Erro prev:", err);
    }
  }
}

/* =========================
   BIBLIOTECA
========================= */
async function loadFiles() {
  const files = document.getElementById("fileInput").files;
  
  const newTracks = [];
  
  for (let f of files) {
    if (!f.type.startsWith("audio/")) continue;
    
    const data = await readFileAsArrayBuffer(f);
    
    newTracks.push({
      name: f.name,
      url: URL.createObjectURL(f),
      data: data,
      played: false
    });
  }

  playlist = [...playlist, ...newTracks];
  
  renderAllPlaylists();
  updatePlaylistInfo();
  updateButtonsState();
  
  if (playlist.length > 0 && player.paused && !isPlaying) {
    index = playlist.length - newTracks.length;
    loadTrack();
  }
  
  setStatus("🎵 " + playlist.length + " músicas na playlist");
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/* =========================
   CLEAR PLAYLIST
========================= */
async function clearPlaylist() {
  for (let t of playlist) {
    if (t.url && t.url.startsWith('blob:')) {
      URL.revokeObjectURL(t.url);
    }
  }
  
  playlist = [];
  index = 0;
  
  await clearPlaylistFromDB();
  
  player.pause();
  player.currentTime = 0;
  isPlaying = false;
  updatePlayButton();
  
  renderAllPlaylists();
  updateTitle();
  updatePlaylistInfo();
  updateButtonsState();
  resetInactivityTimer();
  setStatus("🗑 Playlist limpa");
}

/* =========================
   REMOVE TRACK
========================= */
function removeTrack(i) {
  if (playlist[i] && playlist[i].url && playlist[i].url.startsWith('blob:')) {
    URL.revokeObjectURL(playlist[i].url);
  }
  
  playlist.splice(i, 1);
  
  if (playlist.length === 0) {
    index = 0;
    player.pause();
    player.currentTime = 0;
    isPlaying = false;
    updatePlayButton();
  } else if (i <= index && index > 0) {
    index--;
    loadTrack();
  }
  
  renderAllPlaylists();
  updateTitle();
  updatePlaylistInfo();
  updateButtonsState();
  setStatus("🎵 " + playlist.length + " músicas na playlist");
}

/* =========================
   RENDER ALL PLAYLISTS
========================= */
function renderAllPlaylists() {
  renderPlaylist();
  renderMainPlaylist();
  updatePlaylistInfo();
}

/* =========================
   RENDER PLAYLIST (config)
========================= */
let lastClickTime = 0;
let lastClickIndex = -1;

function renderPlaylist() {
  const div = document.getElementById("playlist");
  if (!div) return;
  div.innerHTML = "";

  playlist.forEach((t, i) => {
    const el = createPlaylistItem(t, i, true);
    div.appendChild(el);
  });
}

/* =========================
   RENDER MAIN PLAYLIST (controle)
========================= */
function renderMainPlaylist() {
  const div = document.getElementById("mainPlaylist");
  if (!div) return;
  div.innerHTML = "";

  playlist.forEach((t, i) => {
    const el = createPlaylistItem(t, i, false);
    div.appendChild(el);
  });
}

/* =========================
   CREATE PLAYLIST ITEM
========================= */
function createPlaylistItem(t, i, showRemove) {
  const el = document.createElement("div");
  el.className = "playlist-item";
  if (i === index) el.classList.add("current");
  if (t.played) el.classList.add("played");
  
  el.innerHTML = `
    <span class="track-number">${(i + 1).toString().padStart(2, '0')}</span>
    <span class="track-icon">${i === index && isPlaying ? '🔊' : (t.played ? '✅' : '🎵')}</span>
    <span class="track-name">${t.name}</span>
    ${showRemove ? '<button class="remove-track" data-index="' + i + '" title="Remover">✕</button>' : ''}
  `;

  // Duplo clique para tocar (reseta o status played)
  el.addEventListener("click", (e) => {
    if (e.target.classList.contains("remove-track")) return;
    
    const now = Date.now();
    
    if (i === lastClickIndex && now - lastClickTime < 400) {
      // Duplo clique: reseta o status e toca
      playlist[i].played = false;
      playTrack(i);
    } else {
      selectTrack(i);
    }
    
    lastClickTime = now;
    lastClickIndex = i;
  });
  
  if (showRemove) {
    const removeBtn = el.querySelector(".remove-track");
    if (removeBtn) {
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeTrack(i);
      });
    }
  }

  return el;
}

function selectTrack(i) {
  index = i;
  loadTrack();
}

async function playTrack(i) {
  if (i === index && isPlaying) {
    await togglePlay();
    return;
  }
  
  if (isPlaying) {
    await fadeOut(1000);
    player.pause();
  }
  
  index = i;
  loadTrack();
  isPlaying = true;
  
  ensureMusicSource();
  try {
    await player.play();
    updatePlayButton();
    await fadeIn(1000);
    resetInactivityTimer();
    renderAllPlaylists();
  } catch (err) {
    console.error("Erro playTrack:", err);
    setStatus("❌ Erro ao tocar");
  }
}

/* =========================
   MIC
========================= */
let micStream = null;

async function toggleMic() {
  if (!isBroadcasting) {
    setStatus("⚠ Ligue a transmissão primeiro");
    return;
  }
  
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
    isMicOn = false;
    btnMic.textContent = "🎤 Mic Off";
    btnMic.classList.remove("active");
    resetInactivityTimer();
    setStatus("🎤 Microfone desligado");
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = getAudioContext();
    const micSource = ctx.createMediaStreamSource(micStream);
    micSource.connect(getStreamBus());
    isMicOn = true;
    btnMic.textContent = "🎤 Mic On";
    btnMic.classList.add("active");
    resetInactivityTimer();
    setStatus("🎤 Microfone ligado");
  } catch (err) {
    console.error("Erro mic:", err);
    setStatus("❌ Erro microfone: " + err.message);
  }
}

/* =========================
   BROADCAST
========================= */
let wsConnection = null;
let mediaRecorder = null;

function startBroadcast() {
  if (playlist.length === 0) {
    setStatus("⚠ Adicione músicas primeiro");
    return;
  }
  
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    stopBroadcast();
    setStatus("📡 Transmissão encerrada");
    return;
  }

  try {
    wsConnection = new WebSocket("ws://localhost:9001");

    wsConnection.onopen = () => {
      const bus = getStreamBus();
      
      if (!bus.stream.getAudioTracks().length) {
        setStatus("❌ Sem áudio - toque algo primeiro");
        return;
      }

      mediaRecorder = new MediaRecorder(bus.stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
          ? 'audio/webm;codecs=opus' 
          : 'audio/webm'
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && wsConnection && wsConnection.readyState === WebSocket.OPEN) {
          wsConnection.send(e.data);
        }
      };

      mediaRecorder.start(1000);
      isBroadcasting = true;
      btnBroadcast.textContent = "📡 Transmitindo...";
      btnBroadcast.classList.add("active");
      updateButtonsState();
      resetInactivityTimer();
      setStatus("📡 AO VIVO - Transmitindo para Icecast");
    };

    wsConnection.onerror = (err) => {
      console.error("WebSocket erro:", err);
      setStatus("❌ Erro conexão - encoder rodando?");
      isBroadcasting = false;
      btnBroadcast.textContent = "📡 Transmitir";
      btnBroadcast.classList.remove("active");
      updateButtonsState();
    };

    wsConnection.onclose = () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      isBroadcasting = false;
      btnBroadcast.textContent = "📡 Transmitir";
      btnBroadcast.classList.remove("active");
      
      if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
        micStream = null;
        isMicOn = false;
        btnMic.textContent = "🎤 Mic Off";
        btnMic.classList.remove("active");
      }
      
      updateButtonsState();
      
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
      
      if (wsConnection) {
        setStatus("📡 Transmissão encerrada");
      }
      wsConnection = null;
    };

  } catch (err) {
    console.error("Erro broadcast:", err);
    setStatus("❌ Erro ao iniciar transmissão");
  }
}

/* =========================
   PLAYER EVENTS
========================= */
player.addEventListener('timeupdate', updateProgress);
player.addEventListener('loadedmetadata', () => {
  durationEl.textContent = formatTime(player.duration);
});

player.addEventListener('error', (e) => {
  console.error("Player error:", e);
  setStatus("❌ Erro ao carregar áudio");
});

player.addEventListener('ended', () => {
  // Música terminou naturalmente
  markAsPlayed(index);
  renderAllPlaylists();
  
  const nextIndex = getNextIndex();
  
  if (nextIndex === -1) {
    // Todas as músicas foram tocadas
    isPlaying = false;
    updatePlayButton();
    progressBar.value = 0;
    currentTimeEl.textContent = "00:00";
    
    if (isBroadcasting) {
      setStatus("⏹ Todas as músicas foram tocadas - Encerrando transmissão");
      stopBroadcast();
    } else {
      setStatus("⏹ Todas as músicas foram tocadas");
    }
    renderAllPlaylists();
    return;
  }
  
  // Toca a próxima
  index = nextIndex;
  loadTrack();
  
  if (isPlaying) {
    player.play().catch(err => {
      console.error("Erro ao tocar próxima:", err);
    });
    resetInactivityTimer();
  }
});

/* =========================
   VOLUME SLIDER
========================= */
if (volumeSlider) {
  volumeSlider.addEventListener('input', updateVolume);
}

/* =========================
   PROGRESS BAR
========================= */
if (progressBar) {
  progressBar.addEventListener('input', seekAudio);
}

/* =========================
   KEYBOARD SHORTCUTS
========================= */
document.addEventListener('keydown', (e) => {
  switch(e.key) {
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowRight':
      e.preventDefault();
      next();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      prev();
      break;
    case 'm':
      if (e.ctrlKey) {
        e.preventDefault();
        toggleMode();
      }
      break;
  }
});

/* =========================
   INIT
========================= */
async function initApp() {
  try {
    await openDB();
    const savedTracks = await loadPlaylistFromDB();
    
    if (savedTracks.length > 0) {
      playlist = savedTracks;
      index = 0;
      loadTrack();
      renderAllPlaylists();
      updateButtonsState();
      updateModeButton();
      updatePlaylistInfo();
      setStatus("✅ " + playlist.length + " músicas carregadas");
    } else {
      setStatus("PRONTO - Selecione músicas na aba ⚙ Config");
    }
  } catch (err) {
    console.error("Erro ao carregar playlist:", err);
    setStatus("PRONTO - Selecione músicas na aba ⚙ Config");
  }
  
  updateButtonsState();
  updateModeButton();
}

initApp();
