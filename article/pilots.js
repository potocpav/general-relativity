// Autopilots for the article's figures: each returns the control for one step
// of the ship (see World.step), from its state.

import { turnRate } from '../js/world.js';

// Fly the ship (in flat spacetime, at rest or moving along x) to x = `target`
// and stop there, firing its engine with a proper acceleration of at most
// `maxAccel`, over the next `dt` of its proper time. It turns only while the
// engine is off (at turnRate), so it never fires sideways. Above
// `maxSpeed` (a fraction of c), it coasts.
//
// It turns towards the target and accelerates at full thrust (for short
// distances, only up to a speed it can stop from in time). When stopping
// in the remaining distance d would take most of its thrust (allowing for
// the distance covered while turning around), it turns around and brakes,
// with the acceleration that stops it exactly at the target: under constant
// proper acceleration a, stopping from Lorentz factor γ takes the distance
// (γ - 1) / a, so a = (γ - 1) / d; recomputed at every step, this corrects
// itself. The last burn is cut where the ship comes to rest.
export function flyToX(world, target, dt, maxAccel, maxSpeed = 0.999) {
  const [ut, ux] = world.obsvU, gamma = ut;
  const v = Math.abs(ux / ut) < 1e-9 ? 0 : ux / ut; // numerically at rest, e.g. after a stop
  const d = target - world.obsvX[1], dir = Math.sign(d) || 1;
  const [ox, oy] = world.obsvO, angle = Math.atan2(oy, ox);
  if (Math.abs(d) < 1e-4 && v == 0) return {}; // arrived

  // turn towards the direction `want` (an angle), at most turnRate * dt; the engine fires once pointing there
  const turnTo = (want, accel, thrustTime) => {
    let delta = want - angle;
    delta -= 2 * Math.PI * Math.round(delta / (2 * Math.PI));
    if (Math.abs(delta) > turnRate * dt) {
      const a = angle + Math.sign(delta) * turnRate * dt;
      return {heading: [Math.cos(a), Math.sin(a)]};
    }
    return {heading: [Math.cos(want), Math.sin(want)], accel, thrustTime};
  };
  const towards = dir > 0 ? 0 : Math.PI, away = towards + Math.PI;

  if (v * dir > 0) {
    // approaching: the deceleration that would stop the ship at the target, and the distance covered while turning
    // around first (γ times the turning's proper time, in coordinate time)
    const stopAccel = (gamma - 1) / Math.abs(d);
    const turnAngle = Math.abs(Math.atan2(Math.sin(away - angle), Math.cos(away - angle)));
    const coast = Math.abs(v) * gamma * turnAngle / turnRate;
    // the distance needed to turn around and stop at full thrust, as a fraction of the remaining distance: brake
    // from 80%, leaving room to correct (also for deciding only once per step); once turning around, keep to it
    // unless below 50% (while turning, the remaining distance and the distance covered turning shrink alike, so a
    // single threshold would waver)
    const need = ((gamma - 1) / maxAccel + coast) / Math.abs(d);
    const turningAway = Math.cos(angle - towards) < 0.999;
    if (need >= (turningAway ? 0.5 : 0.8)) {
      const accel = Math.min(stopAccel, maxAccel);
      // rapidity falls linearly at constant proper acceleration: cut the burn where the ship is at rest
      return turnTo(away, accel, Math.atanh(Math.abs(v)) / accel);
    }
  }
  // moving away from the target: brake first, cutting the burn at rest (to plan anew)
  if (v * dir < 0) return turnTo(towards, maxAccel, Math.atanh(Math.abs(v)) / maxAccel);
  // accelerate towards the target, up to a speed from which turning around (taking T) and stopping fits in 70%
  // of the distance, v T + v² / 2a = 0.7 d (Newtonian: for short distances, where it matters, close enough), and
  // at most maxSpeed
  const T = Math.PI / turnRate;
  const topSpeed = Math.min(maxSpeed, maxAccel * (Math.sqrt(T * T + 1.4 * Math.abs(d) / maxAccel) - T));
  const thrustTime = (Math.atanh(topSpeed) - Math.atanh(Math.abs(v))) / maxAccel;
  return thrustTime > 0 ? turnTo(towards, maxAccel, thrustTime) : turnTo(towards, 0);
}
