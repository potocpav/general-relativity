// Object types (see js/objects.js), all drawn procedurally by the shader
// (glsl/surface-frag.glsl, which gets the ids as PROJECTILE_ID, PLANET_ID and CLOCK_ID).
export const
  projectileId = 0, // a dot
  planetId = 1,     // an Earth-like planet, spinning
  clockId = 2;      // a digital clock showing its proper time, minutes:seconds; a 2.5:1 box

// Objects' default sizes, by type (an object can have its own, see Objects.spawn):
// their diameter, or for the clock, its diagonal.
export const defaultSize = {
  [projectileId]: 0.125, // 1/4 of the ship's width
  [planetId]: 0.3,
  [clockId]: 0.6,
};

// The farthest an object reaches from its position.
export const objectRadius = o => 0.5 * o.size;
