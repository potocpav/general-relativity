// Checks that the GLSL physics (glsl/physics.glsl) agrees with its JS
// counterparts. Each test evaluates a GLSL expression on the GPU for a set of
// random inputs and compares the results with the JS implementation.
//
// Results are shown on the page and exposed as `window.testResults`
// for test/run.mjs.

import { fetchText, physicsFragmentShader } from '../js/shaders.js';
import { Schwarzschild, GullstrandPainleve, metricTypes, convertState, localVelocity3, velocity3, singularityRadius } from '../js/metric.js';
import { nSprites } from '../js/object-info.js';
import { screenRay, screenToViewport } from '../js/world.js';
import * as math from '../js/math.js';
import { scenarios } from '../js/scenarios.js';
import { Objects, integrateToTime } from '../js/objects.js';
import { asteroidId, photonClockId, objectRadius } from '../js/object-info.js';

const root = '../';
const nSamples = 64;
const rs = 0.3;
// All checks run once per metric; this is the one being tested.
let metric;

// Deterministic PRNG (mulberry32), so that failures are reproducible.
function prng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let random = prng(42);
const uniform = (a, b) => a + (b - a) * random();

const randomPoint = (rMin = 1.5 * rs, rMax = 10) =>
  [uniform(-10, 10), uniform(rMin, rMax), uniform(-Math.PI, Math.PI)];
const randomVector2 = (maxLength) => {
  const length = uniform(0, maxLength), angle = uniform(0, 2 * Math.PI);
  return [length * Math.cos(angle), length * Math.sin(angle)];
};
const randomVelocity = x => localVelocity3(metric, x, randomVector2(0.9));

// Light rays with an impact parameter below this fall into the black hole.
const bCrit = 1.5 * Math.sqrt(3) * rs;
// conserved energy E = -u_t and angular momentum L = u_phi of a geodesic
const conserved = (x, u) => { const ul = math.matVec(metric.g(x), u); return {E: -ul[0], L: ul[2]}; };
// b = L / E
const impactParameter = (x, u) => { const {E, L} = conserved(x, u); return Math.abs(L / E); };

// Shadow of the black hole, as the screen shows it.
//
// The screen axes are the observer's local orthonormal frame, so the shadow
// edges are at the analytic critical angles: a static observer at r0 sees
// rays fall in within the half-angle h around the inward direction, where
// sin h = b_crit / r0 * sqrt(1 - rs / r0) (h > 90 deg inside the photon
// sphere). A moving observer sees them shifted by relativistic aberration.
// The shadow is therefore not a circle on the screen: it is a wedge behind the
// black hole, and only the near side of the photon sphere is ever visible.
const shadowSetups = [
  {name: 'static, 10 rs', r0: 10 * rs, orbiting: false},
  {name: 'static, 3 rs', r0: 3 * rs, orbiting: false},
  {name: 'static, 1.2 rs (inside photon sphere)', r0: 1.2 * rs, orbiting: false},
  {name: 'circular orbit, 10 rs', r0: 10 * rs, orbiting: true},
];

// The observer of a shadow setup, and light rays it sees.
// Returns {x0, edges, ray(psi, length)}: `edges` are the analytic shadow edges and
// `psi` directions in the observer's rest frame, as angles from r-hat towards phi-hat.
function shadowObserver(setup) {
  const x0 = [0, setup.r0, 0.7];
  const tangential = [-Math.sin(x0[2]), Math.cos(x0[2])];
  const u = velocity3(metric, x0, setup.orbiting
    ? math.scale(tangential, Math.sqrt(rs / (2 * setup.r0)))  // circular orbit, as in the app
    : [0, 0]);
  // The observer's rest frame, as a pure boost from the static observer's frame
  // (independent of the metric's reference frame, which the screen uses).
  const w = math.matVec(metric.staticT(x0), u);
  const restToCoord = math.matMul(metric.staticTinv(x0), math.boost(math.negSpatial(w)));
  const beta = w[2] / w[0]; // speed relative to the static observer, along phi-hat

  const s = bCrit / setup.r0 * Math.sqrt(1 - rs / setup.r0);
  const h = setup.r0 >= 1.5 * rs ? Math.asin(s) : Math.PI - Math.asin(s);
  // aberration for motion along phi-hat: a direction at angle chi from the
  // velocity appears at chi', cos chi' = (cos chi + beta) / (1 + beta cos chi)
  const aberrate = psi => {
    const chi = psi - Math.PI / 2;
    const c = (Math.cos(chi) + beta) / (1 + beta * Math.cos(chi));
    return Math.PI / 2 + Math.sign(Math.sin(chi)) * Math.acos(c);
  };
  // past-directed light ray seen in rest frame direction psi
  const ray = (psi, length = 20) =>
    math.matVec(restToCoord, [-length, length * Math.cos(psi), length * Math.sin(psi)]);
  return {x0, edges: [aberrate(Math.PI - h), aberrate(Math.PI + h)], ray};
}

// Screen-space light rays just inside and just outside each shadow edge,
// `delta` [rad] away from it. Returns [{x0, u0, fallsIn, label}].
function shadowEdgeRays(setup, delta) {
  const {x0, edges, ray} = shadowObserver(setup);
  const rays = [];
  edges.forEach((psi, i) => {
    const inwards = i == 0 ? +1 : -1;
    rays.push({x0, u0: ray(psi + inwards * delta), fallsIn: true, label: `edge ${i + 1} inside`});
    rays.push({x0, u0: ray(psi - inwards * delta), fallsIn: false, label: `edge ${i + 1} outside`});
  });
  return rays;
}

// JS geodesics conserve E, L and the norm of the 4-velocity, for random
// timelike geodesics (checks the Christoffel symbols).
function checkGeodesicsJs() {
  let maxError = 0;
  for (let i = 0; i < 20; i++) {
    const x = randomPoint(2, 10), u = randomVelocity(x);
    const xu = math.integrate(metric, math.geo_f(metric), [...x, ...u], 2, 1e-3);
    if (xu === null) continue;
    const x1 = xu.slice(0, 3), u1 = xu.slice(3, 6);
    const c0 = conserved(x, u), c1 = conserved(x1, u1);
    const n1 = math.dot(u1, math.matVec(metric.g(x1), u1));
    maxError = Math.max(maxError, Math.abs(c1.E - c0.E), Math.abs(c1.L - c0.L), Math.abs(n1 + 1));
  }
  return {ok: maxError < 1e-8, message: `max drift of E, L, u.u: ${maxError.toExponential(2)}`};
}

