// Small vector / matrix helpers on plain arrays.
// Vectors are arrays of numbers, matrices are arrays of rows.

export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const scale = (a, s) => a.map(v => v * s);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const norm = a => Math.sqrt(dot(a, a));
export const matVec = (m, v) => m.map(row => dot(row, v));
export const matMul = (a, b) =>
  a.map(row => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));

const epsilon = 1e-10;

// Lorentz boost of orthonormal frame components. `w` is the unit timelike
// 3-velocity (w[0] > 0) of an observer in some frame; boost(w) takes components
// in that frame to components in the observer's rest frame, and
// boost(negSpatial(w)) is its inverse.
export function boost(w) {
  const fac = (w[0] - 1.0) / (w[1]*w[1] + w[2]*w[2] + epsilon);
  return [
    [w[0], -w[1], -w[2]],
    [-w[1], 1.0 + fac * w[1]*w[1], fac * w[1]*w[2]],
    [-w[2], fac * w[1]*w[2], 1.0 + fac * w[2]*w[2]],
  ];
}

export const negSpatial = w => [w[0], -w[1], -w[2]];

// The rest frame of an observer with 4-velocity `u` at `x` is the metric's
// reference frame (metric.T), boosted to the observer's velocity.
// restToCoord takes rest frame components to coordinate components,
// coordToRest the other way.
export function restToCoord(metric, x, u) {
  return matMul(metric.Tinv(x), boost(negSpatial(matVec(metric.T(x), u))));
}

export function coordToRest(metric, x, u) {
  const Tx = metric.T(x);
  return matMul(boost(matVec(Tx, u)), Tx);
}

// Geodesic ODE, solving for the [x^mu, u^mu] 6-vector.
// `accel_rest` is an optional acceleration, as components in the body's rest frame.
export const geo_f = (metric, accel_rest) => (xu) => {
  const x = xu.slice(0, 3), u = xu.slice(3, 6);
  const gamma = metric.gammaUU(x, u);
  const accel = accel_rest !== undefined
    ? matVec(restToCoord(metric, x, u), accel_rest)
    : [0, 0, 0];
  return [
    u[0], u[1], u[2],
    -gamma[0] + accel[0],
    -gamma[1] + accel[1],
    -gamma[2] + accel[2],
  ];
}

// Geodesic (or accelerated, with `accel_rest`) motion together with the
// Fermi–Walker transport of a spatial vector h, the ship's gyroscope axis:
// solving for the [x^mu, u^mu, h^mu] 9-vector, with
//   dh/dtau = -Gamma(u, h) + (h.a) u
// where a is the 4-acceleration. For free fall this is parallel transport;
// the extra term keeps h orthogonal to u when accelerating (no rotation
// other than what the acceleration forces).
export const geo_fw_f = (metric, accel_rest) => (xuh) => {
  const x = xuh.slice(0, 3), u = xuh.slice(3, 6), h = xuh.slice(6, 9);
  const accel = accel_rest !== undefined
    ? matVec(restToCoord(metric, x, u), accel_rest)
    : [0, 0, 0];
  const gammaUU = metric.gammaUU(x, u), gammaUH = metric.gammaUV(x, u, h);
  const ha = dot(h, matVec(metric.g(x), accel));
  return [
    ...u,
    ...gammaUU.map((g, i) => -g + accel[i]),
    ...gammaUH.map((g, i) => -g + ha * u[i]),
  ];
}

