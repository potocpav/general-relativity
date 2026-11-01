import { fetchText, physicsFragmentShader } from './shaders.js';

var gl;
var EXT_color_buffer_float;

var world;
var objectInfo;
var trajectories;

var surfaceProgram, screenProgram;
var surfaceVert, surfaceFragMain;
var vertexBuffer;

var screenWidth, screenHeight;
var target;

// Returns null if WebGL 2 is not available.
export function initGl(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
  if (!gl) return null;

  EXT_color_buffer_float = gl.getExtension('EXT_color_buffer_float');
  if (!EXT_color_buffer_float) {
    console.warn("HDR not supported");
  }
  return gl;
}

export async function init(gl_, world_, objectInfo_, trajectories_, metric) {
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
  var screenVert, screenFrag;
  [surfaceVert, surfaceFragMain, screenVert, screenFrag] = await Promise.all([
    "glsl/surface-vert.glsl", "glsl/surface-frag.glsl", "glsl/screen-vert.glsl", "glsl/screen-frag.glsl",
  ].map(fetchText));

  await setMetric(metric);

  screenProgram = compileProgram(screenVert, screenFrag);
  cacheUniformLocation(screenProgram, 'resolution');
  cacheUniformLocation(screenProgram, 'color');
}

// (Re)compile the raytracing program for `metric`.
export async function setMetric(metric) {
  const program = compileProgram(surfaceVert, await physicsFragmentShader(surfaceFragMain, metric));
  cacheUniformLocation(program, 'resolution');
  world.compile(program);
  trajectories.compile(program);
  objectInfo.compile(program);
  if (surfaceProgram) gl.deleteProgram(surfaceProgram);
  surfaceProgram = program;
}

// Compile & link a program, throwing on failure. Leaves the program in use.
function compileProgram(vertex, fragment) {
  const program = gl.createProgram();

  const vs = createShader(vertex, gl.VERTEX_SHADER);
  const fs = createShader(fragment, gl.FRAGMENT_SHADER);

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);

  gl.linkProgram(program);

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Shader program failed to link: ' + gl.getProgramInfoLog(program));
  }

  gl.useProgram(program);

  program.vertexPosition = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(program.vertexPosition);
  return program;
}

export function initializeWindow(width, height) {
  console.assert(gl);
  screenWidth = width;
  screenHeight = height;
  gl.viewport(0, 0, width, height);
  if (target) {
    gl.deleteFramebuffer(target.framebuffer);
    gl.deleteTexture(target.texture);
  }
  target = createTarget(width, height);
}

function createTarget(width, height) {
  const target = {};

  target.framebuffer = gl.createFramebuffer();
  target.texture = gl.createTexture();

  // set up framebuffer
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  // enable HDR rendering if supported
  if (EXT_color_buffer_float) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status != gl.FRAMEBUFFER_COMPLETE) {
    console.error("Framebuffer incomplete: 0x" + status.toString(16));
  }

  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return target;
}

function createShader(src, type) {
  const shader = gl.createShader(type);

  gl.shaderSource(shader, src);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader).trimEnd();
    gl.deleteShader(shader);
    throw new Error('Shader failed to compile: ' + error);
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
  gl.vertexAttribPointer(surfaceProgram.vertexPosition, 2, gl.FLOAT, false, 0, 0);

  world.render();
  trajectories.render();
  objectInfo.render();

  // Render custom shader to target buffer (covers the whole target, no clear needed)
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Set uniforms for screen shader

  gl.useProgram(screenProgram);

  gl.uniform2f(screenProgram.uniformsCache['resolution'], screenWidth, screenHeight);
  gl.uniform1i(screenProgram.uniformsCache['color'], 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.vertexAttribPointer(screenProgram.vertexPosition, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, target.texture);

  // Render front buffer to screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}
