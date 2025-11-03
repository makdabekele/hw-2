// ------------------------------
// Beat Catcher — p5.js edition
// - Replaces Minim with p5.sound
// - Replaces BeatDetect kick with bass-energy rising-edge detector via p5.FFT
// - Preserves your menu / play / game-over flow, spawn queue, spotlights, etc.
// ------------------------------

let menu = 0, play = 1, gameOver = 2;
let gameState = menu;

const MAX_NOTES = 64;
let notes = new Array(MAX_NOTES).fill(null);

let prevOnset = false;

let bassPeak = 1;
let bassSmooth = 0;
let lastBass = 0;

let pendingSpawns = 0;
let firstPendingAtMs = -1;
const SPAWN_DELAY_MS = 200;

let lastSpotlightMs = 0;
let spotlightCooldownMs = 120;

let lastSpawnMs = 0;
let spawnCooldownMs = 350;

const MAX_SPOTS = 16;
let spots = new Array(MAX_SPOTS).fill(null);

// --- Audio ---
let song = null;          // gameplay
let menuMusic = null;     // menu loop
let gameOverMusic = null; // game-over one-shot
let fft = null;

// Use exactly your file names
const songFiles = [
  "Majid Jordan with Drake - Stars Align (Official Visualizer).mp3",
  "Snoop Dogg - California Roll (Audio) ft. Stevie Wonder.mp3",
  "Travis Scott, Sheck Wes, Don Toliver - 2000 EXCURSION (Official Audio).mp3"
];
const songTitles = [
  "Stars Align",
  "California Roll",
  "2000 Excursion"
];
let selected = 0;

// --- Art / UI ---
let bgImg, gameOverImg;
let paddleX, paddleY;
let paddleW = 140, paddleH = 16;

let score = 0;
let lives = 3;
const maxLives = 3;

let prevMs = 0;

// ------------------------------
// p5 lifecycle
// ------------------------------
function preload() {
  // Images
  bgImg = loadImage("assets/BG_main.png", img => img.resize(800, 600));
  gameOverImg = loadImage("assets/game_over.png", img => img.resize(800, 600));

  // Music
  soundFormats('mp3');
  menuMusic = loadSound("assets/Ariana Grande - no tears left to cry (Official Instrumental)-[AudioTrimmer.com].mp3");
  gameOverMusic = loadSound("assets/Hunter x Hunter 2011 OST 3 - 1 - Kingdom of Predators-[AudioTrimmer.com].mp3");

  // Preload doesn't start song; browsers need user gesture.
}

function setup() {
  createCanvas(800, 600);
  frameRate(60);
  textFont('Helvetica');
  paddleY = height - 80;

  // FFT for gameplay analysis (create once; set input when song loads)
  // smoothing 0.8, 1024 bins (fine for kick energy)
  fft = new p5.FFT(0.8, 1024);
}

function draw() {
  const now = millis();
  const dt = (prevMs === 0) ? (1 / 60) : (now - prevMs) / 1000.0;
  prevMs = now;

  if (gameState === menu) drawMenu();
  else if (gameState === play) updateAndDrawGame(dt);
  else drawGameOver();
}

// ------------------------------
// States
// ------------------------------
function drawMenu() {
  rectMode(CORNER);
  if (bgImg) image(bgImg, 0, 0);
  else background(18);

  // safe-start: loop menu music on first entry after a gesture
  if (menuMusic && !menuMusic.isPlaying() && !song && !gameOverMusic?.isPlaying()) {
    // Do not auto-play without a user gesture; start on first key press in keyPressed()
  }

  textAlign(CENTER, CENTER);
  fill(255);
  textSize(28);
  text("BEAT CATCHER", width / 2, 90);

  textSize(14);
  fill(200);
  text("Use ◀ ▶ to select • ENTER to start", width / 2, 130);

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
      fill(40);
      noStroke();
    }
    rect(x, y, songCardW, songCardH, 14);
    fill((i === selected) ? 30 : 220);
    textSize(16);
    text(songTitles[i], x + songCardW / 2, y + songCardH / 2);
  }
}

