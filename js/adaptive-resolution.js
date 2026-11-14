// Adaptive resolution: starts sharp, one rendered pixel per physical pixel,
// and is lowered (halving the number of pixels) whenever the frame rate,
// averaged over a window, is too low. It is never raised again, so it
// doesn't oscillate. Used by the article's figures and the app's "auto"
// quality.

const minFps = 45;   // below this, averaged over a window, the resolution is lowered
const fpsWindow = 5; // the averaging window [s of animation]

export class AdaptiveResolution {
  // `maxFactor`: the lowest resolution, in physical pixels per rendered pixel
  constructor(maxFactor) {
    this.maxFactor = maxFactor;
    this.factor = 1; // physical pixels per rendered pixel (along each axis)
    this.restart();
  }

  // Measure afresh, e.g. after a pause, a resize, or a change of resolution.
  restart() {
    this.frames = 0;
    this.elapsed = 0;
  }

  // Count a frame that took `dt` seconds. Returns whether the resolution was
  // lowered.
  frame(dt) {
    if (!(dt > 0) || dt > 0.5) { // a pause (e.g. a hidden tab), not a slow frame: start over
      this.restart();
      return false;
    }
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < fpsWindow) return false;
    const slow = this.frames / this.elapsed < minFps && this.factor < this.maxFactor;
    if (slow) this.factor = Math.min(this.maxFactor, this.factor * Math.SQRT2);
    this.restart();
    return slow;
  }
}
