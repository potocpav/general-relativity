// Greetings to Iq/RGBA! ;)

var quality = 4, quality_levels = [1, 2, 4, 8];
var toolbar;
var timeButton, obsvXButton, obsvUButton;
var fullscreenButton;
var canvas, gl, surfaceBuffer, vertexPosition, screenVertexPosition;
var frontTarget, backTarget;
// Minkowski metric
const nu = nj.array([[-1, 0, 0], [0, 1, 0], [0, 0, 1]]);

// Schwarzschield (t, r, phi) metric tensor and Christoffel symbols

const rs = 0.01;

const g = (x) => {
  r = x.get(1);
  return nj.array([[-(1 - rs / r), 0, 0], [0, 1 / (1 - rs / r), 0], [0, 0, r * r]]);
}

const Gamma0 = (x) => {
  const r = x.get(1);
  return nj.array([
    [0.0, rs / (2.0 * r * (r - rs)), 0.0],
    [rs / (2.0 * r * (r - rs)), 0.0, 0.0],
    [0.0, 0.0, 0.0]
  ]);
}
const Gamma1 = (x) => {
  const r = x.get(1);
  return nj.array([
    [rs * (r - rs) / (2.0 * r*r*r), 0.0, 0.0],
    [0.0, -rs / (2.0 * r * (r - rs)), 0.0],
    [0.0, 0.0, rs - r]
  ]);
}
const Gamma2 = (x) => {
  const r = x.get(1);
  return nj.array([
    [0.0, 0.0, 0.0],
    [0.0, 0.0, 1.0 / r],
    [0.0, 1.0 / r, 0.0]
  ]);
}

// 3-velocity from 2-velocity (ds = -1)
// (supposing diagonal metric tensor)
const Velocity3 = (x, u2) => {
  const [ux, uy] = u2.tolist();
  const gx = g(x);

  return nj.array([Math.sqrt(-(1 + gx.get(1,1) * ux*ux + gx.get(2,2) * uy*uy) / gx.get(0,0)), ux, uy]);
}

const inverse = (m) => {
  var [[a, b], [c, d]] = m.tolist();
  return nj.array([[d, -b], [-c, a]]).divide(a * d - b * c);
}

const cart2polar = (r, phi, x) => {
	const A = nj.array([[Math.cos(phi), -r * Math.sin(phi)], [Math.sin(phi), r * Math.cos(phi)]]);
	return inverse(A).dot(x);
}

// Geodesic ODE arount x0, solving for [v^mu, x^mu] 6-vector
const geo_f = (ux) => {
  const u = ux.slice([0, 3]), x = ux.slice([3, 6]);
  return nj.array([
    -Gamma0(x).dot(u).dot(u).get(0),
    -Gamma1(x).dot(u).dot(u).get(0),
    -Gamma2(x).dot(u).dot(u).get(0),
    u.get(0),
    u.get(1),
    u.get(2)
  ]);
}

const rk4 = (f, y, h) => {
  const k1 = f(y);
  const k2 = f(y.add(k1.multiply(h/2)));
  const k3 = f(y.add(k2.multiply(h/2)));
  const k4 = f(y.add(k3.multiply(h)));
  return y.add(k1.add(k2.multiply(2)).add(k3.multiply(2)).add(k4).multiply((h / 6)));
}

var params = {
  mouseX: 0.5,
  mouseY: 0.5,
  screenWidth: 0,
  screenHeight: 0,
};

function initialize() {
  const x = nj.array([0, 30 * rs, 0]);
  const u = nj.array([0, 0.08]);

  params.screenSize = 2.5;
  params.timeScale = 1.0;
  params.rs = rs;

  params.startTime = Date.now();
  params.time = 0;
  params.obsvX = x;
  params.obsvU = Velocity3(x, cart2polar(x.get(1), x.get(2), u));
}

initialize();

function physics() {
  // physics
  const t = (Date.now() - params.startTime) / 1000;
  const dt = Math.max(0.01, Math.min(0.1, t - params.time)) * params.timeScale;
  params.time = t;

  const UX = nj.concatenate(params.obsvU, params.obsvX);
  const UX1 = rk4(geo_f, UX, dt);

  params.obsvU = UX1.slice([0, 3]);
  params.obsvX = UX1.slice([3, 6]);

}

