// ============================================
// Minimal p5.js port that preserves your code
// - Uses p5.sound under small "shim" classes
// - Your logic (spawn/spotlights/BeatDetect flow) is unchanged
// ============================================

// ----------------- SHIMS (NEW) -----------------
let __fftCore;        // p5.FFT instance
let __peak;           // p5.PeakDetect for kick-ish onsets
let __sounds = {};    // preloaded sounds by filename
let __audioUnlocked = false;

function userGestureAudio() {
  if (getAudioContext().state !== 'running') userStartAudio();
  __audioUnlocked = true;
}

// Emulate "Minim" API surface we actually use
class Minim {
  loadFile(name /*, bufferSize*/) {
    // return AudioPlayer wrapping a preloaded p5.SoundFile
    const s = __sounds[name];
    if (!s) {
      console.warn('Sound not preloaded:', name);
      return null;
    }
    return new AudioPlayer(name, s);
  }
}

// Emulate "AudioPlayer" used in your code
class AudioPlayer {
  constructor(name, soundFile) {
    this.name = name;
    this.sf = soundFile; // p5.SoundFile
    this._looping = false;
  }
  play()    { if (__audioUnlocked) this.sf.play(); }
  pause()   { this.sf.pause(); }
  loop()    { if (__audioUnlocked) { this._looping = true; this.sf.loop(); } }
  rewind()  { this.sf.stop(); if (this._looping) this.sf.loop(); }
  close()   { try { this.sf.stop(); } catch(e){} }
  isPlaying(){ return this.sf.isPlaying(); }
  bufferSize(){ return 2048; } // not used by shim FFT
  sampleRate(){ return this.sf.sampleRate ? this.sf.sampleRate() : 44100; }
  // in your code you pass song.mix to BeatDetect/FFT; we ignore the arg in shims.
  get mix() { return null; }
}

// Emulate "BeatDetect" you call with detect()/isKick()
class BeatDetect {
  constructor(/*bufferSize, sampleRate*/) {
    // use PeakDetect in the bass band for kick-like peaks
    // You set sensitivity(200) later; we keep that behavior via framesPerPeak
    this.low = 20; this.high = 140;
    this.threshold = 0.18;
    this.framesPerPeak = 20; // about your 200ms sensitivity at 60fps
  }
  detectMode(/*FREQ_ENERGY*/) { /* no-op: we always use freq energy */ }
  setSensitivity(ms) {
    // rough mapping: ~ms/10 frames at 60fps (tune if needed)
    this.framesPerPeak = Math.round(constrain(ms / 10, 5, 60));
  }
  detect(/*buffer*/) {
    if (!__fftCore) return;
    __fftCore.analyze();
    if (!__peak) __peak = new p5.PeakDetect(this.low, this.high, this.threshold, this.framesPerPeak);
    __peak.update(__fftCore);
  }
  isKick() { return __peak ? __peak.isDetected : false; }
}

// Emulate "FFT" you use with forward()/specSize()/indexToFreq()/getBand()
class FFT {
  constructor(/*bufferSize, sampleRate*/) {
    if (!__fftCore) __fftCore = new p5.FFT(0.8, 1024);
  }
  forward(/*mix*/) { __fftCore.analyze(); }
  specSize() { return __fftCore.bins; }
  indexToFreq(i) {
    // approximate bin-to-freq mapping (Nyquist = sr/2)
    const sr = 44100;
    return (i / __fftCore.bins) * (sr / 2);
  }
  getBand(i) {
    // __fftCore.spectrum is 0..255
    return __fftCore.spectrum[i] || 0;
  }
}

// p5-friendly replacements for Processing helpers
function max(a,b){ return Math.max(a,b); }
function lerp(a,b,t){ return a + (b - a) * t; }

// ----------------- YOUR ORIGINAL CODE -----------------
let minim;
let song;
let beat;
let fft;
let menuMusic;
let gameOverMusic;

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

let menu = 0;
let play = 1;
let gameOver = 2;
let gameState = menu;

const MAX_SPOTS = 16;
let spots = new Array(MAX_SPOTS).fill(null);

const songFiles = [
  "Majid Jordan with Drake - Stars Align (Official Visualizer).mp3", 
  "Snoop Dogg - California Roll (Audio) ft. Stevie Wonder.mp3", 
  "Travis Scott, Sheck Wes, Don Toliver - 2000 EXCURSION (Official Audio).mp3"
];
let selected = 0;
const songTitles = [
  "Stars Align",
  "California Roll",
  "2000 Excurcsion"
];

let bgImg;
let gameOverImg;

let paddleX;
let paddleY;
let paddleW = 140;
let paddleH = 16;

let score = 0;
let lives = 3;
let maxLives = 3;
// PFont f;  // Not needed in p5; we’ll use a system font.

let prevMs = 0;

