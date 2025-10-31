// ===== p5.js PORT OF YOUR PROCESSING SKETCH =====
// Requires p5.js + p5.sound

// ---- AUDIO ----
let menuMusic, gameOverMusic;
let song = null;
let fft = null;            // p5.FFT
let peak = null;           // p5.PeakDetect (used like BeatDetect kick)
let prevOnset = false;

// ---- GAME ARRAYS ----
const MAX_NOTES = 64;
let notes = new Array(MAX_NOTES).fill(null);

const MAX_SPOTS = 16;
let spots = new Array(MAX_SPOTS).fill(null);

// ---- BASS FLASH SMOOTHING ----
let bassPeak = 1;
let bassSmooth = 0;
let lastBass = 0;

// ---- PENDING SPAWNS (kick edge) ----
let pendingSpawns = 0;
let firstPendingAtMs = -1;
const SPAWN_DELAY_MS = 200;

// ---- COOLDOWNS ----
let lastSpotlightMs = 0;
let spotlightCooldownMs = 120;

let lastSpawnMs = 0;
let spawnCooldownMs = 350;

// ---- STATES ----
const MENU = 0;
const PLAY = 1;
const GAMEOVER = 2;
let gameState = MENU;

// ---- SONGS ----
let songFiles = [
  "Majid Jordan with Drake - Stars Align (Official Visualizer).mp3",
  "Snoop Dogg - California Roll (Audio) ft. Stevie Wonder.mp3",
  "Travis Scott, Sheck Wes, Don Toliver - 2000 EXCURSION (Official Audio).mp3"
];
let songTitles = [
  "Stars Align",
  "California Roll",
  "2000 Excursion"
];
let selected = 0;

// ---- IMAGES ----
let bgImg = null;
let gameOverImg = null;

// ---- UI / PADDLE ----
let paddleX = 0;
let paddleY = 0;
let paddleW = 140;
let paddleH = 16;

// ---- SCORE/LIVES ----
let score = 0;
let lives = 3;
let maxLives = 3;

// ---- TIMING ----
let prevMs = 0;

// ---- FONT (p5 uses system fonts by name; no need to createFont) ----
let haveInteracted = false; // browsers block autoplay; we’ll start audio after first key press/click

function preload() {
  // Load images (draw scaled at render time)
  bgImg = loadImage("BG_main.png", () => {}, () => { bgImg = null; });
  gameOverImg = loadImage("game_over.png", () => {}, () => { gameOverImg = null; });

  // Load audio (actual playback triggered after user gesture)
  soundFormats('mp3', 'wav', 'ogg');
  menuMusic = loadSound("Ariana Grande - no tears left to cry (Official Instrumental)-[AudioTrimmer.com].mp3");
  gameOverMusic = loadSound("Hunter x Hunter 2011 OST 3 - 1 - Kingdom of Predators-[AudioTrimmer.com].mp3");
}

function setup() {
  createCanvas(800, 600);
  frameRate(60);

  // Prepare FFT + PeakDetect (we’ll re-route input when song changes)
  fft = new p5.FFT(0.8, 1024);
  peak = new p5.PeakDetect(20, 150, 0.9, 20); // approx "kick" band w/ threshold

  paddleY = height - 80;
  textFont('Helvetica');
}

function draw() {
  const now = millis();
  const dt = (prevMs === 0) ? (1.0 / 60.0) : (now - prevMs) / 1000.0;
  prevMs = now;

  if (gameState === MENU) drawMenu();
  else if (gameState === PLAY) updateAndDrawGame(dt);
  else if (gameState === GAMEOVER) drawGameOver();
}

// ------------- MENU -------------
function drawMenu() {
  rectMode(CORNER);
  if (bgImg) image(bgImg, 0, 0, width, height);
  else background(18);

  textAlign(CENTER, CENTER);
  fill(255);
  textSize(28);
  text("BEAT CATCHER", width / 2, 90);
  textSize(14);
  fill(200);
  if (!haveInteracted) {
    text("Press any key/click to enable audio, then use arrows to choose a song • ENTER to start", width/2, 130);
  } else {
    text("Use arrow keys to select song • ENTER to start", width/2, 130);
  }

  const songCardW = 220;
  const songCardH = 120;
  const spacing = 30;
  const totalW = 3 * songCardW + 2 * spacing;
  const startX = (width - totalW) / 2;
  const y = height / 2 - songCardH / 2;

  for (let i = 0; i < 3; i++) {
    const x = startX + i * (songCardW + spacing);
    if (i === selected) {
      fill(255, 230, 120);
      stroke(40);
      strokeWeight(2);
    } else {
      noStroke();
      fill(40);
    }
    rect(x, y, songCardW, songCardH, 14);
    fill(i === selected ? 30 : 220);
    textSize(16);
    text(songTitles[i], x + songCardW / 2, y + songCardH / 2);
  }
}