// The reference and static frames are orthonormal, and T, Tinv are inverses.
function checkFramesJs() {
  const transpose = m => m[0].map((_, j) => m.map(row => row[j]));
  const eta = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]], identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let maxError = 0;
  for (let i = 0; i < 64; i++) {
    const x = randomPoint(1.05 * rs);
    for (const [F, Finv] of [[metric.T(x), metric.Tinv(x)], [metric.staticT(x), metric.staticTinv(x)]]) {
      const metricInFrame = math.matMul(math.matMul(transpose(Finv), metric.g(x)), Finv);
      const product = math.matMul(F, Finv);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        maxError = Math.max(maxError, Math.abs(metricInFrame[a][b] - eta[a][b]), Math.abs(product[a][b] - identity[a][b]));
      }
    }
  }
  return {ok: maxError < 1e-12, message: `max error ${maxError.toExponential(2)}`};
}

// The same geodesics, integrated in Schwarzschild and in Gullstrand–Painlevé
// coordinates, agree after converting between them (T = t + shift(r)).
function checkCoordinateTransformJs() {
  const S = new Schwarzschild(rs), G = new GullstrandPainleve(rs);
  const rand = prng(7);
  let maxError = 0;
  for (let i = 0; i < 20; i++) {
    const x = [0, rs * (4 + 20 * rand()), 6 * rand()];
    const u = localVelocity3(S, x, [rand() - 0.5, rand() - 0.5]);
    const [xg, ug] = convertState(S, G, x, u);
    const a = math.integrate(S, math.geo_f(S), [...x, ...u], 3, 1e-3);
    const b = math.integrate(G, math.geo_f(G), [...xg, ...ug], 3, 1e-3);
    if (!a || !b) continue;
    const [xa, ua] = convertState(S, G, a.slice(0, 3), a.slice(3));
    for (let k = 0; k < 3; k++) {
      maxError = Math.max(maxError, Math.abs(xa[k] - b[k]), Math.abs(ua[k] - b[3 + k]));
    }
  }
  return {ok: maxError < 1e-9, message: `max difference after tau = 3: ${maxError.toExponential(2)}`};
}

// The JS ray tracer (conserved quantities) agrees with integrating the
// geodesic equation, for rays outside the horizon that aren't near-critical.
function checkTraceRayJs() {
  let maxError = 0, compared = 0;
  for (let i = 0; i < 64; i++) {
    const x0 = randomPoint(2, 10);
    const p0 = screenRay(metric, x0, randomVelocity(x0), randomVector2(10));
    if (Math.abs(impactParameter(x0, p0) / bCrit - 1) < 0.1) continue;
    const ray = math.traceRay(metric, x0, p0, 1e-4);
    const xu = math.integrate(metric, math.geo_f(metric), [...x0, ...p0], 1, 1e-4);
    if (ray.status != math.RAY_REACHED || xu === null) continue;
    compared++;
    for (let k = 0; k < 3; k++) {
      maxError = Math.max(maxError, Math.abs(ray.x[k] - xu[k]) / Math.max(1, Math.abs(xu[k])),
        Math.abs(ray.p[k] - xu[3 + k]) / Math.max(1, Math.abs(xu[3 + k])));
    }
  }
  return {ok: maxError < 1e-6 && compared > 32, message: `max error ${maxError.toExponential(2)}, ${compared} rays`};
}

// A raindrop (falling from rest at infinity) crosses the horizon and reaches
// radius r at proper time tau = 2 / (3 sqrt(rs)) (r0^1.5 - r^1.5), and is
// followed until close to the singularity.
function checkFreeFallJs() {
  const r0 = 10 * rs, x0 = [0, r0, 0.3];
  const u0 = math.matVec(metric.Tinv(x0), [1, 0, 0]); // the reference (raindrop) observer
  const tau = r => 2 / (3 * Math.sqrt(rs)) * (Math.pow(r0, 1.5) - Math.pow(r, 1.5));
  const fall = t => math.integrate(metric, math.geo_f(metric), [...x0, ...u0], t, 1e-3);
  const errors = [];
  for (const r of [2 * rs, rs, 0.5 * rs, 0.1 * rs]) {
    const xu = fall(tau(r));
    if (xu === null || Math.abs(xu[1] - r) > 1e-6) errors.push(`r at tau(${r / rs} rs) = ${xu && xu[1] / rs} rs`);
  }
  if (fall(tau(0.9 * singularityRadius * rs)) !== null) errors.push('followed past the singularity radius');
  return {ok: errors.length == 0, message: errors.length ? errors.join(', ') : 'r(tau) matches down to 0.1 rs'};
}

