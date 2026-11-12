import { matVec, matMul, dot, scale, norm, rk4, RAY_REACHED, RAY_HORIZON } from './math.js';

// Where the coordinates break down, detected from local quantities only (the
// same for every metric, also in glsl/common.glsl):
// - the reference frame becomes degenerate: the condition number of T,
//   estimated as |T| |T^-1| (Frobenius norms), exceeds maxFrameCondition
//   (e.g. near the singularity);
// - a light ray's energy measured by the reference observer changes sign: it
//   would no longer be past-directed (e.g. a ray heading into the past
//   horizon, which Gullstrand–Painlevé coordinates don't cover: there the
//   energy diverges, and has the other sign beyond).
// Non-finite values count as a breakdown too.
export const maxFrameCondition = 1e6;

// Integration steps are limited so that a body's velocity changes by at most
// this fraction per step (measured in the reference frame), which makes them
// shrink where the coordinates break down.
const stepFraction = 0.1;

const frobenius = m => Math.sqrt(m.reduce((s, row) => s + dot(row, row), 0));
export const frameCondition = (metric, x) => frobenius(metric.T(x)) * frobenius(metric.Tinv(x));

// Whether a light ray at x with momentum p, which started with reference
// frame energy e0, can be followed further.
export function rayCanFollow(metric, x, p, e0) {
  return [...x, ...p].every(Number.isFinite) && frameCondition(metric, x) < maxFrameCondition
    && matVec(metric.T(x), p)[0] * e0 > 0;
}

// 3-velocity from a physical 2-velocity measured by a static observer at x,
// or inside the horizon, where there are none, by the metric's reference
// observer. `v2_cart` is in screen-aligned cartesian components.
// Returns null if |v| >= 1.
export const localVelocity3 = (metric, x, v2_cart) => {
  const frameInv = metric.staticTinv(x) ?? metric.Tinv(x);
  const [vr, vphi] = metric.cartesianToLocal(x, v2_cart);
  const v2 = vr*vr + vphi*vphi;
  if (!(v2 < 1)) return null;
  const gamma = 1 / Math.sqrt(1 - v2);
  return matVec(frameInv, [gamma, gamma * vr, gamma * vphi]);
}

// Lorentz factor of 4-velocity `u` relative to a static observer at x,
// or null if there is none.
export const staticGamma = (metric, x, u) => {
  const frame = metric.staticT(x);
  return frame === null ? null : matVec(frame, u)[0];
}

// Lorentz factor of 4-velocity `u` relative to the reference observer at x.
export const referenceGamma = (metric, x, u) => matVec(metric.T(x), u)[0];

// Christoffel symbols contracted with vectors u and v, Gamma^mu_ab u^a v^b,
// for a metric in (t, r, phi) depending only on r:
//   Gamma^mu_ab = 1/2 g^mu nu (d_a g_nu b + d_b g_nu a - d_nu g_ab)
// where only d_r is non-zero, so
//   Gamma^mu_ab u^a v^b = 1/2 g^mu nu (u^r (g' v)_nu + v^r (g' u)_nu - delta^r_nu u.g'.v)
function radialChristoffel(metric, x, u, v) {
  const dg = metric.dgdr(x);
  const dgu = matVec(dg, u), dgv = matVec(dg, v);
  const udgv = dot(u, dgv);
  const w = dgv.map((_, nu) => u[1] * dgv[nu] + v[1] * dgu[nu] - (nu == 1 ? udgv : 0));
  return scale(matVec(metric.gInv(x), w), 0.5);
}

// Metrics are in coordinates (time, x1, x2), where the time coordinate is a
// global time function. Each metric class provides:
// - g(x), gInv(x): the metric and its inverse;
// - gammaUV(x, u, v), gammaUU(x, u): Christoffel symbols, Gamma^mu_ab u^a v^b;
// - T(x), Tinv(x): the reference frame, an orthonormal frame at every point:
//   T takes coordinate components of a vector at x to reference frame
//   components, Tinv back; staticT / staticTinv: the frame of static
//   observers, or null where there are none;
// - cartesianToLocal(x, v): a screen-aligned (cartesian) 2-vector at x as
//   spatial reference frame components (screen_to_frame in its GLSL file);
// - toPlane(x): x in a flat plane, for culling boxes (chart_plane);
// - traceRay(x0, p0, maxStep): light rays, see js/math.js (trace_ray);
// - static id, label, endMessage, params (below), `features` of the spacetime
//   ({blackHole} so far) and `glslFile`, its file in glsl/metrics/.
// canFollow(xu), stepLimit(xu) and the rest are the same for all metrics.
//
// Metrics have parameters, declared as `static params = {name: {label,
// default}}` and given to the constructor as {name: value} (missing ones take
// their defaults), available as `params`. The shader gets them, in declaration
// order, as the components of `metric_params` (see glslParams).

