// Autopilots for the article's figures: each returns the control for one step
// of the ship (see World.step), from its state.

import * as math from '../js/math.js';

// Fly the ship (in flat spacetime, from any position and velocity) to the
// point `target` (x, y) and hold it there, over the next `dt` of its proper
// time. It turns at once, and its acceleration and speed are limited on each
// axis separately: `limits` = {x: {accel, speed}, y: {accel, speed}}, the
// accelerations in c per second of its proper time, the speeds as fractions
// of c.
//
// Parametrized by the ship's proper time tau, each axis is a double
// integrator of its own: dx/dtau = w, dw/dtau = A, with w = u^x (the proper
// velocity, γ v, unbounded) and A the 4-acceleration's x component. So each
// axis follows the proper velocity that would stop it at the target under
// 90% of its acceleration, sqrt(2 a |d|) at the distance d (exact, at
// constant A), within the speed limit (as a proper velocity v / sqrt(1 - v²)),
// and close to the target, slowing in proportion, |d| / settleTime (a smooth
// final approach, rather than oscillating around it), steering towards it with
// an acceleration up to its limit. Once there (within `arrived`, nearly at
// rest), one last burn against the motion stops it exactly (rather than
// coasting on, drifting out and correcting again, back and forth), and then
// it coasts, at rest, its engine off. The 4-acceleration
// (A^t from being orthogonal to u) in the ship's rest frame then gives the
// heading and the engine's proper acceleration.
const settleTime = 0.5, arrived = 1e-4;
export function flyTo(world, target, dt, limits) {
  const {metric, obsvX: x, obsvU: u} = world;
  const d = [target[0] - x[1], target[1] - x[2]];
  if (Math.max(...d.map(Math.abs), Math.abs(u[1]), Math.abs(u[2])) < arrived) {
    // brake against the motion (in the rest frame, along the same direction: a boost along it keeps it), cutting
    // the burn where the ship is at rest: the rapidity falls linearly, along a fixed direction
    const w = Math.hypot(u[1], u[2]), accel = Math.min(limits.x.accel, limits.y.accel);
    if (!(w > 1e-12)) return {};
    return {heading: [-u[1] / w, -u[2] / w], accel, thrustTime: Math.asinh(w) / accel};
  }
  const A = [0, 0];
  for (const [i, {accel, speed}] of [limits.x, limits.y].entries()) {
    const wMax = speed / Math.sqrt(1 - speed * speed), dist = Math.abs(d[i]);
    const wWant = Math.sign(d[i]) * Math.min(wMax, Math.sqrt(1.8 * accel * dist), dist / settleTime);
    A[i] = Math.max(-accel, Math.min(accel, (wWant - u[i + 1]) / dt));
  }
  if (!(Math.hypot(...A) > 0)) return {};
  const At = (u[1] * A[0] + u[2] * A[1]) / u[0];
  const [, ax, ay] = math.matVec(math.coordToRest(metric, x, u), [At, ...A]);
  const accel = Math.hypot(ax, ay);
  return {heading: [ax / accel, ay / accel], accel};
}