// The ship's heading is Fermi–Walker transported: on a circular orbit at r,
// a gyroscope turns relative to the fixed (screen) directions by the geodetic
// precession 2 pi (1 - sqrt(1 - 1.5 rs / r)) per orbit. Under thrust, the
// transported axis stays a unit vector orthogonal to the 4-velocity.
function checkGyroscopeJs() {
  const errors = [];
  // the heading's angle relative to the screen axes
  const screenAngle = y => {
    const h = math.matVec(math.coordToRest(metric, y.slice(0, 3), y.slice(3, 6)), y.slice(6, 9));
    return Math.atan2(h[2], h[1]) + y[2];
  };
  const drift = y => {
    const g = metric.g(y.slice(0, 3)), u = y.slice(3, 6), h = y.slice(6, 9);
    return Math.max(Math.abs(math.dot(h, math.matVec(g, u))), Math.abs(math.dot(h, math.matVec(g, h)) - 1));
  };
  let maxDrift = 0;
  for (const k of [10, 4, 3]) {
    const r = k * rs, x = [0, r, 0];
    const u = velocity3(metric, x, [0, Math.sqrt(rs / (2 * r))]);
    const h = math.matVec(math.restToCoord(metric, x, u), [0, 1, 0]);
    // proper time of one orbit: coordinate period 2 pi sqrt(r^3 / M), M = rs / 2, times sqrt(1 - 1.5 rs / r)
    const period = 2 * Math.PI * Math.sqrt(2 * r ** 3 / rs) * Math.sqrt(1 - 1.5 * rs / r);
    const y0 = [...x, ...u, ...h];
    const y = math.integrate(metric, math.geo_fw_f(metric), y0, period, 0.005);
    const turned = (screenAngle(y) - screenAngle(y0) - 2 * Math.PI) * 180 / Math.PI;
    const expected = 360 * (1 - Math.sqrt(1 - 1.5 * rs / r));
    if (!(Math.abs(turned - expected) < 0.01)) errors.push(`${k} rs: ${turned.toFixed(3)} deg, expected ${expected.toFixed(3)}`);
    maxDrift = Math.max(maxDrift, drift(y));
  }
  // thrusting, sideways to the heading (own random numbers, so as not to
  // change the other tests' samples)
  const rand = prng(3);
  const x = [0, (3 + 7 * rand()) * rs, 6 * rand()], u = localVelocity3(metric, x, [0.5 * rand() - 0.25, 0.5 * rand() - 0.25]);
  const h = math.matVec(math.restToCoord(metric, x, u), [0, 0.6, 0.8]);
  const y = math.integrate(metric, math.geo_fw_f(metric, [0, 0.4, -0.3]), [...x, ...u, ...h], 3, 0.005);
  maxDrift = Math.max(maxDrift, drift(y));
  if (!(maxDrift < 1e-8)) errors.push(`h.u or h.h - 1 drifted by ${maxDrift.toExponential(1)}`);
  return {ok: errors.length == 0, message: errors.length ? errors.join('; ') :
    `geodetic precession at 10, 4, 3 rs within 0.01 deg; h.u, h.h - 1 drift ${maxDrift.toExponential(1)}`};
}

// JS geodesics vs the analytic shadow edges.
function checkShadowJs() {
  const delta = 0.1 * Math.PI / 180;
  const failures = [];
  for (const setup of shadowSetups) {
    for (const ray of shadowEdgeRays(setup, delta)) {
      const fallsIn = math.traceRay(metric, ray.x0, ray.u0, 2e-4).status == math.RAY_HORIZON;
      if (fallsIn != ray.fallsIn) failures.push(`${setup.name}: ${ray.label}`);
    }
  }
  return {
    ok: failures.length == 0,
    message: `rays 0.1 deg from the analytic edges` + (failures.length ? `; wrong: ${failures.join(', ')}` : ''),
  };
}

// Test definitions.
//
// `input()` returns one sample: a list of input vectors (up to 4 components),
//   available in GLSL as `in_(0)`, `in_(1)`, ...
// `glsl` is the body of `vec4 test(int row)`, computing output row `row`.
// `expected(input)` returns the expected rows, or null to skip the sample.
// `tolerance` bounds |gpu - js| / max(1, |js row|) for every component, i.e. the
//   error is relative to the length of the expected row vector (if longer than 1).
const randomObserver = () => { const x = randomPoint(); return [x, randomVelocity(x)]; };

const tests = [
  {
    name: 'T',
    input: () => [randomPoint()],
    glsl: 'return mat_row(T(in_(0).xyz), row);',
    expected: ([x]) => metric.T(x),
    tolerance: 1e-5,
  },
  {
    name: 'T_inv',
    input: () => [randomPoint()],
    glsl: 'return mat_row(T_inv(in_(0).xyz), row);',
    expected: ([x]) => metric.Tinv(x),
    tolerance: 1e-5,
  },
  {
    name: 'rest_to_coord',
    input: randomObserver,
    glsl: 'return mat_row(rest_to_coord(in_(0).xyz, in_(1).xyz), row);',
    expected: ([x, u]) => math.restToCoord(metric, x, u),
    tolerance: 1e-4,
  },
  {
    name: 'coord_to_rest',
    input: randomObserver,
    glsl: 'return mat_row(coord_to_rest(in_(0).xyz, in_(1).xyz), row);',
    expected: ([x, u]) => math.coordToRest(metric, x, u),
    tolerance: 1e-4,
  },
  {
    name: 'screen_ray',
    input: () => [...randomObserver(), randomVector2(10)],
    glsl: 'return vec4(screen_ray(in_(0).xyz, in_(1).xyz, in_(2).xy), 0.0);',
    expected: ([x, u, v]) => [screenRay(metric, x, u, v)],
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
    // by the adaptive RK23 on the GPU, and by fine-step RK4 in JS (traceRay).
    // Rays that either side doesn't finish are skipped, and so are rays
    // close to the critical impact parameter: they wind around the photon
    // sphere, which amplifies any integration error (see the shadow tests).
    name: 'raytrace',
    input: () => {
      const x0 = randomPoint(2, 10);
      return [x0, screenRay(metric, x0, randomVelocity(x0), randomVector2(10))];
    },
    glsl: `
      vec3 x, u;
      bool reached = raytrace(in_(0).xyz, in_(1).xyz, x, u);
      return row == 0 ? vec4(x, reached ? 1.0 : 0.0) : vec4(u, 0.0);`,
    expected: ([x0, u0]) => {
      if (Math.abs(impactParameter(x0, u0) / bCrit - 1) < 0.1) return null;
      return expectedRay(x0, u0);
    },
    skip: gpuRows => gpuRows[0][3] != 1,
    minCompared: 0.5,
    // the shader's solver has a relative tolerance of 1e-3 per step
    tolerance: 1e-2,
  },
  {
    // The same, for observers inside the black hole.
    name: 'raytrace from inside the horizon',
    metrics: [GullstrandPainleve],
    input: () => {
      const x0 = randomPoint(0.2 * rs, 0.95 * rs);
      return [x0, screenRay(metric, x0, randomVelocity(x0), randomVector2(10))];
    },
    glsl: `
      vec3 x, u;
      bool reached = raytrace(in_(0).xyz, in_(1).xyz, x, u);
      return row == 0 ? vec4(x, reached ? 1.0 : 0.0) : vec4(u, 0.0);`,
    expected: ([x0, u0]) => {
      if (Math.abs(impactParameter(x0, u0) / bCrit - 1) < 0.1) return null;
      return expectedRay(x0, u0);
    },
    skip: gpuRows => gpuRows[0][3] != 1,
    minCompared: 0.25,
    // These rays sweep large angles through the strongest field, so the
    // shader's per-step tolerance (1e-3) adds up to ~2% at the end (also in
    // float64), which is below a pixel at the default zoom.
    tolerance: 3e-2,
  },
];

