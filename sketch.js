// BeatCatcher — p5.js (merged game logic + your PDE visuals & music)
// ------------------------------------------------------------------
// Folder structure (next to index.html):
//   ./assets/
//     BG_main.png
//     game_over.png
//     Ariana Grande - no tears left to cry (Official Instrumental)-[AudioTrimmer.com].mp3
//     Hunter x Hunter 2011 OST 3 - 1 - Kingdom of Predators-[AudioTrimmer.com].mp3
//     Majid Jordan with Drake - Stars Align (Official Visualizer).mp3
//     Snoop Dogg - California Roll (Audio) ft. Stevie Wonder.mp3
//     Travis Scott, Sheck Wes, Don Toliver - 2000 EXCURSION (Official Audio).mp3
//
// HTML needs p5 + p5.sound (sound AFTER p5):
// <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/p5.min.js"></script>
// <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/addons/p5.sound.min.js"></script>

/***** Assets *****/
let bgImg, gameOverImg;

// Gameplay songs (lazy-loaded on selection)
let songFiles = [
  "Majid Jordan with Drake - Stars Align (Official Visualizer).mp3",
  "Snoop Dogg - California Roll (Audio) ft. Stevie Wonder.mp3",
  "Travis Scott, Sheck Wes, Don Toliver - 2000 EXCURSION (Official Audio).mp3"
];
let songTitles = ["Stars Align", "California Roll", "2000 Excursion"];
let songs = []; // p5.SoundFile[] (loaded on demand)

// Menu + Game Over music (your exact files)
let menuMusic = null;
let gameOverMusic = null;

/***** Audio Analysis *****/
let fft;                 // p5.FFT
let peak;                // p5.PeakDetect for kick-ish onsets
let currentSong = null;  // active gameplay song

/***** Game State *****/
const MENU = 0, PLAY = 1, GAME_OVER = 2;
let gameState = MENU;
let selected = 0;        // selected song index on menu

/***** Notes & Spotlights *****/
const MAX_NOTES = 64;
let notes = new Array(MAX_NOTES).fill(null);
const MAX_SPOTS = 16;
let spots = new Array(MAX_SPOTS).fill(null);

/***** Rhythm / Spawning *****/
let prevOnset = false;         // rising-edge detection
let lastSpawnMs = 0;           // cooldown for note spawns
let spawnCooldownMs = 350;

let pendingSpawns = 0;         // staggered spawns (cluster smoothing)
let firstPendingAtMs = -1;
const SPAWN_DELAY_MS = 200;

let lastSpotlightMs = 0;       // spotlight throttle
let spotlightCooldownMs = 120;

let bassPeak = 1;              // stage flash normalization
let bassSmooth = 0;
let lastBass = 0;

/***** Player + HUD *****/
let paddleW = 140;
let paddleH = 16;
let score = 0;
let lives = 3;
const maxLives = 3;

/***** Timing *****/
let prevMs = 0;

/******************* Preload *******************/
function preload(){
  soundFormats('mp3','wav','ogg');

  // Backgrounds
  bgImg = loadImage('assets/BG_main.png', null, () => console.warn('Missing assets/BG_main.png'));
  gameOverImg = loadImage('assets/game_over.png', null, () => console.warn('Missing assets/game_over.png'));

  // Menu & Game Over music (your filenames)
  menuMusic = loadSound('assets/Ariana Grande - no tears left to cry (Official Instrumental)-[AudioTrimmer.com].mp3',
    () => console.log('Menu music loaded'),
    (e) => console.warn('Menu music failed to load', e)
  );
  gameOverMusic = loadSound('assets/Hunter x Hunter 2011 OST 3 - 1 - Kingdom of Predators-[AudioTrimmer.com].mp3',
    () => console.log('Game over music loaded'),
    (e) => console.warn('Game over music failed to load', e)
  );
}

