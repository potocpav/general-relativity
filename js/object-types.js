// Object types (see js/objects.js), all drawn procedurally by the shader
// (glsl/surface-frag.glsl, which gets the ids as PROJECTILE_ID, PLANET_ID, CLOCK_ID,
// JUPITER_ID and SUN_ID).
export const
  projectileId = 0, // a dot
  planetId = 1,     // an Earth-like planet, spinning
  clockId = 2,      // a digital clock showing its proper time, minutes:seconds; a 2.5:1 box
  jupiterId = 3,    // Jupiter, banded, with the Great Red Spot, spinning
  sunId = 4;        // the Sun, glowing as a blackbody, spinning slowly

// Real diameters, in light seconds (the simulation's unit of length).
const lightSecond = 299792.458; // [km]
export const jupiterDiameter = 139820 / lightSecond, // 0.466 (the mean)
  sunDiameter = 1392700 / lightSecond;               // 4.65

// Objects' default sizes, by type (an object can have its own, see Objects.spawn):
// their diameter, or for the clock, its diagonal.
export const defaultSize = {
  [projectileId]: 0.125, // 1/4 of the ship's width
  [planetId]: 0.3,
  [clockId]: 0.6,
  [jupiterId]: jupiterDiameter,
  [sunId]: sunDiameter,
};

// The farthest an object reaches from its position.
export const objectRadius = o => 0.5 * o.size;
