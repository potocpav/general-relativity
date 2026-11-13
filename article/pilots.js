// Pilots for the article's figures: each returns the control for one step of
// the ship (see World.step), from the ship's state.

import { thrust, turnRate } from '../js/world.js';

// The ship's velocity along x relative to the reference observers (in flat
// spacetime: the grid), from its 4-velocity in Cartesian coordinates.
export const velocityX = world => world.obsvU[1] / world.obsvU[0];

// Fly the ship (in flat spacetime, moving along x) to velocity `target` along
// x, over the next `dt` seconds. It turns towards the direction it needs to
// accelerate in, at the app's turn rate and without thrust, then fires its
// engine with proper acceleration `accel` (by default, the app's) until its
// velocity matches; the burn is
// cut exactly there, as the rapidity atanh(v) grows linearly with proper time
// under constant proper acceleration. Then it coasts, keeping its heading.
export function matchVelocity(world, target, dt, accel = thrust) {
  const dEta = Math.atanh(target) - Math.atanh(velocityX(world));
  if (!(Math.abs(dEta) > 1e-12)) return {};
  const want = dEta > 0 ? 0 : Math.PI, [ox, oy] = world.obsvO, angle = Math.atan2(oy, ox);
  let turn = want - angle;
  turn -= 2 * Math.PI * Math.round(turn / (2 * Math.PI));
  if (Math.abs(turn) > turnRate * dt) {
    const a = angle + Math.sign(turn) * turnRate * dt;
    return {heading: [Math.cos(a), Math.sin(a)]};
  }
  return {heading: [Math.cos(want), Math.sin(want)], accel, thrustTime: Math.abs(dEta) / accel};
}
