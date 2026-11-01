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

// Schwarzschild metric in Schwarzschild (t, r, phi) coordinates.
//
// Each metric defines a reference frame: an orthonormal frame at every point,
// here the static observers. T(x) takes coordinate components of a vector at x
// to reference frame components, Tinv(x) back. staticT / staticTinv are the
// frame of static observers, or null where there are none.
export class Schwarzschild {
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

  // rotate a screen-space cartesian 2-vector into the local orthonormal
  // (r-hat, phi-hat) basis at `x0`
  cartesianToLocal(x0, v) {
    const c = Math.cos(x0[2]), s = Math.sin(x0[2]);
    return [c * v[0] + s * v[1], -s * v[0] + c * v[1]];
  }
}
