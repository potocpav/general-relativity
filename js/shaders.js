// Shader source loading and assembly.

import { nSprites, projectileId } from './object-info.js';
import { maxFrameCondition } from './metric.js';

export async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

// Constants shared between JS and GLSL, defined once on the JS side.
// `metric` selects the metric in glsl/physics.glsl.
export function shaderDefines(metric) {
  return {
    N_SPRITES: nSprites,
    PROJECTILE_ID: projectileId,
    MAX_FRAME_CONDITION: maxFrameCondition.toExponential(),
  };
}

// Builds a GLSL ES 3.0 shader from source parts, prefixed by the `#version`
// directive and `#define`s. In compiler errors, part n (counting from 1)
// is reported as source string n, with line numbers relative to that part.
export function assembleShader(defines, parts) {
  const header = [
    '#version 300 es',
    ...Object.entries(defines).map(([name, value]) => `#define ${name} ${value}`),
  ];
  return [header.join('\n'), ...parts.map((part, i) => `#line 1 ${i + 1}\n${part}`)].join('\n');
}

// Fragment shader made of glsl/physics.glsl for `metric` and glsl/objects.glsl,
// followed by `mainSource`. `root` is the URL of the repository root,
// relative to the page.
export async function physicsFragmentShader(mainSource, metric, root = '') {
  const [physics, objects] = await Promise.all(['glsl/physics.glsl', 'glsl/objects.glsl'].map(f => fetchText(root + f)));
  return assembleShader(shaderDefines(metric), [physics, objects, mainSource]);
}
