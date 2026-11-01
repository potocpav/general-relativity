// Checks that the GLSL physics (glsl/physics.glsl) agrees with its JS
// counterparts. Each test evaluates a GLSL expression on the GPU for a set of
// random inputs and compares the results with the JS implementation.
//
// Results are shown on the page and exposed as `window.testResults`
// for test/run.mjs.

import { fetchText, physicsFragmentShader } from '../js/shaders.js';
import { Schwarzschild, localVelocity3 } from '../js/metric.js';
import { nSprites } from '../js/object-info.js';
import { light3, screenToViewport } from '../js/world.js';
import * as math from '../js/math.js';

const root = '../';
const nSamples = 64;
const metric = new Schwarzschild(0.3);
const rs = metric.rs;

// Deterministic PRNG (mulberry32), so that failures are reproducible.
function prng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = prng(42);
const uniform = (a, b) => a + (b - a) * random();

const randomPoint = (rMin = 1.5 * rs, rMax = 10) =>
  [uniform(-10, 10), uniform(rMin, rMax), uniform(-Math.PI, Math.PI)];
const randomVector2 = (maxLength) => {
  const length = uniform(0, maxLength), angle = uniform(0, 2 * Math.PI);
  return [length * Math.cos(angle), length * Math.sin(angle)];
};
const randomVelocity = x => localVelocity3(metric, x, randomVector2(0.9));

// Test definitions.
//
// `input()` returns one sample: a list of input vectors (up to 4 components),
//   available in GLSL as `in_(0)`, `in_(1)`, ...
// `glsl` is the body of `vec4 test(int row)`, computing output row `row`.
// `expected(input)` returns the expected rows, or null to skip the sample.
// `tolerance` bounds |gpu - js| / max(1, |js row|) for every component, i.e. the
//   error is relative to the length of the expected row vector (if longer than 1).
const tests = [
  {
    name: 'g',
    input: () => [randomPoint()],
    glsl: 'return mat_row(g(in_(0).xyz), row);',
    expected: ([x]) => metric.g(x),
    tolerance: 1e-5,
  },
  {
    name: 'gamma_uu',
    input: () => { const x = randomPoint(); return [x, randomVelocity(x)]; },
    glsl: 'return vec4(gamma_uu(in_(0).xyz, in_(1).xyz), 0.0);',
    expected: ([x, u]) => [metric.gammaUU(x, u)],
    tolerance: 1e-5,
  },
  {
    name: 'T',
    input: () => [randomPoint()],
    glsl: 'return mat_row(T(in_(0).xyz), row);',
    expected: ([x]) => metric.T(x),
    tolerance: 1e-5,
  },
  {
    name: 'general_boost',
    input: () => { const x = randomPoint(); return [x, randomVelocity(x)]; },
    glsl: 'return mat_row(general_boost(T(in_(0).xyz), neg_u(in_(1).xyz)), row);',
    expected: ([x, u]) => math.general_boost(metric.T(x), math.neg_u(u)),
    tolerance: 1e-4,
  },
  {
    name: 'light3',
    input: () => [randomPoint(), randomVector2(2)],
    glsl: 'return vec4(light3(g(in_(0).xyz), in_(1).xy), 0.0);',
    expected: ([x, v]) => [light3(metric.g(x), v)],
    tolerance: 1e-5,
  },
  {
    name: 'viewport2world',
    input: () => [randomPoint(), randomVector2(10)],
    glsl: 'vec3 x = in_(0).xyz; return vec4(viewport2world(x.y, x.z, in_(1).xy), 0.0, 0.0);',
    expected: ([x, v]) => [metric.viewportToWorld(x, v)],
    // GPU sin / cos are much less precise than the rest of float32 arithmetic
    tolerance: 1e-3,
  },
  {
    name: 's2v (screenToViewport)',
    input: () => {
      const res = [uniform(100, 3000), uniform(100, 3000)];
      return [[uniform(0, res[0]), uniform(0, res[1])], res, [uniform(1, 50)]];
    },
    glsl: 'return vec4(s2v(in_(0).xy, in_(1).xy, in_(2).x), 0.0, 0.0);',
    expected: ([s, res, [size]]) => [screenToViewport(s, res, size)],
    tolerance: 1e-5,
  },
  {
    // A light ray as cast for a screen pixel, traced to affine parameter 1
    // by the adaptive RK23 on the GPU, and by fine-step RK4 in JS.
    // Rays that either side doesn't finish are skipped.
    name: 'raytrace',
    input: () => {
      const x0 = randomPoint(2, 10);
      return [x0, light3(metric.g(x0), metric.viewportToWorld(x0, randomVector2(10)))];
    },
    glsl: `
      vec3 x, u;
      bool reached = raytrace(in_(0).xyz, in_(1).xyz, x, u);
      return row == 0 ? vec4(x, reached ? 1.0 : 0.0) : vec4(u, 0.0);`,
    expected: ([x0, u0]) => {
      const xu = math.integrate(metric, math.geo_f(metric), [...x0, ...u0], 1, 1e-3);
      return xu && [[...xu.slice(0, 3), 1], [...xu.slice(3, 6), 0]];
    },
    skip: gpuRows => gpuRows[0][3] != 1,
    minCompared: 0.5,
    // the shader's solver has a relative tolerance of 1e-3 per step
    tolerance: 1e-2,
  },
];