// traceRay's result in the rows of the raytrace tests, or null if not reached
function expectedRay(x0, u0) {
  const ray = math.traceRay(metric, x0, u0, 1e-3);
  return ray.status == math.RAY_REACHED ? [[...ray.x, 1], [...ray.p, 0]] : null;
}

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
  const program = compileProgram(gl, vertexSource, await physicsFragmentShader(harness(test.glsl), metric, root));
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

  if (test.setup) test.setup(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, inputTex);
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

// The shader's `reached` flag, which paints the shadow on screen, vs the
// analytic shadow edges. Rays that wind around the photon sphere are hard for
// the shader's solver (max. 40 steps), so the edge is only resolved to `deg`.
async function checkShadowGpu(gl, vertexSource, deg) {
  const rays = shadowSetups.flatMap(setup =>
    shadowEdgeRays(setup, deg * Math.PI / 180).map(ray => ({...ray, setup: setup.name})));
  const test = {glsl: 'vec3 x, u; return vec4(raytrace(in_(0).xyz, in_(1).xyz, x, u) ? 1.0 : 0.0);'};
  const gpu = await runOnGpu(gl, vertexSource, test, rays.map(r => [r.x0, r.u0]), 1);
  const failures = rays.filter((ray, i) => (gpu[i][0][0] != 1) != ray.fallsIn).map(r => `${r.setup}: ${r.label}`);
  return {
    ok: failures.length == 0,
    message: `rays ${deg} deg from the analytic edges` + (failures.length ? `; wrong: ${failures.join(', ')}` : ''),
  };
}

// Rays aimed into the shadow that end just in front of the horizon must be
// traced to the end, not given up on: the shadow must not be too big.
// For each ray direction, the screen length at which the ray ends at a given
// radius is found with the JS geodesics; the GPU must reach the same radius,
// and report a slightly longer ray as fallen in.
async function checkNearHorizonGpu(gl, vertexSource) {
  const endRadius = (x0, u0) => {
    const ray = math.traceRay(metric, x0, u0, 1e-3);
    return ray.status == math.RAY_REACHED ? ray.x[1] : 0;
  };
  const cases = [];
  for (const setup of [shadowSetups[0], shadowSetups[3]]) {
    const {x0, edges, ray} = shadowObserver(setup);
    const center = (edges[0] + edges[1]) / 2;
    for (const offset of [0, 0.5, -0.8]) { // fraction of the shadow half-width
      const psi = center + offset * (edges[1] - edges[0]) / 2;
      for (const target of [1.05, 1.2, 1.5]) {
        let lo = 0, hi = 40; // screen lengths ending outside / behind target
        for (let i = 0; i < 30; i++) {
          const mid = (lo + hi) / 2;
          endRadius(x0, ray(psi, mid)) > target * rs ? lo = mid : hi = mid;
        }
        const label = `${setup.name}, ${offset} of half-width`;
        cases.push({x0, u0: ray(psi, lo), reached: true, target, label: `${label}: ends at ${target} rs`});
        const longer = ray(psi, hi + 0.5);
        if (endRadius(x0, longer) == 0) {
          cases.push({x0, u0: longer, reached: false, target, label: `${label}: past the horizon`});
        }
      }
    }
  }
  const test = {glsl: 'vec3 x, u; bool reached = raytrace(in_(0).xyz, in_(1).xyz, x, u); return vec4(reached ? 1.0 : 0.0, x.y, 0.0, 0.0);'};
  const gpu = await runOnGpu(gl, vertexSource, test, cases.map(c => [c.x0, c.u0]), 1);
  const failures = cases.filter((c, i) => {
    const [reached, r] = gpu[i][0];
    if ((reached == 1) != c.reached) return true;
    return c.reached && Math.abs(r / rs - c.target) > 0.01;
  }).map((c, i) => c.label);
  return {
    ok: failures.length == 0,
    message: `${cases.length} rays` + (failures.length ? `; wrong: ${failures.join(', ')}` : ''),
  };
}

// Where a light ray seen by an observer comes from, decided analytically from
// its conserved energy E (= -p_t), impact parameter b = |L / E| and radial
// direction v = dr/dl, traced backwards in time:
// - outside the photon sphere (r >= 1.5 rs) it reaches the sky if b > b_crit
//   (it turns around outside the photon sphere) or if it heads outwards;
// - inside (including inside the horizon) only if b < b_crit, E < 0 and it
//   heads outwards (with b > b_crit it turns around inside the photon sphere
//   and falls back; E > 0 inside means it comes from the other side).
// Everything else ends in the black hole's shadow.
function reachesSky(x, p) {
  const ul = math.matVec(metric.g(x), p), E = -ul[0], L = ul[2];
  if (!(E < 0)) return false;
  const b = Math.abs(L / E), r = x[1], v = p[1];
  return r >= 1.5 * rs ? (b > bCrit || v > 0) : (b < bCrit && v > 0);
}

