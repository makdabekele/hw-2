// ===== Beat Catcher — p5.js (minimal port w/ isKick & isSnare emulation) =====
// Requires: p5.js + p5.sound
// Note: Click or press any key once on the menu to enable audio (browser policy).

// ---------- AUDIO ----------
let minim_like = {}; // placeholder, not used (parity w/ original names)
let song = null;     // current gameplay song
let fft = null;      // p5.FFT
let menuMusic, gameOverMusic;
let gameSongs = [];
let haveInteracted = false; // user gesture required for audio

// ---------- SONGS ----------
const songFiles = [
  "Majid Jordan with Drake - Stars Align (Official Visualizer).mp3",
  "Snoop Dogg - California Roll (Audio) ft. Stevie Wonder.mp3",
  "Travis Scott, Sheck Wes, Don Toliver - 2000 EXCURSION (Official Audio).mp3"
];
const songTitles = [
  "Stars Align",
  "California Roll",
  "2000 Excurcsion"
];
let selected = 0;

// ---------- IMAGES / FONT ----------
let bgImg = null, gameOverImg = null;
let paddleX = 0;
let paddleY = 0;
let paddleW = 140;
let paddleH = 16;

// ---------- GAME STATE ----------
const MENU = 0, PLAY = 1, GAMEOVER = 2;
let gameState = MENU;

// ---------- NOTES ----------
const MAX_NOTES = 64;
let notes = new Array(MAX_NOTES).fill(null);

// ---------- SPOTLIGHTS ----------
const MAX_SPOTS = 16;
let spots = new Array(MAX_SPOTS).fill(null);

// ---------- BASS FLASH SMOOTHING ----------
let bassPeak = 1;
let bassSmooth = 0;
let lastBass = 0;

// ---------- PENDING SPAWNS (kick rising-edge) ----------
let pendingSpawns = 0;
let firstPendingAtMs = -1;
const SPAWN_DELAY_MS = 200;

// ---------- COOLDOWNS ----------
let lastSpotlightMs = 0;
let spotlightCooldownMs = 120;
let lastSpawnMs = 0;
let spawnCooldownMs = 350;

// ---------- SCORE/LIVES ----------
let score = 0;
let lives = 3;
let maxLives = 3;

// ---------- TIMING ----------
let prevMs = 0;

// ---------- KICK/SNARE EMULATION ----------
let prevKick = false;
let prevOnset = false; // kept to mirror your original
let lastKickMs = 0, lastSnareMs = 0;
const KICK_COOLDOWN_MS  = 110; // similar to Minim feel
const SNARE_COOLDOWN_MS = 120;
// band choices (tweak if needed)
const KICK_LOW  = [20, 150];
const MID_BAND  = [150, 400];
const SNARE_BAND = [180, 300];
// thresholds
let kickRatioThreshold  = 1.35;  // low/mid ratio
let kickEnergyFloor     = 50;    // ensure non-trivial low energy
let snareEnergyThreshold = 80;   // absolute mid-high energy

// =======================================================
// PRELOAD
// =======================================================
function preload() {
  soundFormats('mp3', 'wav', 'ogg');

  // images (safe-load; if missing, keep null)
  bgImg = loadImage("BG_main.png", () => {}, () => { bgImg = null; });
  gameOverImg = loadImage("game_over.png", () => {}, () => { gameOverImg = null; });

  // music
  menuMusic     = loadSound("Ariana Grande - no tears left to cry (Official Instrumental)-[AudioTrimmer.com].mp3");
  gameOverMusic = loadSound("Hunter x Hunter 2011 OST 3 - 1 - Kingdom of Predators-[AudioTrimmer.com].mp3");

  // gameplay songs
  for (let i = 0; i < songFiles.length; i++) {
    try {
      gameSongs[i] = loadSound(songFiles[i]);
    } catch (e) {
      gameSongs[i] = null;
    }
  }
}

// =======================================================
// SETUP / DRAW
// =======================================================
function setup() {
  createCanvas(800, 600);
  frameRate(60);

  fft = new p5.FFT(0.8, 1024);

  paddleY = height - 80;
  textFont('Helvetica');

  // we won’t start audio until the first user gesture
}

function draw() {
  const now = millis();
  const dt = (prevMs === 0) ? (1.0 / 60.0) : (now - prevMs) / 1000.0;
  prevMs = now;

  if (gameState === MENU)       drawMenu();
  else if (gameState === PLAY)  updateAndDrawGame(dt);
  else if (gameState === GAMEOVER) drawGameOver();
}