async function init() {
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  gl = initGl(canvas);

  toolbar = createToolbar();

  var clientXLast, clientYLast;

  document.addEventListener('pointermove', function (event) {
    var clientX = event.clientX;
    var clientY = event.clientY;

    if (clientXLast == clientX && clientYLast == clientY)
      return;

    clientXLast = clientX;
    clientYLast = clientY;

    stopHideUI(toolbar);

    params.mouseX = clientX / window.innerWidth;
    params.mouseY = 1 - clientY / window.innerHeight;
  }, false);

  document.addEventListener('wheel', (event) => {
    params.screenSize *= Math.exp(event.deltaY / 500);
    // params.timeScale *= Math.exp(-event.deltaX / 500);
  }, false);

  onWindowResize();
  window.addEventListener('resize', onWindowResize, false);

  tex = await loadTexture("models/render/asteroid.png");
  console.log(tex);

  // fetch shaders
  const surfaceVert = await fetch("glsl/surface-vert.glsl").then(r => r.text());
  const surfaceFrag = await fetch("glsl/surface-frag.glsl").then(r => r.text());
  const screenVert = await fetch("glsl/screen-vert.glsl").then(r => r.text());
  const screenFrag = await fetch("glsl/screen-frag.glsl").then(r => r.text());

  glContext = {
    surfaceProgram: compileSurfaceProgram(surfaceVert, surfaceFrag),
    screenProgram: compileScreenProgram(screenVert, screenFrag),
  };

  return glContext;
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

  timeButton = document.createElement('button');
  timeButton.textContent = '0:00.00';
  timeButton.addEventListener('click', function (event) {
    initialize();
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

var hideUITimer;
var isUIHidden = false;

function startHideUITimer (toolbar) {
  stopHideUITimer();
  if (!isUIHidden)
    hideUITimer = window.setTimeout(onHideUITimer, 1000 * 3);

  function onHideUITimer() {
    stopHideUITimer();

    if (!isUIHidden) {
      isUIHidden = true;
      toolbar.style.opacity = '0';
      document.body.style.cursor = 'none';
    }
  }

  function stopHideUITimer () {
    if (hideUITimer) {
      window.clearTimeout(hideUITimer);
      hideUITimer = 0;
    }
  }
}

function stopHideUI (toolbar) {
  if (isUIHidden) {
    isUIHidden = false;
    toolbar.style.opacity = '1';
    document.body.style.cursor = '';
  }
  startHideUITimer(toolbar);
}

function onWindowResize(event) {
  canvas.width = window.innerWidth / quality;
  canvas.height = window.innerHeight / quality;

  params.screenWidth = canvas.width;
  params.screenHeight = canvas.height;

  if (gl) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    frontTarget = createTarget(params.screenWidth, params.screenHeight);
    backTarget = createTarget(params.screenWidth, params.screenHeight);
  }
}

function animate(glContext) {
  requestAnimationFrame(() => animate(glContext));
  physics();

  renderUi();

  render(glContext, frontTarget, backTarget);
  [frontTarget, backTarget] = [backTarget, frontTarget];
}

function renderUi() {
  timeButton.textContent = printTime(params.time);
  obsvXButton.textContent = "X: " + print3Vec(params.obsvX);
  obsvUButton.textContent = "U: " + print3Vec(params.obsvU);
}

function printTime(s) {
  const minutes = Math.floor(s / 60);
  const seconds = (s % 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${seconds}`;
}

function print3Vec(x) {
  return `${x.get(0).toFixed(2)}, ${x.get(1).toFixed(2)}, ${x.get(2).toFixed(2)}`;
}

// creates a texture info { width: w, height: h, frames: f, texture: tex }
async function loadTexture(url) {
  const loadPromise = new Promise((resolve) => {
    var img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.src = url;
  });
  img = x = await loadPromise;

  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);

  const w = img.width;
  const h = w % img.height;
  const f = img.height / w;

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

  return {
    width: w,
    height: h,
    frames: f,
    texture: tex,
  };
}

init().then(glContext => {
  params.startTime = Date.now();
  animate(glContext);
});
