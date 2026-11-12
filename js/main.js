// Greetings to Iq/RGBA! ;)

import { h, Component, render } from 'https://esm.sh/preact@11.1.1';
import htm from 'https://esm.sh/htm@3.1.1';

import * as math from './math.js';
import { Simulation } from './simulation.js';
import { asteroidId, photonClockId, projectileId } from './object-info.js';
import { scenarios, scenariosOf } from './scenarios.js';
import { localVelocity3, staticGamma, referenceGamma, metricTypes } from './metric.js';

const html = htm.bind(h);

const devicePixelRatio = () => window.devicePixelRatio || 1;

// The view's size in CSS pixels: the canvas's size on the page (which, unlike
// window.innerWidth / innerHeight, excludes browser bars on mobile).
const viewWidth = () => (canvas && canvas.clientWidth) || window.innerWidth;
const viewHeight = () => (canvas && canvas.clientHeight) || window.innerHeight;

// Device pixels per rendered pixel. The default is about one CSS pixel.
const quality_levels = [1, 2, 4, 8];
var quality = quality_levels.reduce((best, q) =>
  Math.abs(q - devicePixelRatio()) < Math.abs(best - devicePixelRatio()) ? q : best);

// Settings remembered across visits, in local storage: the quality, the
// scenario and the overlays. (Storage may be unavailable, e.g. in some
// private browsing modes; then nothing is remembered.)
const settingsKey = 'general-relativity-settings';
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(settingsKey)) ?? {};
  } catch {
    return {};
  }
}
function saveSettings(changes) {
  try {
    localStorage.setItem(settingsKey, JSON.stringify({...loadSettings(), ...changes}));
  } catch {
    // not remembered
  }
}
const savedSettings = loadSettings();
if (quality_levels.includes(savedSettings.quality)) quality = savedSettings.quality;

// The initial scenario: from the URL (?scenario=<id>, set when a scenario is
// chosen, so that it can be linked), else the last one chosen, else the first.
const findScenario = id => scenarios.find(sc => sc.id == id && sc.setup);
const initialScenario = findScenario(new URLSearchParams(location.search).get('scenario'))
  ?? findScenario(savedSettings.scenario) ?? scenarios[0];

const uiUpdateInterval = 200; // ms between refreshes of the textual UI

// set by the scenario (its metric class and parameters), see loadScenario
var metric = new initialScenario.metric(initialScenario.params);

// projectiles fired with Space: speed in the ship's rest frame, and how many
// are kept (the oldest are dropped)
const projectileSpeed = 0.5;
const maxProjectiles = 64;

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
var sim;     // the Simulation
var world;   // sim.world
var objects; // sim.objects

var params = {
  mousePos: null, // [x, y] in CSS pixels, y pointing up; null until the pointer moves
  pointerDn: false,
  screenDim: [window.innerWidth, window.innerHeight], // set from the view in refreshWindow
};

// Pointers (fingers, mouse) currently pressed on the view, id -> [x, y], and
// the distance between the first two while pinching (null otherwise).
const touches = new Map();
var pinchDistance = null;
const fingerDistance = () => {
  const [a, b] = [...touches.values()];
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
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
  objects.spawn(objectIds[objectName], x, u);
}

const isArrowControl = key => key == "ArrowUp" || key == "ArrowLeft" || key == "ArrowRight";

// The time slider runs from -3 to 3, with ticks at time scales -10, -1, -0.1,
// 0, 0.1, 1 and 10: linear between -0.1 and 0.1, exponential outside.
const sliderToTimeScale = s => Math.abs(s) <= 1 ? 0.1 * s : Math.sign(s) * Math.pow(10, Math.abs(s) - 2);
const timeScaleToSlider = scale => Math.abs(scale) <= 0.1 ? 10 * scale : Math.sign(scale) * (Math.log10(Math.abs(scale)) + 2);
const timeScaleOf = state => state.pause ? 0 : sliderToTimeScale(state.timeSlider);

class App extends Component {
  state = {
    tool: 'boost',
    spawnObject: 'asteroid',
    spawnDragOrigin: undefined,
    spawnVelocity: undefined,
    timeSlider: timeScaleToSlider(1),
    showDisplayOptions: false,
    pause: false,
    scenario: initialScenario.id,
    showDescription: true,
    tau: null,
    obsvX: null,
    obsvU: null,
    fps: null,
    crashed: false,
    showPhotonSphere: savedSettings.showPhotonSphere ?? false,
    showEventHorizon: savedSettings.showEventHorizon ?? true,
    showInterior: savedSettings.showInterior ?? false,
    showRedshift: savedSettings.showRedshift ?? true,
    metric: metric.constructor.id,
    message: null, // transient notice
    error: null,
  }

