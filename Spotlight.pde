class Spotlight {
  float x;
  float angle;
  float w;
  float h;
  float a;
  float decay;

  float r, g, b;  // COLOR

  Spotlight(float _x) {
    x = _x;
    angle = random(-0.15, 0.15);
    w = random(60, 120);
    h = random(260, 420);
    a = 180;
    decay = random(4, 7);

    // --- COLOR RANGE (EDIT THESE!) ---
    // example: soft neon range: pink-blue-purple
    r = random(100, 255);
    g = random(0, 150);
    b = random(150, 255);
  }

  void update() {
    a -= decay;
  }

  boolean dead() {
    return a <= 0;
  }

  void draw() {
    pushMatrix();
    translate(x, height);
    rotate(angle);
    blendMode(ADD);
    noStroke();

    for (int i = 0; i < 4; i++) {
      float t = 1 - i * 0.22;
      int al = (int)(a * (0.55 - i * 0.12));
      if (al <= 0) continue;

      fill(r, g, b, al);   // <--- NOW USES RANDOM COLOR

      float ww = w * t;
      float hh = -h * t;
      triangle(0, 0, -ww, hh, ww, hh);
    }

    blendMode(BLEND);
    popMatrix();
  }
}
