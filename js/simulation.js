// A simulated world drawn into a canvas: the ship (the observer, whose view
// is drawn), the objects around it, and the metric. Each Simulation has its
// own WebGL 2 context, so several can run on one page (the app has one, the
// article one per figure); shader sources and sprites are loaded once.

import { World } from './world.js';
import { Objects } from './objects.js';
import { ObjectInfo } from './object-info.js';
import { Renderer } from './renderer.js';

export class Simulation {
  // Use Simulation.create.
  constructor(canvas, gl, metric, root) {
    this.canvas = canvas;
    this.gl = gl;
    this.root = root;
    this.world = new World(gl, metric);
    this.objectInfo = new ObjectInfo(gl);
    this.objects = new Objects(gl, metric);
    this.renderer = new Renderer(gl, this.world, this.objectInfo, this.objects, root);
  }

  // A simulation in `canvas`, in `metric`; `root` is the URL of the
  // repository root, relative to the page. Returns null if WebGL 2 is not
  // available.
  static async create(canvas, metric, {root = ''} = {}) {
    const gl = canvas.getContext('webgl2', {antialias: false, depth: false, stencil: false, premultipliedAlpha: false});
    if (!gl) return null;
    const sim = new Simulation(canvas, gl, metric, root);
    await sim.objectInfo.initialize(root);
    await sim.renderer.init(metric);
    return sim;
  }

  get metric() {
    return this.world.metric;
  }

  // Switch to `metric` (another class, or other parameters). The shader is
  // recompiled first if the class changes, so that a failure changes nothing.
  // The ship and objects aren't converted: reset the state afterwards.
  async setMetric(metric) {
    if (metric.constructor !== this.metric.constructor) await this.renderer.setMetric(metric);
    this.world.metric = metric;
  }

  // Start from `state` (as returned by a scenario's setup):
  // {ship: {x, u, heading}, objects: [{type, x, u}], viewportSize}.
  reset(state) {
    this.world.viewportSize = state.viewportSize;
    this.world.reset(state.ship.x, state.ship.u, state.ship.heading);
    this.objects.reset(this.metric, this.world.obsvX[0]);
    for (const o of state.objects) this.objects.spawn(o.type, o.x, o.u);
  }

  // Set the canvas's drawing buffer size [pixels].
  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer.resize(width, height);
  }

  // Advance to real time `time` [s], with the ship controlled by the pointer
  // and keys (see World.update); the objects follow.
  update(time, mousePos, pointerDn, screenDim, keys) {
    this.world.update(time, mousePos, pointerDn, screenDim, keys);
    this.objects.advance(this.world.obsvX[0]);
  }

  // Advance the ship by proper time `dt` under `control` (heading, engine;
  // see World.step), e.g. from an article's pilot; the objects follow.
  step(dt, control) {
    this.world.step(dt, control);
    this.objects.advance(this.world.obsvX[0]);
  }

  render() {
    this.renderer.render();
  }
}
