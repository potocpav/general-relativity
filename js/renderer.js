
var gl;

var world;
var objectInfo;
var trajectories;

var surfaceProgram, screenProgram;
var vertexBuffer;
var vertexPosition;
var screenVertexPosition;

var screenWidth, screenHeight;
var frontTarget, backTarget;

export function initGl (canvas) {
  var gl;
  try {
    gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  } catch(error) { }

  if (gl) {

  } else {
    alert('WebGL not supported.');
  }
  return gl;
}

export async function init(gl_, world_, objectInfo_, trajectories_) {
  gl = gl_;
  world = world_;
  objectInfo = objectInfo_;
  trajectories = trajectories_;

  const surfaceCorners = new Float32Array([
    -1.0, -1.0, 1.0, -1.0, -1.0, 1.0,
    1.0, -1.0, 1.0, 1.0, -1.0, 1.0,
    ]);

  vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, surfaceCorners, gl.STATIC_DRAW);

  // fetch shaders
  const surfaceVert = await fetch("glsl/surface-vert.glsl").then(r => r.text());
  const surfaceFrag = await fetch("glsl/surface-frag.glsl").then(r => r.text());
  const screenVert = await fetch("glsl/screen-vert.glsl").then(r => r.text());
  const screenFrag = await fetch("glsl/screen-frag.glsl").then(r => r.text());

  surfaceProgram = compileSurfaceProgram(surfaceVert, surfaceFrag);
  screenProgram = compileScreenProgram(screenVert, screenFrag);
}

function compileSurfaceProgram(vertex, fragment) {
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
    var error = gl.getProgramInfoLog(program);
    console.error(error);
    console.error('VALIDATE_STATUS: ' + gl.getProgramParameter(program, gl.VALIDATE_STATUS), 'ERROR: ' + gl.getError());
    return;
  }

  // Cache uniforms
  cacheUniformLocation(program, 'resolution');
  cacheUniformLocation(program, 'screen_size');

  world.compile(program);
  trajectories.compile(program);
  objectInfo.compile(program);

  // Load program into GPU
  gl.useProgram(program);

  // Set up buffers
  vertexPosition = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(vertexPosition);
  return program;
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
    console.error('VALIDATE_STATUS: ' + gl.getProgramParameter(program, gl.VALIDATE_STATUS), 'ERROR: ' + gl.getError());
    return;
  }

  gl.useProgram(program);

  cacheUniformLocation(program, 'resolution');
  cacheUniformLocation(program, 'color');

  screenVertexPosition = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(screenVertexPosition);

  return program;
}

export function initializeWindow(width, height) {
  console.assert(gl);
  screenWidth = width;
  screenHeight = height;
  gl.viewport(0, 0, width, height);
  frontTarget = createTarget(width, height);
  backTarget = createTarget(width, height);
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
  gl.bindBuffer(gl.UNIFORM_BUFFER, null);

  return target;
}

function createShader(src, type) {
  var shader = gl.createShader(type);

  gl.shaderSource(shader, src);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    var error = gl.getShaderInfoLog(shader);

    // Remove trailing linefeed, for FireFox's benefit.
    while ((error.length > 1) && (error.charCodeAt(error.length - 1) < 32)) {
      error = error.substring(0, error.length - 1);
    }

    console.error(src, error);
    return null;
  }
  return shader;
}

function cacheUniformLocation(program, label) {
  if (program.uniformsCache === undefined) {
    program.uniformsCache = {};
  }
  program.uniformsCache[label] = gl.getUniformLocation(program, label);
}

export function render() {
  // Set uniforms for surface shader
  gl.useProgram(surfaceProgram);

  gl.uniform2f(surfaceProgram.uniformsCache['resolution'], screenWidth, screenHeight);

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.vertexAttribPointer(vertexPosition, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, backTarget.texture);

  world.render();
  trajectories.render();
  objectInfo.render();

  gl.bindBuffer(gl.UNIFORM_BUFFER, null);

  // Render custom shader to front buffer

  gl.bindFramebuffer(gl.FRAMEBUFFER, frontTarget.framebuffer);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Set uniforms for screen shader

  gl.useProgram(screenProgram);

  gl.uniform2f(screenProgram.uniformsCache['resolution'], screenWidth, screenHeight);
  gl.uniform1i(screenProgram.uniformsCache['color'], 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.vertexAttribPointer(screenVertexPosition, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, frontTarget.texture);

  // Render front buffer to screen

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  [frontTarget, backTarget] = [backTarget, frontTarget];
}
