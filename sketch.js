// BeatCatcher — Processing (Minim) -> p5.js (p5.sound) single‑file port
// ---------------------------------------------------------------
// If you see an endless "Loading…" message, follow this checklist:
// 1) Serve locally (NOT file://). Use VS Code Live Server or: python -m http.server 8000
// 2) Create an ./assets/ folder next to index.html
// 3) Put ONE small test MP3 in ./assets/ named test.mp3 (exactly)
// 4) Keep only that one file in songFiles below while debugging
// 5) Open DevTools (Chrome: Cmd+Opt+I on Mac) and check Console for errors
// 6) Once it works, add your real filenames back one by one
//
// Libraries required in index.html (load p5.sound after p5.js):
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/p5.min.js"></script>
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/addons/p5.sound.min.js"></script>

/***** Assets *****/
// Start with ONE known-good file while debugging
let songFiles = [
  "test.mp3",
  // "Majid Jordan with Drake - Stars Align (Official Visualizer).mp3",
  // "Snoop Dogg - California Roll (Audio) ft. Stevie Wonder.mp3",
  // "Travis Scott, Sheck Wes, Don Toliver - 2000 EXCURSION (Official Audio).mp3"
];
let songTitles = ["Test Track"]; // keep in sync with songFiles while debugging

/***** Audio + Analysis *****/
let songs = [];            // p5.SoundFile[]
let fft;                   // p5.FFT
let peak;                  // p5.PeakDetect (low band kick-ish)
let currentSong = null;

/***** Game State *****/
const MENU = 0, PLAY = 1, GAME_OVER = 2;
let gameState = MENU;
let selected = 0;          // selected song index on menu

/***** Notes *****/
const MAX_NOTES = 64;
let notes = [];            // array of Note instances or null

/***** Spotlights *****/
const MAX_SPOTS = 16;
let spots = [];            // array of Spotlight instances or null

/***** Rhythm / spawning *****/
let prevOnset = false;     // rising-edge detection of kick
let lastSpawnMs = 0;       // cooldown for note spawns
let spawnCooldownMs = 350;

// Stagger spawns slightly so clusters don’t drop same frame
let pendingSpawns = 0;     
let firstPendingAtMs = -1; 
const SPAWN_DELAY_MS = 200;

// Spotlight throttling
let lastSpotlightMs = 0;
let spotlightCooldownMs = 120;

// Bass envelope
let bassPeak = 1;
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

/***** Visuals *****/
let useHalftone = false;   // kept simple; toggle if you want

function preload(){
  // Help the loader pick a codec
  soundFormats('mp3','wav','ogg');
  // Do NOT bulk-load many big files while debugging. Start with the first only.
  if (songFiles.length > 0){
    songs[0] = loadSound(`assets/${songFiles[0]}`,
      () => { console.log('Loaded:', songFiles[0]); },
      (e) => { console.error('Failed to load', songFiles[0], e); }
    );
  }
}

function setup(){
  createCanvas(windowWidth, windowHeight);
  textFont('monospace');
  textAlign(CENTER, CENTER);

  // Ensure AudioContext is running (prevents some browsers from stalling)
  userStartAudio();

  fft = new p5.FFT(0.85, 1024);
  peak = new p5.PeakDetect(20, 120, 0.9, 20); // low band ~kick, tuned later

  // Prepare containers
  for (let i = 0; i < MAX_NOTES; i++) notes[i] = null;
  for (let i = 0; i < MAX_SPOTS; i++) spots[i] = null;
}

function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
}

function draw(){
  background(12);

  // Delta time in seconds
  const now = millis();
  const dt = (prevMs === 0) ? (1/60) : (now - prevMs) / 1000.0;
  prevMs = now;

  // Simple loading status if nothing is ready yet
  const anyLoaded = songs.some(s => s && s.buffer && s.buffer.duration > 0);

  switch (gameState){
    case MENU:
      if (!anyLoaded){
        fill(220);
        textSize(16);
        text(`Loading… Make sure you are SERVING files (not opening via file://)
• ./assets/test.mp3 must exist
• See Console for errors (Cmd+Opt+I → Console).`, width/2, height/2);
      }
      drawMenu();
      break;
    case PLAY: runGame(dt); break;
    case GAME_OVER: drawGameOver(); break;
  }
}

