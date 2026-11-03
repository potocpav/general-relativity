import { matVec, dot, scale } from './math.js';

// In Schwarzschild coordinates, which are singular at r = rs, bodies closer
// than this (in multiples of rs) are considered lost behind the event horizon.
// Light rays use it in both coordinates, see rayTerminated.
export const horizonMargin = 1.02;

// In Gullstrand–Painlevé coordinates, bodies are followed until this radius
// (in multiples of rs), close to the singularity at r = 0.
export const singularityRadius = 0.005;

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
// for a metric depending only on r:
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
//
// canFollow(x): whether bodies at x can be followed; stepLimit(xu): max.
// integration step for a body there, approaching where it can't.
//
// Light rays are traced with their conserved energy E = -p_t and angular
// momentum L = p_phi (see traceRay in js/math.js and glsl/physics.glsl):
// rayEnergy(x, p) is E, rayDtdl(r, v, E, L) is dt/dl, with v = dr/dl, and
// rayTerminated(y, E) whether a ray at y = [t, r, phi, v] went where it can't
// be followed (into the black hole's shadow).

// Schwarzschild metric in Schwarzschild (t, r, phi) coordinates.
// The reference frame is that of static observers. The coordinates are
// singular at the horizon, so nothing can be followed across it.
export class Schwarzschild {
  static id = 'schwarzschild';
  static label = 'Schwarzschild';
  static glslId = 0;

  static endMessage = "You have reached the event horizon: Schwarzschild coordinates can't follow you inside. Switch to Gullstrand–Painlevé to continue, or";

  constructor(rs) {
    this.rs = rs;
  }

  canFollow(x) {
    return x[1] > this.rs * horizonMargin;
  }

  stepLimit(xu) {
    return 0.1 * (xu[1] - this.rs) / (Math.abs(xu[4]) + 1e-12);
  }

  rayEnergy(x, p) {
    return (1 - this.rs / x[1]) * p[0];
  }

  rayDtdl(r, v, E, L) {
    return E / (1 - this.rs / r);
  }

  rayTerminated(y, E) {
    return y[1] < this.rs * horizonMargin;
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

  // Gamma^mu_ab u^a v^b, and the same with v = u
  gammaUV(x, u, v) {
    return radialChristoffel(this, x, u, v);
  }

  gammaUU(x, u) {
    return radialChristoffel(this, x, u, u);
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

  static endMessage = "You have hit the singularity:";

  constructor(rs) {
    this.rs = rs;
  }

  canFollow(x) {
    return x[1] > this.rs * singularityRadius;
  }

  stepLimit(xu) {
    return 0.1 * xu[1] / (Math.abs(xu[4]) + 1e-12);
  }

  rayEnergy(x, p) {
    const a = this.rs / x[1];
    return (1 - a) * p[0] - Math.sqrt(a) * p[1];
  }

  // (E + s v) / (1 - rs/r), rewritten using the null condition to be finite
  // at the horizon, except for rays heading into the past horizon
  rayDtdl(r, v, E, L) {
    return (E * E + this.rs * L * L / (r * r * r)) / (E - Math.sqrt(this.rs / r) * v);
  }

  // Rays are traced backwards in time. A ray that crosses the horizon inwards
  // came out of the past horizon (white hole), which these coordinates don't
  // cover. Inside, rays with E > 0 head there too, never leaving; in a real
  // black hole they would come from the collapsed star.
  rayTerminated(y, E) {
    return (y[1] < this.rs && y[3] < 0) || (E > 0 && y[1] > this.rs / horizonMargin);
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

  // Gamma^mu_ab u^a v^b, and the same with v = u
  gammaUV(x, u, v) {
    return radialChristoffel(this, x, u, v);
  }

  gammaUU(x, u) {
    return radialChristoffel(this, x, u, u);
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
