// Greetings to Iq/RGBA! ;)

// import { Component, render } from 'https://unpkg.com/htm/preact/standalone.module.js';
import { h, Component, render } from 'https://esm.sh/preact';
import htm from 'https://esm.sh/htm';

import * as renderer from './renderer.js';
import { World } from './world.js';
import { ObjectInfo, photonClockId } from './object-info.js';
import { Trajectories } from './trajectories.js';
import { Trajectory } from './trajectory.js';
import { velocity3, Schwarzschild } from './metric.js';

const html = htm.bind(h);

var quality = 2;
const quality_levels = [1, 2, 4, 8];

const rs = 0.3;
const metric = new Schwarzschild(rs);

var canvas;
var overlay;
var gl;
var world;
var objectInfo;
var trajectories;
var asteroid;

var params = {
  mousePos: nj.array([0, 0]),
  pointerDn: false,
  screenDim: nj.array([window.innerWidth, window.innerHeight]),
};

function initWorld() {
  const r = 10 * rs;
  const x = nj.array([0, r, 0]);
  // const u2 = nj.array([0.0, 0.0]); // stationary
  // const u2 = nj.array([-(1 - rs/r) * Math.sqrt(rs/r), 0.0]); // raindrop
  const u2 = nj.array([0.0, Math.sqrt(rs/(2*r))]); // circular orbit

  world.time = 0;
  world.viewportSize = 20;
  world.timeScale = 1.0;
  world.rs = rs;

  world.startTime = Date.now();
  world.obsvX = x;
  world.obsvU = velocity3(metric, x, u2);
  world.obsvO = nj.array([0.0, 1.0]);
  world.eventX = nj.array([0.0, 0.0, 0.0]);

  // objects
  const asteroid_x0 = nj.array([0, 25 * rs, 0.0]);
  const asteroid_v0 = nj.array([0.0, -0.12]);
  asteroid = new Trajectory(metric, photonClockId, asteroid_x0, velocity3(metric, asteroid_x0, asteroid_v0))
  trajectories.add(asteroid);
}

class App extends Component {
  state = {
    tool: 'boost',
    spawnDragOrigin: undefined,
    spawnVelocity: undefined,
    timeSlider: 0,
    timeScale: 1,
    pause: false,
    tau: null,
    obsvX: null,
    obsvU: null,
    fps: null,
  }

  componentDidMount () {
    canvas = document.getElementById("canvas")
    overlay = document.getElementById("overlay")
    gl = renderer.initGl(canvas);

    document.body.onkeydown = this.onKeyDown;

    startup().then(() => {
      initWorld();
      requestAnimationFrame(t => this.animate(t));
    });
  }

  animate(t) {
    requestAnimationFrame(t => this.animate(t));
    world.timeScale = this.state.pause ? 0 : Math.pow(10, this.state.timeSlider);
    world.update(t / 1000, params.mousePos, params.pointerDn, params.screenDim);
    renderer.render();
    this.renderOverlay();

    this.setState({
      tau: world.time,
      obsvX: world.obsvX,
      obsvU: world.obsvU,
      fps: Math.floor(world.fps),
      timeScale: world.timeScale,
    });
  }

  renderOverlay() {
    var ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (this.state.tool == 'spawn' && this.state.spawnDragOrigin !== undefined) {
      const [originPxX, originPxY] = this.state.spawnDragOrigin.tolist();
      const originX = originPxX / quality;
      const originY = overlay.height - originPxY / quality;
      const targetX = params.mousePos.get(0) / quality;
      const targetY = overlay.height - params.mousePos.get(1) / quality;
      const absVel = Math.sqrt(this.state.spawnVelocity.dot(this.state.spawnVelocity).get(0));

      ctx.beginPath();
      ctx.strokeStyle = `#fff`;
      ctx.moveTo(originX, originY);
      ctx.lineTo(targetX, targetY);
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = "11px serif";
      ctx.fillStyle = `#fff`;
      ctx.fillText(Math.round(absVel * 100) + " %", targetX, targetY);
    }

  }

  onPointerMove = ev => {
    params.mousePos = nj.array([ev.clientX, window.innerHeight - ev.clientY]);
    if (this.state.tool == 'spawn' && this.state.spawnDragOrigin !== undefined) {
      const vLinear = this.state.spawnDragOrigin.subtract(params.mousePos).divide((params.screenDim.get(0) + params.screenDim.get(1)) / 2);
      const vAbs = Math.sqrt(vLinear.dot(vLinear).get(0));
      const vScale = (1 - Math.exp(-vAbs * 3)) / vAbs;
      this.setState({spawnVelocity: vLinear.multiply(vScale)});
    }
  }