class Metric {
  static features = {};

  constructor(params = {}) {
    const declared = this.constructor.params;
    this.params = Object.fromEntries(Object.entries(declared).map(([name, p]) => [name, params[name] ?? p.default]));
  }

  // whether `params` ({name: value}, missing ones at their defaults) are the same as this metric's
  sameParams(params = {}) {
    return Object.entries(this.constructor.params).every(([name, p]) => (params[name] ?? p.default) === this.params[name]);
  }

  // the parameters as the shader's `metric_params` (vec4)
  glslParams() {
    const values = Object.keys(this.constructor.params).map(name => this.params[name]);
    return [...values, 0, 0, 0, 0].slice(0, 4);
  }

  // How close a body at xu = [x, u, ...] is to where the coordinates break
  // down (see maxFrameCondition): it can be followed while this is below 1.
  // Continuous, so that the point where it reaches 1 can be found exactly
  // (math.integrate); infinite for non-finite values.
  breakdown(xu) {
    const b = frameCondition(this, xu.slice(0, 3)) / maxFrameCondition;
    return xu.slice(0, 6).every(Number.isFinite) && Number.isFinite(b) ? b : Infinity;
  }

  canFollow(xu) {
    return this.breakdown(xu) < 1;
  }

  rayCanFollow(x, p, e0) {
    return rayCanFollow(this, x, p, e0);
  }

  // Max. proper-time step for a body at xu = [x, u, ...]: its velocity
  // changes by at most stepFraction, du/dtau = -Gamma(u, u) in free fall.
  stepLimit(xu) {
    const x = xu.slice(0, 3), u = xu.slice(3, 6), Tx = this.T(x);
    return stepFraction * norm(matVec(Tx, u)) / (norm(matVec(Tx, this.gammaUU(x, u))) + 1e-300);
  }
}

// How much the reference frame may change over one step of traceRay,
// |T(y1) T^-1(y) - 1|. The same control as in trace_ray in glsl/metrics/gp.glsl,
// but much finer: traceRay is the reference.
const rayFrameStep = 0.02;

const identity3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// Schwarzschild metric in Gullstrand–Painlevé (T, r, phi) coordinates:
//   ds^2 = -(1 - rs/r) dT^2 + 2 sqrt(rs/r) dT dr + dr^2 + r^2 dphi^2
// with T = t + 2 sqrt(rs r) + rs ln|(sqrt(r) - sqrt(rs)) / (sqrt(r) + sqrt(rs))|,
// t being the Schwarzschild time. Unlike Schwarzschild coordinates, these are
// regular at the (future) horizon and cover the black hole's interior. Space
// at constant T is flat.
//
// The reference frame is that of "raindrop" observers, falling freely from
// rest at infinity, u = (1, -sqrt(rs/r), 0); they exist everywhere.
export class GullstrandPainleve extends Metric {
  static id = 'gp';
  static label = 'Gullstrand–Painlevé';

  static endMessage = "You have hit the singularity:";
  static params = {rs: {label: 'Schwarzschild radius', default: 0.3}};
  static features = {blackHole: true};
  static glslFile = 'gp';

  get rs() {
    return this.params.rs;
  }

  // Gamma^mu_ab u^a v^b, and the same with v = u
  gammaUV(x, u, v) {
    return radialChristoffel(this, x, u, v);
  }

  gammaUU(x, u) {
    return radialChristoffel(this, x, u, u);
  }

  // rotate a screen-space cartesian 2-vector into the local orthonormal
  // (r-hat, phi-hat) basis at `x0`
  cartesianToLocal(x0, v) {
    const c = Math.cos(x0[2]), s = Math.sin(x0[2]);
    return [c * v[0] + s * v[1], -s * v[0] + c * v[1]];
  }

  toPlane(x) {
    return [x[1] * Math.cos(x[2]), x[1] * Math.sin(x[2])];
  }

  // Light rays are traced with their conserved energy E = -p_t and angular
  // momentum L = p_phi: rayEnergy(x, p) is E, rayDtdl(r, v, E, L) is dT/dl,
  // with v = dr/dl.

  rayEnergy(x, p) {
    const a = this.rs / x[1];
    return (1 - a) * p[0] - Math.sqrt(a) * p[1];
  }

