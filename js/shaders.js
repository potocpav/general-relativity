// Shader source loading and assembly.

import { nSprites, projectileId } from './object-info.js';
import { maxFrameCondition } from './metric.js';

// Fetches a text file, once per page (shaders are shared by all simulations).
const texts = new Map(); // url -> Promise<string>
export function fetchText(url) {
  if (!texts.has(url)) texts.set(url, (async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return response.text();
  })());
  return texts.get(url);
}

// Constants shared between JS and GLSL, defined once on the JS side.
// `metric` selects the metric's file and features, see physicsFragmentShader.
export function shaderDefines(metric) {
  return {
    N_SPRITES: nSprites,
    PROJECTILE_ID: projectileId,
    MAX_FRAME_CONDITION: maxFrameCondition.toExponential(),
    // features of the metric's spacetime, see `features` in js/metric.js
    ...(metric.constructor.features.blackHole ? {BLACK_HOLE: 1} : {}),
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

// Fragment shader made of glsl/common.glsl, the metric's file in
// glsl/metrics/ (its `glslFile`) and glsl/objects.glsl, followed by
// `mainSource`. `root` is the URL of the repository root, relative to the page.
export async function physicsFragmentShader(mainSource, metric, root = '') {
  const files = ['glsl/common.glsl', `glsl/metrics/${metric.constructor.glslFile}.glsl`, 'glsl/objects.glsl'];
  const parts = await Promise.all(files.map(f => fetchText(root + f)));
  return assembleShader(shaderDefines(metric), [...parts, mainSource]);
}