// Light rays seen by random observers inside and outside the horizon reach
// the sky or end in the shadow as reachesSky predicts, in JS and on the GPU.
// The rays are long, so that most shadow rays end before affine parameter 1;
// rays still approaching the horizon at the end (their radial speed there
// tends to |E|, which can be small) are skipped, as their fate is undecided.
async function checkSkyGpu(gl, vertexSource, rMin, rMax) {
  const cases = [];
  for (let i = 0; cases.length < nSamples && i < 1000; i++) {
    const x0 = randomPoint(rMin, rMax);
    const angle = uniform(0, 2 * Math.PI);
    const p0 = screenRay(metric, x0, randomVelocity(x0), [30 * Math.cos(angle), 30 * Math.sin(angle)]);
    if (Math.abs(impactParameter(x0, p0) / bCrit - 1) < 0.03) continue;
    const ray = math.traceRay(metric, x0, p0, 1e-3);
    if (ray.status == math.RAY_REACHED && ray.x[1] < 1.1 * rs) continue;
    cases.push({x0, p0, sky: reachesSky(x0, p0), js: ray.status == math.RAY_REACHED});
  }
  const test = {glsl: 'vec3 x, u; return vec4(raytrace(in_(0).xyz, in_(1).xyz, x, u) ? 1.0 : 0.0);'};
  const gpu = await runOnGpu(gl, vertexSource, test, cases.map(c => [c.x0, c.p0]), 1);
  let jsWrong = 0, gpuWrong = 0;
  const details = [];
  cases.forEach((c, i) => {
    const js = c.js, gpuSky = gpu[i][0][0] == 1;
    if (js != c.sky) jsWrong++;
    if (gpuSky != c.sky) gpuWrong++;
    if (js != c.sky || gpuSky != c.sky) {
      const ul = math.matVec(metric.g(c.x0), c.p0);
      details.push(`r = ${(c.x0[1] / rs).toFixed(3)} rs, E = ${(-ul[0]).toFixed(3)}, ` +
        `b = ${(Math.abs(ul[2] / ul[0]) / bCrit).toFixed(3)} b_crit, v = ${c.p0[1].toFixed(3)}: ` +
        `expected ${c.sky ? 'sky' : 'shadow'}, JS ${js ? 'sky' : 'shadow'}, GPU ${gpuSky ? 'sky' : 'shadow'}`);
    }
  });
  const sky = cases.filter(c => c.sky).length;
  return {
    ok: jsWrong == 0 && gpuWrong == 0,
    message: `${cases.length} rays (${sky} reaching the sky); ` +
      `wrong: ${jsWrong} in JS, ${gpuWrong} on the GPU` + (details.length ? `: ${details.join('; ')}` : ''),
  };
}

// A free-falling (raindrop) observer at r sees the shadow edge at angle psi
// from the outward direction where r sin psi / (1 + s cos psi) = b_crit,
// s = sqrt(rs/r): for light seen in direction psi, E = -(1 + s cos psi) and
// L = r sin psi. At the horizon, psi = 2 atan(b_crit / rs) = 137.9 deg: the
// black hole covers 42.1 deg around the inward direction. Checked with rays
// 0.3 deg on either side of the edge, on the GPU.
async function checkInfallViewGpu(gl, vertexSource) {
  const deg = Math.PI / 180, delta = 0.3 * deg;
  const cases = [];
  const halfAngles = [];
  for (const k of [1.2, 1.0, 0.5]) {
    const r = k * rs, s = Math.sqrt(rs / r), x0 = [0, r, 0.4];
    let lo = 0, hi = Math.PI; // sky at lo, shadow at hi
    for (let i = 0; i < 60; i++) {
      const psi = (lo + hi) / 2;
      r * Math.sin(psi) / (1 + s * Math.cos(psi)) < bCrit ? lo = psi : hi = psi;
    }
    const edge = (lo + hi) / 2;
    halfAngles.push(`${k} rs: ${((Math.PI - edge) / deg).toFixed(1)} deg`);
    // raindrop rest frame = reference frame
    const ray = psi => math.matVec(metric.Tinv(x0), math.scale([-1, Math.cos(psi), Math.sin(psi)], 30));
    for (const sign of [1, -1]) {
      cases.push({x0, p0: ray(sign * (edge - delta)), sky: true, label: `${k} rs, sky side`});
      cases.push({x0, p0: ray(sign * (edge + delta)), sky: false, label: `${k} rs, shadow side`});
    }
  }
  const test = {glsl: 'vec3 x, u; return vec4(raytrace(in_(0).xyz, in_(1).xyz, x, u) ? 1.0 : 0.0);'};
  const gpu = await runOnGpu(gl, vertexSource, test, cases.map(c => [c.x0, c.p0]), 1);
  const failures = cases.filter((c, i) => (gpu[i][0][0] == 1) != c.sky).map(c => c.label);
  return {
    ok: failures.length == 0,
    message: `shadow half-angle around the inward direction: ${halfAngles.join(', ')}` +
      (failures.length ? `; wrong: ${failures.join(', ')}` : ''),
  };
}

