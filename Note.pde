class Note {
  float x;
  float y;
  float vy;
  float r;
  //boolean alive;

  Note(float startX, float startY, float speed, float radius) {
    x = startX;
    y = startY;
    vy = speed;
    r = radius;
    //alive = true;
  }

  void update(float dt) {
    y += vy * dt;
  }

  void drawNote() {
    ellipse(x, y, r*2, r*2);
  }

  boolean offScreen() {
    return y - r > height;
  }
}
