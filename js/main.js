// Greetings to Iq/RGBA! ;)

var quality = 2, quality_levels = [1, 2, 4, 8];
var toolbar;
var showButton, timeButton, obsvXButton, obsvUButton;
var compileButton, fullscreenButton, compileTimer, errorLines = [];
var code, canvas, gl, buffer, currentProgram, vertexPosition, screenVertexPosition;
var surface = { centerX: 0, centerY: 0, width: 1, height: 1 };
var frontTarget, backTarget, screenProgram, getWebGL, compileOnChangeCode = true;
var surfaceVertexShader;

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

const initialObsvX = nj.array([0.0, 30 * rs, 0.0]);
const initialObsvU = Velocity3(initialObsvX, cart2polar(
  initialObsvX.get(1),
  initialObsvX.get(2),
  nj.array([0.0, 0.08])
  ));

var parameters = {
  startTime: Date.now(),
  time: 0,
  mouseX: 0.5,
  mouseY: 0.5,
  screenWidth: 0,
  screenHeight: 0,
  obsvX: initialObsvX,
  obsvU: initialObsvU,
  rs: rs,
  screenSize: 2.5,
  timeScale: 1.0
};

function update() {
  // physics
  const t = (Date.now() - parameters.startTime) / 1000;
  const dt = Math.max(0.01, Math.min(0.1, t - parameters.time)) * parameters.timeScale;
  parameters.time = t;

  const UX = nj.concatenate(parameters.obsvU, parameters.obsvX);
  const UX1 = rk4(geo_f, UX, dt);

  parameters.obsvU = UX1.slice([0, 3]);
  parameters.obsvX = UX1.slice([3, 6]);

}

init();

if (gl) {
  parameters.startTime = Date.now();
  animate();
}

function init() {
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

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

  showButton = document.createElement('button');
  showButton.textContent = 'show code';
  showButton.addEventListener('click', function () {
    isCodeVisible() ? hideCode() : showCode();
  }, false);
  toolbar.appendChild(showButton);

  timeButton = document.createElement('button');
  timeButton.textContent = '0:00.00';
  timeButton.addEventListener('click', function (event) {
    parameters.startTime = Date.now();
  }, false);
  toolbar.appendChild(timeButton);

  obsvXButton = document.createElement('button');
  obsvXButton.addEventListener('click', function (event) {
    parameters.obsvX = initialObsvX;
  }, false);
  toolbar.appendChild(obsvXButton);

  obsvUButton = document.createElement('button');
  obsvUButton.addEventListener('click', function (event) {
    parameters.obsvV = initialObsvU;
  }, false);
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

  compileButton = document.createElement('button');
  compileButton.textContent = 'compiled';
  toolbar.appendChild(compileButton);

  // Initialise WebGL

  try {
    gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  } catch(error) { }

  if (gl) {
    // enable dFdx, dFdy, fwidth
    gl.getExtension('OES_standard_derivatives');

    // Create vertex buffer (2 triangles)

    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([- 1.0, - 1.0, 1.0, - 1.0, - 1.0, 1.0, 1.0, - 1.0, 1.0, 1.0, - 1.0, 1.0]), gl.STATIC_DRAW);

    // Create surface buffer (coordinates at screen corners)

    surface.buffer = gl.createBuffer();
  } else {
    alert('WebGL not supported, but code will be shown.');
  }

  // initialize code editor
  code = CodeMirror(document.body, {
    lineNumbers: true,
    matchBrackets: true,
    indentWithTabs: true,
    tabSize: 8,
    indentUnit: 8,
    mode: "text/x-glsl",
    onChange: function () {
      if (compileOnChangeCode) {
        clearTimeout(compileTimer);
        compileTimer = setTimeout(compile, 500);
      }
    }
  });

  var clientXLast, clientYLast;

  document.addEventListener('pointermove', function (event) {
    var clientX = event.clientX;
    var clientY = event.clientY;

    if (clientXLast == clientX && clientYLast == clientY)
      return;

    clientXLast = clientX;
    clientYLast = clientY;

    stopHideUI();

    parameters.mouseX = clientX / window.innerWidth;
    parameters.mouseY = 1 - clientY / window.innerHeight;
  }, false);

  document.addEventListener('wheel', (event) => {
    parameters.screenSize *= Math.exp(event.deltaY / 500);
    // parameters.timeScale *= Math.exp(-event.deltaX / 500);
  }, false);

  onWindowResize();
  window.addEventListener('resize', onWindowResize, false);

  // fetch shaders

  fetch("glsl/surface-frag.glsl")
    .then((response) => response.text())
    .then((text) => code.setValue(text));

  const screenVert = fetch("glsl/screen-vert.glsl").then((response) => response.text());
  const screenFrag = fetch("glsl/screen-frag.glsl").then((response) => response.text());
  Promise.all([screenVert, screenFrag])
    .then(([vert, frag]) => compileScreenProgram(vert, frag));

  fetch("glsl/surface-vert.glsl")
    .then((response) => response.text())
    .then((text) => surfaceVertexShader = text);

  hideCode();
}

