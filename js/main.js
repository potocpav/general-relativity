// Greetings to Iq/RGBA! ;)

import { h, Component, render } from 'https://esm.sh/preact@11.1.1';
import htm from 'https://esm.sh/htm@3.1.1';

import * as renderer from './renderer.js';
import * as math from './math.js';
import { World } from './world.js';
import { ObjectInfo, asteroidId, photonClockId } from './object-info.js';
import { Trajectories } from './trajectories.js';
import { Trajectory } from './trajectory.js';
import { scenarios, defaultRs } from './scenarios.js';
import { localVelocity3, staticGamma, referenceGamma, convertState, metricTypes, Schwarzschild } from './metric.js';

const html = htm.bind(h);

const devicePixelRatio = () => window.devicePixelRatio || 1;

// Device pixels per rendered pixel. The default is about two CSS pixels.
const quality_levels = [1, 2, 4, 8];
var quality = quality_levels.reduce((best, q) =>
  Math.abs(q - 2 * devicePixelRatio()) < Math.abs(best - 2 * devicePixelRatio()) ? q : best);

const uiUpdateInterval = 200; // ms between refreshes of the textual UI

// switchable, see selectMetric; its black hole size is set by scenarios
var metric = new Schwarzschild(defaultRs);

const objectIds = {
  'asteroid': asteroidId,
  'photonClock': photonClockId,
};
const nextObjectId = id => {
  const keys = Object.keys(objectIds);
  return keys[(keys.indexOf(id) + 1) % keys.length];
};

var canvas;
var overlay;
var gl;
var world;
var objectInfo;
var trajectories;

var params = {
  mousePos: null, // [x, y] in CSS pixels, y pointing up; null until the pointer moves
  pointerDn: false,
  screenDim: [window.innerWidth, window.innerHeight],
};

// arrow keys currently held down
const arrowKeys = new Set();
const shipControls = () => ({
  thrust: arrowKeys.has("ArrowUp"),
  turn: (arrowKeys.has("ArrowLeft") ? 1 : 0) - (arrowKeys.has("ArrowRight") ? 1 : 0),
});


// Velocity relative to a static observer, from a drag on the screen.
// The magnitude saturates below the speed of light.
function spawnVelocityFromDrag(origin, pos) {
  const meanRes = (params.screenDim[0] + params.screenDim[1]) / 2;
  const vLinear = math.scale(math.sub(origin, pos), 1 / meanRes);
  const vAbs = math.norm(vLinear);
  const vScale = vAbs > 1e-9 ? (1 - Math.exp(-vAbs * 3)) / vAbs : 3; // limit for vAbs -> 0
  return math.scale(vLinear, vScale);
}

function spawn(objectName, screenPos, velocity) {
  const x = world.getWorldPos(screenPos, params.screenDim);
  if (!x) return;
  const u = localVelocity3(metric, x, velocity);
  if (!u) return;
  trajectories.add(new Trajectory(metric, objectIds[objectName], x, u));
}

const isArrowControl = key => key == "ArrowUp" || key == "ArrowLeft" || key == "ArrowRight";

const timeScaleOf = state => state.pause ? 0 : Math.pow(10, state.timeSlider);

class App extends Component {
  state = {
    tool: 'boost',
    spawnObject: 'asteroid',
    spawnDragOrigin: undefined,
    spawnVelocity: undefined,
    timeSlider: 0,
    pause: false,
    scenario: scenarios[0].id,
    showDescription: true,
    tau: null,
    obsvX: null,
    obsvU: null,
    fps: null,
    crashed: false,
    showPhotonSphere: true,
    showEventHorizon: true,
    showRedshift: true,
    metric: metric.constructor.id,
    message: null, // transient notice
    error: null,
  }

  componentDidMount () {
    canvas = document.getElementById("canvas")
    overlay = document.getElementById("overlay")
    gl = renderer.initGl(canvas);
    if (!gl) {
      this.setState({error: "WebGL 2 is not supported by this browser."});
      return;
    }

    document.body.onkeydown = this.onKeyDown;
    document.body.onkeyup = this.onKeyUp;
    // keyup is not delivered when the window loses focus
    window.addEventListener('blur', () => arrowKeys.clear());

    startup().then(() => this.loadScenario(scenarios[0])).then(() => {
      this.lastUiUpdate = -Infinity;
      requestAnimationFrame(this.animate);
    }).catch(err => {
      console.error(err);
      this.setState({error: "Initialization failed: " + err.message});
    });
  }

  animate = t => {
    requestAnimationFrame(this.animate);
    world.timeScale = timeScaleOf(this.state);
    world.update(t / 1000, params.mousePos, params.pointerDn, params.screenDim, shipControls());
    renderer.render();
    this.renderOverlay();

    if (t - this.lastUiUpdate >= uiUpdateInterval) {
      this.lastUiUpdate = t;
      this.setState({
        tau: world.time,
        obsvX: world.obsvX,
        obsvU: world.obsvU,
        fps: Math.round(world.fps),
        crashed: world.crashed,
      });
    }
  }

