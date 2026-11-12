// Scenarios: preset initial states showing interesting features of general
// relativity, in each spacetime.
//
// Each scenario belongs to one metric (`metric`, a class from metricTypes);
// switching the metric starts its first scenario. It may set the metric's
// parameters (`params`, the others take their defaults). Its `setup(metric)`,
// given an instance of that class, returns the initial state:
//   {ship: {x, u, heading}, objects: [{type, x, u}], viewportSize,
//    timeScale (negative runs backwards), paused}
// Scenarios without `setup` are placeholders, shown disabled. Ids are unique
// across all metrics (they are used in links, ?scenario=<id>).

import * as math from './math.js';
import { GullstrandPainleve, Minkowski, localVelocity3 } from './metric.js';
import { asteroidId, photonClockId } from './object-info.js';

// --- helpers; positions are (r, phi)

// 3-velocity from a 2-velocity given as coordinate velocity (dx/dt, dy/dt)
// in screen-aligned cartesian components, i.e. flat-space polar (dr/dt, r dphi/dt).
// Returns null if the velocity is not timelike.
export const velocity3 = (metric, x, u2_cart) => {
  const [vr, vphi] = metric.cartesianToLocal(x, u2_cart);
  const V = [1, vr, vphi / x[1]];
  const norm = -math.dot(V, math.matVec(metric.g(x), V));
  if (!(norm > 0)) return null;
  return math.scale(V, 1 / Math.sqrt(norm));
}

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