/******************* MENU *******************/
function drawMenu(){
  push();
  fill(240);
  textSize(28);
  text('BeatCatcher', width/2, height*0.18);
  textSize(14);
  text('Click a card to pick a track. Press SPACE to start / pause.', width/2, height*0.18 + 28);
  pop();

  // Layout song cards (number = songFiles.length)
  const n = max(1, songFiles.length);
  const songCardW = 220;
  const songCardH = 120;
  const spacing = 30;
  const totalW = n * songCardW + (n-1) * spacing;
  const startX = (width - totalW) / 2;
  const y = height/2 - songCardH/2;

  for (let i = 0; i < n; i++){
    const x = startX + i * (songCardW + spacing);
    drawSongCard(i, x, y, songCardW, songCardH, i === selected);
  }

  // Instructions footer
  fill(180);
  textSize(12);
  text('Arrow keys to change selection • Click to choose • SPACE to play/pause', width/2, height - 28);
}

function drawSongCard(i, x, y, w, h, active){
  push();
  stroke(active ? color(0,255,180) : 90);
  strokeWeight(active ? 3 : 1);
  fill(active ? 24 : 16);
  rect(x, y, w, h, 16);

  fill(230);
  textSize(16);
  const title = songTitles[i] || `Track ${i+1}`;
  text(title , x + w/2, y + h/2 - 8);
  fill(160);
  textSize(12);
  const label = (songFiles[i]||'').slice(0, 30) + ((songFiles[i]||'').length>30?'…':'');
  text(label, x + w/2, y + h/2 + 14);
  pop();
}

function mousePressed(){
  if (gameState === MENU){
    // Hit test cards
    const n = max(1, songFiles.length);
    const songCardW = 220, songCardH = 120, spacing = 30;
    const totalW = n * songCardW + (n-1) * spacing;
    const startX = (width - totalW) / 2;
    const y = height/2 - songCardH/2;
    for (let i = 0; i < n; i++){
      const x = startX + i*(songCardW + spacing);
      if (mouseX >= x && mouseX <= x+songCardW && mouseY >= y && mouseY <= y+songCardH){
        selectSong(i);
        return;
      }
    }
  } else if (gameState === PLAY){
    // User gesture helps ensure audio resumes if paused by browser
    if (currentSong && !currentSong.isPlaying()) currentSong.play();
  }
}

function keyPressed(){
  if (gameState === MENU){
    const n = max(1, songFiles.length);
    if (keyCode === LEFT_ARROW){ selected = (selected + n - 1) % n; }
    else if (keyCode === RIGHT_ARROW){ selected = (selected + 1) % n; }
    else if (key === ' '){ startGame(); }
    else if (keyCode === ENTER){ startGame(); }
  } else if (gameState === PLAY){
    if (key === ' '){ togglePause(); }
  } else if (gameState === GAME_OVER){
    if (key === ' ' || keyCode === ENTER){ goMenu(); }
  }
}

function selectSong(i){
  selected = i;
  // Lazy-load on selection if not already loaded
  if (!songs[i]){
    const name = songFiles[i];
    if (!name){ console.warn('No filename for index', i); return; }
    console.log('Loading on-demand:', name);
    songs[i] = loadSound(`assets/${name}`,
      () => { console.log('Loaded:', name); },
      (e) => { console.error('Failed to load', name, e); }
    );
  }
}

function startGame(){
  // Stop any current track
  for (let s of songs) if (s && s.isPlaying()) s.stop();
  const s = songs[selected];
  if (!s){
    console.warn('Selected song not loaded yet. Try again after it finishes loading.');
    return;
  }
  currentSong = s;
  currentSong.play();
  currentSong.setLoop(false);
  resetGame();
  gameState = PLAY;
}

function togglePause(){
  if (!currentSong) return;
  if (currentSong.isPlaying()) currentSong.pause(); else currentSong.play();
}

function goMenu(){
  // Stop audio
  for (let s of songs) if (s && s.isPlaying()) s.stop();
  currentSong = null;
  gameState = MENU;
}

function resetGame(){
  score = 0; lives = maxLives;
  for (let i = 0; i < MAX_NOTES; i++) notes[i] = null;
  for (let i = 0; i < MAX_SPOTS; i++) spots[i] = null;
  lastSpawnMs = 0; pendingSpawns = 0; firstPendingAtMs = -1;
  bassPeak = 1; bassSmooth = 0; lastBass = 0; prevOnset = false;
}

