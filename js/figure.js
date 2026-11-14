// Runs a Simulation in an article figure: its canvas is sized to the view,
// at an adaptive resolution (see AdaptiveResolution), and it is animated only
// while the figure is on screen.

import { Simulation } from './simulation.js';
import { AdaptiveResolution } from './adaptive-resolution.js';

const maxCssPerPixel = 2; // the lowest resolution: CSS pixels per rendered pixel

// Start a simulation in `canvas`, in `metric`, from `state` (as returned by a
// scenario's setup). On each animation frame, `onFrame(sim, dt)` advances it
// by `dt` seconds (real time, at most 0.1 s), e.g. with sim.step, and it is
// drawn. Returns the Simulation, or null if WebGL 2 is not available.
export async function runFigure(canvas, metric, state, onFrame, {root = '../'} = {}) {
  const sim = await Simulation.create(canvas, metric, {root});
  if (!sim) return null;
  sim.reset(state);

  const dpr = window.devicePixelRatio || 1;
  const resolution = new AdaptiveResolution(dpr * maxCssPerPixel);
  const resize = () => {
    const scale = dpr / resolution.factor; // rendered pixels per CSS pixel
    const w = Math.max(1, Math.round(canvas.clientWidth * scale));
    const h = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (w != canvas.width || h != canvas.height) sim.resize(w, h);
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  let visible = false, running = false, last;
  const frame = t => {
    if (!visible) {
      running = false;
      return;
    }
    // the time since the last frame, unless this is the first one since the figure (re)appeared
    const dt = last === undefined ? 0 : (t - last) / 1000;
    last = t;
    if (resolution.frame(dt)) resize();
    onFrame(sim, Math.min(0.1, dt));
    sim.render();
    requestAnimationFrame(frame);
  };
  new IntersectionObserver(entries => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible && !running) {
      running = true;
      last = undefined;
      requestAnimationFrame(frame);
    }
  }).observe(canvas);
  return sim;
}
