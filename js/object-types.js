// Object types (see js/objects.js), all drawn procedurally by the shader
// (glsl/surface-frag.glsl, which gets the ids as PROJECTILE_ID and PLANET_ID).
export const
  projectileId = 0, // a dot
  planetId = 1;     // an Earth-like planet, spinning

// Objects' default diameters, by type (an object can have its own, see Objects.spawn).
export const defaultSize = {
  [projectileId]: 0.125, // 1/4 of the ship's width
  [planetId]: 0.3,
};

// The farthest an object reaches from its position.
export const objectRadius = o => 0.5 * o.size;
