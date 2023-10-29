
import * as math from './math.js';

var gl;

export class World {
  constructor(gl_, metric) {
    gl = gl_;

    this.lastDate = undefined;
    this.time = 0;
    this.metric = metric;
    this.dt = 0.017;
  }
  compile(program) {
    this.time_loc = gl.getUniformLocation(program, 'time');
    this.obsv_x_loc = gl.getUniformLocation(program, 'obsv_x');
    this.obsv_u_loc = gl.getUniformLocation(program, 'obsv_u');
    this.obsv_o_loc = gl.getUniformLocation(program, 'obsv_o');
    this.obsv_sprite_loc = gl.getUniformLocation(program, 'obsv_sprite');
    this.rs_loc = gl.getUniformLocation(program, 'rs');
    this.screen_size_loc = gl.getUniformLocation(program, 'screen_size');

    // just a debugging event
    this.event_x_loc = gl.getUniformLocation(program, 'event_x');
  }

  update(mousePos, pointerDn, screenDim) {
    var date = Date.now() / 1000;
    var targetDt;
    if (this.lastDate !== undefined) {
      targetDt = (date - this.lastDate) * this.timeScale;
      targetDt = Math.max(0.01, Math.min(0.1, targetDt));
      this.dt = this.dt * 0.99 + targetDt * 0.01;
    }
    this.lastDate = date;
    this.time += this.dt;

    // rocket motor
    var accel3_rest = nj.array([0,0,0]);
    const acceleration = 0.5;
    if (mousePos.get(0) != 0 || mousePos.get(1) != 0) {
      const mouseViewport = screenToViewport(mousePos, screenDim, this.viewportSize);
      const mouseRel = mouseViewport.multiply(-1);
      const accelViewport = mouseRel.multiply(acceleration/Math.sqrt(mouseRel.dot(mouseRel).get(0)));
      const accelPolar = this.metric.viewportToWorld(this.obsvX, accelViewport);
      const accelWorld = nj.array([0, accelPolar.get(0), accelPolar.get(1)]);
      if (pointerDn) {
        this.obsvO = accelWorld.slice([1,3]);
        accel3_rest = accelWorld;
      }
    }

    const XU = nj.concatenate(this.obsvX, this.obsvU);
    const XU1 = math.rk4(math.geo_f(this.metric, accel3_rest), XU, this.dt);

    this.obsvX = XU1.slice([0, 3]);
    this.obsvU = XU1.slice([3, 6]);
    this.obsvSprite = pointerDn ? 1 : 0;
  }

  // get world coordinates under the screen coordinates
  getWorldPos(screen, screenDim) {
    const viewport = screenToViewport(screen, screenDim, this.viewportSize);
    const world2 = this.metric.viewportToWorld(this.obsvX, viewport);
    const world3 = light3(this.metric.g(this.obsvX), world2);
    const u0 = math.general_boost(this.metric.T(this.obsvX), math.neg_u(this.obsvU)).dot(world3);

    // raytracing along null geodesics
    const max_iters = 10;
    const dl = 1 / max_iters
    var xu = nj.concatenate(this.obsvX, u0);
    for (var tau = 0; tau < 1; tau += dl) {
      xu = math.rk4(math.geo_f(this.metric, undefined), xu, dl);
    }
    return xu.slice([0,3]);
  }

  render() {
    gl.uniform1f(this.time_loc, this.time);
    gl.uniform3f(this.obsv_x_loc, this.obsvX.get(0), this.obsvX.get(1), this.obsvX.get(2));
    gl.uniform3f(this.obsv_u_loc, this.obsvU.get(0), this.obsvU.get(1), this.obsvU.get(2));
    gl.uniform2f(this.obsv_o_loc, this.obsvO.get(0), this.obsvO.get(1));
    gl.uniform1i(this.obsv_sprite_loc, this.obsvSprite);
    gl.uniform1f(this.rs_loc, this.rs);
    gl.uniform1f(this.screen_size_loc, this.viewportSize);
    gl.uniform3f(this.event_x_loc, this.eventX.get(0), this.eventX.get(1), this.eventX.get(2));
  }
}

// screen coords  [px] to viewport coords  [s]
function screenToViewport(s, screenDim, viewportSize) {
	const meanRes = (screenDim.get(0) + screenDim.get(1)) / 2.0;
	return s.subtract(screenDim.divide(2.0)).divide(meanRes).multiply(viewportSize / 2.0);
}

// compute 3-vector out of a 2-vector so that ds = 0
// (supposing a diagonal metric)
function light3(gx, u2) {
  const [x, y] = u2.tolist();
  const u3 = nj.array([0, x, y]);
	const res = gx.dot(u3).dot(u3).get(0) / gx.get(0,0);
	return nj.array([-Math.sqrt(-res), x, y]);
}