const harness = body => `
uniform highp sampler2D inputs;
out vec4 out_color;

vec4 in_(int k) {
  return texelFetch(inputs, ivec2(int(gl_FragCoord.x), k), 0);
}

vec4 mat_row(mat3 m, int r) {
  return vec4(m[0][r], m[1][r], m[2][r], 0.0);
}

vec4 test(int row) {
  ${body}
}

void main() {
  out_color = test(int(gl_FragCoord.y));
}
`;

function compileProgram(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('Shader failed to compile: ' + gl.getShaderInfoLog(shader).trimEnd());
    }
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Shader program failed to link: ' + gl.getProgramInfoLog(program));
  }
  return program;
}

function floatTexture(gl, width, height, data) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
  return tex;
}

const pad4 = v => [0, 1, 2, 3].map(i => v[i] ?? 0);

// Evaluate the test's GLSL on all samples; returns gpu[sample][row] = vec4.
async function runOnGpu(gl, vertexSource, test, samples, nRows) {
  const program = compileProgram(gl, vertexSource, await physicsFragmentShader(harness(test.glsl), root));
  gl.useProgram(program);

  const nInputs = samples[0].length;
  const inputData = new Float32Array(nSamples * nInputs * 4);
  samples.forEach((sample, i) => sample.forEach((v, k) => inputData.set(pad4(v), (k * nSamples + i) * 4)));
  const inputTex = floatTexture(gl, nSamples, nInputs, inputData);

  const outputTex = floatTexture(gl, nSamples, nRows, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTex, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, inputTex);
  gl.uniform1i(gl.getUniformLocation(program, 'inputs'), 0);
  gl.uniform1f(gl.getUniformLocation(program, 'rs'), rs);

  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  gl.viewport(0, 0, nSamples, nRows);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  const out = new Float32Array(nSamples * nRows * 4);
  gl.readPixels(0, 0, nSamples, nRows, gl.RGBA, gl.FLOAT, out);

  gl.deleteFramebuffer(framebuffer);
  gl.deleteTexture(inputTex);
  gl.deleteTexture(outputTex);
  gl.deleteProgram(program);

  return samples.map((_, i) =>
    [...Array(nRows).keys()].map(r => Array.from(out.subarray((r * nSamples + i) * 4, (r * nSamples + i + 1) * 4))));
}

async function runComparison(gl, vertexSource, test) {
  const samples = [...Array(nSamples)].map(() => test.input());
  const expected = samples.map(test.expected);
  const nRows = expected.find(e => e).length;
  const gpu = await runOnGpu(gl, vertexSource, test, samples, nRows);

  let maxError = 0, worst = null, compared = 0;
  samples.forEach((sample, i) => {
    if (!expected[i] || (test.skip && test.skip(gpu[i]))) return;
    compared++;
    expected[i].forEach((row, r) => pad4(row).forEach((want, c) => {
      const got = gpu[i][r][c];
      const error = Math.abs(got - want) / Math.max(1, math.norm(pad4(row)));
      if (!(error <= maxError)) {  // also catches NaN
        maxError = Number.isNaN(error) ? Infinity : error;
        worst = {sample, row: r, component: c, gpu: got, js: want};
      }
    }));
  });

  const minCompared = Math.ceil((test.minCompared ?? 1) * nSamples);
  if (compared < minCompared) {
    return {ok: false, message: `only ${compared}/${nSamples} samples compared, expected at least ${minCompared}`};
  }
  const ok = maxError <= test.tolerance;
  return {
    ok,
    message: `max error ${maxError.toExponential(2)} (tolerance ${test.tolerance.toExponential(0)}), ` +
      `${compared}/${nSamples} samples` + (ok ? '' : `; worst: ${JSON.stringify(worst)}`),
  };
}

// The full raytracing shader compiles and its uniform block matches the JS sprite tables.
async function checkSurfaceShader(gl, vertexSource) {
  const program = compileProgram(gl, vertexSource,
    await physicsFragmentShader(await fetchText(root + 'glsl/surface-frag.glsl'), root));
  const block = gl.getUniformBlockIndex(program, 'objectInfo');
  const size = gl.getActiveUniformBlockParameter(program, block, gl.UNIFORM_BLOCK_DATA_SIZE);
  const expectedSize = 3 * nSprites * 16; // 3 arrays of std140 vec3
  gl.deleteProgram(program);
  return {
    ok: size == expectedSize,
    message: `objectInfo block size ${size}, expected ${expectedSize}`,
  };
}

async function main() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL 2 not available');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float not available');

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  const vertexSource = await fetchText(root + 'glsl/surface-vert.glsl');

  const results = [];
  const run = async (name, f) => {
    try {
      results.push({name, ...await f()});
    } catch (err) {
      results.push({name, ok: false, message: String(err.message ?? err)});
    }
  };
  await run('surface shader', () => checkSurfaceShader(gl, vertexSource));
  for (const test of tests) {
    await run(test.name, () => runComparison(gl, vertexSource, test));
  }
  return results;
}

function show(results) {
  const list = document.getElementById('results');
  for (const r of results) {
    const item = document.createElement('li');
    item.className = r.ok ? 'pass' : 'fail';
    item.textContent = `${r.ok ? 'PASS' : 'FAIL'} ${r.name}: ${r.message}`;
    list.appendChild(item);
  }
}

main().then(results => {
  show(results);
  window.testResults = {ok: results.every(r => r.ok), results};
}).catch(err => {
  const results = [{name: 'setup', ok: false, message: String(err.message ?? err)}];
  show(results);
  window.testResults = {ok: false, results};
});