export const rk4 = (f, y, h) => {
  const k1 = f(y);
  const k2 = f(y.map((v, i) => v + k1[i] * h / 2));
  const k3 = f(y.map((v, i) => v + k2[i] * h / 2));
  const k4 = f(y.map((v, i) => v + k3[i] * h));
  return y.map((v, i) => v + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

// Max. proper-time RK4 step for the ship and objects (also limited by
// metric.stepLimit).
export const maxProperStep = 0.02;

// Integrate the geodesic ODE `f` (see geo_f) over the parameter interval
// `duration` (backwards if negative) with RK4 steps of at most `maxStep`.
// Steps are shortened where the coordinates break down (metric.stepLimit),
// so that a long step doesn't jump across it. A body that gets where it
// can't be followed (metric.canFollow) is stopped exactly where
// metric.breakdown reaches 1 (the last step is bisected), so that it always
// ends at the same threshold, however the integration is split into calls.
// Returns {xu, done, ended}: the state, the parameter interval integrated
// (|done| <= |duration|), and whether it ended there.
export function integrate(metric, f, xu, duration, maxStep) {
  const maxIters = 100000;
  const sign = Math.sign(duration), total = Math.abs(duration);
  var done = 0;
  for (var i = 0; total - done > 1e-12; i++) {
    if (i >= maxIters) return {xu, done: sign * done, ended: true};
    const h = Math.min(maxStep, metric.stepLimit(xu), total - done);
    const next = rk4(f, xu, sign * h);
    if (!metric.canFollow(next)) {
      // the step length where breakdown reaches 1
      let lo = 0, hi = h;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        metric.canFollow(rk4(f, xu, sign * mid)) ? lo = mid : hi = mid;
      }
      return {xu: rk4(f, xu, sign * lo), done: sign * (done + lo), ended: true};
    }
    xu = next;
    done += h;
  }
  return {xu, done: sign * done, ended: false};
}

export const RAY_REACHED = 0;  // traced to the end
export const RAY_HORIZON = 1;  // went where it can't be followed (the black hole's shadow)

// How much the reference frame may change over one step of traceRay,
// |T(y1) T^-1(y) - 1|. The same control as in trace_ray in glsl/physics.glsl,
// but much finer: traceRay is the reference.
const rayFrameStep = 0.02;

const frobenius = m => Math.sqrt(m.reduce((s, row) => s + dot(row, row), 0));
const identity3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// Trace a light ray, a past-directed null geodesic from x0 with momentum p0,
// from affine parameter 0 to 1. Mirrors trace_ray in glsl/physics.glsl: the
// ray is traced using its conserved energy E and angular momentum L, as
// y = [t, r, phi, v = dr/dl] with
//   dt/dl = metric.rayDtdl(r, v, E, L),  dr/dl = v,  dphi/dl = L / r^2,
//   dv/dl = L^2 (r - 1.5 rs) / r^4,
// which (except for t) is regular at the horizon. RK4 steps are at most
// `maxStep`, and short enough that the reference frame changes little
// (rayFrameStep); longer ones, and ones giving non-finite values, are retried
// shorter, so that no step jumps across where the coordinates break down.
// The ray is stopped where it can't be followed (metric.rayCanFollow).
// Returns {status, x, p}, with x and p at the end if it was reached.
export function traceRay(metric, x0, p0, maxStep = 1e-3) {
  const rs = metric.rs;
  const E = metric.rayEnergy(x0, p0), L = x0[1] * x0[1] * p0[2];
  const f = y => {
    const r = y[1];
    return [metric.rayDtdl(r, y[3], E, L), y[3], L / (r * r), L * L * (r - 1.5 * rs) / (r * r * r * r)];
  };
  const momentum = y => [metric.rayDtdl(y[1], y[3], E, L), y[3], L / (y[1] * y[1])];
  const e0 = matVec(metric.T(x0), p0)[0];
  const canFollow = y => metric.rayCanFollow(y.slice(0, 3), momentum(y), e0);
  // whether a step from y to y1 is short enough (false for non-finite values)
  const smallStep = (y, y1) => frobenius(matMul(metric.T(y1.slice(0, 3)), metric.Tinv(y.slice(0, 3)))
    .map((row, a) => row.map((v, b) => v - identity3[a][b]))) <= rayFrameStep;
  var y = [...x0, p0[1]], l = 0, h = maxStep;
  for (var i = 0; 1 - l > 1e-12; i++) {
    if (!canFollow(y) || i > 1e6) return {status: RAY_HORIZON};
    h = Math.min(maxStep, 1 - l, h);
    const y1 = rk4(f, y, h);
    if (smallStep(y, y1)) {
      y = y1; l += h;
      h *= 2;
    } else {
      h /= 4;
      if (!(h > 1e-15)) return {status: RAY_HORIZON};
    }
  }
  if (!canFollow(y)) return {status: RAY_HORIZON};
  return {status: RAY_REACHED, x: y.slice(0, 3), p: momentum(y)};
}
