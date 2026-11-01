// Scenarios: preset initial states showing interesting features of general
// relativity and the Schwarzschild black hole.
//
// Each scenario has a `setup(metric)` returning the initial state in the
// coordinates of `metric` (an instance of the scenario's `metric` class, or of
// the current one if that is null):
//   {ship: {x, u, heading}, objects: [{type, x, u}], viewportSize,
//    timeSlider (log10 of the time scale), paused}
// Scenarios without `setup` are placeholders, shown disabled.

import * as math from './math.js';
import { Schwarzschild, GullstrandPainleve, velocity3, localVelocity3, convertState } from './metric.js';
import { asteroidId, photonClockId } from './object-info.js';

// --- helpers; positions are (r, phi), velocities in Schwarzschild coordinates

// effective potential: E^2 at the turning points of a timelike geodesic
const potential = (rs, r, L) => (1 - rs / r) * (1 + L * L / (r * r));

function bisect(g, a, b) {
  const ga = g(a) > 0;
  for (let i = 0; i < 100; i++) {
    const c = (a + b) / 2;
    (g(c) > 0) == ga ? a = c : b = c;
  }
  return (a + b) / 2;
}

// Geodesic with energy E and angular momentum L at radius r, moving towards
// +phi and inwards (or outwards), as [x, u] in Schwarzschild coordinates.
function orbitState(rs, r, phi, E, L, inwards = true) {
  const vr2 = E * E - potential(rs, r, L);
  const ur = (inwards ? -1 : 1) * Math.sqrt(Math.max(0, vr2));
  return [[0, r, phi], [E / (1 - rs / r), ur, L / (r * r)]];
}

// E and L of a bound orbit between periapsis rp and apoapsis ra
function orbitConstants(rs, rp, ra) {
  const L2 = bisect(L2 => potential(rs, rp, Math.sqrt(L2)) - potential(rs, ra, Math.sqrt(L2)), 1e-9, 1e3);
  const L = Math.sqrt(L2);
  return {E: Math.sqrt(potential(rs, ra, L)), L};
}

// circular orbit at r, with the speed scaled by `factor`, moving towards +phi
function circularOrbit(metric, r, phi, factor = 1) {
  const x = [0, r, phi];
  const tangential = [-Math.sin(phi), Math.cos(phi)];
  return [x, velocity3(metric, x, math.scale(tangential, factor * Math.sqrt(metric.rs / (2 * r))))];
}

// at rest relative to a static observer
const atRest = (metric, r, phi) => {
  const x = [0, r, phi];
  return [x, localVelocity3(metric, x, [0, 0])];
};

// convert a Schwarzschild-coordinates state to `metric`'s coordinates
const fromSchwarzschild = (metric, [x, u]) => convertState(new Schwarzschild(metric.rs), metric, x, u);

// free-fall state `tau` proper time before (x, u): geodesics are
// time-reversible, so integrate forward with the velocity reversed
function backwards(metric, [x, u], tau) {
  const xu = math.integrate(metric, math.geo_f(metric), [...x, ...math.scale(u, -1)], tau, 0.02);
  return [xu.slice(0, 3), math.scale(xu.slice(3, 6), -1)];
}

const ship = ([x, u], heading = Math.PI / 2) => ({x, u, heading});
const object = (type, [x, u]) => ({type, x, u});

const defaults = {viewportSize: 20, timeSlider: 0, paused: false};

// --- scenarios