  renderOverlay() {
    const ctx = overlay.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const {tool, spawnDragOrigin, spawnVelocity} = this.state;
    if (tool != 'spawn' || !spawnDragOrigin || !params.mousePos) return;

    // draw in CSS pixels
    const s = overlay.width / window.innerWidth;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const height = window.innerHeight;
    const [originX, originY] = spawnDragOrigin;
    const [targetX, targetY] = params.mousePos;

    ctx.beginPath();
    ctx.strokeStyle = `#fff`;
    ctx.moveTo(originX, height - originY);
    ctx.lineTo(targetX, height - targetY);
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = "14px serif";
    ctx.fillStyle = `#fff`;
    ctx.fillText(Math.round(math.norm(spawnVelocity) * 100) + " %", targetX, height - targetY);
  }

  onPointerMove = ev => {
    params.mousePos = [ev.clientX, window.innerHeight - ev.clientY];
    if (this.state.tool == 'spawn' && this.state.spawnDragOrigin) {
      this.setState({spawnVelocity: spawnVelocityFromDrag(this.state.spawnDragOrigin, params.mousePos)});
    }
  }

  onPointerDown = ev => {
    if (ev.target.tagName != "DIV") return;
    params.mousePos = [ev.clientX, window.innerHeight - ev.clientY];
    // keep receiving events when the pointer leaves the window
    ev.currentTarget.setPointerCapture(ev.pointerId);

    if (this.state.tool == 'boost') {
      params.pointerDn = true;
    } else if (this.state.tool == 'spawn') {
      this.setState({
        spawnDragOrigin: params.mousePos,
        spawnVelocity: [0, 0],
      });
    }
  }

  onPointerUp = _ => {
    const {tool, spawnDragOrigin, spawnVelocity, spawnObject} = this.state;
    if (tool == 'spawn' && spawnDragOrigin) {
      spawn(spawnObject, spawnDragOrigin, spawnVelocity);
    }
    this.cancelPointer();
  }

  cancelPointer = _ => {
    params.pointerDn = false;
    if (this.state.spawnDragOrigin) {
      this.setState({spawnDragOrigin: undefined, spawnVelocity: undefined});
    }
  }

  onWheel = ev => {
    world.viewportSize *= Math.exp(ev.deltaY / 500);
  }

  onKeyDown = ev => {
    if (isArrowControl(ev.key)) {
      // don't scroll, or move the focused time slider
      ev.preventDefault();
      arrowKeys.add(ev.key);
      return;
    }
    switch (ev.code) {
      case "Digit1": this.activateBoost();
      break; case "Digit2":
        if (this.state.tool != 'spawn')
          this.activateSpawn();
        else {
          this.setState({spawnObject: nextObjectId(this.state.spawnObject)});
        }
    }
    switch (ev.key) {
      case "r": this.reset();
      break; case "p": this.togglePhotonSphere();
      break; case "h": this.toggleEventHorizon();
      break; case "s": this.toggleRedshift();
      break; case " ":
        // Don't let Space also activate a focused button (e.g. the pause button).
        ev.preventDefault();
        if (document.activeElement && document.activeElement !== document.body) {
          document.activeElement.blur();
        }
        if (!ev.repeat) this.onPlayPause();
    }
  }

  onKeyUp = ev => {
    arrowKeys.delete(ev.key);
  }

  togglePhotonSphere = _ => {
    const show = !this.state.showPhotonSphere;
    if (world) world.showPhotonSphere = show;
    this.setState({showPhotonSphere: show});
  }

  toggleRedshift = _ => {
    const show = !this.state.showRedshift;
    if (world) world.showRedshift = show;
    this.setState({showRedshift: show});
  }

  toggleEventHorizon = _ => {
    const show = !this.state.showEventHorizon;
    if (world) world.showEventHorizon = show;
    this.setState({showEventHorizon: show});
  }

  onPlayPause = _ => {
    this.setState({pause: !this.state.pause});
  }

  onResetTimeSlider = _ => {
    this.setState({timeSlider: 0, pause: false});
  }

  onTimeSlider = ev => {
    this.setState({timeSlider: Number(ev.target.value)});
  }

  zoomIn = _ => world.viewportSize /= 1.7;

  zoomOut = _ => world.viewportSize *= 1.7;

  setTool(tool) {
    this.cancelPointer();
    this.setState({tool});
  }

  activateBoost = _ => this.setTool('boost');

  activateSpawn = _ => this.setTool('spawn');

