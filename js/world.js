
import * as math from './math.js';

var gl;

export class World {
  constructor(gl_, metric) {
    gl = gl_;

    this.lastDate = undefined;
    this.time = 0;
    this.metric = metric;
  }
  compile(program) {
    this.time_loc = gl.getUniformLocation(program, 'time');
    this.obsv_x_loc = gl.getUniformLocation(program, 'obsv_x');
    this.obsv_u_loc = gl.getUniformLocation(program, 'obsv_u');
    this.obsv_o_loc = gl.getUniformLocation(program, 'obsv_o');
    this.obsv_sprite_loc = gl.getUniformLocation(program, 'obsv_sprite');
    this.rs_loc = gl.getUniformLocation(program, 'rs');
    this.screen_size_loc = gl.getUniformLocation(program, 'screen_size');
  }

  update(mouseX, mouseY, pointerDn) {
    // physics
    var dt = 0.01;
    var date = Date.now() / 1000;
    if (this.lastTime !== undefined) {
      dt = (date - this.lastDate) * this.timeScale;
      console.log(Date.now() / 1000, this.lastTime, dt);
      dt = Math.max(0.01, Math.min(0.1, dt));
    }
    this.lastDate = date;
    this.time += dt;

    // rocket motor
    var accel3_rest = nj.array([0,0,0]);
    const acceleration = 0.5;
    if (mouseX !== undefined) {
      const mouse_rel = nj.array([0, 0.5 - mouseX, 0.5 - mouseY]);
      const accelScreen = mouse_rel.multiply(acceleration/Math.sqrt(mouse_rel.dot(mouse_rel).get(0)));
      const accelPolar = this.metric.dScreenToWorld(this.obsvX, accelScreen);
      if (pointerDn) {
        this.obsvO = accelPolar.slice([1,3]);
        accel3_rest = accelPolar;
      }
    }

    const XU = nj.concatenate(this.obsvX, this.obsvU);
    const XU1 = math.rk4(math.geo_f(this.metric, accel3_rest), XU, dt);

    this.obsvX = XU1.slice([0, 3]);
    this.obsvU = XU1.slice([3, 6]);
    this.obsvSprite = pointerDn ? 1 : 0;
  }

  render() {
    gl.uniform1f(this.time_loc, this.time);
    gl.uniform3f(this.obsv_x_loc, this.obsvX.get(0), this.obsvX.get(1), this.obsvX.get(2));
    gl.uniform3f(this.obsv_u_loc, this.obsvU.get(0), this.obsvU.get(1), this.obsvU.get(2));
    gl.uniform2f(this.obsv_o_loc, this.obsvO.get(0), this.obsvO.get(1));
    gl.uniform1i(this.obsv_sprite_loc, this.obsvSprite);
    gl.uniform1f(this.rs_loc, this.rs);
    gl.uniform1f(this.screen_size_loc, this.screenSize);
  }
}