function setup(){
  createCanvas(windowWidth, windowHeight);
  textAlign(CENTER, CENTER);
  userStartAudio(); // ensure AudioContext is unlocked

  fft = new p5.FFT(0.85, 1024);
  peak = new p5.PeakDetect(20, 120, 0.9, 20); // low band ~ kick

  // Loop menu music (autoplay may wait for user gesture on some browsers)
  if (menuMusic) {
    menuMusic.setLoop(true);
    try { if (!menuMusic.isPlaying()) menuMusic.play(); } catch (e) {}
  }
}

function windowResized(){ resizeCanvas(windowWidth, windowHeight); }

function draw(){
  const now = millis();
  const dt = (prevMs === 0) ? (1/60) : (now - prevMs) / 1000.0;
  prevMs = now;

  if (gameState === MENU) drawMenu();
  else if (gameState === PLAY) runGame(dt);
  else if (gameState === GAME_OVER) drawGameOver();
}

/******************* MENU *******************/
function drawMenu(){
  rectMode(CORNER);
  if (bgImg) image(bgImg, 0, 0, width, height); else background(18);

  fill(255);
  textSize(28);
  text('BEAT CATCHER', width/2, 90);
  textSize(14); fill(200);
  text('Use ←/→ to select • ENTER/SPACE to start • Click a card to load', width/2, 130);

  const n = max(1, songFiles.length);
  const songCardW = 220;
  const songCardH = 120;
  const spacing = 30;
  const totalW = n * songCardW + (n-1) * spacing;
  const startX = (width - totalW) / 2;
  const y = height/2 - songCardH/2;

  for (let i = 0; i < n; i++){
    const x = startX + i*(songCardW + spacing);
    if (i === selected){ fill(255,230,120); stroke(40); strokeWeight(2);} else { fill(40); noStroke(); }
    rect(x, y, songCardW, songCardH, 14);
    fill(i === selected ? 30 : 220);
    textSize(16);
    text(songTitles[i] || `Track ${i+1}`, x + songCardW/2, y + songCardH/2);
  }
}

function mousePressed(){
  if (gameState === MENU){
    // start/ensure menu music plays after gesture
    if (menuMusic && !menuMusic.isPlaying()) menuMusic.play();

    const n = max(1, songFiles.length);
    const songCardW = 220, songCardH = 120, spacing = 30;
    const totalW = n * songCardW + (n-1) * spacing;
    const startX = (width - totalW) / 2;
    const y = height/2 - songCardH/2;
    for (let i = 0; i < n; i++){
      const x = startX + i*(songCardW + spacing);
      if (mouseX >= x && mouseX <= x+songCardW && mouseY >= y && mouseY <= y+songCardH){
        selectSong(i);
        selected = i;
      }
    }
  }
  if (gameState === PLAY){
    if (currentSong && !currentSong.isPlaying()) currentSong.play();
  }
}

function keyPressed(){
  if (gameState === MENU){
    const n = max(1, songFiles.length);
    if (keyCode === LEFT_ARROW) selected = (selected + n - 1) % n;
    else if (keyCode === RIGHT_ARROW) selected = (selected + 1) % n;
    else if (keyCode === ENTER || keyCode === RETURN || key === ' ') startGame();
  } else if (gameState === PLAY){
    if (key === ' ') togglePause();
  } else if (gameState === GAME_OVER){
    if (key === 'r' || key === 'R') restartGame();
    else if (keyCode === ENTER || keyCode === RETURN || key === ' ') backToMenu();
  }
}

function selectSong(i){
  selected = i;
  if (!songs[i]){
    const name = songFiles[i];
    if (!name) return;
    console.log('Loading:', name);
    songs[i] = loadSound(`assets/${name}`,
      () => console.log('Loaded', name),
      (e) => console.error('Failed to load', name, e)
    );
  }
}

