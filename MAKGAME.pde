import ddf.minim.*;
import ddf.minim.analysis.*;
import ddf.minim.effects.*;
import ddf.minim.signals.*;
import ddf.minim.spi.*;
import ddf.minim.ugens.*;
import ddf.minim.*;
import ddf.minim.analysis.*;
import ddf.minim.effects.*;
import ddf.minim.signals.*;
import ddf.minim.spi.*;
import ddf.minim.ugens.*;

Minim minim;
AudioPlayer song;
BeatDetect beat;
FFT fft;
AudioPlayer menuMusic;
AudioPlayer gameOverMusic;

final int MAX_NOTES = 64;
Note[] notes = new Note[MAX_NOTES];

static boolean prevOnset = false;

float bassPeak = 1;
float bassSmooth = 0;
float lastBass = 0;

int pendingSpawns = 0;
int firstPendingAtMs = -1;
final int SPAWN_DELAY_MS = 200;

int lastSpotlightMs = 0;
int spotlightCooldownMs = 120;

int lastSpawnMs = 0;
int spawnCooldownMs = 350;

int menu = 0;
int play = 1;
int gameOver = 2;
int gameState = menu;

final int MAX_SPOTS = 16;
Spotlight[] spots = new Spotlight[MAX_SPOTS];

String[] songFiles = {
  "Majid Jordan with Drake - Stars Align (Official Visualizer).mp3", 
  "Snoop Dogg - California Roll (Audio) ft. Stevie Wonder.mp3", 
  "Travis Scott, Sheck Wes, Don Toliver - 2000 EXCURSION (Official Audio).mp3"
};
int selected = 0;
String[] songTitles = {
  "Stars Align",
  "California Roll",
  "2000 Excurcsion"
};

PImage bgImg;
PImage gameOverImg;

float paddleX;
float paddleY;
float paddleW = 140;
float paddleH = 16;

int score = 0;
int lives = 3;
int maxLives = 3;
PFont f;

int prevMs = 0;

void setup() {
  size(800, 600);
  frameRate(60);
  minim = new Minim(this);
  menuMusic = minim.loadFile("Ariana Grande - no tears left to cry (Official Instrumental)-[AudioTrimmer.com].mp3");
  gameOverMusic = minim.loadFile("Hunter x Hunter 2011 OST 3 - 1 - Kingdom of Predators-[AudioTrimmer.com].mp3");
  menuMusic.loop();
  
  f = createFont("Helvetica", 16, true);
  bgImg = loadImage("BG_main.png");
  if (bgImg != null) bgImg.resize(width, height);
  gameOverImg = loadImage("game_over.png");
  if (gameOverImg != null) gameOverImg.resize(width, height);
  paddleY = height - 80;
}

void draw() {
  int now = millis();
  float dt = (prevMs == 0) ? (1.0/60.0) : (now - prevMs) / 1000.0;
  prevMs = now;
  
  if (gameState == menu) drawMenu();
  else if (gameState == play) updateAndDrawGame(dt);
  else if (gameState == gameOver) drawGameOver();
}

void drawMenu() {
  rectMode(CORNER);
  if (bgImg != null) image(bgImg, 0, 0);
  else background(18);

  textAlign(CENTER, CENTER);
  textFont(f);
  fill(255);
  textSize(28);
  text("BEAT CATCHER", width/2, 90);
  textSize(14);
  fill(200);
  text("Use arrow keys to select song!    ENTER to start", width/2, 130);

  int songCardW = 220;
  int songCardH = 120;
  int spacing = 30;
  int totalW = 3 * songCardW + 2 * spacing;
  int startX = (width - totalW) / 2;
  int y = height/2 - songCardH/2;

  for (int i = 0; i < 3; i++) {
    int x = startX + i*(songCardW + spacing);
    if (i == selected) {
      fill(255, 230, 120);
      stroke(40);
      strokeWeight(2);
    } else {
      fill(40);
      noStroke();
    }
    rect(x, y, songCardW, songCardH, 14);
    fill(i == selected ? 30 : 220);
    textSize(16);
    text(songTitles[i], x + songCardW/2, y + songCardH/2);
  }
}

void addSpotlight(float x) {
  for (int i = 0; i < MAX_SPOTS; i++) {
    if (spots[i] == null) { 
      spots[i] = new Spotlight(x); 
      return; 
    }
  }
}

void updateAndDrawSpotlights() {
  for (int i = 0; i < MAX_SPOTS; i++) {
    if (spots[i] != null) {
      spots[i].update();
      spots[i].draw();
      if (spots[i].dead()) spots[i] = null;
    }
  }
}