export const scenarios = [
  {
    id: 'free',
    name: 'Free play',
    description: 'A circular orbit at 10 rs, with a photon clock falling past. ' +
      'Boost with the mouse or the arrow keys, spawn objects, and explore.',
    metric: null, // keep the current coordinates
    setup: metric => {
      const rs = metric.rs;
      const clock = [[0, 25 * rs, 0], velocity3(metric, [0, 25 * rs, 0], [0, -0.12])];
      return {
        ...defaults,
        ship: ship(circularOrbit(metric, 10 * rs, 0)),
        // started in the past, so that the clock is visible right away
        objects: [object(photonClockId, backwards(metric, clock, 40))],
      };
    },
  },
  {
    id: 'precession',
    name: 'Perihelion precession',
    description: 'An eccentric orbit between 8 and 20 rs does not close: each closest ' +
      'approach happens about 60° further around than the last (watch φ, the third ' +
      'coordinate), so the orbit traces a rosette. This is the effect first seen in the ' +
      'orbit of Mercury, here much larger.',
    metric: Schwarzschild,
    setup: metric => {
      const rs = metric.rs, ra = 20 * rs;
      const {E, L} = orbitConstants(rs, 8 * rs, ra);
      return {
        ...defaults,
        viewportSize: 30, timeSlider: 1,
        ship: ship(fromSchwarzschild(metric, orbitState(rs, ra, 0, E, L))),
        objects: [],
      };
    },
  },
  {
    id: 'isco',
    name: 'Innermost stable circular orbit',
    description: 'Below 3 rs, circular orbits are unstable. Two asteroids start on ' +
      'circular orbits, slightly too slow: at 4 rs (1% slow) it just wobbles, ' +
      'at 2.5 rs (0.1% slow) it plunges into the black hole. Newtonian gravity has no such limit.',
    metric: Schwarzschild,
    setup: metric => {
      const rs = metric.rs;
      return {
        ...defaults,
        viewportSize: 7,
        ship: ship(circularOrbit(metric, 6 * rs, 0)),
        objects: [
          object(asteroidId, circularOrbit(metric, 4 * rs, 2.0, 0.99)),
          object(asteroidId, circularOrbit(metric, 2.5 * rs, 4.0, 0.999)),
        ],
      };
    },
  },
  {
    id: 'zoom-whirl',
    name: 'Zoom-whirl orbit',
    description: 'An orbit tuned just above capture: the ship whirls around the black hole ' +
      'about twice near 2.1 rs before zooming back out to 37 rs. Close to the black hole, ' +
      'orbits can wind around many times before leaving.',
    metric: Schwarzschild,
    setup: metric => {
      const rs = metric.rs, L = 1.95 * rs;
      const ru = L * L / rs * (1 - Math.sqrt(1 - 3 * rs * rs / (L * L))); // unstable circular orbit
      const E = Math.sqrt(potential(rs, ru, L) * (1 - 1e-4));
      return {
        ...defaults,
        viewportSize: 8, timeSlider: 0.3,
        ship: ship(fromSchwarzschild(metric, orbitState(rs, 10 * rs, 0, E, L))),
        objects: [],
      };
    },
  },
  {
    id: 'fall-in',
    name: 'Falling into the black hole',
    description: 'Dropped from rest at 10 rs, the ship falls through the event horizon ' +
      '(nothing special happens there locally) and reaches the singularity in finite time. ' +
      'At the horizon, the black hole covers 42° around the inward direction. ' +
      'Slow down time with the slider to watch the crossing.',
    metric: GullstrandPainleve,
    setup: metric => {
      const rs = metric.rs;
      return {
        ...defaults,
        viewportSize: 12,
        ship: ship(atRest(metric, 10 * rs, 0), Math.PI),
        objects: [],
      };
    },
  },
  {
    id: 'frozen-star',
    name: 'The frozen star',
    description: 'An asteroid dropped from 6 rs. In its own time it falls through the horizon ' +
      'within seconds, but seen from the ship it slows down, dims and reddens, and seems ' +
      'to freeze just above the horizon, its light ever more delayed.',
    metric: GullstrandPainleve,
    setup: metric => {
      const rs = metric.rs;
      return {
        ...defaults,
        viewportSize: 14,
        ship: ship(circularOrbit(metric, 15 * rs, 0)),
        objects: [object(asteroidId, atRest(metric, 6 * rs, 0.6))],
      };
    },
  },
  {
    id: 'lensing',
    name: 'Gravitational lensing',
    description: 'A photon clock orbits at 5 rs. When it passes behind the black hole, ' +
      'its light bends around both sides: it appears twice, on either side of the ' +
      'black hole\'s shadow (the 2D version of an Einstein ring).',
    metric: Schwarzschild,
    setup: metric => {
      const rs = metric.rs;
      return {
        ...defaults,
        viewportSize: 14,
        ship: ship(circularOrbit(metric, 15 * rs, 0)),
        objects: [object(photonClockId, circularOrbit(metric, 5 * rs, Math.PI - 1.0))],
      };
    },
  },
  {
    id: 'no-return',
    name: 'Point of no return',
    description: 'The ship hangs at rest at 2.25 rs, falling. Its engine can hold it up ' +
      'only above 2.14 rs, and the thrust needed grows without bound at the horizon. ' +
      'Press Space to start, and hold ↑ (pointing outwards) to escape.',
    metric: GullstrandPainleve,
    setup: metric => {
      const rs = metric.rs;
      return {
        ...defaults,
        viewportSize: 5, paused: true,
        ship: ship(atRest(metric, 2.25 * rs, 0), 0),
        objects: [],
      };
    },
  },
  {
    id: 'flyby',
    name: 'Relativistic flyby',
    description: 'Flying past photon clocks at 90% of the speed of light: relativistic beaming, ' +
      'Doppler shift and length contraction.',
  },
  {
    id: 'twins',
    name: 'Twin paradox without acceleration',
    description: 'Two clocks part and meet again, both in free fall, with different elapsed times.',
  },
  {
    id: 'time-dilation',
    name: 'Gravitational time dilation',
    description: 'A clock hovering near the black hole ticks slower than one far away.',
  },
  {
    id: 'hover',
    name: 'Hovering near the horizon',
    description: 'Holding position at 1.1 rs, under a blueshifted, compressed sky.',
  },
];