// The scenarios start in valid states, and what their descriptions claim
// holds for the JS physics.
function checkScenariosJs() {
  const failures = [];
  const check = (ok, what) => { if (!ok) failures.push(what); };
  // follow a free-fall geodesic for `tau`; returns {fell, rMin, rMax, periapsisPhis, xu}
  const follow = (metric, x, u, tau, accel) => {
    const f = math.geo_f(metric, accel);
    let xu = [...x, ...u], rMin = x[1], rMax = x[1], dir = 0, periapsisPhis = [];
    for (let t = 0; t < tau; t += 0.05) {
      const next = math.integrate(metric, f, xu, 0.05, 0.01);
      if (next === null) return {fell: true, rMin, rMax, periapsisPhis, xu};
      const d = Math.sign(next[1] - xu[1]);
      if (dir < 0 && d > 0) periapsisPhis.push(xu[2]);
      dir = d;
      rMin = Math.min(rMin, next[1]); rMax = Math.max(rMax, next[1]);
      xu = next;
    }
    return {fell: false, rMin, rMax, periapsisPhis, xu};
  };
  for (const sc of scenarios.filter(sc => sc.setup)) {
    const m = new (sc.metric ?? Schwarzschild)(sc.rs ?? rs);
    const st = sc.setup(m);
    for (const body of [st.ship, ...st.objects]) {
      const norm = math.dot(body.u, math.matVec(m.g(body.x), body.u));
      check(Math.abs(norm + 1) < 1e-9 && m.canFollow(body.x), `${sc.id}: invalid initial state`);
    }
    const ship = st.ship;
    if (sc.id == 'precession') {
      const o = follow(m, ship.x, ship.u, 450);
      const advance = (o.periapsisPhis[1] - o.periapsisPhis[0]) * 180 / Math.PI - 360;
      check(!o.fell && Math.abs(advance - 60) < 2, `precession: ${advance.toFixed(1)} deg per orbit`);
    }
    if (sc.id == 'isco') {
      // stays on the orbit; a 0.1 tau burn against the motion (-phi-hat)
      // sends it in within half an orbit (4.9 tau), the same burn forwards
      // (the initial heading) doesn't
      const burn = (accel, tau) => {
        let xu = [...ship.x, ...ship.u];
        for (let t = 0; t < tau; t += 0.05) {
          xu = math.integrate(m, math.geo_f(m, t < 0.1 ? accel : undefined), xu, 0.05, 0.01);
          if (xu === null) return null;
        }
        return xu;
      };
      const free = follow(m, ship.x, ship.u, 30);
      check(!free.fell && Math.abs(free.rMin / rs - 3) < 1e-3 && Math.abs(free.rMax / rs - 3) < 1e-3,
        `isco: without thrust r between ${(free.rMin / rs).toFixed(4)} and ${(free.rMax / rs).toFixed(4)} rs`);
      check(burn([0, 0, -0.5], 4.9) === null, 'isco: a burn against the motion did not send it in');
      check(burn([0, 0, 0.5], 30) !== null, 'isco: a burn forwards sent it in');
      check(Math.abs(ship.heading - Math.PI / 2) < 1e-12, 'isco: the ship does not point in the direction of motion');
    }
    if (sc.id == 'zoom-whirl') {
      const o = follow(m, ship.x, ship.u, 300);
      check(!o.fell && o.rMin < 2.15 * rs && o.rMax > 30 * rs, `zoom-whirl: r between ${(o.rMin / rs).toFixed(2)} and ${(o.rMax / rs).toFixed(1)} rs`);
    }
    if (sc.id == 'fall-in') {
      // Free fall from infinity: tau(r) = (2/3) (r0^1.5 - r^1.5) / sqrt(rs), so
      // 9.14 s from 2 rs to the horizon, then 5 s to the singularity (4.94 s to
      // where bodies are followed until, in Gullstrand–Painlevé coordinates).
      const R = m.rs, tau = r => 2 / 3 * (Math.pow(2 * R, 1.5) - Math.pow(r, 1.5)) / Math.sqrt(R);
      const horizon = follow(m, ship.x, ship.u, tau(R) - 0.05).xu[1] / R;
      const end = tau(singularityRadius * R);
      check(m instanceof GullstrandPainleve && Math.abs(tau(R) - 9.14) < 0.01 && Math.abs(end - tau(R) - 4.94) < 0.01,
        `fall-in: ${tau(R).toFixed(2)} s to the horizon, ${(end - tau(R)).toFixed(2)} s inside`);
      check(horizon > 1 && horizon < 1.01, `fall-in: at ${(horizon).toFixed(3)} rs just before the horizon`);
      check(follow(m, ship.x, ship.u, end + 0.1).fell && !follow(m, ship.x, ship.u, end - 0.1).fell,
        'fall-in: not ended at the singularity radius in time');
    }
    if (sc.id == 'no-return') {
      // full thrust outwards (heading 0 at phi 0 is r-hat) from the start, and from below the limit
      const accel = [0, 0.5, 0];
      const escape = follow(m, ship.x, ship.u, 20, accel);
      check(!escape.fell && escape.xu[1] > 3 * rs, `no-return: full thrust from 2.25 rs ended at ${(escape.xu[1] / rs).toFixed(2)} rs`);
      const x = [0, 2.1 * rs, 0], u = localVelocity3(m, x, [0, 0]);
      check(follow(m, x, u, 20, accel).fell, 'no-return: escaped from 2.1 rs');
    }
  }
  return {ok: failures.length == 0, message: failures.length ? failures.join('; ') : `${scenarios.filter(sc => sc.setup).length} scenarios`};
}

// --- objects (js/objects.js, glsl/objects.glsl)

// Objects on random bound-ish orbits, spawned in the past and advanced to
// T = 5 in irregular steps. Returns {objs, spawned: [{x, u}]}.
function objectsFixture(gl, rand) {
  const objs = new Objects(gl, metric);
  const spawned = [];
  for (let i = 0; i < 3; i++) {
    const x = [-3 + rand(), (4 + 6 * rand()) * rs, 6 * rand()];
    const u = localVelocity3(metric, x, [0.2 * rand() - 0.1, 0.25 + 0.1 * rand()]);
    objs.spawn(i % 2 ? photonClockId : asteroidId, x, u);
    spawned.push({x, u});
  }
  for (let T = 0; T < 5; T += 0.37 + 0.2 * rand()) objs.advance(T);
  objs.advance(5);
  return {objs, spawned};
}

const rowsOf = (objs, o) => {
  const [first, last] = objs.validRows(o), rows = [];
  for (let k = first; k <= last; k++) rows.push([k, objs.rowState(o, k)]);
  return rows;
};

// History rows are on the time grid; they match integrating the geodesic in
// proper time from the spawn state (away from the black hole: close to it,
// a tiny difference in the accumulated proper time means a large difference
// in state), and integrating to their coordinate times with 100 times finer
// steps (everywhere); rewinding and replaying gives the same rows; rewinding before
// the spawn removes the objects; the culling boxes contain all stored positions.
function checkObjectHistoryJs() {
  const errors = [];
  const {objs, spawned} = objectsFixture(null, prng(11));
  const dt = objs.dt;
  const finer = Object.create(metric);
  finer.stepLimit = xu => Math.min(metric.stepLimit(xu), rs / 1500);
  // relative: close to the singularity, velocities grow large
  const rel = (a, b) => Math.max(...[0, 1, 2, 3, 4, 5].map(c => Math.abs(a[c] - b[c]) / Math.max(1, Math.abs(b[c]))));
  let maxError = 0, maxErrorFiner = 0;
  objs.objects.forEach((o, i) => {
    let xu = [...spawned[i].x, ...spawned[i].u], tau = 0;
    let yf = integrateToTime(finer, [...spawned[i].x, ...spawned[i].u, 0], rowsOf(objs, o)[0][0] * dt);
    for (const [k, y] of rowsOf(objs, o)) {
      if (y[0] != k * dt) errors.push(`row ${k} at T = ${y[0]}, not ${k * dt}`);
      xu = math.integrate(metric, math.geo_f(metric), xu, y[6] - tau, 1e-3);
      tau = y[6];
      if (y[1] > 2 * rs) maxError = Math.max(maxError, rel(xu, y));
      yf = integrateToTime(finer, yf, k * dt);
      maxErrorFiner = Math.max(maxErrorFiner, rel(yf, y));
    }
  });
  if (!(maxError < 1e-6)) errors.push(`rows differ from proper-time integration by ${maxError.toExponential(1)}`);
  if (!(maxErrorFiner < 5e-4)) errors.push(`rows differ from finer integration by ${maxErrorFiner.toExponential(1)}`);

  const before = objs.objects.map(o => rowsOf(objs, o));
  objs.advance(2);
  if (objs.objects.some(o => o.lastRow != Math.ceil(2 / dt))) errors.push('rewinding did not trim');
  objs.advance(5);
  const after = objs.objects.map(o => rowsOf(objs, o));
  if (JSON.stringify(before) != JSON.stringify(after)) errors.push('rewinding and replaying changed the rows');

  for (const o of objs.objects) {
    const b = objs.bounds(o);
    for (const [, y] of rowsOf(objs, o)) {
      const px = y[1] * Math.cos(y[2]), py = y[1] * Math.sin(y[2]), pad = objectRadius(o.type) - 1e-9;
      if (px < b[0] + pad || py < b[1] + pad || px > b[2] - pad || py > b[3] - pad) {
        errors.push('a stored position is outside the culling box');
        break;
      }
    }
  }

  objs.advance(-5);
  if (objs.objects.length != 0) errors.push('rewinding before the spawn did not remove the objects');
  return {ok: errors.length == 0, message: errors.length ? errors.join('; ') :
    `3 objects, rows match proper-time integration to ${maxError.toExponential(1)}, ` +
    `finer integration to ${maxErrorFiner.toExponential(1)}`};
}

