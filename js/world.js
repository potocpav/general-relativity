
import * as math from './math.js';
import { convertState } from './metric.js';

var gl;

const thrust = 0.5;      // rocket acceleration in its rest frame
const turnRate = Math.PI; // ship rotation speed [rad per real-time second]
const maxStep = 0.02;    // max. proper-time RK4 step for the observer

export class World {
  constructor(gl_, metric) {
    gl = gl_;

    this.lastRealTime = undefined;
    this.time = 0;
    this.timeScale = 1;
    this.viewportSize = 20;
    this.metric = metric;
    this.dt = 0.017;
    this.fps = 1 / this.dt;
    this.crashed = false;
    this.showPhotonSphere = true;
    this.showEventHorizon = true;
    this.showRedshift = true;
  }

  // Ship heading as an angle in screen-aligned cartesian coordinates,
  // so that it doesn't rotate with the polar frame while orbiting.
  reset(x, u, heading = Math.PI / 2) {
    this.time = 0;
    this.obsvX = x;
    this.obsvU = u;
    this.heading = heading;
    this.obsvO = this.metric.cartesianToLocal(x, headingVector(this.heading));
    this.obsvSprite = 0;
    this.crashed = false;
  }

  // Switch to the coordinates of `metric`, converting the observer's state.
  // Returns false (and changes nothing) if the observer's position can't be
  // represented in them.
  setMetric(metric) {
    const state = convertState(this.metric, metric, this.obsvX, this.obsvU);
    if (state === null) return false;
    [this.obsvX, this.obsvU] = state;
    this.metric = metric;
    // continue if the new coordinates can follow the observer further
    if (this.crashed && metric.canFollow(this.obsvX)) this.crashed = false;
    return true;
  }

  compile(program) {
    this.time_loc = gl.getUniformLocation(program, 'time');
    this.obsv_x_loc = gl.getUniformLocation(program, 'obsv_x');
    this.obsv_u_loc = gl.getUniformLocation(program, 'obsv_u');
    this.obsv_o_loc = gl.getUniformLocation(program, 'obsv_o');
    this.obsv_sprite_loc = gl.getUniformLocation(program, 'obsv_sprite');
    this.rs_loc = gl.getUniformLocation(program, 'rs');
    this.viewport_size_loc = gl.getUniformLocation(program, 'viewport_size');
    this.show_photon_sphere_loc = gl.getUniformLocation(program, 'show_photon_sphere');
    this.show_event_horizon_loc = gl.getUniformLocation(program, 'show_event_horizon');
    this.show_redshift_loc = gl.getUniformLocation(program, 'show_redshift');
  }

  // `mousePos` is null when the pointer position is unknown.
  // `keys.thrust` (bool) fires the engine along the heading,
  // `keys.turn` (-1, 0, 1) rotates the ship clockwise / counter-clockwise.
  update(time, mousePos, pointerDn, screenDim, keys) {
    var realTimeDt = 0.017;
    if (this.lastRealTime !== undefined) {
      realTimeDt = time - this.lastRealTime;
      if (realTimeDt > 0) {
        this.fps = 0.99 * this.fps + 0.01 / realTimeDt;
      }
    }
    this.lastRealTime = time;
    realTimeDt = Math.max(0.005, Math.min(0.1, realTimeDt));
    this.dt = realTimeDt * this.timeScale;

    this.obsvSprite = 0;
    if (this.crashed) return;

    // steering
    this.heading += keys.turn * turnRate * realTimeDt;
    var thrusting = keys.thrust;
    if (pointerDn && mousePos) {
      const mouseViewport = screenToViewport(mousePos, screenDim, this.viewportSize);
      if (math.norm(mouseViewport) > 1e-9) {
        // point away from the pointer
        this.heading = Math.atan2(-mouseViewport[1], -mouseViewport[0]);
        thrusting = true;
      }
    }
    // heading in the local orthonormal (r, phi) frame
    this.obsvO = this.metric.cartesianToLocal(this.obsvX, headingVector(this.heading));

    // rocket motor, in the ship's rest frame
    var accel3_rest = undefined;
    if (thrusting) {
      accel3_rest = [0, thrust * this.obsvO[0], thrust * this.obsvO[1]];
      this.obsvSprite = 1;
    }

    const f = math.geo_f(this.metric, accel3_rest);
    const xu = math.integrate(this.metric, f, [...this.obsvX, ...this.obsvU], this.dt, maxStep);
    if (xu === null) {
      this.crashed = true;
      return;
    }
    this.time += this.dt;
    this.obsvX = xu.slice(0, 3);
    this.obsvU = xu.slice(3, 6);
  }

  // get world coordinates under the screen coordinates,
  // or null if the ray doesn't reach them
  getWorldPos(screen, screenDim) {
    const viewport = screenToViewport(screen, screenDim, this.viewportSize);
    const u0 = screenRay(this.metric, this.obsvX, this.obsvU, viewport);

    // raytracing along null geodesics, affine parameter from 0 to 1
    const ray = math.traceRay(this.metric, this.obsvX, u0);
    return ray.status == math.RAY_REACHED ? ray.x : null;
  }

  render() {
    gl.uniform1f(this.time_loc, this.time);
    gl.uniform3f(this.obsv_x_loc, ...this.obsvX);
    gl.uniform3f(this.obsv_u_loc, ...this.obsvU);
    gl.uniform2f(this.obsv_o_loc, ...this.obsvO);
    gl.uniform1i(this.obsv_sprite_loc, this.obsvSprite);
    gl.uniform1f(this.rs_loc, this.metric.rs);
    gl.uniform1f(this.viewport_size_loc, this.viewportSize);
    gl.uniform1i(this.show_photon_sphere_loc, this.showPhotonSphere ? 1 : 0);
    gl.uniform1i(this.show_event_horizon_loc, this.showEventHorizon ? 1 : 0);
    gl.uniform1i(this.show_redshift_loc, this.showRedshift ? 1 : 0);
  }
}

const headingVector = angle => [Math.cos(angle), Math.sin(angle)];

// screen coords  [px] to viewport coords  [s]
export function screenToViewport(s, screenDim, viewportSize) {
  const meanRes = (screenDim[0] + screenDim[1]) / 2.0;
  return s.map((v, i) => (v - screenDim[i] / 2.0) / meanRes * viewportSize / 2.0);
}

// The light ray (past-directed null vector, coordinate components) that the
// observer at `x` with 4-velocity `u` sees at viewport vector `v`. The screen
// axes are the observer's rest frame axes, rotated to screen-aligned
// (cartesian) directions, so screen angles and short distances are the ones
// the observer measures. The photon energy measured by the observer is |v|.
export function screenRay(metric, x, u, v) {
  const local = metric.cartesianToLocal(x, v);
  return math.matVec(math.restToCoord(metric, x, u), [-math.norm(local), ...local]);
}