// ------------- SPOTLIGHTS -------------
function addSpotlight(x) {
  for (let i = 0; i < MAX_SPOTS; i++) {
    if (spots[i] === null) {
      spots[i] = new Spotlight(x);
      return;
    }
  }
}

function updateAndDrawSpotlights() {
  for (let i = 0; i < MAX_SPOTS; i++) {
    const s = spots[i];
    if (s) {
      s.update();
      s.draw();
      if (s.dead()) spots[i] = null;
    }
  }
}

// ------------- GAME -------------
function updateAndDrawGame(dt) {
  rectMode(CORNER);
  if (bgImg) image(bgImg, 0, 0, width, height);
  else background(24);

  // Paddle follows mouse, clamped
  paddleX = constrain(mouseX, paddleW / 2, width - paddleW / 2);

  if (song && song.isPlaying()) {
    // Analyze spectrum
    fft.analyze();

    // Bass energy for spotlight flashes (≈ <150Hz)
    const sumBass = fft.getEnergy(20, 150); // 0..255 scale
    // Normalize similar to original logic
    bassPeak = Math.max(1, Math.max(bassPeak * 0.96, sumBass));
    const norm = sumBass / bassPeak;
    bassSmooth = lerp(bassSmooth, norm, 0.2);

    // Rising-edge / strong flash condition
    const rise = bassSmooth - lastBass;
    const strong = (bassSmooth > 0.45 && rise > 0.025) || (bassSmooth > 0.75 && rise > 0.015);

    const nowMs = millis();
    if (strong && (nowMs - lastSpotlightMs) > spotlightCooldownMs) {
      addSpotlight(random(60, width - 60));
      if (bassSmooth > 0.90 && random() < 0.4) addSpotlight(random(60, width - 60));
      lastSpotlightMs = nowMs;
    }
    lastBass = bassSmooth;

    // Beat / kick detect ≈ BeatDetect.isKick()
    peak.update(fft); // must be called after fft.analyze()
    const onset = peak.isDetected; // boolean
    const now = millis();

    if (onset && !prevOnset) {
      pendingSpawns++;
      if (firstPendingAtMs === -1) firstPendingAtMs = now;
    }
    prevOnset = onset;

    // Delayed spawn to line up with visuals, with cooldown and population cap
    if (pendingSpawns > 0 && firstPendingAtMs !== -1 && (now - firstPendingAtMs) >= SPAWN_DELAY_MS) {
      if (countActiveNotes() < 22 && (now - lastSpawnMs) > spawnCooldownMs) {
        spawn();
        lastSpawnMs = now;
        pendingSpawns--;
      }
      firstPendingAtMs = (pendingSpawns > 0) ? now : -1;
    }
  }

  updateAndDrawSpotlights();

  // Paddle
  rectMode(CENTER);
  noStroke();
  fill(255, 230, 120);
  rect(paddleX, paddleY, paddleW, paddleH, 6);

  // Notes
  fill(255);
  noStroke();
  for (let i = 0; i < MAX_NOTES; i++) {
    const n = notes[i];
    if (n) {
      n.update(dt);
      n.drawNote();
      if (circleRectOverlap(n.x, n.y, n.r, paddleX - paddleW / 2, paddleY - paddleH / 2, paddleW, paddleH)) {
        score++;
        notes[i] = null;
        continue;
      }
      if (notes[i] && n.offScreen()) {
        notes[i] = null;
        lives--;
        if (lives <= 0) {
          goGameOver();
          return;
        }
      }
    }
  }

  drawHUD();
}

function drawHUD() {
  textAlign(LEFT, TOP);
  fill(255);
  textSize(16);
  text(`Score: ${score}`, 18, 16);

  let hearts = "";
  for (let i = 0; i < lives; i++) hearts += "<3 ";
  fill(255, 120, 120);
  text(`Lives: ${hearts}`, 18, 40);
}

function circleRectOverlap(cx, cy, cr, rx, ry, rw, rh) {
  const nearestX = constrain(cx, rx, rx + rw);
  const nearestY = constrain(cy, ry, ry + rh);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return (dx * dx + dy * dy) <= cr * cr;
}

// ------------- GAME OVER -------------
function drawGameOver() {
  if (gameOverImg) image(gameOverImg, 0, 0, width, height);
  else {
    background(10);
    textAlign(CENTER, CENTER);
    fill(255);
    textSize(32);
    text("GAME OVER", width / 2, height / 2 - 40);
  }
  textAlign(CENTER, CENTER);
  fill(255);
  textSize(18);
  text(`Score: ${score}`, width / 2, height / 2 + 10);
  fill(220);
  textSize(14);
  text("Press R to restart • ENTER for Menu", width / 2, height / 2 + 40);
}