  onSpawnAsteroid = _ => this.setState({spawnObject: 'asteroid'});
  onSpawnPhotonClock = _ => this.setState({spawnObject: 'photonClock'});

  // Reset the world to the initial state of `scenario`, in its coordinates.
  async loadScenario(scenario) {
    const type = scenario.metric ?? metric.constructor;
    const rs = scenario.rs ?? defaultRs;
    if (type !== metric.constructor || rs !== metric.rs) {
      const next = new type(rs);
      // compile first (if the coordinates change), then switch everything at once
      if (type !== metric.constructor) await renderer.setMetric(next);
      metric = next;
      world.metric = next;
    }
    const state = scenario.setup(metric);
    world.viewportSize = state.viewportSize;
    world.reset(state.ship.x, state.ship.u, state.ship.heading);
    trajectories.clear();
    for (const o of state.objects) {
      trajectories.add(new Trajectory(metric, o.type, o.x, o.u));
    }
    this.setState({
      scenario: scenario.id,
      metric: metric.constructor.id,
      timeSlider: state.timeSlider,
      pause: state.paused,
      showDescription: true,
      crashed: false,
      message: null,
    });
  }

  currentScenario = () => scenarios.find(sc => sc.id == this.state.scenario);

  reset = _ => {
    if (world) this.loadScenario(this.currentScenario()).catch(err => {
      console.error(err);
      this.setState({message: "Loading the scenario failed: " + err.message});
    });
  }

  selectScenario = ev => {
    const scenario = scenarios[ev.target.selectedIndex];
    if (!scenario.setup) return;
    this.setState({scenario: scenario.id}, this.reset);
  }

  hideDescription = _ => this.setState({showDescription: false});

  // Switch the coordinates (metric) the simulation runs in.
  selectMetric = async ev => {
    const select = ev.target;
    const type = metricTypes[select.selectedIndex];
    const next = new type(metric.rs);
    if (convertState(metric, next, world.obsvX, world.obsvU) === null) {
      select.selectedIndex = metricTypes.indexOf(metric.constructor);
      this.setState({message: `${type.label} coordinates can't describe the inside of the black hole.`});
      return;
    }
    try {
      // compile first, then switch everything at once
      await renderer.setMetric(next);
    } catch (err) {
      console.error(err);
      select.selectedIndex = metricTypes.indexOf(metric.constructor);
      this.setState({message: "Switching coordinates failed: " + err.message});
      return;
    }
    world.setMetric(next);
    trajectories.setMetric(next);
    metric = next;
    this.setState({metric: type.id, message: null, crashed: world.crashed});
  }

  selectQuality = ev => {
    quality = quality_levels[ev.target.selectedIndex];
    refreshWindow();
  }