// -------- p5 lifecycle (only necessary deltas from Processing) --------
function preload(){
  // Images (prof: load in preload)
  bgImg = loadImage("assets/BG_main.png");
  gameOverImg = loadImage("assets/game_over.png");

  // Sounds — preload ALL files so our Minim shim can find them by name
  __sounds["Ariana Grande - no tears left to cry (Official Instrumental)-[AudioTrimmer.com].mp3"]
    = loadSound("assets/Ariana Grande - no tears left to cry (Official Instrumental)-[AudioTrimmer.com].mp3");
  __sounds["Hunter x Hunter 2011 OST 3 - 1 - Kingdom of Predators-[AudioTrimmer.com].mp3"]
    = loadSound("assets/Hunter x Hunter 2011 OST 3 - 1 - Kingdom of Predators-[AudioTrimmer.com].mp3");

  for (let name of songFiles){
    __sounds[name] = loadSound("assets/" + name);
  }
}

function setup(){
  createCanvas(800, 600);             // Processing size() → p5 createCanvas()
  frameRate(60);
  textFont('Helvetica');              // simple system font
  paddleY = height - 80;

  if (bgImg) bgImg.resize(width, height);
  if (gameOverImg) gameOverImg.resize(width, height);

  minim = new Minim();                // shim
  menuMusic = minim.loadFile("Ariana Grande - no tears left to cry (Official Instrumental)-[AudioTrimmer.com].mp3");
  gameOverMusic = minim.loadFile("Hunter x Hunter 2011 OST 3 - 1 - Kingdom of Predators-[AudioTrimmer.com].mp3");

  // Don’t autoplay (browser blocks). Start it after first key/mouse gesture.
  // menuMusic.loop();  // moved to first user gesture
}

function draw(){
  const now = millis();
  const dt = (prevMs === 0) ? (1/60) : (now - prevMs) / 1000.0;
  prevMs = now;

  if (gameState === menu) drawMenu();
  else if (gameState === play) updateAndDrawGame(dt);
  else if (gameState === gameOver) drawGameOver();
}

function drawMenu(){
  rectMode(CORNER);
  if (bgImg) image(bgImg, 0, 0);
  else background(18);

  textAlign(CENTER, CENTER);
  fill(255);
  textSize(28);
  text("BEAT CATCHER", width/2, 90);
  textSize(14);
  fill(200);
  text("Use arrow keys to select song!    ENTER to start", width/2, 130);

  const songCardW = 220;
  const songCardH = 120;
  const spacing = 30;
  const totalW = 3 * songCardW + 2 * spacing;
  const startX = (width - totalW) / 2;
  const y = height/2 - songCardH/2;

  for (let i = 0; i < 3; i++) {
    const x = startX + i*(songCardW + spacing);
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
    text(songTitles[i], x + songCardW/2, y + songCardH/2);
  }
}

function addSpotlight(x){
  for (let i = 0; i < MAX_SPOTS; i++) {
    if (!spots[i]) { spots[i] = new Spotlight(x); return; }
  }
}

function updateAndDrawSpotlights(){
  for (let i = 0; i < MAX_SPOTS; i++) {
    if (spots[i]) {
      spots[i].update();
      spots[i].draw();
      if (spots[i].dead()) spots[i] = null;
    }
  }
}

