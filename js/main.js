// Greetings to Iq/RGBA! ;)

// import { Component, render } from 'https://unpkg.com/htm/preact/standalone.module.js';
import { h, Component, render } from 'https://esm.sh/preact';
import htm from 'https://esm.sh/htm';

import * as renderer from './renderer.js';
import { World } from './world.js';
import { ObjectInfo, shipId, shipThrustingId, asteroidId } from './object-info.js';
import { Trajectories } from './trajectories.js';
import { Trajectory } from './trajectory.js';
import { velocity3, Schwarzschild, GP } from './metric.js';

const html = htm.bind(h);

var quality = 2;
const quality_levels = [1, 2, 4, 8];

const rs = 0.03;
const metric = new Schwarzschild(rs);

var canvas;
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

  world.viewportSize = 3;
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
  asteroid = new Trajectory(metric, asteroidId, asteroid_x0, velocity3(metric, asteroid_x0, asteroid_v0))
  trajectories.add(asteroid);
}

class App extends Component {
  state = {
    tool: 'boost',
    tau: null,
    obsvX: null,
    obsvU: null,
    fps: null,
  }

  componentDidMount () {
    canvas = document.getElementById("canvas")
    gl = renderer.initGl(canvas);

    document.body.onkeydown = this.onKeyDown;

    startup().then(() => {
      initWorld();
      requestAnimationFrame(t => this.animate(t));
    });
  }

  animate(t) {
    requestAnimationFrame(t => this.animate(t));
    world.update(t / 1000, params.mousePos, params.pointerDn, params.screenDim);
    renderer.render();
    this.setState({
      tau: world.time,
      obsvX: world.obsvX,
      obsvU: world.obsvU,
      fps: Math.floor(world.fps),
    });
  }

  onPointerMove = ev => {
    params.mousePos = nj.array([ev.clientX, window.innerHeight - ev.clientY]);
  }

  onPointerDown = ev => {
    params.mousePos = nj.array([ev.clientX, window.innerHeight - ev.clientY]);

    if (this.state.tool == 'boost') {
      params.pointerDn = true;
    }

    if (this.state.tool == 'spawn') {
      const mouseWorldX = world.getWorldPos(params.mousePos, params.screenDim);
      const asteroid_v0 = nj.array([0.0, 0.0]);
      asteroid = new Trajectory(metric, asteroidId, mouseWorldX, velocity3(metric, mouseWorldX, asteroid_v0))
      trajectories.add(asteroid);
    }
  }

  onPointerUp = _ => {
    params.pointerDn = false;
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
      break; case " ": console.log('space');
    }
  }

  zoomIn = _ => world.viewportSize /= 1.7;

  zoomOut = _ => world.viewportSize *= 1.7;

  activateBoost = _ => this.setState({tool: 'boost'});

  activateSpawn = _ => {
    this.setState({tool: 'spawn'});
  }

  reset = _ => {
    initWorld();
    this.setState({tau: world.time })
  }

  selectQuality = ev => {
    quality = quality_levels[ev.target.selectedIndex];
    refreshWindow();
  }

  goToGithub = _ => {
    window.location.href = "https://github.com/potocpav/general-relativity";
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
    <div id="toolbar">
      <div id="right_side">
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
      <div id="left_side">
        <div>
          <button class=${this.state.tool == 'boost' ? "clicked" : ""} onClick=${this.activateBoost}>Boost</button>
          <button class=${this.state.tool == 'spawn' ? "clicked" : ""} onClick=${this.activateSpawn}>Spawn</button>
        </div>
        <div>
          <button onClick=${this.reset}>${printTime(this.state.tau)}</button>
          <button>${print3Vec(this.state.obsvX)}</button>
        </div>
        <div>
          <button>${printVelocity(this.state.obsvX, this.state.obsvU)}</button>
          <button>${this.state.fps + " FPS"}</button>
        </div>
      </div>
    </div>
    <canvas
      id="canvas"
      onPointerMove=${this.onPointerMove}
      onPointerDown=${this.onPointerDown}
      onPointerUp=${this.onPointerUp}
      onWheel=${this.onWheel}
      />
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