  fullscreen = _ => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    } else if (document.webkitFullscreenElement /* Safari */) {
      document.webkitExitFullscreen();
      return;
    }

    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } else if (document.documentElement.webkitRequestFullscreen /* Safari */) {
      document.documentElement.webkitRequestFullscreen();
    }
  }

  render() {
    return html`
    <canvas id="canvas" />
    <canvas id="overlay" />
    <div
      id="ui"
      onPointerMove=${this.onPointerMove}
      onPointerDown=${this.onPointerDown}
      onPointerUp=${this.onPointerUp}
      onPointerCancel=${this.cancelPointer}
      onWheel=${this.onWheel}>
      <div id="top_right">
        <div>
          <select onChange=${this.selectMetric} title="Coordinates of the simulation">
          ${metricTypes.map(t => html`<option selected=${t.id == this.state.metric}>${t.label}</option>`)}
          </select>
          <select onChange=${this.selectQuality} title="Device pixels per rendered pixel">
          ${quality_levels.map(ql => html`<option selected=${ql == quality}>${ql+"x"}</option>`)}
          </select>
          <a class="icon" href="https://github.com/potocpav/general-relativity" target="_blank" rel="noopener" title="Go to GitHub Repository">
            <img src="img/github-mark-white.svg" alt="GitHub" />
          </a>
          <button class="icon" title="Press F11 to enter or leave fullscreen mode" onClick=${this.fullscreen}>
            <img src="img/fullscreen.svg" alt="Fullscreen" />
          </button>
        </div>
        <div>
          <button onClick=${this.zoomIn}>+</button>
          <button onClick=${this.zoomOut}>−</button>
        </div>
        <div>
          <button
            class=${this.state.showPhotonSphere ? "clicked" : ""}
            title="Circular light orbits at 1.5 rs (P)"
            onClick=${this.togglePhotonSphere}>Photon sphere</button>
        </div>
        <div>
          <button
            class=${this.state.showEventHorizon ? "clicked" : ""}
            title="The event horizon at rs (H)"
            onClick=${this.toggleEventHorizon}>Event horizon</button>
        </div>
        <div>
          <button
            class=${this.state.showRedshift ? "clicked" : ""}
            title="Gravitational and Doppler redshift of colors and brightness (S)"
            onClick=${this.toggleRedshift}>Redshift</button>
        </div>
      </div>
      <div id="top_left">
        <div>
          <select onChange=${this.selectScenario} title="Scenario (R restarts it)">
          ${scenarios.map(sc => html`<option disabled=${!sc.setup} selected=${sc.id == this.state.scenario}>${sc.name}${sc.setup ? '' : ' (coming later)'}</option>`)}
          </select>
        </div>
        ${this.state.showDescription && html`
        <div>
          <button class="description" title="Hide" onClick=${this.hideDescription}>${this.currentScenario().description} ✕</button>
        </div>
        `}
        ${this.state.error && html`<div><button>${this.state.error}</button></div>`}
        ${this.state.message && html`<div><button onClick=${() => this.setState({message: null})}>${this.state.message} ✕</button></div>`}
        <div>
          <button class=${this.state.tool == 'boost' ? "clicked" : ""} onClick=${this.activateBoost}>Boost</button>
          <button class=${this.state.tool == 'spawn' ? "clicked" : ""} onClick=${this.activateSpawn}>Spawn</button>
        </div>
        ${this.state.tool != 'spawn' ? '' : html`
        <div>
          <button class=${this.state.spawnObject == 'asteroid' ? "clicked" : ""} onClick=${this.onSpawnAsteroid}>Asteroid</button>
          <button class=${this.state.spawnObject == 'photonClock' ? "clicked" : ""} onClick=${this.onSpawnPhotonClock}>Clock</button>
        </div>
        `}
        <div>
          <button>${print3Vec(this.state.obsvX)}</button>
        </div>
        <div>
          <button>${printVelocity(this.state.obsvX, this.state.obsvU)}</button>
          <button>${this.state.fps + " FPS"}</button>
        </div>
        ${this.state.crashed && html`
        <div>
          <button onClick=${this.reset}>${metric.constructor.endMessage} press R to reset.</button>
        </div>
        `}
      </div>

      <div id="bottom_left">
        <div>
          <button onClick=${this.reset}>τ = ${printTime(this.state.tau)}</button>
          <button onClick=${this.onResetTimeSlider}>τ' = ${timeScaleOf(this.state).toFixed(2)}</button>
        </div>
        <div>
          <button onClick=${this.onPlayPause} style="width: 4em; height: 3em;">${this.state.pause ? '▶' : '⏸'}</button>
          <input type="range" min="-2" max="2" value="${this.state.timeSlider}" id="time_slider" step="0.1" list="values" onInput=${this.onTimeSlider} />
          <datalist id="values">
            <option value="-2" label="-2"></option>
            <option value="-1" label="-1"></option>
            <option value="0" label="0"></option>
            <option value="1" label="1"></option>
            <option value="2" label="2"></option>
          </datalist>
        </div>
      </div>
    </div>
    `;
  }
}

render(html`<${App} />`, document.body);

async function startup() {
  world = new World(gl, metric);

  objectInfo = new ObjectInfo(gl);
  await objectInfo.initialize();

  trajectories = new Trajectories(gl);

  await renderer.init(gl, world, objectInfo, trajectories, metric);

  refreshWindow();
  window.addEventListener('resize', refreshWindow, false);
}

function refreshWindow() {
  const dpr = devicePixelRatio();
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.max(1, Math.round(w * dpr / quality));
  canvas.height = Math.max(1, Math.round(h * dpr / quality));
  overlay.width = Math.max(1, Math.round(w * dpr));
  overlay.height = Math.max(1, Math.round(h * dpr));
  renderer.initializeWindow(canvas.width, canvas.height);
  params.screenDim = [w, h];
}

function printTime(s) {
  if (s === null) {
    return "n/a"
  } else {
    const hundredths = Math.round(s * 100);
    const minutes = Math.floor(hundredths / 6000);
    const seconds = ((hundredths % 6000) / 100).toFixed(2).padStart(5, '0');
    return `${minutes}:${seconds}`;
  }
}

function printVelocity(x, u) {
  if (u === null) {
    return "n/a"
  } else {
    // relative to a static observer; inside the horizon, where there are
    // none, to the metric's reference observer
    const lambda = staticGamma(metric, x, u);
    const speed = gamma => Math.floor(Math.sqrt(Math.max(0, 1 - Math.pow(gamma, -2))) * 100) + " %";
    if (lambda !== null) return "v = " + speed(lambda);
    return "v = " + speed(referenceGamma(metric, x, u)) + " (vs. free fall)";
  }
}

function print3Vec(x) {
  if (x === null) {
    return "n/a"
  } else {
    return x.map(v => v.toFixed(2)).join(", ");
  }
}