// Objects' orientation axes are parallel transported: on a circular orbit at
// r, the orientation relative to the screen (its angle from r-hat plus phi)
// turns by the geodetic precession 2 pi (1 - sqrt(1 - 1.5 rs / r)) per orbit;
// and the stored angles are continuous from row to row.
function checkObjectOrientationJs() {
  const errors = [];
  for (const k of [10, 4]) {
    const objs = new Objects(null, metric), r = k * rs, x = [0, r, 0];
    objs.spawn(asteroidId, x, velocity3(metric, x, [0, Math.sqrt(rs / (2 * r))]));
    const period = 2 * Math.PI * Math.sqrt(2 * r ** 3 / rs); // in coordinate time
    objs.advance(period);
    const o = objs.objects[0], rows = rowsOf(objs, o);
    const [, y0] = rows[0], [, y1] = rows[rows.length - 1];
    const dPhi = y1[2] - y0[2];
    const turned = (y1[10] + y1[2] - y0[10] - y0[2]) * 180 / Math.PI;
    const expected = 360 * (1 - Math.sqrt(1 - 1.5 * rs / r)) * dPhi / (2 * Math.PI);
    if (!(Math.abs(turned - expected) < 0.01)) errors.push(`${k} rs: turned ${turned.toFixed(3)} deg, expected ${expected.toFixed(3)}`);
    for (let j = 1; j < rows.length; j++) {
      if (Math.abs(rows[j][1][10] - rows[j - 1][1][10]) > 0.5) { errors.push(`${k} rs: angle jumps at row ${rows[j][0]}`); break; }
    }
  }
  return {ok: errors.length == 0, message: errors.length ? errors.join('; ') : 'geodetic precession at 10 and 4 rs within 0.01 deg'};
}

// Switching from Schwarzschild to Gullstrand–Painlevé coordinates regenerates
// the histories: a regenerated row (T, r, phi) is on the old worldline at
// Schwarzschild time t = T - shift(r).
function checkObjectCoordinateSwitchJs() {
  const S = new Schwarzschild(rs), G = new GullstrandPainleve(rs);
  const saved = metric;
  metric = S;
  const {objs} = objectsFixture(null, prng(12));
  metric = saved;
  const old = objs.objects.map(o => rowsOf(objs, o)), dt = objs.dt;
  const shipR = 10 * rs, T = 5 + convertState(S, G, [0, shipR, 0], [1, 0, 0])[0][0];
  objs.setMetric(G, T);
  const errors = [];
  let maxError = 0, maxErrorDead = 0;
  // cubic Hermite interpolation between rows, with dr/dt = u^r / u^t, dphi/dt = u^phi / u^t
  const hermite = (y0, y1, a, c) => {
    const d0 = y0[c + 3] / y0[3] * dt, d1 = y1[c + 3] / y1[3] * dt;
    return (2 * a ** 3 - 3 * a ** 2 + 1) * y0[c] + (a ** 3 - 2 * a ** 2 + a) * d0 +
      (-2 * a ** 3 + 3 * a ** 2) * y1[c] + (a ** 3 - a ** 2) * d1;
  };
  objs.objects.forEach((o, i) => {
    if (!o.dead && o.lastRow != Math.ceil(T / dt)) errors.push(`object ${i} not at now`);
    for (const [, y] of rowsOf(objs, o)) {
      const [xs] = convertState(G, S, y.slice(0, 3), [1, 0, 0]);
      const k = xs[0] / dt, k0 = Math.floor(k), a = k - k0;
      const rows = old[i], j = rows.findIndex(([kk]) => kk == k0);
      if (j < 0 || j + 1 >= rows.length) continue; // outside the old history
      const e = Math.max(Math.abs(hermite(rows[j][1], rows[j + 1][1], a, 1) - xs[1]),
        Math.abs(hermite(rows[j][1], rows[j + 1][1], a, 2) - xs[2]));
      if (o.dead) maxErrorDead = Math.max(maxErrorDead, e); else maxError = Math.max(maxError, e);
    }
  });
  // Objects lost at the horizon in Schwarzschild coordinates are regenerated
  // from their last state there, where those coordinates are ill-conditioned,
  // so their regenerated past is less accurate.
  if (!(maxError < 1e-6)) errors.push(`regenerated rows off the old worldlines by ${maxError.toExponential(1)}`);
  if (!(maxErrorDead < 1e-3)) errors.push(`regenerated rows of lost objects off by ${maxErrorDead.toExponential(1)}`);
  return {ok: errors.length == 0, message: errors.length ? errors.join('; ') :
    `regenerated rows on the old worldlines to ${maxError.toExponential(1)} ` +
    `(objects lost at the horizon: ${maxErrorDead.toExponential(1)})`};
}

