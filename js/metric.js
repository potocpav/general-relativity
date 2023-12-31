import * as math from './math.js';

// 3-velocity from 2-velocity (ds = -1)
// (supposing diagonal metric tensor)
export const velocity3 = (metric, x, u2_cart) => {
  const [ux, uy] = metric.viewportToWorld(x, u2_cart).tolist();
  const gx = metric.g(x);
  console.assert(gx.get(0,1) == 0 && gx.get(0,2) == 0 && gx.get(1,2) == 0);
  const lambda = Math.pow(-(gx.get(0,0) + gx.get(1,1) * ux*ux + gx.get(2,2) * uy*uy), -1/2);
  return nj.array([lambda, ux*lambda, uy*lambda]);
}

export class Schwarzschild {
  constructor(rs) {
    this.rs = rs;
  }

  g(x) {
    const r = x.get(1), rs = this.rs;
    return nj.array([[-(1 - rs / r), 0, 0], [0, 1 / (1 - rs / r), 0], [0, 0, r * r]]);
  }

  Gamma0(x) {
    const r = x.get(1), rs = this.rs;
    return nj.array([
      [0.0, rs / (2.0 * r * (r - rs)), 0.0],
      [rs / (2.0 * r * (r - rs)), 0.0, 0.0],
      [0.0, 0.0, 0.0]
    ]);
  }
  Gamma1(x) {
    const r = x.get(1), rs = this.rs;
    return nj.array([
      [rs * (r - rs) / (2.0 * r*r*r), 0.0, 0.0],
      [0.0, -rs / (2.0 * r * (r - rs)), 0.0],
      [0.0, 0.0, rs - r]
    ]);
  }
  Gamma2(x) {
    const r = x.get(1), rs = this.rs;
    return nj.array([
      [0.0, 0.0, 0.0],
      [0.0, 0.0, 1.0 / r],
      [0.0, 1.0 / r, 0.0]
    ]);
  }

  // Transform metric at point x to Minkowski metric
  // This could be maybe made generic across matrics, but for now
  // it's special-cased to diagonal matrices
  T(x) {
    const gx = this.g(x);
    return nj.array([
      [Math.sqrt(-gx.get(0,0)), 0.0, 0.0],
      [0.0, Math.sqrt(gx.get(1,1)), 0.0],
      [0.0, 0.0, Math.sqrt(gx.get(2,2))],
    ]);
  }

  // transformation from 2D screen-space element `x` into 2D world element
  // around a given working point `x0`
  //
  // FIXME: figure out whether this function is accurate around black holes.
  // It may be messing up our raindrop view of BH horizon angle while crossing it,
  // which should have radius of ~42 degrees.
  // FIXME: incorporate Lorentz transformation
  viewportToWorld(x0, x) {
    const r = x0.get(1), phi = x0.get(2);
    const A = nj.array([[Math.cos(phi), -r * Math.sin(phi)], [Math.sin(phi), r * Math.cos(phi)]]);
    return math.inverse2(A).dot(x);
  }
}

// Gullstrand–Painlevé coordinates
export class GP {
    constructor(rs) {
      this.rs = rs;
    }

    g(x) {
      const r = x.get(1), rs = this.rs;
      return nj.array([
        [-(1-rs/r), Math.sqrt(rs/r), 0],
        [Math.sqrt(rs/r), 1, 0],
        [0, 0, r * r]
      ]);
    }

    Gamma0(x) {
      const r = x.get(1), rs = this.rs;
      const rsr = rs / r;
      return nj.array([
        [rs * Math.sqrt(rsr) / (2*r*r), rs / (2*r*r), 0.0],
        [rs / (2*r*r), Math.sqrt(rsr) / (2*r), 0.0],
        [0.0, 0.0, -r*Math.sqrt(rsr)]
      ]);
    }
    Gamma1(x) {
      const r = x.get(1), rs = this.rs;
      const rsr = rs / r;
      return nj.array([
        [rs * (r - rs) / (2*r*r*r), -rs * Math.sqrt(rsr) / (2*r*r), 0.0],
        [-rs * Math.sqrt(rsr) / (2*r*r), -rs / (2*r*r), 0.0],
        [0.0, 0.0, -r + rs]
      ]);
    }
    Gamma2(x) {
      const r = x.get(1), rs = this.rs;
      return nj.array([
        [0.0, 0.0, 0.0],
        [0.0, 0.0, 1.0 / r],
        [0.0, 1.0 / r, 0.0]
      ]);
    }

    // Transform metric at point x to Minkowski metric
    // This could be maybe made generic across matrics, but for now
    // it's special-cased to diagonal matrices
    T(x) {
      // TODO: fix for GP metric
      const gx = this.g(x);
      return nj.array([
        [Math.sqrt(-gx.get(0,0)), 0.0, 0.0],
        [0.0, Math.sqrt(gx.get(1,1)), 0.0],
        [0.0, 0.0, Math.sqrt(gx.get(2,2))],
      ]);
    }

    // transformation from 2D screen-space element `x` into 2D world element
    // around a given working point `x0`
    //
    // FIXME: figure out whether this function is accurate around black holes.
    // It may be messing up our raindrop view of BH horizon angle while crossing it,
    // which should have radius of ~42 degrees.
    // FIXME: incorporate Lorentz transformation
    viewportToWorld(x0, x) {
      const r = x0.get(1), phi = x0.get(2);
      const A = nj.array([[Math.cos(phi), -r * Math.sin(phi)], [Math.sin(phi), r * Math.cos(phi)]]);
      return math.inverse2(A).dot(x);
    }
  }
