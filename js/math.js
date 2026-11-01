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

function inverse_diag3(m) {
  return [
    [1 / m[0][0], 0, 0],
    [0, 1 / m[1][1], 0],
    [0, 0, 1 / m[2][2]]];
}

// Lorentz boost
function boost(u) {
  const fac = (u[0] - 1.0) / (u[1]*u[1] + u[2]*u[2] + epsilon);
  return [
    [u[0], -u[1], -u[2]],
    [-u[1], 1.0 + fac * u[1]*u[1], fac * u[1]*u[2]],
    [-u[2], fac * u[1]*u[2], 1.0 + fac * u[2]*u[2]],
  ];
}

export function neg_u(u) {
  return [u[0], -u[1], -u[2]];
}

// assuming diagonal metric.T
export function general_boost(Tx, u) {
  return matMul(matMul(inverse_diag3(Tx), boost(matVec(Tx, u))), Tx);
}

// Geodesic ODE, solving for the [x^mu, u^mu] 6-vector.
// `accel_rest` is an optional acceleration in the rest frame of the body,
// given in coordinate components.
export const geo_f = (metric, accel_rest) => (xu) => {
  const x = xu.slice(0, 3), u = xu.slice(3, 6);
  const gamma = metric.gammaUU(x, u);
  const accel = accel_rest !== undefined
    ? matVec(general_boost(metric.T(x), neg_u(u)), accel_rest)
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

export function inverse2(m) {
  const [[a, b], [c, d]] = m;
  const det = a * d - b * c;
  return [[d / det, -b / det], [-c / det, a / det]];
}