// ------------- STATE CONTROL -------------
function startGame() {
  stopAllMusic();

  pendingSpawns = 0;
  firstPendingAtMs = -1;
  clearNotes();
  score = 0;
  lives = maxLives;
  lastSpawnMs = 0;
  prevOnset = false;
  lastBass = 0;
  bassPeak = 1;
  bassSmooth = 0;

  loadSelectedSong(); // sets fft input and starts song
  gameState = PLAY;
}

function restartGame() {
  stopSong();
  startGame();
}

function backToMenu() {
  stopSong();
  clearNotes();
  gameState = MENU;

  if (menuMusic && !menuMusic.isPlaying()) {
    menuMusic.loop();
  }
}

function goGameOver() {
  if (song && song.isPlaying()) song.pause();
  stopSong();
  gameState = GAMEOVER;
  if (gameOverMusic) {
    gameOverMusic.stop();
    gameOverMusic.play();
  }
}

function clearNotes() {
  for (let i = 0; i < MAX_NOTES; i++) notes[i] = null;
}

function loadSelectedSong() {
  stopSong();

  // Load on demand from preloaded? For simplicity here, we try to load fresh each time.
  // If you prefer preloading all game songs, use additional loadSound() in preload.
  const file = songFiles[selected];

  // In p5.sound, loadSound is async; but we want a quick swap.
  // We'll preload all gameplay songs once the user has interacted to ensure fast switching.
  // Minimal approach: load now and play in callback.
  loadSound(file, (snd) => {
    song = snd;
    fft.setInput(song);
    song.play();
  }, (err) => {
    // failed to load; just ignore
    song = null;
  });
}

function stopSong() {
  if (song) {
    song.stop();
    song.disconnect();
    song = null;
  }
}

function stopAllMusic() {
  if (menuMusic && menuMusic.isPlaying()) menuMusic.stop();
  if (gameOverMusic && gameOverMusic.isPlaying()) gameOverMusic.stop();
}

// ------------- INPUT -------------
function keyPressed() {
  // First user gesture: enable audio context + start menu loop
  if (!haveInteracted) {
    userStartAudio();
    haveInteracted = true;
    if (gameState === MENU && menuMusic && !menuMusic.isPlaying()) {
      menuMusic.loop();
    }
  }

  if (gameState === MENU) {
    if (keyCode === LEFT_ARROW) {
      selected = (selected + 2) % 3;
    } else if (keyCode === RIGHT_ARROW) {
      selected = (selected + 1) % 3;
    } else if (keyCode === ENTER || keyCode === RETURN) {
      startGame();
    }
  } else if (gameState === GAMEOVER) {
    if (key === 'r' || key === 'R') {
      restartGame();
    } else if (keyCode === ENTER || keyCode === RETURN) {
      backToMenu();
    }
  }
}

// ------------- SPAWNING -------------
function spawn() {
  if (countActiveNotes() >= 22) return;
  for (let i = 0; i < MAX_NOTES; i++) {
    if (notes[i] === null) {
      notes[i] = new Note(random(30, width - 30), -20, 200, random(12, 20));
      return;
    }
  }
}

function countActiveNotes() {
  let c = 0;
  for (let i = 0; i < MAX_NOTES; i++) if (notes[i] !== null) c++;
  return c;
}

// ------------- CLASSES -------------
class Note {
  constructor(startX, startY, speed, radius) {
    this.x = startX;
    this.y = startY;
    this.vy = speed;
    this.r = radius;
  }
  update(dt) {
    this.y += this.vy * dt;
  }
  drawNote() {
    ellipse(this.x, this.y, this.r * 2, this.r * 2);
  }
  offScreen() {
    return this.y - this.r > height;
  }
}

class Spotlight {
  constructor(x) {
    this.x = x;
    this.angle = random(-0.15, 0.15);
    this.w = random(60, 120);
    this.h = random(260, 420);
    this.a = 180;
    this.decay = random(4, 7);

    // soft neon range
    this.r = random(100, 255);
    this.g = random(0, 150);
    this.b = random(150, 255);
  }
  update() {
    this.a -= this.decay;
  }
  dead() {
    return this.a <= 0;
  }
  draw() {
    push();
    translate(this.x, height);
    rotate(this.angle);
    blendMode(ADD);
    noStroke();

    for (let i = 0; i < 4; i++) {
      const t = 1 - i * 0.22;
      const al = int(this.a * (0.55 - i * 0.12));
      if (al <= 0) continue;

      fill(this.r, this.g, this.b, al);

      const ww = this.w * t;
      const hh = -this.h * t;
      triangle(0, 0, -ww, hh, ww, hh);
    }

    blendMode(BLEND);
    pop();
  }
}