  componentDidMount () {
    canvas = document.getElementById("canvas")
    overlay = document.getElementById("overlay")

    document.body.onkeydown = this.onKeyDown;
    document.body.onkeyup = this.onKeyUp;
    // keyup is not delivered when the window loses focus
    window.addEventListener('blur', () => arrowKeys.clear());

    Simulation.create(canvas, metric).then(created => {
      if (!created) throw new Error("WebGL 2 is not supported by this browser.");
      sim = created;
      world = sim.world;
      objects = sim.objects;
      refreshWindow();
      window.addEventListener('resize', refreshWindow, false);
      world.showPhotonSphere = this.state.showPhotonSphere;
      world.showEventHorizon = this.state.showEventHorizon;
      world.showInterior = this.state.showInterior;
      world.showRedshift = this.state.showRedshift;
      return this.loadScenario(initialScenario);
    }).then(() => {
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
    sim.update(t / 1000, params.mousePos, params.pointerDn, params.screenDim, shipControls());
    sim.render();
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
    const s = overlay.width / viewWidth();
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const height = viewHeight();
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
    if (touches.has(ev.pointerId)) touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pinchDistance !== null) {
      // pinch-to-zoom: zoom by the change of the distance between two fingers
      if (touches.size >= 2) {
        const d = fingerDistance();
        if (d > 0) world.viewportSize *= pinchDistance / d;
        pinchDistance = d;
      }
      return;
    }
    params.mousePos = [ev.clientX, viewHeight() - ev.clientY];
    if (this.state.tool == 'spawn' && this.state.spawnDragOrigin) {
      this.setState({spawnVelocity: spawnVelocityFromDrag(this.state.spawnDragOrigin, params.mousePos)});
    }
  }

  onPointerDown = ev => {
    // While the display options are open, a press outside them closes them;
    // on the view, it does nothing else (no boost, spawn or pinch).
    if (this.state.showDisplayOptions && !ev.target.closest('#top_right')) {
      this.setState({showDisplayOptions: false});
      if (ev.target.tagName == "DIV") return;
    }
    if (ev.target.tagName != "DIV") return;
    if (ev.target.closest('#top_right')) return; // the display options' background
    // keep receiving events when the pointer leaves the window
    ev.currentTarget.setPointerCapture(ev.pointerId);
    touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (touches.size >= 2) {
      // a second finger: pinch-to-zoom instead of boosting or spawning
      this.cancelPointer();
      pinchDistance = fingerDistance();
    }
    // until all fingers have been lifted after a pinch, don't start anything
    if (pinchDistance !== null) return;
    params.mousePos = [ev.clientX, viewHeight() - ev.clientY];

    if (this.state.tool == 'boost') {
      params.pointerDn = true;
    } else if (this.state.tool == 'spawn') {
      this.setState({
        spawnDragOrigin: params.mousePos,
        spawnVelocity: [0, 0],
      });
    }
  }

  onPointerUp = ev => {
    touches.delete(ev.pointerId);
    if (pinchDistance !== null) {
      if (touches.size == 0) pinchDistance = null;
      return;
    }
    const {tool, spawnDragOrigin, spawnVelocity, spawnObject} = this.state;
    if (tool == 'spawn' && spawnDragOrigin) {
      spawn(spawnObject, spawnDragOrigin, spawnVelocity);
    }
    this.cancelPointer();
  }

  onPointerCancel = ev => {
    touches.delete(ev.pointerId);
    if (touches.size == 0) pinchDistance = null;
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
    if (ev.key == "Escape" && this.state.showDisplayOptions) {
      this.setState({showDisplayOptions: false});
      return;
    }
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
    if (ev.key == " " || ev.key == "Enter") {
      // Don't let Space or Enter also activate a focused button (e.g. the pause button).
      ev.preventDefault();
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      if (!ev.repeat) {
        if (ev.key == " ") this.shoot();
        else this.onPlayPause();
      }
      return;
    }
    switch (ev.key) {
      case "r": this.reset();
      break; case "p": this.togglePhotonSphere();
      break; case "h": this.toggleEventHorizon();
      break; case "i": this.toggleInterior();
      break; case "s": this.toggleRedshift();
    }
  }

  onKeyUp = ev => {
    arrowKeys.delete(ev.key);
  }

  togglePhotonSphere = _ => {
    const show = !this.state.showPhotonSphere;
    if (world) world.showPhotonSphere = show;
    this.setState({showPhotonSphere: show});
    saveSettings({showPhotonSphere: show});
  }

  toggleRedshift = _ => {
    const show = !this.state.showRedshift;
    if (world) world.showRedshift = show;
    this.setState({showRedshift: show});
    saveSettings({showRedshift: show});
  }

  toggleEventHorizon = _ => {
    const show = !this.state.showEventHorizon;
    if (world) world.showEventHorizon = show;
    this.setState({showEventHorizon: show});
    saveSettings({showEventHorizon: show});
  }

  toggleInterior = _ => {
    const show = !this.state.showInterior;
    if (world) world.showInterior = show;
    this.setState({showInterior: show});
    saveSettings({showInterior: show});
  }

  toggleDisplayOptions = _ => this.setState({showDisplayOptions: !this.state.showDisplayOptions});

  // Fire a projectile forwards from the ship, at projectileSpeed in its rest frame.
  shoot = _ => {
    if (!world || world.crashed) return;
    const [hr, hphi] = world.obsvO, gamma = 1 / Math.sqrt(1 - projectileSpeed ** 2);
    const u = math.matVec(math.restToCoord(metric, world.obsvX, world.obsvU),
      [gamma, gamma * projectileSpeed * hr, gamma * projectileSpeed * hphi]);
    // keep at most maxProjectiles, dropping the oldest
    const projectiles = objects.objects.filter(o => o.type == projectileId);
    for (const o of projectiles.slice(0, Math.max(0, projectiles.length - maxProjectiles + 1))) objects.remove(o);
    objects.spawn(projectileId, world.obsvX, u);
  }

  onPlayPause = _ => {
    this.setState({pause: !this.state.pause});
  }

  onResetTimeSlider = _ => {
    this.setState({timeSlider: timeScaleToSlider(1), pause: false});
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

  // Reset the world to the initial state of `scenario`, in its metric.
  async loadScenario(scenario) {
    const type = scenario.metric;
    if (type !== metric.constructor || !metric.sameParams(scenario.params)) {
      const next = new type(scenario.params);
      await sim.setMetric(next);
      metric = next;
    }
    const state = scenario.setup(metric);
    sim.reset(state);
    saveSettings({scenario: scenario.id});
    this.setState({
      scenario: scenario.id,
      metric: metric.constructor.id,
      timeSlider: timeScaleToSlider(state.timeScale),
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
    this.startScenario(scenariosOf(metric.constructor)[ev.target.selectedIndex]);
  }

  startScenario(scenario) {
    if (!scenario.setup) return;
    // put it into the URL (only once chosen), so that it can be linked
    const url = new URL(location.href);
    url.searchParams.set('scenario', scenario.id);
    history.replaceState(null, '', url);
    this.setState({scenario: scenario.id}, this.reset);
  }

  hideDescription = _ => this.setState({showDescription: false});

  // Switch the coordinates (metric) the simulation runs in: start its first
  // scenario. (States aren't carried over between metrics.)
  selectMetric = ev => {
    const type = metricTypes[ev.target.selectedIndex];
    this.startScenario(scenariosOf(type).find(sc => sc.setup));
  }

  selectQuality = ev => {
    quality = quality_levels[ev.target.selectedIndex];
    saveSettings({quality});
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
      onPointerCancel=${this.onPointerCancel}
      onWheel=${this.onWheel}>
      <div id="top_right">
        <div>
          <button class=${"icon" + (this.state.showDisplayOptions ? " clicked" : "")} title="Display options" onClick=${this.toggleDisplayOptions}>
            <img src="img/eye.svg" alt="Display options" />
          </button>
          <a class="icon" href="https://github.com/potocpav/general-relativity" target="_blank" rel="noopener" title="Go to GitHub Repository">
            <img src="img/github-mark-white.svg" alt="GitHub" />
          </a>
          <button class="icon" title="Press F11 to enter or leave fullscreen mode" onClick=${this.fullscreen}>
            <img src="img/fullscreen.svg" alt="Fullscreen" />
          </button>
        </div>
        ${this.state.showDisplayOptions && html`
        <div class="popup">
          <div>
            <select onChange=${this.selectQuality} title="Quality: device pixels per rendered pixel">
            ${quality_levels.map(ql => html`<option selected=${ql == quality}>${ql+"x"}</option>`)}
            </select>
            <button onClick=${this.zoomIn} title="Zoom in">+</button>
            <button onClick=${this.zoomOut} title="Zoom out">−</button>
          </div>
          ${metric.constructor.features.blackHole && html`
          <div>
            <button
              class=${this.state.showPhotonSphere ? "clicked" : ""}
              title="Circular light orbits at 1.5 rs"
              onClick=${this.togglePhotonSphere}>Photon sphere (P)</button>
          </div>
          <div>
            <button
              class=${this.state.showEventHorizon ? "clicked" : ""}
              title="The event horizon at rs, visible from inside the black hole"
              onClick=${this.toggleEventHorizon}>Event horizon (H)</button>
          </div>
          <div>
            <button
              class=${this.state.showInterior ? "clicked" : ""}
              title="Tint the black hole's shadow instead of showing it black"
              onClick=${this.toggleInterior}>BH interior (I)</button>
          </div>
          `}
          <div>
            <button
              class=${this.state.showRedshift ? "clicked" : ""}
              title="Gravitational and Doppler redshift of colors and brightness"
              onClick=${this.toggleRedshift}>Redshift (S)</button>
          </div>
          <div>
            <span class="label">${this.state.fps + " FPS"}</span>
          </div>
        </div>
        `}
      </div>
      <div id="top_left">
        <div>
          <select onChange=${this.selectMetric} title=${`Spacetime (simulated in ${metric.constructor.coordinates} coordinates)`}>
          ${metricTypes.map(t => html`<option selected=${t.id == this.state.metric} title=${`${t.coordinates} coordinates`}>${t.label}</option>`)}
          </select>
        </div>
        <div>
          <select onChange=${this.selectScenario} title="Scenario (R restarts it)">
          ${scenariosOf(metric.constructor).map(sc => html`<option disabled=${!sc.setup} selected=${sc.id == this.state.scenario}>${sc.name}${sc.setup ? '' : ' (coming later)'}</option>`)}
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
          <button class=${this.state.tool == 'boost' ? "clicked" : ""} onClick=${this.activateBoost}>Boost (1)</button>
          <button class=${this.state.tool == 'spawn' ? "clicked" : ""} onClick=${this.activateSpawn}>Spawn (2)</button>
        </div>
        ${this.state.tool != 'spawn' ? '' : html`
        <div>
          <button class=${this.state.spawnObject == 'asteroid' ? "clicked" : ""} onClick=${this.onSpawnAsteroid}>Asteroid</button>
          <button class=${this.state.spawnObject == 'photonClock' ? "clicked" : ""} onClick=${this.onSpawnPhotonClock}>Clock</button>
        </div>
        `}
        ${this.state.crashed && html`
        <div>
          <button onClick=${this.reset}>${metric.constructor.endMessage} press R to reset.</button>
        </div>
        `}
      </div>

      <div id="bottom_right">
        <div>
          <span class="label" title=${`The ship's coordinates (${metric.constructor.coordinateNames.join(', ')})`}>${print3Vec(this.state.obsvX)}</span>
        </div>
        <div>
          <span class="label" title="The ship's speed">${printVelocity(this.state.obsvX, this.state.obsvU)}</span>
        </div>
      </div>

      <div id="bottom_left">
        <div>
          <button onClick=${this.reset} title="Restart the scenario">τ = ${printTime(this.state.tau)} (R)</button>
          <button onClick=${this.onResetTimeSlider}>τ' = ${timeScaleOf(this.state).toFixed(2)}</button>
        </div>
        <div>
          <button onClick=${this.onPlayPause} title="Play / pause (Enter)" style="width: 4em; height: 3em;">${this.state.pause ? '▶' : '⏸'}</button>
          <input type="range" min="-3" max="3" value="${this.state.timeSlider}" id="time_slider" step="0.05" list="values" onInput=${this.onTimeSlider}
            title="Time scale: backwards (left) or forwards (right), ticks at ±10, ±1, ±0.1 and 0" />
          <datalist id="values">
            ${[-3, -2, -1, 0, 1, 2, 3].map(s => html`<option value=${s} label=${sliderToTimeScale(s) + "x"}></option>`)}
          </datalist>
        </div>
      </div>
    </div>
    `;
  }
}

render(html`<${App} />`, document.body);

function refreshWindow() {
  const dpr = devicePixelRatio();
  const w = viewWidth(), h = viewHeight();
  sim.resize(Math.max(1, Math.round(w * dpr / quality)), Math.max(1, Math.round(h * dpr / quality)));
  overlay.width = Math.max(1, Math.round(w * dpr));
  overlay.height = Math.max(1, Math.round(h * dpr));
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
    // relative to a static observer; where there are none (inside the
    // horizon), to the metric's reference observer
    const gamma = staticGamma(metric, x, u);
    const speed = gamma => Math.floor(Math.sqrt(Math.max(0, 1 - Math.pow(gamma, -2))) * 100) + " %";
    if (gamma !== null) return "v = " + speed(gamma);
    return "v = " + speed(referenceGamma(metric, x, u)) + ` (vs. ${metric.constructor.referenceObserver})`;
  }
}

function print3Vec(x) {
  if (x === null) {
    return "n/a"
  } else {
    return x.map(v => v.toFixed(2)).join(", ");
  }
}
