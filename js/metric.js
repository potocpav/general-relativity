import { matVec, dot, scale } from './math.js';

// Bodies closer than this (in multiples of rs) are considered lost behind the
// event horizon. Schwarzschild coordinates are singular at r = rs.
export const horizonMargin = 1.02;

// 3-velocity from a 2-velocity given as coordinate velocity (dx/dt, dy/dt)
// in screen-aligned cartesian components, i.e. flat-space polar (dr/dt, r dphi/dt).
// Returns null if the velocity is not timelike.
export const velocity3 = (metric, x, u2_cart) => {
  const [vr, vphi] = metric.cartesianToLocal(x, u2_cart);
  const V = [1, vr, vphi / x[1]];
  const norm = -dot(V, matVec(metric.g(x), V));
  if (!(norm > 0)) return null;
  return scale(V, 1 / Math.sqrt(norm));
}

// 3-velocity from a physical 2-velocity measured by a static observer at x,
// given in screen-aligned cartesian components. Returns null if |v| >= 1
// or there is no static observer at x.
export const localVelocity3 = (metric, x, v2_cart) => {
  const frameInv = metric.staticTinv(x);
  if (frameInv === null) return null;
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

// Christoffel symbols contracted with u twice, Gamma^mu_ab u^a u^b, for a
// metric depending only on r:
//   Gamma^mu_ab = 1/2 g^mu nu (d_a g_nu b + d_b g_nu a - d_nu g_ab)
// where only d_r is non-zero, so
//   Gamma^mu_ab u^a u^b = 1/2 g^mu nu (2 u^r (g' u)_nu - delta^r_nu u.g'.u)
function radialChristoffelUU(metric, x, u) {
  const dgu = matVec(metric.dgdr(x), u);
  const udgu = dot(u, dgu);
  const w = dgu.map((v, nu) => 2 * u[1] * v - (nu == 1 ? udgu : 0));
  return scale(matVec(metric.gInv(x), w), 0.5);
}

// rotate a screen-space cartesian 2-vector into the local orthonormal
// (r-hat, phi-hat) basis at `x0`
function cartesianToLocal(x0, v) {
  const c = Math.cos(x0[2]), s = Math.sin(x0[2]);
  return [c * v[0] + s * v[1], -s * v[0] + c * v[1]];
}

// Metrics are in (time, r, phi) coordinates and depend only on r.
//
// Each metric defines a reference frame: an orthonormal frame at every point.
// T(x) takes coordinate components of a vector at x to reference frame
// components, Tinv(x) back. staticT / staticTinv are the frame of static
// observers, or null where there are none (inside the horizon).
// `glslId` selects the metric in glsl/physics.glsl (METRIC).

// Schwarzschild metric in Schwarzschild (t, r, phi) coordinates.
// The reference frame is that of static observers. The coordinates are
// singular at the horizon, so nothing can be followed across it.
export class Schwarzschild {
  static id = 'schwarzschild';
  static label = 'Schwarzschild';
  static glslId = 0;

  constructor(rs) {
    this.rs = rs;
  }

  isOutsideHorizon(x) {
    return x[1] > this.rs * horizonMargin;
  }

  g(x) {
    const r = x[1], a = 1 - this.rs / r;
    return [[-a, 0, 0], [0, 1 / a, 0], [0, 0, r * r]];
  }

  gInv(x) {
    const r = x[1], a = 1 - this.rs / r;
    return [[-1 / a, 0, 0], [0, a, 0], [0, 0, 1 / (r * r)]];
  }

  // d g / d r
  dgdr(x) {
    const r = x[1], rs = this.rs;
    return [[-rs / (r * r), 0, 0], [0, -rs / ((r - rs) * (r - rs)), 0], [0, 0, 2 * r]];
  }

  gammaUU(x, u) {
    return radialChristoffelUU(this, x, u);
  }

  T(x) {
    const r = x[1], s = Math.sqrt(1 - this.rs / r);
    return [[s, 0, 0], [0, 1 / s, 0], [0, 0, r]];
  }

  Tinv(x) {
    const r = x[1], s = Math.sqrt(1 - this.rs / r);
    return [[1 / s, 0, 0], [0, s, 0], [0, 0, 1 / r]];
  }

  staticT(x) {
    return x[1] > this.rs ? this.T(x) : null;
  }

  staticTinv(x) {
    return x[1] > this.rs ? this.Tinv(x) : null;
  }

  cartesianToLocal(x0, v) {
    return cartesianToLocal(x0, v);
  }
}

// Schwarzschild metric in Gullstrand–Painlevé (T, r, phi) coordinates:
//   ds^2 = -(1 - rs/r) dT^2 + 2 sqrt(rs/r) dT dr + dr^2 + r^2 dphi^2
// with T = t + gpTimeShift(r), t being the Schwarzschild time. Unlike
// Schwarzschild coordinates, these are regular at the (future) horizon and
// cover the black hole's interior. Space at constant T is flat.
//
// The reference frame is that of "raindrop" observers, falling freely from
// rest at infinity, u = (1, -sqrt(rs/r), 0); they exist everywhere.
export class GullstrandPainleve {
  static id = 'gp';
  static label = 'Gullstrand–Painlevé';
  static glslId = 1;

  constructor(rs) {
    this.rs = rs;
  }

  isOutsideHorizon(x) {
    return x[1] > this.rs * horizonMargin;
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

  gammaUU(x, u) {
    return radialChristoffelUU(this, x, u);
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

  cartesianToLocal(x0, v) {
    return cartesianToLocal(x0, v);
  }
}

export const metricTypes = [Schwarzschild, GullstrandPainleve];

// Gullstrand–Painlevé time minus Schwarzschild time at radius r > rs, and its
// derivative sqrt(rs/r) / (1 - rs/r).
export function gpTimeShift(rs, r) {
  return 2 * Math.sqrt(rs * r) + rs * Math.log(Math.abs((Math.sqrt(r) - Math.sqrt(rs)) / (Math.sqrt(r) + Math.sqrt(rs))));
}

function gpTimeShiftDerivative(rs, r) {
  return Math.sqrt(rs / r) / (1 - rs / r);
}

// Convert a position `x` and a vector `u` at it from the coordinates of
// metric `from` to those of `to`. Returns [x, u], or null if the point can't
// be represented in the target coordinates (inside the horizon).
export function convertState(from, to, x, u) {
  if (from.constructor === to.constructor) return [x, u];
  const rs = from.rs, r = x[1];
  if (!(r > rs)) return null;
  const sign = to instanceof GullstrandPainleve ? 1 : -1;
  return [
    [x[0] + sign * gpTimeShift(rs, r), r, x[2]],
    [u[0] + sign * gpTimeShiftDerivative(rs, r) * u[1], u[1], u[2]],
  ];
}
