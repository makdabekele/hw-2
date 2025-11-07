// ============================================
// Beat Catcher — p5.js port (1:1 logic)
// - Keeps menu/play/gameOver states
// - Uses p5.FFT + p5.PeakDetect to mimic Minim BeatDetect.isKick()
// - Preserves pending spawn delay + cooldowns + spotlight behavior
// ============================================

// ---------- Config / Assets ----------
const ASSET_PATH = ""; // e.g., "assets/" if you keep media in /assets

let songFiles = [
  "Majid Jordan with Drake - Stars Align (Official Visualizer).mp3",
  "Snoop Dogg - California Roll (Audio) ft. Stevie Wonder.mp3",
  "Travis Scott, Sheck Wes, Don Toliver - 2000 EXCURSION (Official Audio).mp3"
];
let songTitles = [
  "Stars Align",
  "California Roll",
  "2000 Excurcsion"
];

const MENU_MUSIC = "Ariana Grande - no tears left to cry (Official Instrumental)-[AudioTrimmer.com].mp3";
const GAMEOVER_MUSIC = "Hunter x Hunter 2011 OST 3 - 1 - Kingdom of Predators-[AudioTrimmer.com].mp3";
const BG_IMG = "BG_main.png";
const GAMEOVER_IMG = "game_over.png";

// ---------- Audio (p5.sound) ----------
let song = null;           // gameplay song (p5.SoundFile)
let menuMusic = null;      // menu BGM
let gameOverMusic = null;  // game over BGM

let fft = null;            // p5.FFT
let peakKick = null;       // p5.PeakDetect to mimic beat.isKick()

// ---------- Notes / Spotlights ----------
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

// ---------- States ----------
const menu = 0;
const play = 1;
const gameOver = 2;
let gameState = menu;

// ---------- Spotlights ----------
const MAX_SPOTS = 16;
let spots = new Array(MAX_SPOTS).fill(null);

// ---------- UI / Images ----------
let selected = 0;
let bgImg = null;
let gameOverImg = null;
let uiFont = null; // optional: load a font if you have one

// ---------- Paddle / Score ----------
let paddleX;
let paddleY;
let paddleW = 140;
let paddleH = 16;

let score = 0;
let lives = 3;
let maxLives = 3;

let prevMs = 0;

// ---------- Preload media ----------
function preload() {
  // Images
  bgImg = safeLoadImage(BG_IMG);
  gameOverImg = safeLoadImage(GAMEOVER_IMG);

  // Music
  menuMusic = safeLoadSound(MENU_MUSIC);
  gameOverMusic = safeLoadSound(GAMEOVER_MUSIC);

  // Preload gameplay songs into an array of SoundFiles (same filenames)
  for (let i = 0; i < songFiles.length; i++) {
    songFiles[i] = ASSET_PATH + songFiles[i];
  }
}

function safeLoadImage(name) {
  if (!name) return null;
  const path = ASSET_PATH + name;
  try { return loadImage(path); } catch (e) { return null; }
}

function safeLoadSound(name) {
  if (!name) return null;
  const path = ASSET_PATH + name;
  try { return loadSound(path); } catch (e) { return null; }
}

// ---------- Setup ----------
function setup() {
  createCanvas(800, 600);
  frameRate(60);

  // Start menu music after first user gesture (ENTER) to satisfy browser policies
  paddleY = height - 80;
}

// ---------- Draw ----------
function draw() {
  const now = millis();
  const dt = (prevMs === 0) ? (1.0 / 60.0) : (now - prevMs) / 1000.0;
  prevMs = now;

  if (gameState === menu) drawMenu();
  else if (gameState === play) updateAndDrawGame(dt);
  else if (gameState === gameOver) drawGameOver();
}

// ---------- Menu ----------
function drawMenu() {
  rectMode(CORNER);
  if (bgImg) image(bgImg, 0, 0, width, height);
  else background(18);

  textAlign(CENTER, CENTER);
  if (uiFont) textFont(uiFont);
  fill(255);
  textSize(28);
  text("BEAT CATCHER", width / 2, 90);
  textSize(14);
  fill(200);
  text("Use arrow keys to select song!    ENTER to start", width / 2, 130);

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
    fill(i === selected ? 30 : 220);
    textSize(16);
    text(songTitles[i], x + songCardW / 2, y + songCardH / 2);
  }
}

// ---------- Spotlights ----------
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
    if (spots[i] != null) {
      spots[i].update();
      spots[i].draw();
      if (spots[i].dead()) spots[i] = null;
    }
  }
}

