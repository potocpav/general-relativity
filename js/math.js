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

export const rk4 = (f, y, h) => {
  const k1 = f(y);
  const k2 = f(y.map((v, i) => v + k1[i] * h / 2));
  const k3 = f(y.map((v, i) => v + k2[i] * h / 2));
  const k4 = f(y.map((v, i) => v + k3[i] * h));
  return y.map((v, i) => v + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

// Integrate the geodesic ODE `f` (see geo_f) over the parameter interval
// `duration` with RK4 steps of at most `maxStep`. Steps are shortened near
// the horizon, where Schwarzschild coordinates are singular and a long step
// could jump across it. Returns null if the body falls behind the horizon.
export function integrate(metric, f, xu, duration, maxStep) {
  const maxIters = 100000;
  var done = 0;
  for (var i = 0; duration - done > 1e-12; i++) {
    if (i >= maxIters) return null;
    const horizonStep = 0.1 * (xu[1] - metric.rs) / (Math.abs(xu[4]) + 1e-12);
    const h = Math.min(maxStep, horizonStep, duration - done);
    const next = rk4(f, xu, h);
    if (!metric.isOutsideHorizon(next)) return null;
    xu = next;
    done += h;
  }
  return xu;
}