function updateAndDrawGame(dt) {
  rectMode(CORNER);
  if (bgImg) image(bgImg, 0, 0);
  else background(24);

  // paddle follows mouse, clamped to canvas
  paddleX = constrain(mouseX, paddleW / 2, width - paddleW / 2);

  // ----- AUDIO ANALYSIS -----
  if (song && song.isPlaying()) {
    // Compute bass energy (20–150Hz). getEnergy returns 0..255
    const bassEnergy = fft.getEnergy(20, 150) || 0;

    // Peak-hold and normalized smooth (like your Processing code)
    if (bassEnergy > bassPeak) bassPeak = bassEnergy;
    bassPeak *= 0.96;
    if (bassPeak < 1) bassPeak = 1;

    const norm = bassEnergy / bassPeak;
    bassSmooth = lerp(bassSmooth, norm, 0.2);

    // Rising-edge heuristic for "kick"
    const rise = bassSmooth - lastBass;
    const strong = (bassSmooth > 0.45 && rise > 0.025) || (bassSmooth > 0.75 && rise > 0.015);

    const nowMs = millis();
    if (strong && (nowMs - lastSpotlightMs) > spotlightCooldownMs) {
      addSpotlight(random(60, width - 60));
      if (bassSmooth > 0.90 && random() < 0.4) addSpotlight(random(60, width - 60));
      lastSpotlightMs = nowMs;
    }

    // Use the same "onset queue" pattern you had with BeatDetect
    const onset = strong; // replacement for beat.isKick()
    if (onset && !prevOnset) {
      pendingSpawns++;
      if (firstPendingAtMs === -1) firstPendingAtMs = nowMs;
    }
    prevOnset = onset;

    // Release queued spawns with delay + cooldown + cap
    if (pendingSpawns > 0 && firstPendingAtMs !== -1 && nowMs - firstPendingAtMs >= SPAWN_DELAY_MS) {
      if (countActiveNotes() < 22 && nowMs - lastSpawnMs > spawnCooldownMs) {
        spawn();
        lastSpawnMs = nowMs;
        pendingSpawns--;
      }
      firstPendingAtMs = (pendingSpawns > 0) ? nowMs : -1;
    }

    lastBass = bassSmooth;
  }

  // ----- SPOTLIGHTS -----
  updateAndDrawSpotlights();

  // ----- PADDLE -----
  rectMode(CENTER);
  noStroke();
  fill(255, 230, 120);
  rect(paddleX, paddleY, paddleW, paddleH, 6);

  // ----- NOTES -----
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
      if (n && n.offScreen()) {
        notes[i] = null;
        lives--;
        if (lives <= 0) {
          goGameOver();
          return;
        }
      }
    }
  }

  // ----- HUD -----
  drawHUD();
}

function drawGameOver() {
  if (gameOverImg) image(gameOverImg, 0, 0);
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

// ------------------------------
// Flow helpers
// ------------------------------
function startGame() {
  // stop menu / game-over music
  if (menuMusic?.isPlaying()) menuMusic.pause();
  if (gameOverMusic?.isPlaying()) gameOverMusic.pause();

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

  loadSelectedSong();
  gameState = play;
}

function restartGame() {
  stopSong();
  startGame();
}

function backToMenu() {
  if (gameOverMusic?.isPlaying()) gameOverMusic.pause();
  // rewind + loop menu music (requires user gesture occurred before)
  if (menuMusic) {
    menuMusic.stop();
    menuMusic.loop();
  }
  stopSong();
  clearNotes();
  gameState = menu;
}

function goGameOver() {
  if (song?.isPlaying()) song.pause();
  if (gameOverMusic) {
    gameOverMusic.stop();
    gameOverMusic.play(); // play once
  }
  stopSong();
  gameState = gameOver;
}

// ------------------------------
// Audio control
// ------------------------------
function loadSelectedSong() {
  stopSong();
  const path = `assets/${songFiles[selected]}`;

  song = loadSound(path, () => {
    // connect FFT to this song
    fft.setInput(song);
    song.play();
  });
}

function stopSong() {
  if (song) {
    if (song.isPlaying()) song.stop();
    song.disconnect();
    song = null;
  }
}

// ------------------------------
// Spawns / Notes / Spotlights
// ------------------------------
function spawn() {
  if (countActiveNotes() >= 22) return;
  for (let i = 0; i < MAX_NOTES; i++) {
    if (!notes[i]) {
      notes[i] = new Note(random(30, width - 30), -20, 200, random(12, 20));
      return;
    }
  }
}

function countActiveNotes() {
  let c = 0;
  for (let i = 0; i < MAX_NOTES; i++) if (notes[i]) c++;
  return c;
}

function clearNotes() {
  for (let i = 0; i < MAX_NOTES; i++) notes[i] = null;
}

function addSpotlight(x) {
  for (let i = 0; i < MAX_SPOTS; i++) {
    if (!spots[i]) {
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

// ------------------------------
// UI helpers
// ------------------------------
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

// ------------------------------
// Input
// ------------------------------
function keyPressed() {
  if (gameState === menu) {
    if (keyCode === LEFT_ARROW) {
      selected = (selected + 2) % 3;
    } else if (keyCode === RIGHT_ARROW) {
      selected = (selected + 1) % 3;
    } else if (keyCode === ENTER || keyCode === RETURN) {
      // First gesture: start menu loop if it hasn't played yet
      if (menuMusic && !menuMusic.isPlaying()) {
        // Start + immediately stop to unlock audio, then start game.
        // But simpler: just start game; startGame() pauses menuMusic anyway.
      }
      startGame();
    }
  } else if (gameState === gameOver) {
    if (key === 'r' || key === 'R') {
      restartGame();
    } else if (keyCode === ENTER || keyCode === RETURN) {
      backToMenu();
    }
  }
}

// ------------------------------
// Classes
// ------------------------------
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

    // soft neon range: pink-blue-purple
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
      const al = this.a * (0.55 - i * 0.12);
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

