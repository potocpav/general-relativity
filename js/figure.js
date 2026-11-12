// Runs a Simulation in an article figure: its canvas is sized to the view
// (one rendered pixel per CSS pixel), and it is animated only while the
// figure is on screen.

import { Simulation } from './simulation.js';

// Start a simulation in `canvas`, in `metric`, from `state` (as returned by a
// scenario's setup). On each animation frame, `onFrame(sim, dt)` advances it
// by `dt` seconds (real time, at most 0.1 s), e.g. with sim.step, and it is
// drawn. Returns the Simulation, or null if WebGL 2 is not available.
export async function runFigure(canvas, metric, state, onFrame, {root = '../'} = {}) {
  const sim = await Simulation.create(canvas, metric, {root});
  if (!sim) return null;
  sim.reset(state);

  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth)), h = Math.max(1, Math.round(canvas.clientHeight));
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
    const dt = last === undefined ? 0 : Math.min(0.1, (t - last) / 1000);
    last = t;
    onFrame(sim, dt);
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
