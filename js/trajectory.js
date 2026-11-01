import {geo_f, integrate} from './math.js';

const dtau = 0.1;     // proper time between stored trajectory points
const maxStep = 0.02; // max. RK4 step

export class Trajectory {
  constructor(metric, obj_i, x0, u0) {
    this.metric = metric;
    this.obj_i = obj_i;
    this.x = x0;
    this.u = u0;
  }

  // Points after the body can't be followed (see metric.canFollow) are filled with NaN.
  simulate(n) {
    const xs = new Float32Array(n*3).fill(NaN);
    const us = new Float32Array(n*3).fill(NaN);
    const it = new Float32Array(n*2);
    const f = geo_f(this.metric);
    var xu = [...this.x, ...this.u];
    var alive = this.metric.canFollow(xu);
    for (var i = 0; i < n; i++) {
      if (i > 0 && alive) {
        xu = integrate(this.metric, f, xu, dtau, maxStep);
        alive = xu !== null;
      }

      it[i*2 + 0] = this.obj_i;
      it[i*2 + 1] = i * dtau;
      if (alive) {
        xs.set(xu.slice(0, 3), i*3);
        us.set(xu.slice(3, 6), i*3);
      }
    }
    return {"xs": xs, "us": us, "it": it, "n": n};
  }
}
