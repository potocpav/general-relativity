// Greetings to Iq/RGBA! ;)

var quality = 4, quality_levels = [1, 2, 4, 8];
var toolbar;
var timeButton, obsvXButton, obsvUButton;
var fullscreenButton;
var canvas, gl, surfaceBuffer, vertexPosition, screenVertexPosition;
var objectInfoUboLocation, objectInfoUboBlockSize, objectInfoUboBuffer, objectInfoUboVariableInfo;
var frontTarget, backTarget;
var objectTextures;

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

// Transform metric at point x to Minkowski metric
function T(x) {
	gx = g(x);
	return nj.array([
		[Math.sqrt(-gx.get(0,0)), 0.0, 0.0],
		[0.0, Math.sqrt(gx.get(1,1)), 0.0],
		[0.0, 0.0, Math.sqrt(gx.get(2,2))],
  ]);
}

function inverse_diag3(m) {
	return nj.array([
		[1 / m.get(0,0), 0, 0],
		[0, 1 / m.get(1,1), 0],
		[0, 0, 1 / m.get(2,2)]]);
}

// Lorentz boost
function boost(u) {
	const fac = (u.get(0) - 1.0) / (u.get(1)*u.get(1) + u.get(2)*u.get(2));
	return nj.array([
		[u.get(0), -u.get(1), -u.get(2)],
		[-u.get(1), 1.0 + fac * u.get(1)*u.get(1), fac * u.get(1)*u.get(2)],
		[-u.get(2), fac * u.get(1)*u.get(2), 1.0 + fac * u.get(2)*u.get(2)],
  ]);
}

function neg_u(u) {
	return nj.array([u.get(0), -u.get(1), -u.get(2)]);
}

function general_boost(Tx, u) {
  return inverse_diag3(Tx).dot(boost(Tx.dot(u))).dot(Tx);
}