// =======================================================
// MENU
// =======================================================
function drawMenu() {
  rectMode(CORNER);
  if (bgImg) image(bgImg, 0, 0, width, height);
  else background(18);

  textAlign(CENTER, CENTER);
  fill(255);
  textSize(28);
  text("BEAT CATCHER", width/2, 90);

  textSize(14);
  fill(200);
  if (!haveInteracted) {
    text("Press any key/click once to enable audio • Arrows to choose song • ENTER to start", width/2, 130);
  } else {
    text("Use arrow keys to select song • ENTER to start", width/2, 130);
  }

  const songCardW = 220;
  const songCardH = 120;
  const spacing = 30;
  const totalW = 3 * songCardW + 2 * spacing;
  const startX = (width - totalW) / 2;
  const y = height/2 - songCardH/2;

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
    text(songTitles[i], x + songCardW/2, y + songCardH/2);
  }
}

// =======================================================
// GAME LOOP (PLAY)
// =======================================================
function updateAndDrawGame(dt) {
  rectMode(CORNER);
  if (bgImg) image(bgImg, 0, 0, width, height);
  else background(24);

  // Paddle follows mouse, clamped
  paddleX = constrain(mouseX, paddleW / 2, width - paddleW / 2);

  // --- AUDIO ANALYSIS & DETECTION ---
  if (song && song.isPlaying()) {
    fft.analyze();

    // Bass flash (visual smoothing only)
    const sumBass = fft.getEnergy(KICK_LOW[0], KICK_LOW[1]); // 0..255
    bassPeak = Math.max(1, Math.max(bassPeak * 0.96, sumBass));
    const norm = sumBass / bassPeak;
    bassSmooth = lerp(bassSmooth, norm, 0.2);

    const rise = bassSmooth - lastBass;
    const strong = (bassSmooth > 0.45 && rise > 0.025) || (bassSmooth > 0.75 && rise > 0.015);

    const nowMs = millis();
    // visual-based spotlight pulses (like original)
    if (strong && (nowMs - lastSpotlightMs) > spotlightCooldownMs) {
      addSpotlight(random(60, width - 60));
      if (bassSmooth > 0.90 && random() < 0.4) addSpotlight(random(60, width - 60));
      lastSpotlightMs = nowMs;
    }
    lastBass = bassSmooth;

    // ---- Minim-like BeatDetect: isKick / isSnare ----
    const onsetKick  = isKick();
    const onsetSnare = isSnare();

    // Use kick for your spawn pipeline (same as beat.isKick())
    if (onsetKick && !prevOnset) {
      pendingSpawns++;
      if (firstPendingAtMs === -1) firstPendingAtMs = nowMs;
    }
    prevOnset = onsetKick;

    // IMPORTANT: To guarantee simultaneity, also allow kick to trigger spotlights immediately
    if (onsetKick && (nowMs - lastSpotlightMs) > spotlightCooldownMs) {
      addSpotlight(random(60, width - 60));
      lastSpotlightMs = nowMs;
    }

    // (Optional) You can do something distinct on snare:
    // e.g., thinner spotlight or color shift, left as-is for minimalism.

    // Delayed spawn to align visuals, with cooldown & cap (unchanged)
    if (pendingSpawns > 0 && firstPendingAtMs !== -1 && (nowMs - firstPendingAtMs) >= SPAWN_DELAY_MS) {
      if (countActiveNotes() < 22 && (nowMs - lastSpawnMs) > spawnCooldownMs) {
        spawn();
        lastSpawnMs = nowMs;
        pendingSpawns--;
      }
      firstPendingAtMs = (pendingSpawns > 0) ? nowMs : -1;
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

  // HUD
  textAlign(LEFT, TOP);
  fill(255);
  textSize(16);
  text("Score: " + score, 18, 16);

  let hearts = "";
  for (let i = 0; i < lives; i++) hearts += "<3 ";
  fill(255, 120, 120);
  text("Lives: " + hearts, 18, 40);
}

// =======================================================
// GAME OVER
// =======================================================
function drawGameOver() {
  rectMode(CORNER);
  if (gameOverImg) image(gameOverImg, 0, 0, width, height);
  else {
    background(10);
    textAlign(CENTER, CENTER);
    fill(255);
    textSize(32);
    text("GAME OVER", width/2, height/2 - 40);
  }
  textAlign(CENTER, CENTER);
  fill(255);
  textSize(18);
  text("Score: " + score, width/2, height/2 + 10);
  fill(220);
  textSize(14);
  text("Press R to restart • ENTER for Menu", width/2, height/2 + 40);
}

// =======================================================
// DETECTION: isKick / isSnare (Minim-like recreation)
// =======================================================
function isKick() {
  // kick ≈ strong low vs mid (ratio) + cooldown
  const now = millis();
  const low = fft.getEnergy(KICK_LOW[0], KICK_LOW[1]);
  const mid = fft.getEnergy(MID_BAND[0], MID_BAND[1]);
  const ratio = low / (mid + 1);

  const kick = (low > kickEnergyFloor && ratio > kickRatioThreshold && (now - lastKickMs) > KICK_COOLDOWN_MS);
  if (kick) lastKickMs = now;
  return kick;
}

function isSnare() {
  // snare ≈ mid-high burst + cooldown
  const now = millis();
  const sn = fft.getEnergy(SNARE_BAND[0], SNARE_BAND[1]);
  const trig = (sn > snareEnergyThreshold && (now - lastSnareMs) > SNARE_COOLDOWN_MS);
  if (trig) lastSnareMs = now;
  return trig;
}

// =======================================================
// SPOTLIGHTS
// =======================================================
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

function clearSpotlights() {
  for (let i = 0; i < MAX_SPOTS; i++) spots[i] = null;
  lastSpotlightMs = 0;
  bassPeak = 1;
  bassSmooth = 0;
  lastBass = 0;
}

// =======================================================
// STATE CONTROL
// =======================================================
function startGame() {
  stopAllMusic();
  pendingSpawns = 0;
  firstPendingAtMs = -1;
  clearNotes();
  clearSpotlights();
  score = 0;
  lives = maxLives;
  lastSpawnMs = 0;
  prevOnset = false;
  lastBass = 0;
  bassPeak = 1;
  bassSmooth = 0;

  // pick preloaded song
  song = gameSongs[selected] || null;
  if (song) {
    song.stop();
    song.play();
    fft.setInput(song);
  } else {
    fft.setInput(null);
  }
  gameState = PLAY;
}

function restartGame() {
  stopSong();
  startGame();
}

function backToMenu() {
  stopAllMusic();
  clearNotes();
  clearSpotlights();
  fft.setInput(null);
  gameState = MENU;
  if (haveInteracted && menuMusic) menuMusic.loop();
}

function goGameOver() {
  stopAllMusic();
  gameState = GAMEOVER;
  if (gameOverMusic) gameOverMusic.play();
}

// =======================================================
// MUSIC HELPERS
// =======================================================
function stopSong() {
  if (song) {
    song.stop();
    song.disconnect();
    song = null;
    fft.setInput(null);
  }
}

function stopAllMusic() {
  if (song) { song.stop(); song.disconnect(); song = null; }
  if (menuMusic) menuMusic.stop();
  if (gameOverMusic) gameOverMusic.stop();
}

// =======================================================
// INPUT
// =======================================================
function keyPressed() {
  // first gesture: enable audio + loop menu music if in MENU
  if (!haveInteracted) {
    userStartAudio();
    haveInteracted = true;
    if (gameState === MENU && menuMusic && !menuMusic.isPlaying()) {
      menuMusic.loop();
    }
  }

  if (gameState === MENU) {
    if (keyCode === LEFT_ARROW) {
      selected = (selected + songFiles.length - 1) % songFiles.length;
    } else if (keyCode === RIGHT_ARROW) {
      selected = (selected + 1) % songFiles.length;
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

function mousePressed() {
  if (!haveInteracted) {
    userStartAudio();
    haveInteracted = true;
    if (gameState === MENU && menuMusic && !menuMusic.isPlaying()) {
      menuMusic.loop();
    }
  }
}

// =======================================================
// SPAWNING
// =======================================================
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

function clearNotes() {
  for (let i = 0; i < MAX_NOTES; i++) notes[i] = null;
}

// =======================================================
// GEOMETRY
// =======================================================
function circleRectOverlap(cx, cy, cr, rx, ry, rw, rh) {
  const nearestX = constrain(cx, rx, rx + rw);
  const nearestY = constrain(cy, ry, ry + rh);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return (dx * dx + dy * dy) <= cr * cr;
}

// =======================================================
// CLASSES
// =======================================================
class Note {
  constructor(startX, startY, speed, radius) {
    this.x = startX;
    this.y = startY;
    this.vy = speed;
    this.r = radius;
  }
  update(dt) { this.y += this.vy * dt; }
  drawNote() { ellipse(this.x, this.y, this.r * 2, this.r * 2); }
  offScreen() { return this.y - this.r > height; }
}

class Spotlight {
  constructor(x) {
    this.x = x;
    this.angle = random(-0.15, 0.15);
    this.w = random(60, 120);
    this.h = random(260, 420);
    this.a = 180;
    this.decay = random(4, 7);

    // color range similar to your neon
    this.r = random(100, 255);
    this.g = random(0, 150);
    this.b = random(150, 255);
  }
  update() { this.a -= this.decay; }
  dead() { return this.a <= 0; }
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









