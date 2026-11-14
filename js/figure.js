// Runs a Simulation in an article figure: its canvas is sized to the view,
// and it is animated only while the figure is on screen.
//
// The resolution adapts: it starts sharp, one rendered pixel per physical
// pixel, and is lowered (halving the number of pixels) whenever the frame
// rate, averaged over a while, is too low; it is never raised again, so it
// doesn't oscillate.

import { Simulation } from './simulation.js';

const minFps = 45;          // below this, averaged over a window, the resolution is lowered
const fpsWindow = 2;        // the averaging window [s of animation]
const maxCssPerPixel = 2;   // the lowest resolution: CSS pixels per rendered pixel

// Start a simulation in `canvas`, in `metric`, from `state` (as returned by a
// scenario's setup). On each animation frame, `onFrame(sim, dt)` advances it
// by `dt` seconds (real time, at most 0.1 s), e.g. with sim.step, and it is
// drawn. Returns the Simulation, or null if WebGL 2 is not available.
export async function runFigure(canvas, metric, state, onFrame, {root = '../'} = {}) {
  const sim = await Simulation.create(canvas, metric, {root});
  if (!sim) return null;
  sim.reset(state);

  // rendered pixels per CSS pixel
  let scale = window.devicePixelRatio || 1;
  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth * scale));
    const h = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (w != canvas.width || h != canvas.height) sim.resize(w, h);
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  // the frame rate over the current window: its frames, and their time
  let frames = 0, elapsed = 0;
  const measure = dt => {
    if (dt > 0.5) { // a pause (e.g. a hidden tab), not a slow frame: start over
      frames = elapsed = 0;
      return;
    }
    frames++;
    elapsed += dt;
    if (elapsed < fpsWindow) return;
    if (frames / elapsed < minFps && scale > 1 / maxCssPerPixel) {
      scale = Math.max(1 / maxCssPerPixel, scale / Math.SQRT2);
      resize();
    }
    frames = elapsed = 0;
  };

  let visible = false, running = false, last;
  const frame = t => {
    if (!visible) {
      running = false;
      return;
    }
    // the time since the last frame, unless this is the first one since the figure (re)appeared
    const dt = last === undefined ? undefined : (t - last) / 1000;
    last = t;
    if (dt !== undefined) measure(dt);
    onFrame(sim, Math.min(0.1, dt ?? 0));
    sim.render();
    requestAnimationFrame(frame);
  };
  new IntersectionObserver(entries => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible && !running) {
      running = true;
      last = undefined;
      frames = elapsed = 0; // measure afresh: frames may have been throttled while hidden
      requestAnimationFrame(frame);
    }
  }).observe(canvas);
  return sim;
}