function showCode() {
  showButton.textContent = 'hide code';
  code.getWrapperElement().style.visibility = 'visible';
  compileButton.style.visibility = 'visible';
}

function hideCode() {
  showButton.textContent = 'show code';
  code.getWrapperElement().style.visibility = 'hidden';
  compileButton.style.visibility = 'hidden';
  stopHideUI();
}

function isCodeVisible() {
  return code && code.getWrapperElement().style.visibility === 'visible';
}

var hideUITimer;
var isUIHidden = false;

function startHideUITimer () {
  stopHideUITimer();
  if (!isUIHidden && !isCodeVisible())
    hideUITimer = window.setTimeout(onHideUITimer, 1000 * 3);

  function onHideUITimer() {
    stopHideUITimer();

    if (!isUIHidden && !isCodeVisible()) {
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

function stopHideUI () {

  if (isUIHidden) {

    isUIHidden = false;
    toolbar.style.opacity = '1';
    document.body.style.cursor = '';
  }
  startHideUITimer();
}


function computeSurfaceCorners() {
  if (gl) {
    surface.width = surface.height * parameters.screenWidth / parameters.screenHeight;

    var halfWidth = surface.width * 0.5, halfHeight = surface.height * 0.5;

    gl.bindBuffer(gl.ARRAY_BUFFER, surface.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      surface.centerX - halfWidth, surface.centerY - halfHeight,
      surface.centerX + halfWidth, surface.centerY - halfHeight,
      surface.centerX - halfWidth, surface.centerY + halfHeight,
      surface.centerX + halfWidth, surface.centerY - halfHeight,
      surface.centerX + halfWidth, surface.centerY + halfHeight,
      surface.centerX - halfWidth, surface.centerY + halfHeight]), gl.STATIC_DRAW);
  }
}

function resetSurface() {
  surface.centerX = surface.centerY = 0;
  surface.height = 1;
  computeSurfaceCorners();
}

function compile() {
  var program = gl.createProgram();
  var fragment = code.getValue();
  var vertex = surfaceVertexShader;

  var vs = createShader(vertex, gl.VERTEX_SHADER);
  var fs = createShader(fragment, gl.FRAGMENT_SHADER);

  if (vs == null || fs == null) return null;

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {

    showCode();

    var error = gl.getProgramInfoLog(program);

    compileButton.title = error;
    console.error(error);

    console.error('VALIDATE_STATUS: ' + gl.getProgramParameter(program, gl.VALIDATE_STATUS), 'ERROR: ' + gl.getError());
    compileButton.style.color = '#ff0000';
    compileButton.textContent = 'errors';

    return;
  }

  if (currentProgram) {
    gl.deleteProgram(currentProgram);
  }

  currentProgram = program;

  compileButton.style.color = '#00ff00';
  compileButton.textContent = 'compiled';

  // Cache uniforms

  cacheUniformLocation(program, 'time');
  cacheUniformLocation(program, 'mouse');
  cacheUniformLocation(program, 'resolution');
  cacheUniformLocation(program, 'backbuffer');
  cacheUniformLocation(program, 'surfaceSize');
  cacheUniformLocation(program, 'obsv_x');
  cacheUniformLocation(program, 'obsv_u');
  cacheUniformLocation(program, 'screen_size');
  cacheUniformLocation(program, 'rs');

  // Load program into GPU

  gl.useProgram(currentProgram);

  // Set up buffers

  vertexPosition = gl.getAttribLocation(currentProgram, "position");
  gl.enableVertexAttribArray(vertexPosition);
}

function compileScreenProgram(vertex, fragment) {
  if (!gl) { return; }

  var program = gl.createProgram();

  var vs = createShader(vertex, gl.VERTEX_SHADER);
  var fs = createShader(fragment, gl.FRAGMENT_SHADER);

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {

    showCode();

    console.error('VALIDATE_STATUS: ' + gl.getProgramParameter(program, gl.VALIDATE_STATUS), 'ERROR: ' + gl.getError());

    return;

  }

  screenProgram = program;

  gl.useProgram(screenProgram);

  cacheUniformLocation(program, 'resolution');
  cacheUniformLocation(program, 'texture');

  screenVertexPosition = gl.getAttribLocation(screenProgram, "position");
  gl.enableVertexAttribArray(screenVertexPosition);
}

function cacheUniformLocation(program, label) {
  if (program.uniformsCache === undefined) {
    program.uniformsCache = {};
  }
  program.uniformsCache[label] = gl.getUniformLocation(program, label);
}

function createTarget(width, height) {
  var target = {};

  target.framebuffer = gl.createFramebuffer();
  target.renderbuffer = gl.createRenderbuffer();
  target.texture = gl.createTexture();

  // set up framebuffer

  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);

  // set up renderbuffer

  gl.bindRenderbuffer(gl.RENDERBUFFER, target.renderbuffer);

  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, target.renderbuffer);

  // clean up

  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return target;
}