// Geodesic with energy E = -u_t and angular momentum L = u_phi at radius r,
// moving towards +phi and inwards (or outwards), as [x, u]. Relative to the
// static observer there, its Lorentz factor is gamma = E / sqrt(1 - rs/r),
// and its velocity v_phi = L / (gamma r) and v_r^2 = 1 - 1/gamma^2 - v_phi^2.
function orbitState(metric, r, phi, E, L, inwards = true) {
  const rs = metric.rs, x = [0, r, phi];
  const gamma = E / Math.sqrt(1 - rs / r), vphi = L / (gamma * r);
  const vr = (inwards ? -1 : 1) * Math.sqrt(Math.max(0, 1 - 1 / (gamma * gamma) - vphi * vphi));
  // (r-hat, phi-hat) components to the screen-aligned ones that localVelocity3 takes
  const c = Math.cos(phi), s = Math.sin(phi);
  return [x, localVelocity3(metric, x, [c * vr - s * vphi, s * vr + c * vphi])];
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

// falling radially inwards, with the speed of a body that fell from rest at
// infinity (a "raindrop"): sqrt(rs/r) relative to a static observer
const raindrop = (metric, r, phi) => {
  const x = [0, r, phi], v = Math.sqrt(metric.rs / r);
  return [x, localVelocity3(metric, x, [-v * Math.cos(phi), -v * Math.sin(phi)])];
};

// free-fall state `tau` proper time before (x, u): geodesics are
// time-reversible, so integrate forward with the velocity reversed
function backwards(metric, [x, u], tau) {
  const {xu} = math.integrate(metric, math.geo_f(metric), [...x, ...math.scale(u, -1)], tau, 0.02);
  return [xu.slice(0, 3), math.scale(xu.slice(3, 6), -1)];
}

const ship = ([x, u], heading = Math.PI / 2) => ({x, u, heading});
const object = (type, [x, u]) => ({type, x, u});

const defaults = {viewportSize: 20, timeScale: 1, paused: false};

// --- scenarios

// Gullstrand–Painlevé coordinates follow everything across the horizon.
const gpScenarios = [
  {
    id: 'free',
    name: 'Free play',
    description: 'A circular orbit at 10 rs, with a photon clock falling past. ' +
      'Boost with the mouse or the arrow keys, spawn objects, and explore.',
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
    description: 'An eccentric orbit between 4 and 7 rs does not close: each closest ' +
      'approach happens about 200° further around than the last (watch φ, the third ' +
      'coordinate), so the orbit traces a rosette. This is the effect first seen in the ' +
      'orbit of Mercury, here much larger.',
    setup: metric => {
      const rs = metric.rs, ra = 7 * rs;
      const {E, L} = orbitConstants(rs, 4 * rs, ra);
      return {
        ...defaults,
        viewportSize: 11, timeScale: 4,
        ship: ship(orbitState(metric, ra, 0, E, L)),
        objects: [],
      };
    },
  },
  {
    id: 'isco',
    name: 'Innermost stable circular orbit',
    description: 'The ship is on the innermost stable circular orbit, at 3 rs; below it, ' +
      'circular orbits are unstable. The orbit is on the edge: a small slowdown sends the ' +
      'ship spiralling into the black hole within half an orbit, while a small speed-up lifts ' +
      'it into an eccentric orbit. Newtonian gravity has no such limit.',
    setup: metric => {
      const rs = metric.rs;
      return {
        ...defaults,
        // moving towards +phi, up on the screen, and pointing that way
        ship: ship(circularOrbit(metric, 3 * rs, 0), Math.PI / 2),
        objects: [],
      };
    },
  },
  {
    id: 'zoom-whirl',
    name: 'Zoom-whirl orbit',
    description: 'An orbit tuned just above capture: the ship whirls around the black hole ' +
      'about twice near 2.1 rs before zooming back out to 37 rs. Close to the black hole, ' +
      'orbits can wind around many times before leaving.',
    setup: metric => {
      const rs = metric.rs, L = 1.95 * rs;
      const ru = L * L / rs * (1 - Math.sqrt(1 - 3 * rs * rs / (L * L))); // unstable circular orbit
      const E = Math.sqrt(potential(rs, ru, L) * (1 - 1e-4));
      return {
        ...defaults,
        viewportSize: 12, timeScale: 2,
        ship: ship(orbitState(metric, 10 * rs, 0, E, L)),
        objects: [],
      };
    },
  },
  {
    id: 'fall-in',
    name: 'Falling into the black hole',
    description: 'A black hole 25 times heavier than in the other scenarios. Falling in ' +
      'from far away, the ship passes 2 rs at 71% of the speed of light, crosses the event ' +
      'horizon 9 s later (nothing special happens there locally), and spends 5 s inside ' +
      'before reaching the singularity. At the horizon, the black hole covers 42° around ' +
      'the inward direction.',
    // Free fall from infinity takes (2/3) rs of proper time from the horizon
    // to the singularity: 5 s at this size.
    params: {rs: 7.5},
    setup: metric => {
      const rs = metric.rs;
      return {
        ...defaults,
        viewportSize: 8 * rs,
        ship: ship(raindrop(metric, 2 * rs, 0), Math.PI),
        objects: [],
      };
    },
  },
  {
    id: 'frozen-star',
    name: 'The frozen star',
    description: 'An asteroid falling from 6 rs, shown at 0.25× speed. In its own time it ' +
      'crosses the horizon within seconds, but seen from the ship it slows down, reddens ' +
      'and fades out as it nears the horizon, never seen to cross: its light is redshifted ' +
      'by a further factor e every 2 rs/c, so a "frozen star" is practically black.',
    setup: metric => {
      const rs = metric.rs;
      // Dropped from rest 9.5 time units before the start (the spacetime is
      // static, so shifting the time coordinate is exact): the ship then sees
      // it fall from about 4 rs, and fade within the first ~5 time units.
      const [x, u] = atRest(metric, 6 * rs, 0.6);
      return {
        ...defaults,
        viewportSize: 22, timeScale: 0.25,
        ship: ship(circularOrbit(metric, 15 * rs, 0)),
        objects: [object(asteroidId, [[x[0] - 9.5, x[1], x[2]], u])],
      };
    },
  },
  {
    id: 'lensing',
    name: 'Gravitational lensing',
    description: 'A photon clock orbits at 5 rs. When it passes behind the black hole, ' +
      'its light bends around both sides: it appears twice, on either side of the ' +
      'black hole\'s shadow (the 2D version of an Einstein ring).',
    setup: metric => {
      const rs = metric.rs;
      return {
        ...defaults,
        viewportSize: 22,
        ship: ship(circularOrbit(metric, 15 * rs, 0)),
        objects: [object(photonClockId, circularOrbit(metric, 5 * rs, Math.PI - 1.0))],
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

// Flat spacetime, in Cartesian coordinates: special relativity.
const minkowskiScenarios = [
  {
    id: 'flat',
    name: 'Free play',
    description: 'A ship at rest in flat spacetime, without gravity: only special relativity. ' +
      'Boost with the mouse or the arrow keys, spawn objects, and explore.',
    setup: metric => ({
      ...defaults,
      ship: ship([[0, 0, 0], [1, 0, 0]]),
      objects: [],
    }),
  },
];

export const scenarios = [
  ...gpScenarios.map(sc => ({...sc, metric: GullstrandPainleve})),
  ...minkowskiScenarios.map(sc => ({...sc, metric: Minkowski})),
];

// The scenarios of metric class `type`.
export const scenariosOf = type => scenarios.filter(sc => sc.metric === type);