function updateAndDrawGame(dt){
  rectMode(CORNER);
  if (bgImg) image(bgImg, 0, 0);
  else background(24);

  paddleX = constrain(mouseX, paddleW/2, width - paddleW/2);

  if (song && song.isPlaying()) {
    if (fft) {
      fft.forward(song.mix);
      let sum = 0;
      for (let i = 0; i < fft.specSize(); i++) {
        if (fft.indexToFreq(i) < 150) sum += fft.getBand(i);
        else break;
      }
      bassPeak = max(1, max(bassPeak * 0.96, sum));
      const norm = sum / bassPeak;
      bassSmooth = lerp(bassSmooth, norm, 0.2);

      const rise = bassSmooth - lastBass;
      const strong = (bassSmooth > 0.45 && rise > 0.025) || (bassSmooth > 0.75 && rise > 0.015);

      const nowMs = millis();
      if (strong && (nowMs - lastSpotlightMs) > spotlightCooldownMs) {
        addSpotlight(random(60, width - 60));
        if (bassSmooth > 0.90 && random() < 0.4) addSpotlight(random(60, width - 60));
        lastSpotlightMs = nowMs;
      }

      lastBass = bassSmooth;
    }

    if (beat) {
      beat.detect(song.mix);
      const onset = beat.isKick();
      const now = millis();

      if (onset && !prevOnset) {
        pendingSpawns++;
        if (firstPendingAtMs === -1) firstPendingAtMs = now;
      }
      prevOnset = onset;

      if (pendingSpawns > 0 && firstPendingAtMs !== -1 && now - firstPendingAtMs >= SPAWN_DELAY_MS) {
        if (countActiveNotes() < 22 && now - lastSpawnMs > spawnCooldownMs) {
          spawn();
          lastSpawnMs = now;
          pendingSpawns--;
        }
        firstPendingAtMs = (pendingSpawns > 0) ? now : -1;
      }
    }
  }

  updateAndDrawSpotlights();

  rectMode(CENTER);
  noStroke();
  fill(255, 230, 120);
  rect(paddleX, paddleY, paddleW, paddleH, 6);

  fill(255);
  noStroke();
  for (let i = 0; i < MAX_NOTES; i++) {
    if (notes[i]) {
      notes[i].update(dt);
      notes[i].drawNote();
      if (circleRectOverlap(notes[i].x, notes[i].y, notes[i].r, paddleX - paddleW/2, paddleY - paddleH/2, paddleW, paddleH)) {
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

  drawdesign();
}

function drawdesign(){
  textAlign(LEFT, TOP);
  fill(255);
  textSize(16);
  text("Score: " + score, 18, 16);

  let hearts = "";
  for (let i = 0; i < lives; i++) hearts += "<3 ";
  fill(255, 120, 120);
  text("Lives: " + hearts, 18, 40);
}

function circleRectOverlap(cx, cy, cr, rx, ry, rw, rh){
  const nearestX = constrain(cx, rx, rx + rw);
  const nearestY = constrain(cy, ry, ry + rh);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return (dx*dx + dy*dy) <= cr*cr;
}

function drawGameOver(){
  if (gameOverImg) image(gameOverImg, 0, 0);
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

function startGame(){
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

function restartGame(){
  stopSong();
  startGame();
}

function backToMenu(){
  if (gameOverMusic && gameOverMusic.isPlaying()) gameOverMusic.pause();
  if (menuMusic) { menuMusic.rewind(); menuMusic.loop(); }
  stopSong();
  clearNotes();
  gameState = menu;
}

function goGameOver(){
  if (song) song.pause();
  if (gameOverMusic) { gameOverMusic.rewind(); gameOverMusic.play(); }
  stopSong();
  gameState = gameOver;
}

function clearNotes(){ for (let i = 0; i < MAX_NOTES; i++) notes[i] = null; }

function loadSelectedSong(){
  stopSong();
  song = minim.loadFile(songFiles[selected], 2048);
  if (song) {
    song.play();
    fft = new FFT(song.bufferSize(), song.sampleRate());
    beat = new BeatDetect(song.bufferSize(), song.sampleRate());
    beat.detectMode(BeatDetect.FREQ_ENERGY);
    beat.setSensitivity(200);

    // connect FFT input to this song
    if (__fftCore) __fftCore.setInput(__sounds[songFiles[selected]]);
  }
}

function stopSong(){
  if (song) { song.close(); song = null; }
}

function keyPressed(){
  userGestureAudio(); // unlock audio on first gesture

  if (gameState === menu) {
    if (keyCode === LEFT_ARROW) selected = (selected + 2) % 3;
    else if (keyCode === RIGHT_ARROW) selected = (selected + 1) % 3;
    else if (keyCode === ENTER || keyCode === RETURN) {
      if (menuMusic && !menuMusic.isPlaying()) menuMusic.loop();
      startGame();
    }
  } else if (gameState === gameOver) {
    if (key === 'r' || key === 'R') restartGame();
    else if (keyCode === ENTER || keyCode === RETURN) backToMenu();
  }
}

function mousePressed(){
  userGestureAudio();
  if (gameState === menu && menuMusic && !menuMusic.isPlaying()) menuMusic.loop();
}

function spawn(){
  if (countActiveNotes() >= 22) return;
  for (let i = 0; i < MAX_NOTES; i++) {
    if (!notes[i]) {
      notes[i] = new Note(random(30, width - 30), -20, 200, random(12, 20));
      return;
    }
  }
}

function countActiveNotes(){
  let c = 0;
  for (let i = 0; i < MAX_NOTES; i++) if (notes[i]) c++;
  return c;
}

// --------- your classes (unchanged, just JS syntax) ----------
class Note {
  constructor(startX, startY, speed, radius){
    this.x = startX;
    this.y = startY;
    this.vy = speed;
    this.r = radius;
  }
  update(dt){ this.y += this.vy * dt; }
  drawNote(){ ellipse(this.x, this.y, this.r*2, this.r*2); }
  offScreen(){ return this.y - this.r > height; }
}

class Spotlight {
  constructor(_x){
    this.x = _x;
    this.angle = random(-0.15, 0.15);
    this.w = random(60, 120);
    this.h = random(260, 420);
    this.a = 180;
    this.decay = random(4, 7);
    this.r = random(100, 255);
    this.g = random(0, 150);
    this.b = random(150, 255);
  }
  update(){ this.a -= this.decay; }
  dead(){ return this.a <= 0; }
  draw(){
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