function createRenderTargets() {
  frontTarget = createTarget(parameters.screenWidth, parameters.screenHeight);
  backTarget = createTarget(parameters.screenWidth, parameters.screenHeight);
}

function htmlEncode(str){
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function createShader(src, type) {
  var shader = gl.createShader(type);
  var line, lineNum, lineError, index = 0, indexEnd;

  while (errorLines.length > 0) {
    line = errorLines.pop();
    code.setLineClass(line, null);
    code.clearMarker(line);
  }

  gl.shaderSource(shader, src);
  gl.compileShader(shader);

  compileButton.title = '';

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    showCode();

    var error = gl.getShaderInfoLog(shader);

    // Remove trailing linefeed, for FireFox's benefit.
    while ((error.length > 1) && (error.charCodeAt(error.length - 1) < 32)) {
      error = error.substring(0, error.length - 1);
    }

    compileButton.title = error;
    console.error(error);

    compileButton.style.color = '#ff0000';
    compileButton.textContent = 'errors';

    while (index >= 0) {
      index = error.indexOf("ERROR: 0:", index);
      if (index < 0) { break; }
      index += 9;
      indexEnd = error.indexOf(':', index);
      if (indexEnd > index) {
        lineNum = parseInt(error.substring(index, indexEnd));
        if ((!isNaN(lineNum)) && (lineNum > 0)) {
          index = indexEnd + 1;
          indexEnd = error.indexOf("ERROR: 0:", index);
          lineError = htmlEncode((indexEnd > index) ? error.substring(index, indexEnd) : error.substring(index));
          line = code.setMarker(lineNum - 1, '<abbr title="' + lineError + '">' + lineNum + '</abbr>', "errorMarker");
          code.setLineClass(line, "errorLine");
          errorLines.push(line);
        }
      }
    }
    return null;
  }
  return shader;
}

function onWindowResize(event) {
  canvas.width = window.innerWidth / quality;
  canvas.height = window.innerHeight / quality;

  parameters.screenWidth = canvas.width;
  parameters.screenHeight = canvas.height;

  computeSurfaceCorners();

  if (gl) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    createRenderTargets();
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (!currentProgram) {
    parameters.startTime = Date.now();
    return;
  }
  update();
  render();
}

function render() {
  timeButton.textContent = printTime(parameters.time);
  obsvXButton.textContent = "X: " + print3Vec(parameters.obsvX);
  obsvUButton.textContent = "U: " + print3Vec(parameters.obsvU);

  // Set uniforms for custom shader
  gl.useProgram(currentProgram);

  gl.uniform1f(currentProgram.uniformsCache['time'], parameters.time);
  gl.uniform2f(currentProgram.uniformsCache['mouse'], parameters.mouseX, parameters.mouseY);
  gl.uniform2f(currentProgram.uniformsCache['resolution'], parameters.screenWidth, parameters.screenHeight);
  gl.uniform3f(currentProgram.uniformsCache['obsv_x'], parameters.obsvX.get(0), parameters.obsvX.get(1), parameters.obsvX.get(2));
  gl.uniform3f(currentProgram.uniformsCache['obsv_u'], parameters.obsvU.get(0), parameters.obsvU.get(1), parameters.obsvU.get(2));
  gl.uniform1f(currentProgram.uniformsCache['screen_size'], parameters.screenSize);
  gl.uniform1f(currentProgram.uniformsCache['rs'], parameters.rs);


  gl.uniform1i(currentProgram.uniformsCache['backbuffer'], 0);
  gl.uniform2f(currentProgram.uniformsCache['surfaceSize'], surface.width, surface.height);

  gl.bindBuffer(gl.ARRAY_BUFFER, surface.buffer);
  gl.vertexAttribPointer(surface.positionAttribute, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.vertexAttribPointer(vertexPosition, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, backTarget.texture);

  // Render custom shader to front buffer

  gl.bindFramebuffer(gl.FRAMEBUFFER, frontTarget.framebuffer);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Set uniforms for screen shader

  gl.useProgram(screenProgram);

  gl.uniform2f(screenProgram.uniformsCache['resolution'], parameters.screenWidth, parameters.screenHeight);
  gl.uniform1i(screenProgram.uniformsCache['texture'], 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.vertexAttribPointer(screenVertexPosition, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, frontTarget.texture);

  // Render front buffer to screen

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Swap buffers

  var tmp = frontTarget;
  frontTarget = backTarget;
  backTarget = tmp;
}

function printTime(s) {
  const minutes = Math.floor(s / 60);
  const seconds = (s % 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${seconds}`;
}

function print3Vec(x) {
  return `${x.get(0).toFixed(2)}, ${x.get(1).toFixed(2)}, ${x.get(2).toFixed(2)}`;
}
