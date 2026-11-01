// Bodies closer than this (in multiples of rs) are considered lost behind the
// event horizon. Schwarzschild coordinates are singular at r = rs.
export const horizonMargin = 1.02;

// 3-velocity from a 2-velocity given as coordinate velocity (dx/dt, dy/dt)
// in screen-aligned cartesian components (ds = -1).
// Returns null if the velocity is not timelike.
// (supposing diagonal metric tensor)
export const velocity3 = (metric, x, u2_cart) => {
  const [vr, vphi] = metric.cartesianToLocal(x, u2_cart);
  const ux = vr, uy = vphi / x[1]; // flat-space polar coordinate velocity
  const gx = metric.g(x);
  const norm = -(gx[0][0] + gx[1][1] * ux*ux + gx[2][2] * uy*uy);
  if (!(norm > 0)) return null;
  const lambda = Math.pow(norm, -1/2);
  return [lambda, ux*lambda, uy*lambda];
}

// 3-velocity from a physical 2-velocity measured by a static observer at x,
// given in screen-aligned cartesian components. Returns null if |v| >= 1
// or x is not outside the horizon.
export const localVelocity3 = (metric, x, v2_cart) => {
  if (!metric.isOutsideHorizon(x)) return null;
  const [vr, vphi] = metric.cartesianToLocal(x, v2_cart);
  const v2 = vr*vr + vphi*vphi;
  if (!(v2 < 1)) return null;
  const gamma = 1 / Math.sqrt(1 - v2);
  const Tx = metric.T(x);
  return [gamma / Tx[0][0], gamma * vr / Tx[1][1], gamma * vphi / Tx[2][2]];
}

export class Schwarzschild {
  constructor(rs) {
    this.rs = rs;
  }

  isOutsideHorizon(x) {
    return x[1] > this.rs * horizonMargin;
  }

  g(x) {
    const r = x[1], rs = this.rs;
    return [[-(1 - rs / r), 0, 0], [0, 1 / (1 - rs / r), 0], [0, 0, r * r]];
  }

  // Christoffel symbols contracted with u twice: Gamma^mu_ab u^a u^b
  // (only the non-zero symbols are evaluated)
  gammaUU(x, u) {
    const r = x[1], rs = this.rs;
    const [ut, ur, uphi] = u;
    const a = rs / (2.0 * r * (r - rs)); // Gamma^t_tr = -Gamma^r_rr
    return [
      2.0 * a * ut * ur,
      rs * (r - rs) / (2.0 * r*r*r) * ut*ut - a * ur*ur + (rs - r) * uphi*uphi,
      2.0 / r * ur * uphi,
    ];
  }

  // Transform metric at point x to Minkowski metric
  // This could be maybe made generic across matrics, but for now
  // it's special-cased to diagonal matrices
  T(x) {
    const gx = this.g(x);
    return [
      [Math.sqrt(-gx[0][0]), 0.0, 0.0],
      [0.0, Math.sqrt(gx[1][1]), 0.0],
      [0.0, 0.0, Math.sqrt(gx[2][2])],
    ];
  }

  // Transformation from a 2D screen-space element `v` into a 2D world element
  // (dr, dphi) at `x0`. The screen axes are the local orthonormal frame of a
  // static observer at `x0`, rotated to screen-aligned (cartesian) directions,
  // so that screen angles and lengths are the ones measured locally.
  // The observer's own motion is applied afterwards, by a Lorentz boost.
  viewportToWorld(x0, v) {
    const [vr, vphi] = this.cartesianToLocal(x0, v);
    const Tx = this.T(x0);
    return [vr / Tx[1][1], vphi / Tx[2][2]];
  }

  // rotate a screen-space cartesian 2-vector into the local orthonormal
  // (r-hat, phi-hat) basis at `x0`
  cartesianToLocal(x0, v) {
    const c = Math.cos(x0[2]), s = Math.sin(x0[2]);
    return [c * v[0] + s * v[1], -s * v[0] + c * v[1]];
  }
}