// ---------- Gameplay ----------
function updateAndDrawGame(dt) {
  rectMode(CORNER);
  if (bgImg) image(bgImg, 0, 0, width, height);
  else background(24);

  paddleX = constrain(mouseX, paddleW / 2, width - paddleW / 2);

  // --- Analysis / beat detection ---
  if (song && song.isPlaying()) {
    if (fft) {
      // Bass "sum" via getEnergy(20..150), scaled 0..255
      const bassEnergy = fft.getEnergy(20, 150); // 0..255
      // Smooth & normalize (mirror your bassPeak logic)
      bassPeak = Math.max(1, Math.max(bassPeak * 0.96, bassEnergy));
      const norm = bassEnergy / bassPeak; // ~0..1 normalized
      bassSmooth = lerp(bassSmooth, norm, 0.2);

      // Rising edge & thresholds (unchanged semantics)
      const rise = bassSmooth - lastBass;
      const strong = (bassSmooth > 0.45 && rise > 0.025) || (bassSmooth > 0.75 && rise > 0.015);

      const nowMs = millis();
      if (strong && (nowMs - lastSpotlightMs) > spotlightCooldownMs) {
        addSpotlight(random(60, width - 60));
        if (bassSmooth > 0.90 && random(1) < 0.4) addSpotlight(random(60, width - 60));
        lastSpotlightMs = nowMs;
      }

      lastBass = bassSmooth;
    }

    // Replace Minim BeatDetect.isKick() with p5.PeakDetect in low band
    if (peakKick && fft) {
      peakKick.update(fft);
      const onset = !!peakKick.isDetected;
      const now = millis();

      if (onset && !prevOnset) {
        pendingSpawns++;
        if (firstPendingAtMs === -1) firstPendingAtMs = now;
      }
      prevOnset = onset;

      if (pendingSpawns > 0 && firstPendingAtMs !== -1 && (now - firstPendingAtMs) >= SPAWN_DELAY_MS) {
        if (countActiveNotes() < 22 && (now - lastSpawnMs) > spawnCooldownMs) {
          spawn();
          lastSpawnMs = now;
          pendingSpawns--;
        }
        firstPendingAtMs = (pendingSpawns > 0) ? now : -1;
      }
    }
  }

  // Spotlights
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
    if (notes[i] != null) {
      notes[i].update(dt);
      notes[i].drawNote();
      if (circleRectOverlap(notes[i].x, notes[i].y, notes[i].r, paddleX - paddleW / 2, paddleY - paddleH / 2, paddleW, paddleH)) {
        score++;
        notes[i] = null;
        continue;
      }
      if (notes[i] && notes[i].offScreen()) {
        notes[i] = null;
        lives--;
        if (lives <= 0) {
          goGameOver();
          return;
        }
      }
    }
  }

  // HUD
  drawdesign();
}

function drawdesign() {
  textAlign(LEFT, TOP);
  if (uiFont) textFont(uiFont);
  fill(255);
  textSize(16);
  text("Score: " + score, 18, 16);

  let hearts = "";
  for (let i = 0; i < lives; i++) hearts += "<3 ";
  fill(255, 120, 120);
  text("Lives: " + hearts, 18, 40);
}

// Circle-rect overlap (same math)
function circleRectOverlap(cx, cy, cr, rx, ry, rw, rh) {
  const nearestX = constrain(cx, rx, rx + rw);
  const nearestY = constrain(cy, ry, ry + rh);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return (dx * dx + dy * dy) <= cr * cr;
}

// ---------- Game Over ----------
function drawGameOver() {
  if (gameOverImg) image(gameOverImg, 0, 0, width, height);
  else {
    background(10);
    textAlign(CENTER, CENTER);
    if (uiFont) textFont(uiFont);
    fill(255);
    textSize(32);
    text("GAME OVER", width / 2, height / 2 - 40);
  }
  textAlign(CENTER, CENTER);
  if (uiFont) textFont(uiFont);
  fill(255);
  textSize(18);
  text("Score: " + score, width / 2, height / 2 + 10);
  fill(220);
  textSize(14);
  text("Press R to restart • ENTER for Menu", width / 2, height / 2 + 40);
}

// ---------- State helpers ----------
function startGame() {
  // ensure audio context is started by a gesture
  userStartAudio();

  if (menuMusic && menuMusic.isPlaying()) menuMusic.pause();
  if (gameOverMusic && gameOverMusic.isPlaying()) gameOverMusic.pause();

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
  if (gameOverMusic && gameOverMusic.isPlaying()) gameOverMusic.pause();
  if (menuMusic) {
    menuMusic.stop();
    menuMusic.loop();
  }
  stopSong();
  clearNotes();
  gameState = menu;
}

function goGameOver() {
  if (song) song.pause();
  if (gameOverMusic) {
    gameOverMusic.stop();
    gameOverMusic.play();
  }
  stopSong();
  gameState = gameOver;
}

function clearNotes() {
  for (let i = 0; i < MAX_NOTES; i++) notes[i] = null;
}

function loadSelectedSong() {
  stopSong();
  // Load on demand (playback starts at user gesture)
  song = loadSound(songFiles[selected], () => {
    // Once loaded, wire FFT + PeakDetect and play
    fft = new p5.FFT(0.8, 1024);
    fft.setInput(song);

    // Mimic "kick" band ~ 20-150 Hz, threshold ~0.15..0.2; play with framesPerPeak ~ 20 (like sensitivity)
    peakKick = new p5.PeakDetect(20, 150, 0.15, 20);

    song.play(); // start from beginning
  }, (err) => {
    // load error; fail gracefully
    console.error("Error loading song:", err);
  });
}

function stopSong() {
  if (song) {
    song.stop();
    song = null;
  }
}

// ---------- Input ----------
function keyPressed() {
  if (gameState === menu) {
    if (keyCode === LEFT_ARROW) selected = (selected + 2) % 3;
    else if (keyCode === RIGHT_ARROW) selected = (selected + 1) % 3;
    else if (keyCode === ENTER || keyCode === RETURN) {
      // Start menu music if not already
      if (menuMusic && !menuMusic.isPlaying()) {
        menuMusic.loop();
      }
      startGame();
    }
  } else if (gameState === gameOver) {
    if (key === 'r' || key === 'R') restartGame();
    else if (keyCode === ENTER || keyCode === RETURN) backToMenu();
  }
}

// ---------- Spawning ----------
function spawn() {
  if (countActiveNotes() >= 22) return;
  for (let i = 0; i < MAX_NOTES; i++) {
    if (notes[i] == null) {
      notes[i] = new Note(random(30, width - 30), -20, 200, random(12, 20));
      return;
    }
  }
}

function countActiveNotes() {
  let c = 0;
  for (let i = 0; i < MAX_NOTES; i++) if (notes[i] != null) c++;
  return c;
}

// ---------- Classes ----------
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
  constructor(_x) {
    this.x = _x;
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
    drawingContext.save();
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
    drawingContext.restore();
    pop();
  }
}