// 3-velocity from 2-velocity (ds = -1)
// (supposing diagonal metric tensor)
const Velocity3 = (x, u2_cart) => {
  const u2 = cart2polar(x.get(1), x.get(2), u2_cart);
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
const geo_f = (accel_rest) => (xu) => {
  const x = xu.slice([0, 3]), u = xu.slice([3, 6]);
  const accel = general_boost(T(x), neg_u(u)).dot(accel_rest);
  return nj.array([
    u.get(0),
    u.get(1),
    u.get(2),
    -Gamma0(x).dot(u).dot(u).get(0) + accel.get(0),
    -Gamma1(x).dot(u).dot(u).get(0) + accel.get(1),
    -Gamma2(x).dot(u).dot(u).get(0) + accel.get(2),
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
  mouseX: undefined,
  mouseY: undefined,
  pointerDn: false,
  screenWidth: 0,
  screenHeight: 0,
};

function initialize() {
  const x = nj.array([0, 30 * rs, 0]);
  const u2 = nj.array([0, 0.08]);

  params.screenSize = 2.5;
  params.timeScale = 1.0;
  params.rs = rs;

  params.startTime = Date.now();
  params.time = 0;
  params.obsvX = x;
  params.obsvU = Velocity3(x, u2);
  params.obsvO = nj.array([0.0, 1.0]);
}

initialize();

function physics() {
  // physics
  const t = (Date.now() - params.startTime) / 1000;
  const dt = Math.max(0.01, Math.min(0.1, t - params.time)) * params.timeScale;
  params.time = t;

  // rocket motor
  var accel3_rest = nj.array([0,0,0]);
  const acceleration = 0.5;
  if (params.mouseX !== undefined) {
    params.obsvO = nj.array([0.0, 1.0]);
    const mouse_rel = nj.array([0.5 - params.mouseX, 0.5 - params.mouseY]);
    const accel2 = mouse_rel.multiply(acceleration/Math.sqrt(mouse_rel.dot(mouse_rel).get(0)));
    const accelPolar = cart2polar(params.obsvX.get(1), params.obsvX.get(2), accel2);
    params.obsvO = accelPolar;
    if (params.pointerDn)
      accel3_rest = nj.array([0, accelPolar.get(0), accelPolar.get(1)]);
  }

  const XU = nj.concatenate(params.obsvX, params.obsvU);
  const XU1 = rk4(geo_f(accel3_rest), XU, dt);

  params.obsvX = XU1.slice([0, 3]);
  params.obsvU = XU1.slice([3, 6]);
}

obj_xs = nj.array([0, 25 * rs, 0.0]);
asteroid_freefall = sim_freefall(1000, obj_xs, Velocity3(obj_xs, [0.0, -0.12]), 2);

function sim_freefall(n, x0, u0, obj_i) {
  const dt = 0.1;
  var xs = new Float32Array(n*3), us = new Float32Array(n*3), it = new Float32Array(n*2);
  var xu = nj.concatenate(x0, u0);
  var tau = 0.0;
  for (i = 0; i < n; i++) {
    if (i > 0) {
      xu = rk4(geo_f(nj.array([0,0,0])), xu, dt);
      tau += dt;
    }
    xs[i*3 + 0] = xu.get(0);
    xs[i*3 + 1] = xu.get(1);
    xs[i*3 + 2] = xu.get(2);
    us[i*3 + 0] = xu.get(3);
    us[i*3 + 1] = xu.get(4);
    us[i*3 + 2] = xu.get(5);
    it[i*2 + 0] = obj_i;
    it[i*2 + 1] = tau;
  }
  return {"xs": xs, "us": us, "it": it, "n": n};
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

    if (clientXLast != clientX || clientYLast != clientY)
      stopHideUI(toolbar);

    clientXLast = clientX;
    clientYLast = clientY;

    params.mouseX = clientX / window.innerWidth;
    params.mouseY = 1 - clientY / window.innerHeight;
  }, false);

  document.addEventListener('pointerdown', (event) => {
    params.pointerDn = true;
    params.mouseX = event.clientX / window.innerWidth;
    params.mouseY = 1 - event.clientY / window.innerHeight;
  });

  document.addEventListener('pointerup', (event) => {
    params.pointerDn = false;
  });

  document.addEventListener('wheel', (event) => {
    params.screenSize *= Math.exp(event.deltaY / 500);
    // params.timeScale *= Math.exp(-event.deltaX / 500);
  }, false);

  onWindowResize();
  window.addEventListener('resize', onWindowResize, false);

  tex = await loadSpriteTexture("models/sprites.png", 64*2, 64, 60);
  params.spriteTexture = tex;

  // fetch shaders
  const surfaceVert = await fetch("glsl/surface-vert.glsl").then(r => r.text());
  const surfaceFrag = await fetch("glsl/surface-frag.glsl").then(r => r.text());
  const screenVert = await fetch("glsl/screen-vert.glsl").then(r => r.text());
  const screenFrag = await fetch("glsl/screen-frag.glsl").then(r => r.text());

  objectTextures = initObjectSamplers();
  makeTestObject(objectTextures, asteroid_freefall);

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
    hideUITimer = window.setTimeout(onHideUITimer, 1000 * 2);

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

// creates a 3D texture info from an URL with a given width, height and depth
async function loadSpriteTexture(url, width, height, depth) {
  const loadPromise = new Promise((resolve) => {
    var img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.src = url;
  });
  img = x = await loadPromise;

  if (img.width * img.height != width * height * depth) {
    console.error("Image has unexpected number of pixels.", [img.width, img.height], [width, height, depth]);
  }

  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA, width, height, depth, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  return tex;
}

function initObjectSamplers() {
  var tex_x = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex_x);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

  var tex_u = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex_u);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);


  var tex_it = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex_it);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

  gl.bindTexture(gl.TEXTURE_2D, null);
  return {
    tex_x: tex_x,
    tex_u: tex_u,
    tex_it: tex_it
  };
}

function makeTestObject(objTextures, data) {
  const nObjects = 1;
  const nPoints = data.n;
  gl.bindTexture(gl.TEXTURE_2D, objTextures.tex_x);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, nObjects, nPoints, 0, gl.RGB, gl.FLOAT,
    new Float32Array(data.xs));

  gl.bindTexture(gl.TEXTURE_2D, objTextures.tex_u);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, nObjects, nPoints, 0, gl.RGB, gl.FLOAT,
    new Float32Array(data.us));

  gl.bindTexture(gl.TEXTURE_2D, objTextures.tex_it);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, nObjects, nPoints, 0, gl.RG, gl.FLOAT,
    new Float32Array(data.it));

  gl.bindTexture(gl.TEXTURE_2D, null);
}

init().then(glContext => {
  params.startTime = Date.now();
  animate(glContext);
});
