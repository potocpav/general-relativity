import {geo_f, rk4} from './math.js';

const dt = 0.1;

export class Trajectory {
  constructor(metric, obj_i, x0, u0) {
    this.metric = metric;
    this.obj_i = obj_i;
    this.x = x0;
    this.u = u0;
    this.tau = 0;
  }

  simulate(n) {
    var xs = new Float32Array(n*3), us = new Float32Array(n*3), it = new Float32Array(n*2);
    var xu = nj.concatenate(this.x, this.u);
    for (var i = 0; i < n; i++) {
      if (i > 0) {
        xu = rk4(geo_f(this.metric, undefined), xu, dt);
        this.tau += dt;
      }

      xs[i*3 + 0] = xu.get(0);
      xs[i*3 + 1] = xu.get(1);
      xs[i*3 + 2] = xu.get(2);
      us[i*3 + 0] = xu.get(3);
      us[i*3 + 1] = xu.get(4);
      us[i*3 + 2] = xu.get(5);
      it[i*2 + 0] = this.obj_i;
      it[i*2 + 1] = this.tau;
    }
    return {"xs": xs, "us": us, "it": it, "n": n};
  }
}
