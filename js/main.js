// Greetings to Iq/RGBA! ;)

import * as renderer from './renderer.js';
import * as math from './math.js';
import { World } from './world.js';
import { ObjectInfo, shipId, shipThrustingId, asteroidId } from './object-info.js';
import { Trajectories } from './trajectories.js';
import { Trajectory } from './trajectory.js';
import { velocity3, Schwarzschild } from './metric.js';

var quality = 4, quality_levels = [1, 2, 4, 8];
var toolbar;
var boostButton, spawnButton;
var timeButton, obsvXButton, obsvUButton;
var githubButton, fullscreenButton;
var mouseWorldX;

const rs = 0.01;
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
  tool: 'boost',
};

function initWorld() {
  const x = nj.array([0, 30 * rs, 0]);
  const u2 = nj.array([0, 0.08]);

  world.viewportSize = 1.5;
  world.timeScale = 1.0;
  world.rs = rs;

  world.startTime = Date.now();
  world.obsvX = x;
  world.obsvU = velocity3(metric, x, u2);
  world.obsvO = nj.array([0.0, 1.0]);
  mouseWorldX = nj.array([0.0, 0.0, 0.0]);
  world.eventX = nj.array([0.0, 0.0, 0.0]);

  // objects
  const asteroid_x0 = nj.array([0, 25 * rs, 0.0]);
  const asteroid_v0 = nj.array([0.0, -0.12]);
  asteroid = new Trajectory(metric, asteroidId, asteroid_x0, velocity3(metric, asteroid_x0, asteroid_v0))
  trajectories.add(asteroid);
}

startup().then(() => {
  initWorld();
  animate();
});

async function startup() {
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  gl = renderer.initGl(canvas);

  world = new World(gl, metric);

  objectInfo = new ObjectInfo(gl);
  await objectInfo.initialize();

  trajectories = new Trajectories(gl);

  await renderer.init(gl, world, objectInfo, trajectories);

  toolbar = createToolbar();

  // event listeners
  initEventListeners();
}

function initEventListeners() {
  document.addEventListener('pointermove', function (event) {
    params.mousePos = nj.array([event.clientX, window.innerHeight - event.clientY]);
  }, false);

  document.addEventListener('pointerdown', (event) => {
    params.mousePos = nj.array([event.clientX, window.innerHeight - event.clientY]);

    if (params.tool == 'boost') {
      params.pointerDn = true;
    }

    if (params.tool == 'spawn') {
      const mouseWorldX = world.getWorldPos(params.mousePos, params.screenDim);
      const asteroid_v0 = nj.array([0.0, 0.0]);
      asteroid = new Trajectory(metric, asteroidId, mouseWorldX, velocity3(metric, mouseWorldX, asteroid_v0))
      trajectories.add(asteroid);
    }
  });

  document.addEventListener('pointerup', (event) => {
    params.pointerDn = false;
  });

  document.addEventListener('wheel', (event) => {
    world.viewportSize *= Math.exp(event.deltaY / 500);

  }, false);

  onWindowResize();
  window.addEventListener('resize', onWindowResize, false);
}

function createToolbar() {
  toolbar = document.createElement('div');
  toolbar.id = 'toolbar';
  toolbar.style.position = 'absolute';
  toolbar.style.top = '0px';
  toolbar.style.padding = '25px';
  toolbar.style.paddingTop = 'max(25px, env(safe-area-inset-top))'; // handle hole-punch camera & notch
  toolbar.style.width = '100%';
  document.body.appendChild(toolbar);

  var rightside = document.createElement('div');
  rightside.style.cssFloat = 'right';
  toolbar.appendChild(rightside);

  githubButton = document.createElement('img');
  githubButton.src = 'img/github-mark-white.svg';
  githubButton.title = 'Go to GitHub Repository';
  githubButton.addEventListener('click', function (event) {
    window.location.href = "https://github.com/potocpav/general-relativity";
  }, false);
  rightside.appendChild(githubButton);

  fullscreenButton = document.createElement('img');
  fullscreenButton.src = 'img/fullscreen.svg';
  fullscreenButton.title = 'Press F11 to enter or leave fullscreen mode';
  fullscreenButton.addEventListener('click', function (event) {
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
  }, false);
  rightside.appendChild(fullscreenButton);

  boostButton = document.createElement('button');
  boostButton.textContent = 'boost';

  spawnButton = document.createElement('button');
  spawnButton.textContent = 'spawn';

  toolbar.appendChild(boostButton);
  boostButton.classList.add("clicked");
  boostButton.addEventListener('click', e => {
    params.tool = 'boost';
    spawnButton.classList.remove("clicked");
    boostButton.classList.add("clicked");
    e.preventDefault();
  }, false);

  toolbar.appendChild(spawnButton);
  spawnButton.addEventListener('click', e => {
    params.tool = 'spawn';
    boostButton.classList.remove("clicked");
    spawnButton.classList.add("clicked");
    e.preventDefault();
  }, false);

  timeButton = document.createElement('button');
  timeButton.textContent = '0:00.00';
  timeButton.addEventListener('click', e => {
    initWorld();
    e.preventDefault();
  }, false);
  toolbar.appendChild(timeButton);

  obsvXButton = document.createElement('button');
  toolbar.appendChild(obsvXButton);

  obsvUButton = document.createElement('button');
  toolbar.appendChild(obsvUButton);

  var select = document.createElement('select');

  for (var i = 0; i < quality_levels.length; i ++) {
    var option = document.createElement('option');
    option.textContent = quality_levels[i] + 'x';
    if (quality_levels[i] == quality) option.selected = true;
    select.appendChild(option);
  }

  select.addEventListener('change', function (event) {
    quality = quality_levels[event.target.selectedIndex];
    onWindowResize();
  }, false);

  toolbar.appendChild(select);
  return toolbar;
}

function onWindowResize() {
  canvas.width = window.innerWidth / quality;
  canvas.height = window.innerHeight / quality;
  renderer.initializeWindow(canvas.width, canvas.height);
  params.screenDim = nj.array([window.innerWidth, window.innerHeight]);
}

function animate() {
  requestAnimationFrame(() => animate());
  world.update(params.mousePos, params.pointerDn, params.screenDim);
  renderUi();
  renderer.render();
}

function renderUi() {
  timeButton.textContent = printTime(world.time);
  obsvXButton.textContent = "X: " + print3Vec(world.obsvX);
  obsvUButton.textContent = "U: " + print3Vec(world.obsvU);
}

function printTime(s) {
  const minutes = Math.floor(s / 60);
  const seconds = (s % 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${seconds}`;
}

function print3Vec(x) {
  return `${x.get(0).toFixed(2)}, ${x.get(1).toFixed(2)}, ${x.get(2).toFixed(2)}`;
}