void updateAndDrawGame(float dt) {
  rectMode(CORNER);
  if (bgImg != null) image(bgImg, 0, 0);
  else background(24);

  paddleX = constrain(mouseX, paddleW/2, width - paddleW/2);

  if (song != null && song.isPlaying()) {
    if (fft != null) {
      fft.forward(song.mix);
      float sum = 0;
      for (int i = 0; i < fft.specSize(); i++) {
        if (fft.indexToFreq(i) < 150) sum += fft.getBand(i);
        else break;
      }
      bassPeak = max(1, max(bassPeak * 0.96, sum));
      float norm = sum / bassPeak;
      bassSmooth = lerp(bassSmooth, norm, 0.2);

      float rise = bassSmooth - lastBass;
      boolean strong = (bassSmooth > 0.45 && rise > 0.025) || (bassSmooth > 0.75 && rise > 0.015);

      int nowMs = millis();
      if (strong && (nowMs - lastSpotlightMs) > spotlightCooldownMs) {
        addSpotlight(random(60, width - 60));
        if (bassSmooth > 0.90 && random(1) < 0.4) addSpotlight(random(60, width - 60));
        lastSpotlightMs = nowMs;
      }

      lastBass = bassSmooth;
    }

    if (beat != null) {
      beat.detect(song.mix);
      boolean onset = beat.isKick();
      int now = millis();

      if (onset && !prevOnset) {
        pendingSpawns++;
        if (firstPendingAtMs == -1) firstPendingAtMs = now;
      }
      prevOnset = onset;

      if (pendingSpawns > 0 && firstPendingAtMs != -1 && now - firstPendingAtMs >= SPAWN_DELAY_MS) {
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
  for (int i = 0; i < MAX_NOTES; i++) {
    if (notes[i] != null) {
      notes[i].update(dt);
      notes[i].drawNote();
      if (circleRectOverlap(notes[i].x, notes[i].y, notes[i].r, paddleX - paddleW/2, paddleY - paddleH/2, paddleW, paddleH)) {
        score++;
        notes[i] = null;
        continue;
      }
      if (notes[i] != null && notes[i].offScreen()) {
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

void drawdesign() {
  textAlign(LEFT, TOP);
  textFont(f);
  fill(255);
  textSize(16);
  text("Score: " + score, 18, 16);

  String hearts = "";
  for (int i = 0; i < lives; i++) hearts += "<3 ";
  fill(255, 120, 120);
  text("Lives: " + hearts, 18, 40);
}

boolean circleRectOverlap(float cx, float cy, float cr, float rx, float ry, float rw, float rh) {
  float nearestX = constrain(cx, rx, rx + rw);
  float nearestY = constrain(cy, ry, ry + rh);
  float dx = cx - nearestX;
  float dy = cy - nearestY;
  return (dx*dx + dy*dy) <= cr*cr;
}

void drawGameOver() {
  if (gameOverImg != null) image(gameOverImg, 0, 0);
  else {
    background(10);
    textAlign(CENTER, CENTER);
    textFont(f);
    fill(255);
    textSize(32);
    text("GAME OVER", width/2, height/2 - 40);
  }
  textAlign(CENTER, CENTER);
  textFont(f);
  fill(255);
  textSize(18);
  text("Score: " + score, width/2, height/2 + 10);
  fill(220);
  textSize(14);
  text("Press R to restart • ENTER for Menu", width/2, height/2 + 40);
}

void startGame() {
  if (menuMusic != null && menuMusic.isPlaying()) menuMusic.pause();
  if (gameOverMusic != null && gameOverMusic.isPlaying()) gameOverMusic.pause();
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

void restartGame() {
  stopSong();
  startGame();
}

void backToMenu() {
  if (gameOverMusic != null && gameOverMusic.isPlaying()) gameOverMusic.pause();
  if (menuMusic != null) {
  menuMusic.rewind();
  menuMusic.loop();
}

  stopSong();
  clearNotes();
  gameState = menu;
}

void goGameOver() {
  if (song != null) song.pause(); // stops gameplay music
  if (gameOverMusic != null) {
  gameOverMusic.rewind();
  gameOverMusic.play();
}

  stopSong();
  gameState = gameOver;
}

void clearNotes() {
  for (int i = 0; i < MAX_NOTES; i++) notes[i] = null;
}

void loadSelectedSong() {
  stopSong();
  song = minim.loadFile(songFiles[selected], 2048);
  if (song != null) {
    song.play();
    fft = new FFT(song.bufferSize(), song.sampleRate());
    beat = new BeatDetect(song.bufferSize(), song.sampleRate());
    beat.detectMode(BeatDetect.FREQ_ENERGY);
    beat.setSensitivity(200);
  }
}

void stopSong() {
  if (song != null) {
    song.close();
    song = null;
  }
}

void keyPressed() {
  if (gameState == menu) {
    if (keyCode == LEFT) selected = (selected + 2) % 3;
    else if (keyCode == RIGHT) selected = (selected + 1) % 3;
    else if (keyCode == ENTER || key == RETURN) startGame();
  } else if (gameState == gameOver) {
    if (key == 'r' || key == 'R') restartGame();
    else if (keyCode == ENTER || key == RETURN) backToMenu();
  }
}

void spawn() {
  if (countActiveNotes() >= 22) return;
  for (int i = 0; i < MAX_NOTES; i++) {
    if (notes[i] == null) {
      notes[i] = new Note(random(30,width - 30), -20, 200, random(12, 20));
      return;
    }
  }
}

int countActiveNotes() {
  int c = 0;
  for (int i = 0; i < MAX_NOTES; i++) if (notes[i] != null) c++;
  return c;
}