function startGame(){
  // Stop menu/game-over tracks
  if (menuMusic && menuMusic.isPlaying()) menuMusic.pause();
  if (gameOverMusic && gameOverMusic.isPlaying()) gameOverMusic.stop();

  // Ensure selection is loaded
  if (!songs[selected]) selectSong(selected);
  const s = songs[selected];
  if (!s){ console.warn('Selected song not loaded yet'); return; }

  // Start gameplay track
  currentSong = s;
  currentSong.setLoop(false);
  currentSong.play();

  resetGame();
  gameState = PLAY;
}

function togglePause(){ if (!currentSong) return; currentSong.isPlaying() ? currentSong.pause() : currentSong.play(); }
function restartGame(){ if (gameOverMusic && gameOverMusic.isPlaying()) gameOverMusic.stop(); startGame(); }
function backToMenu(){ if (gameOverMusic && gameOverMusic.isPlaying()) gameOverMusic.stop(); if (menuMusic){ try{ menuMusic.stop(); menuMusic.loop(); }catch(e){} } stopAllSongs(); clearNotes(); gameState = MENU; }
function goGameOver(){ if (currentSong) currentSong.pause(); if (gameOverMusic){ try{ gameOverMusic.stop(); gameOverMusic.play(); }catch(e){} } stopAllSongs(); gameState = GAME_OVER; }

function stopAllSongs(){ for (const s of songs) if (s && s.isPlaying()) s.stop(); currentSong = null; }
function resetGame(){ score = 0; lives = maxLives; clearNotes(); spots = new Array(MAX_SPOTS).fill(null); lastSpawnMs = 0; pendingSpawns = 0; firstPendingAtMs = -1; bassPeak = 1; bassSmooth = 0; lastBass = 0; prevOnset = false; }
function clearNotes(){ for (let i = 0; i < MAX_NOTES; i++) notes[i] = null; }

/******************* PLAY LOOP *******************/
function runGame(dt){
  rectMode(CORNER);
  if (bgImg) image(bgImg, 0, 0, width, height); else background(24);

  // FFT/Peak analysis attached to current song
  if (currentSong) fft.setInput(currentSong);
  const spec = fft.analyze();
  peak.update(fft);

  // Bass envelope
  const bass = fft.getEnergy('bass') / 255.0; // 0..1
  bassSmooth = lerp(bassSmooth, bass, 0.25);
  bassPeak = max(bassPeak * 0.995, bassSmooth + 1e-4);

  // Spotlight trigger
  const norm = (bassPeak <= 0) ? 0 : (bassSmooth / bassPeak);
  const rise = bassSmooth - lastBass;
  const strong = (bassSmooth > 0.45 && rise > 0.025) || (bassSmooth > 0.75 && rise > 0.015);
  const nowMs = millis();
  if (strong && (nowMs - lastSpotlightMs) > spotlightCooldownMs){
    addSpotlight(random(40, width-40));
    lastSpotlightMs = nowMs;
  }
  lastBass = bassSmooth;

  // Onset-based spawning (rising edge)
  const onset = peak.isDetected;
  if (onset && !prevOnset){
    pendingSpawns++;
    if (firstPendingAtMs < 0) firstPendingAtMs = nowMs;
  }
  prevOnset = onset;

  // Release pending spawns with slight delay
  if (pendingSpawns > 0 && nowMs - firstPendingAtMs >= SPAWN_DELAY_MS){
    trySpawnNote();
    pendingSpawns--;
    firstPendingAtMs = (pendingSpawns > 0) ? nowMs : -1;
  }

  // Safety cooldown (optional immediate spawn disabled)
  if (onset && (nowMs - lastSpawnMs) > spawnCooldownMs){
    lastSpawnMs = nowMs;
  }

  // Stage effects
  drawStageBackdrop(norm);

  // Notes update/draw
  for (let i = 0; i < MAX_NOTES; i++){
    const n = notes[i];
    if (!n) continue;
    n.update(dt);
    n.draw();

    const hit = circleRectCollide(n.x, n.y, n.r, mouseX - paddleW/2, height - 42, paddleW, paddleH);
    if (hit){ score += 10; notes[i] = null; continue; }

    if (n.offScreen()){ notes[i] = null; lives--; if (lives <= 0) goGameOver(); }
  }

  // Spotlights
  for (let i = 0; i < MAX_SPOTS; i++){
    const s = spots[i];
    if (!s) continue;
    s.update();
    s.draw();
    if (s.dead()) spots[i] = null;
  }

  // Paddle + HUD
  drawPaddle();
  drawHUD();
}

