const WebSocket = require("ws");
const { spawn } = require("child_process");

// Pega a senha do argumento da linha de comando
const PASSWORD = process.argv[2] || "SENHA_DO_ENCODER";

const ICECAST_HOST = process.argv[3] || "s01.brascast.com";
const ICECAST_PORT = process.argv[4] || "31112";
const ICECAST_MOUNT = process.argv[5] || "/live";

const ICECAST_URL = `icecast://source:${PASSWORD}@${ICECAST_HOST}:${ICECAST_PORT}${ICECAST_MOUNT}`;

console.log("═══════════════════════════════════════");
console.log("🎙 CURUPIRA RADIO - ENCODER");
console.log("═══════════════════════════════════════");
console.log("📡 Servidor:", ICECAST_HOST + ":" + ICECAST_PORT);
console.log("📍 Mount:", ICECAST_MOUNT);
console.log("🔑 Senha:", "*".repeat(PASSWORD.length));
console.log("═══════════════════════════════════════");

function startFFMPEG() {
  console.log("🔄 Iniciando FFmpeg...");
  
  const ffmpeg = spawn("ffmpeg", [
    "-re",
    "-f", "webm",
    "-i", "pipe:0",
    "-c:a", "aac",
    "-b:a", "96k",
    "-ar", "44100",
    "-f", "adts",
    "-content_type", "audio/aac",
    "-ice_name", "Curupira Radio",
    "-ice_description", "Radio App",
    ICECAST_URL
  ]);

  ffmpeg.on("error", (err) => {
    console.error("❌ Erro FFmpeg:", err.message);
  });

  ffmpeg.stderr.on("data", (data) => {
    const msg = data.toString();
    // Mostra erros e informações importantes
    if (msg.includes("Error") || msg.includes("error") || 
        msg.includes("Connected") || msg.includes("connect") ||
        msg.includes("403") || msg.includes("401")) {
      console.log("FFmpeg:", msg.trim());
    }
  });

  ffmpeg.on("close", (code) => {
    console.log("⚠ FFmpeg encerrado com código:", code);
  });

  return ffmpeg;
}

let ffmpeg = startFFMPEG();

// WebSocket server
const wss = new WebSocket.Server({ port: 9001 });

console.log("🔌 WebSocket aguardando na porta 9001");

wss.on("connection", (ws) => {
  console.log("📱 App conectado");

  ws.on("message", (data) => {
    // Reinicia encoder se necessário
    if (!ffmpeg || ffmpeg.killed || ffmpeg.stdin.destroyed) {
      console.log("♻ Reiniciando encoder...");
      ffmpeg = startFFMPEG();
    }

    try {
      const canWrite = ffmpeg.stdin.write(data);
      if (!canWrite) {
        ffmpeg.stdin.once("drain", () => {});
      }
    } catch (err) {
      console.error("❌ Erro ao escrever no FFmpeg:", err.message);
      ffmpeg = startFFMPEG();
    }
  });

  ws.on("close", () => {
    console.log("❌ Cliente desconectado");
  });

  ws.on("error", (err) => {
    console.error("❌ Erro WebSocket:", err.message);
  });
});

// Watchdog
setInterval(() => {
  if (!ffmpeg || ffmpeg.killed || ffmpeg.stdin.destroyed) {
    console.log("♻ Watchdog reiniciando encoder...");
    ffmpeg = startFFMPEG();
  }
}, 10000);

console.log("✅ Encoder pronto! Aguardando áudio do app...");