  // (E + s v) / (1 - rs/r), rewritten using the null condition to be finite
  // at the horizon, except for rays heading into the past horizon (white
  // hole), which these coordinates don't cover: there dT/dl diverges, and
  // the ray's energy measured by the raindrop observer with it, changing
  // sign beyond, so the ray is stopped (see rayCanFollow). Rays are traced
  // backwards in time: those
  // crossing the horizon inwards came out of the white hole, and inside, rays
  // with E > 0 head there too; in a real black hole they would come from the
  // collapsed star.
  rayDtdl(r, v, E, L) {
    return (E * E + this.rs * L * L / (r * r * r)) / (E - Math.sqrt(this.rs / r) * v);
  }

  // Trace a light ray, a past-directed null geodesic from x0 with momentum p0,
  // from affine parameter 0 to 1. Mirrors trace_ray in glsl/metrics/gp.glsl: the
  // ray is traced using its conserved energy E and angular momentum L, as
  // y = [t, r, phi, v = dr/dl] with
  //   dt/dl = this.rayDtdl(r, v, E, L),  dr/dl = v,  dphi/dl = L / r^2,
  //   dv/dl = L^2 (r - 1.5 rs) / r^4,
  // which (except for t) is regular at the horizon. RK4 steps are at most
  // `maxStep`, and short enough that the reference frame changes little
  // (rayFrameStep); longer ones, and ones giving non-finite values, are retried
  // shorter, so that no step jumps across where the coordinates break down.
  // The ray is stopped where it can't be followed (this.rayCanFollow).
  // Returns {status, x, p}, with x and p at the end if it was reached.
  traceRay(x0, p0, maxStep = 1e-3) {
    const rs = this.rs;
    const E = this.rayEnergy(x0, p0), L = x0[1] * x0[1] * p0[2];
    const f = y => {
      const r = y[1];
      return [this.rayDtdl(r, y[3], E, L), y[3], L / (r * r), L * L * (r - 1.5 * rs) / (r * r * r * r)];
    };
    const momentum = y => [this.rayDtdl(y[1], y[3], E, L), y[3], L / (y[1] * y[1])];
    const e0 = matVec(this.T(x0), p0)[0];
    const canFollow = y => this.rayCanFollow(y.slice(0, 3), momentum(y), e0);
    // whether a step from y to y1 is short enough (false for non-finite values)
    const smallStep = (y, y1) => frobenius(matMul(this.T(y1.slice(0, 3)), this.Tinv(y.slice(0, 3)))
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

  g(x) {
    const r = x[1], a = this.rs / r, s = Math.sqrt(a);
    return [[-(1 - a), s, 0], [s, 1, 0], [0, 0, r * r]];
  }

  gInv(x) {
    const r = x[1], a = this.rs / r, s = Math.sqrt(a);
    return [[-1, s, 0], [s, 1 - a, 0], [0, 0, 1 / (r * r)]];
  }

  // d g / d r
  dgdr(x) {
    const r = x[1], s = Math.sqrt(this.rs / r);
    return [[-this.rs / (r * r), -s / (2 * r), 0], [-s / (2 * r), 0, 0], [0, 0, 2 * r]];
  }

  // raindrop frame: e_0 = (1, -s, 0), e_r = (0, 1, 0), e_phi = (0, 0, 1/r), s = sqrt(rs/r)
  T(x) {
    const r = x[1], s = Math.sqrt(this.rs / r);
    return [[1, 0, 0], [s, 1, 0], [0, 0, r]];
  }

  Tinv(x) {
    const r = x[1], s = Math.sqrt(this.rs / r);
    return [[1, 0, 0], [-s, 1, 0], [0, 0, 1 / r]];
  }

  // static frame, outside the horizon only:
  // e_0 = (1, 0, 0) / sqrt(q), e_r = (s / sqrt(q), sqrt(q), 0), e_phi = (0, 0, 1/r), q = 1 - rs/r
  staticT(x) {
    const r = x[1], s = Math.sqrt(this.rs / r), q = 1 - this.rs / r;
    if (!(q > 0)) return null;
    const sq = Math.sqrt(q);
    return [[sq, -s / sq, 0], [0, 1 / sq, 0], [0, 0, r]];
  }

  staticTinv(x) {
    const r = x[1], s = Math.sqrt(this.rs / r), q = 1 - this.rs / r;
    if (!(q > 0)) return null;
    const sq = Math.sqrt(q);
    return [[1 / sq, s / sq, 0], [0, sq, 0], [0, 0, 1 / r]];
  }
}

export const metricTypes = [GullstrandPainleve];
