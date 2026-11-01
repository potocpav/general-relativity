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
  for (const type of metricTypes) {
    metric = new type(rs);
    random = prng(42);
    const prefix = `[${type.label}] `;
    await run(prefix + 'surface shader', () => checkSurfaceShader(gl, vertexSource));
    await run(prefix + 'frames (JS)', async () => checkFramesJs());
    await run(prefix + 'geodesics (JS)', async () => checkGeodesicsJs());
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