  onPointerDown = ev => {
    if (ev.target.tagName != "DIV") return;
    params.mousePos = nj.array([ev.clientX, window.innerHeight - ev.clientY]);

    if (this.state.tool == 'boost') {
      params.pointerDn = true;
    } else if (this.state.tool == 'spawn') {
      this.setState({spawnDragOrigin: params.mousePos, spawnVelocity: nj.array([0,0])});
    }
  }

  onPointerUp = _ => {
    if (this.state.tool == 'boost') {
      params.pointerDn = false;
    } else if (this.state.tool == 'spawn' && this.state.spawnDragOrigin !== undefined) {
      const spawnX = world.getWorldPos(this.state.spawnDragOrigin, params.screenDim);
      asteroid = new Trajectory(metric, photonClockId, spawnX, velocity3(metric, spawnX, this.state.spawnVelocity))
      trajectories.add(asteroid);
      this.setState({spawnDragOrigin: undefined, spawnVelocity: undefined});
    }
  }

  onWheel = ev => {
    world.viewportSize *= Math.exp(ev.deltaY / 500);
  }

  onKeyDown = ev => {
    switch (ev.code) {
      case "Digit1": this.activateBoost();
      break; case "Digit2": this.activateSpawn();
    }
    switch (ev.key) {
      case "r": this.reset();
      break; case " ": this.onPlayPause();
    }
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

  activateBoost = _ => this.setState({tool: 'boost'});

  activateSpawn = _ => this.setState({tool: 'spawn'});

  reset = _ => initWorld();

  selectQuality = ev => {
    quality = quality_levels[ev.target.selectedIndex];
    refreshWindow();
  }

  goToGithub = _ => window.location.href = "https://github.com/potocpav/general-relativity";

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
      onWheel=${this.onWheel}>
      <div id="top_right">
        <div>
          <select onChange=${this.selectQuality}>
          ${quality_levels.map(ql => html`<option selected=${ql == quality}>${ql+"x"}</option>`)}
          </select>
          <img src="img/github-mark-white.svg" title="Go to GitHub Repository" onClick=${this.goToGithub} />
          <img src="img/fullscreen.svg" title="Press F11 to enter or leave fullscreen mode" onClick=${this.fullscreen} />
        </div>
        <div>
          <button onClick=${this.zoomIn}>+</button>
          <button onClick=${this.zoomOut}>−</button>
        </div>
      </div>
      <div id="top_left">
        <div>
          <button class=${this.state.tool == 'boost' ? "clicked" : ""} onClick=${this.activateBoost}>Boost</button>
          <button class=${this.state.tool == 'spawn' ? "clicked" : ""} onClick=${this.activateSpawn}>Spawn</button>
        </div>
        <div>
          <button>${print3Vec(this.state.obsvX)}</button>
        </div>
        <div>
          <button>${printVelocity(this.state.obsvX, this.state.obsvU)}</button>
          <button>${this.state.fps + " FPS"}</button>
        </div>
      </div>

      <div id="bottom_left">
        <div>
          <button onClick=${this.reset}>τ = ${printTime(this.state.tau)}</button>
          <button onClick=${this.onResetTimeSlider}>τ' = ${this.state.timeScale.toFixed(2)}</button>
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

  await renderer.init(gl, world, objectInfo, trajectories);

  refreshWindow();
  window.addEventListener('resize', refreshWindow, false);
}

function refreshWindow() {
  canvas.width = window.innerWidth / quality;
  canvas.height = window.innerHeight / quality;
  overlay.width = window.innerWidth / quality;
  overlay.height = window.innerHeight / quality;
  renderer.initializeWindow(canvas.width, canvas.height);
  params.screenDim = nj.array([window.innerWidth, window.innerHeight]);
}

function printTime(s) {
  if (s === null) {
    return "n/a"
  } else {
    const minutes = Math.floor(s / 60);
    const seconds = (s % 60).toFixed(2).padStart(5, '0');
    return `${minutes}:${seconds}`;
  }
}

function printVelocity(x, u) {
  if (u === null) {
    return "n/a"
  } else {
    const lambda = metric.T(x).dot(u).get(0);
    const v = Math.sqrt(1-Math.pow(lambda, -2));
    return "v = " + Math.floor(v * 100) + " %"
  }
}

function print3Vec(x) {
  if (x === null) {
    return "n/a"
  } else {
    return `${x.get(0).toFixed(2)}, ${x.get(1).toFixed(2)}, ${x.get(2).toFixed(2)}`;
  }
}