/******************* PLAY LOOP *******************/
function runGame(dt){
  // Attach analysis to current audio
  if (currentSong){
    fft.setInput(currentSong);
  }
  const spec = fft.analyze();
  peak.update(fft); // for kick-like onset

  // Bass envelope + normalization
  const bass = fft.getEnergy('bass') / 255.0; // 0..1
  // Smooth with exponential moving average
  bassSmooth = lerp(bassSmooth, bass, 0.25);
  bassPeak = max(bassPeak * 0.995, bassSmooth + 1e-4);

  // Spotlight trigger: strong rising bass OR very high bass
  const norm = (bassPeak <= 0) ? 0 : (bassSmooth / bassPeak);
  const rise = bassSmooth - lastBass;
  const strong = (bassSmooth > 0.45 && rise > 0.025) || (bassSmooth > 0.75 && rise > 0.015);
  const nowMs = millis();
  if (strong && (nowMs - lastSpotlightMs) > spotlightCooldownMs){
    addSpotlight(random(40, width-40));
    lastSpotlightMs = nowMs;
  }
  lastBass = bassSmooth;

  // Onset (kick-ish)
  const onset = peak.isDetected;
  if (onset && !prevOnset){
    // Queue a few staggered spawns (imitates your pending system)
    pendingSpawns++;
    if (firstPendingAtMs < 0) firstPendingAtMs = nowMs;
  }
  prevOnset = onset;

  // Release pending spawns over time
  if (pendingSpawns > 0 && nowMs - firstPendingAtMs >= SPAWN_DELAY_MS){
    trySpawnNote();
    pendingSpawns--;
    firstPendingAtMs = (pendingSpawns > 0) ? nowMs : -1;
  }

  // Spawn cooldown safety
  if (onset && (nowMs - lastSpawnMs) > spawnCooldownMs){
    // optional immediate spawn in addition to the pending queue
    // trySpawnNote();
    lastSpawnMs = nowMs;
  }

  // Update + draw
  drawStageBackdrop(norm);

  // Notes
  stroke(255);
  noFill();
  for (let i = 0; i < MAX_NOTES; i++){
    const n = notes[i];
    if (!n) continue;
    n.update(dt);
    n.draw();
    // Collision with paddle
    const hit = circleRectCollide(n.x, n.y, n.r, mouseX - paddleW/2, height - 42, paddleW, paddleH);
    if (hit){
      score += 10;
      notes[i] = null; // collect
      continue;
    }
    // Missed
    if (n.offScreen()){
      notes[i] = null;
      lives--;
      if (lives <= 0){ gameState = GAME_OVER; }
    }
  }

  // Spotlights
  for (let i = 0; i < MAX_SPOTS; i++){
    const s = spots[i];
    if (!s) continue;
    s.update();
    s.draw();
    if (s.dead()) spots[i] = null;
  }

  // Paddle
  drawPaddle();

  // HUD
  drawHUD();
}

function drawStageBackdrop(norm){
  push();
  noStroke();
  // Dark stage gradient
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
  fill(255);
  textSize(14);
  textAlign(LEFT, TOP);
  text(`Score: ${score}`, 16, 14);
  text(`Lives: ${lives}/${maxLives}`, 16, 34);
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
  push();
  fill(255);
  textSize(28);
  text('Game Over', width/2, height*0.35);
  textSize(16);
  text(`Final Score: ${score}`, width/2, height*0.35 + 30);

  fill(180);
  textSize(14);
  text('Press SPACE or ENTER to return to menu', width/2, height*0.35 + 58);
  pop();
}

/******************* Spawning *******************/
function trySpawnNote(){
  // Limit simultaneous notes
  if (countActiveNotes() >= 22) return;
  // Find open slot
  for (let i = 0; i < MAX_NOTES; i++){
    if (!notes[i]){
      notes[i] = new Note(random(30, width-30), -20, 200, random(12, 20));
      return;
    }
  }
}

function countActiveNotes(){
  let c = 0; for (let n of notes) if (n) c++; return c;
}

function addSpotlight(x){
  for (let i = 0; i < MAX_SPOTS; i++){
    if (!spots[i]){ spots[i] = new Spotlight(x); return; }
  }
}

/******************* Geometry *******************/
function circleRectCollide(cx, cy, r, rx, ry, rw, rh){
  // Clamp circle center to rect bounds
  const nearestX = constrain(cx, rx, rx + rw);
  const nearestY = constrain(cy, ry, ry + rh);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return (dx*dx + dy*dy) <= (r*r);
}

/******************* Classes *******************/
class Note{
  constructor(x, y, vy, r){
    this.x = x; this.y = y; this.vy = vy; this.r = r;
  }
  update(dt){ this.y += this.vy * dt; }
  draw(){
    push();
    noFill();
    stroke(255);
    ellipse(this.x, this.y, this.r*2, this.r*2);
    pop();
  }
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
    // Color (random but controlled)
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
    // Multi‑slice triangle beam, fading per slice
    for (let i = 0; i < 4; i++){
      const t = 1 - i * 0.2;
      const al = this.a * (0.55 - i*0.12);
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