function drawStageBackdrop(norm){
  push();
  noStroke();
  // Subtle stage layers
  for (let i = 0; i < 10; i++){
    const t = i / 9;
    fill(10 + 30*t, 10 + 30*t, 16 + 40*t);
    rect(0, height*(0.25 + t*0.075), width, height*0.08);
  }
  // Bass flash overlay
  const a = map(norm, 0, 1, 0, 80);
  fill(20, 250, 200, a);
  rect(0, 0, width, height);
  pop();
}

function drawHUD(){
  push();
  textAlign(LEFT, TOP);
  fill(255);
  textSize(16);
  text(`Score: ${score}`, 18, 16);
  let hearts = '';
  for (let i = 0; i < lives; i++) hearts += '<3 ';
  fill(255,120,120);
  text(`Lives: ${hearts}`, 18, 40);
  pop();
}

function drawPaddle(){
  push();
  const x = constrain(mouseX - paddleW/2, 20, width - 20 - paddleW);
  const y = height - 42;
  fill(240);
  rect(x, y, paddleW, paddleH, 8);
  pop();
}

function drawGameOver(){
  rectMode(CORNER);
  if (gameOverImg) image(gameOverImg, 0, 0, width, height); else background(0);
  fill(255);
  textSize(28);
  text('Game Over', width/2, height*0.35);
  textSize(16);
  text(`Final Score: ${score}`, width/2, height*0.35 + 30);
  fill(200);
  textSize(14);
  text('Press R to restart • ENTER for Menu', width/2, height*0.35 + 58);
}

/******************* Spawning & Geometry *******************/
function trySpawnNote(){
  if (countActiveNotes() >= 22) return;
  for (let i = 0; i < MAX_NOTES; i++){
    if (!notes[i]){ notes[i] = new Note(random(30, width-30), -20, 200, random(12, 20)); return; }
  }
}
function countActiveNotes(){ let c = 0; for (const n of notes) if (n) c++; return c; }
function addSpotlight(x){ for (let i = 0; i < MAX_SPOTS; i++){ if (!spots[i]){ spots[i] = new Spotlight(x); return; } } }

function circleRectCollide(cx, cy, r, rx, ry, rw, rh){
  const nearestX = constrain(cx, rx, rx + rw);
  const nearestY = constrain(cy, ry, ry + rh);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return (dx*dx + dy*dy) <= (r*r);
}

/******************* Classes *******************/
class Note{
  constructor(x, y, vy, r){ this.x = x; this.y = y; this.vy = vy; this.r = r; }
  update(dt){ this.y += this.vy * dt; }
  draw(){ push(); noFill(); stroke(255); ellipse(this.x, this.y, this.r*2, this.r*2); pop(); }
  offScreen(){ return this.y - this.r > height; }
}

class Spotlight{
  constructor(x){
    this.x = x;
    this.angle = random(-0.15, 0.15);
    this.w = random(60, 120);
    this.h = random(260, 420);
    this.a = 180;
    this.decay = random(4, 7);
    this.r = random(140, 255);
    this.g = random(140, 255);
    this.b = random(140, 255);
  }
  update(){ this.a -= this.decay; }
  dead(){ return this.a <= 0; }
  draw(){
    push();
    translate(this.x, height);
    rotate(this.angle);
    blendMode(ADD);
    noStroke();
    for (let i = 0; i < 4; i++){
      const t = 1 - i * 0.2;
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