// The shader's object lookup (pixel time -> row, Newton steps to rest-frame
// simultaneity) finds the same event as an exact bisection in JS, for pixel
// events near the objects; and nothing for pixels outside an object's box or
// before its history.
async function checkObjectLookupGpu(gl, vertexSource) {
  const rand = prng(13);
  const {objs} = objectsFixture(gl, rand);
  const dt = objs.dt;
  const sample = (o, k) => {
    const k0 = Math.floor(k), a = k - k0, y0 = objs.rowState(o, k0), y1 = objs.rowState(o, k0 + 1);
    const y = y0.map((v, c) => (1 - a) * v + a * y1[c]);
    return {x: [k * dt, y[1], y[2]], u: y.slice(3, 6), tau: y[6], angle: y[10]};
  };
  const offset = (pix, s) => {
    const d = math.sub(s.x, pix);
    d[2] = ((d[2] + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return math.matVec(math.coordToRest(metric, pix, s.u), d);
  };
  const cases = [];
  for (let n = 0; n < nSamples - 2; n++) {
    const i = n % objs.objects.length, o = objs.objects[i];
    const [first, last] = objs.validRows(o);
    const s = sample(o, first + 5 + rand() * (last - first - 10));
    // a pixel event close to the object, displaced in its rest frame
    const pix = math.sub(s.x, math.matVec(math.restToCoord(metric, s.x, s.u), [0.05 * rand(), 0.2 * rand() - 0.1, 0.2 * rand() - 0.1]));
    // exact: bisection on the row for rest-frame simultaneity
    let lo = first, hi = last;
    for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; offset(pix, sample(o, mid))[0] > 0 ? hi = mid : lo = mid; }
    const e = sample(o, lo);
    cases.push({input: [pix, [o.slot]], found: true, x: e.x, d: offset(pix, e), tau: e.tau, angle: e.angle});
  }
  const o = objs.objects[0];
  const s = sample(o, objs.validRows(o)[0] + 3);
  cases.push({input: [[s.x[0], s.x[1] + 5, s.x[2]], [o.slot]], found: false}); // far away
  cases.push({input: [[objs.validRows(o)[0] * dt - 10, s.x[1], s.x[2]], [o.slot]], found: false}); // before its history

  const test = {
    glsl: `
      vec3 x, u, d; float tau, angle; mat3 R;
      bool found = object_event(int(in_(1).x), in_(0).xyz, x, u, tau, angle, R, d);
      return row == 0 ? vec4(x, found ? 1.0 : 0.0) : row == 1 ? vec4(d, tau) : vec4(angle, 0.0, 0.0, 0.0);`,
    setup: program => { objs.compile(program); objs.render(); },
  };
  const gpu = await runOnGpu(gl, vertexSource, test, cases.map(c => c.input), 3);
  const errors = [];
  let maxError = 0;
  cases.forEach((c, n) => {
    const [x0, x1, x2, found] = gpu[n][0], [d0, d1, d2, tau] = gpu[n][1];
    if ((found == 1) != c.found) { errors.push(`case ${n}: found ${found == 1}, expected ${c.found}`); return; }
    if (!c.found) return;
    maxError = Math.max(maxError, Math.abs(x0 - c.x[0]), Math.abs(x1 - c.x[1]), Math.abs(x2 - c.x[2]),
      Math.abs(d1 - c.d[1]), Math.abs(d2 - c.d[2]), Math.abs(tau - c.tau), Math.abs(gpu[n][2][0] - c.angle));
  });
  if (!(maxError < 2e-4)) errors.push(`GPU event differs from the exact one by ${maxError.toExponential(1)}`);
  return {ok: errors.length == 0, message: errors.length ? errors.slice(0, 5).join('; ') :
    `${cases.length} pixel events; max difference ${maxError.toExponential(1)}`};
}

// The full raytracing shader compiles and its uniform block matches the JS sprite tables.
async function checkSurfaceShader(gl, vertexSource) {
  const program = compileProgram(gl, vertexSource,
    await physicsFragmentShader(await fetchText(root + 'glsl/surface-frag.glsl'), metric, root));
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
  await run('coordinate transformation (JS)', async () => checkCoordinateTransformJs());
  await run('scenarios (JS)', async () => checkScenariosJs());
  await run('object histories across a coordinate switch (JS)', async () => checkObjectCoordinateSwitchJs());
  for (const type of metricTypes) {
    metric = new type(rs);
    random = prng(42);
    const prefix = `[${type.label}] `;
    await run(prefix + 'surface shader', () => checkSurfaceShader(gl, vertexSource));
    await run(prefix + 'frames (JS)', async () => checkFramesJs());
    await run(prefix + 'geodesics (JS)', async () => checkGeodesicsJs());
    await run(prefix + 'gyroscope (JS)', async () => checkGyroscopeJs());
    await run(prefix + 'object history (JS)', async () => checkObjectHistoryJs());
    await run(prefix + 'object orientation (JS)', async () => checkObjectOrientationJs());
    await run(prefix + 'object lookup (GPU)', () => checkObjectLookupGpu(gl, vertexSource));
    await run(prefix + 'ray tracer vs geodesic equation (JS)', async () => checkTraceRayJs());
    if (type == GullstrandPainleve) await run(prefix + 'free fall to the singularity (JS)', async () => checkFreeFallJs());
    await run(prefix + 'shadow edges (JS)', async () => checkShadowJs());
    await run(prefix + 'shadow edges (GPU)', () => checkShadowGpu(gl, vertexSource, 0.3));
    await run(prefix + 'near-horizon rays (GPU)', () => checkNearHorizonGpu(gl, vertexSource));
    if (type == GullstrandPainleve) {
      await run(prefix + 'sky or shadow from inside the horizon, analytic (JS, GPU)', () => checkSkyGpu(gl, vertexSource, 0.2 * rs, 0.98 * rs));
      await run(prefix + 'sky or shadow from outside, analytic (JS, GPU)', () => checkSkyGpu(gl, vertexSource, 1.02 * rs, 4 * rs));
      await run(prefix + 'view while falling in, analytic (GPU)', () => checkInfallViewGpu(gl, vertexSource));
    }
    for (const test of tests.filter(t => !t.metrics || t.metrics.includes(type))) {
      await run(prefix + test.name, () => runComparison(gl, vertexSource, test));
    }
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
