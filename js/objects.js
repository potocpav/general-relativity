// Objects (asteroids, photon clocks, ...) simulated live, with a rolling
// history of their recent past.
//
// Rendering only needs the past: each pixel shows an event on the ship's past
// light cone. So objects are advanced together with the ship, and their
// states are recorded at regular steps of coordinate time: row k holds the
// state at time k * dt, dt = rs / rowsPerRs. The last `historyRows` rows are
// kept, as a ring buffer (row k is stored at k mod historyRows), both in JS
// (float64, the source of truth, used when rewinding) and on the GPU
// (float32 textures, one column per object), where glsl/objects.glsl looks
// up the event of an object that a pixel shows.
//
// Objects are kept one row ahead of the ship's coordinate time, so that the
// pixels around the ship have data. Rewinding trims the rows after the new
// time; an object rewound past its first row is removed. Switching
// coordinates converts each object's latest state and regenerates its
// history by integrating backwards (exact for free fall).

import * as math from './math.js';
import { convertState } from './metric.js';
import { objectRadius } from './object-info.js';

export const maxObjects = 256;
export const historyRows = 1024;
export const rowsPerRs = 6;    // history rows per rs of coordinate time
const chunkRows = 64;          // rows per chunk of bounding boxes
const stepsPerRs = 15;         // integration steps per rs of proper time, at least

// Integrate y = [x, u, tau] of a free-falling body (or accelerated, with
// `accel_rest` in its rest frame) to coordinate time T1, forwards or
// backwards, with coordinate time as the parameter:
//   dx/dT = u / u^T,  du/dT = (-Gamma(u, u) + a) / u^T,  dtau/dT = 1 / u^T.
// Returns null if the body gets where it can't be followed.
export function integrateToTime(metric, y, T1, accel_rest) {
  const f = math.geo_f(metric, accel_rest);
  const g = y => {
    const d = f(y.slice(0, 6)), ut = y[3];
    return [...d.map(v => v / ut), 1 / ut];
  };
  const maxStepTau = metric.rs / stepsPerRs;
  for (let i = 0; Math.abs(T1 - y[0]) > 1e-12 * Math.max(1, Math.abs(T1)); i++) {
    if (i > 100000) return null;
    const hTau = Math.min(maxStepTau, metric.stepLimit(y));
    const h = Math.min(Math.abs(T1 - y[0]), hTau * Math.abs(y[3]));
    const next = math.rk4(g, y, Math.sign(T1 - y[0]) * h);
    if (!metric.canFollow(next)) return null;
    y = next;
  }
  y[0] = T1;
  return y;
}

const cartesian = y => [y[1] * Math.cos(y[2]), y[1] * Math.sin(y[2])];
const ring = k => ((k % historyRows) + historyRows) % historyRows;

class SimObject {
  constructor(type, x, u, slot) {
    this.type = type;
    this.slot = slot;
    this.birth = x;          // spawn event, to limit regenerated histories
    this.state = null;       // [x, u, tau] at row lastRow
    this.firstRow = 0;
    this.lastRow = 0;
    this.dead = false;       // can't be followed further
    this.chunks = new Map(); // chunk index -> bounding box [xmin, ymin, xmax, ymax]
  }
}

export class Objects {
  // `gl` may be null (no GPU textures, for tests)
  constructor(gl, metric) {
    this.gl = gl;
    this.history = new Float64Array(maxObjects * historyRows * 7);
    this.dirtyRows = new Set();
    this.infoData = new Float32Array(maxObjects * 2 * 4);
    if (gl) this.createTextures();
    this.reset(metric, 0);
  }

  get dt() {
    return this.metric.rs / rowsPerRs;
  }

  // Remove all objects; the ship is at coordinate time T.
  reset(metric, T) {
    this.metric = metric;
    this.objects = [];
    this.slots = new Array(maxObjects).fill(null);
    this.now = Math.ceil(T / this.dt); // row the objects are advanced to
  }

  // Add an object at event x with 4-velocity u (x[0] may be in the past),
  // simulating it up to now. Returns false if there is no free slot or it
  // can't be followed from there.
  spawn(type, x, u) {
    const slot = this.slots.indexOf(null);
    if (slot < 0) return false;
    const o = new SimObject(type, x, u, slot);
    const first = Math.ceil(x[0] / this.dt);
    const y = integrateToTime(this.metric, [...x, ...u, 0], first * this.dt);
    if (y === null) return false;
    o.firstRow = o.lastRow = first;
    o.state = y;
    this.slots[slot] = o;
    this.objects.push(o);
    this.writeRow(o, first, y);
    this.advanceObject(o, this.now);
    return true;
  }

  // Advance (or rewind) all objects to the ship's coordinate time T.
  advance(T) {
    this.now = Math.ceil(T / this.dt);
    for (const o of [...this.objects]) {
      if (o.lastRow > this.now) this.trim(o, this.now);
      else if (!o.dead) this.advanceObject(o, this.now);
    }
    // forget objects whose history has left the window
    for (const o of [...this.objects]) {
      if (o.lastRow < this.windowStart()) this.remove(o);
    }
  }

  windowStart() {
    return this.now - historyRows + 1;
  }

  advanceObject(o, row) {
    for (let k = o.lastRow + 1; k <= row && !o.dead; k++) {
      const y = integrateToTime(this.metric, o.state, k * this.dt);
      if (y === null) {
        o.dead = true;
      } else {
        o.state = y;
        o.lastRow = k;
        this.writeRow(o, k, y);
      }
    }
  }

  // drop the rows after `row`, restoring the state there
  trim(o, row) {
    if (row < o.firstRow) {
      this.remove(o);
      return;
    }
    o.lastRow = row;
    o.dead = false;
    const i = this.historyIndex(o.slot, row);
    o.state = Array.from(this.history.subarray(i, i + 7));
    // recompute the bounding boxes of the chunks after it
    const c = Math.floor(row / chunkRows);
    for (const key of [...o.chunks.keys()]) if (key >= c) o.chunks.delete(key);
    for (let k = Math.max(c * chunkRows, o.firstRow); k <= row; k++) this.extendBounds(o, k, this.rowState(o, k));
  }

  remove(o) {
    this.objects.splice(this.objects.indexOf(o), 1);
    this.slots[o.slot] = null;
  }

  // Switch to the coordinates of `metric`; the ship is now at coordinate time
  // T. Each object's latest state is converted, and its history regenerated
  // by integrating backwards, down to its (converted) spawn time or the window
  // start. Objects that can't be represented in the new coordinates are removed.
  setMetric(metric, T) {
    const old = this.metric, objects = this.objects;
    this.reset(metric, T);
    for (const o of objects) {
      const state = convertState(old, metric, o.state.slice(0, 3), o.state.slice(3, 6));
      const birth = convertState(old, metric, o.birth, [1, 0, 0]);
      if (state === null) continue;
      const n = new SimObject(o.type, birth ? birth[0] : state[0], null, o.slot);
      // the latest row: now if alive, else the last row before it got lost
      const last = o.dead ? Math.floor(state[0][0] / this.dt) : this.now;
      let y = integrateToTime(metric, [...state[0], ...state[1], o.state[6]], last * this.dt);
      if (y === null) continue;
      n.firstRow = n.lastRow = last;
      n.state = y;
      n.dead = o.dead;
      this.slots[n.slot] = n;
      this.objects.push(n);
      this.writeRow(n, last, y);
      const first = Math.max(Math.ceil(n.birth[0] / this.dt), this.windowStart());
      for (let k = last - 1; k >= first; k--) {
        y = integrateToTime(metric, y, k * this.dt);
        if (y === null) break;
        n.firstRow = k;
        this.writeRow(n, k, y);
      }
    }
  }

  historyIndex(slot, k) {
    return (ring(k) * maxObjects + slot) * 7;
  }

  rowState(o, k) {
    const i = this.historyIndex(o.slot, k);
    return Array.from(this.history.subarray(i, i + 7));
  }

  writeRow(o, k, y) {
    this.history.set(y, this.historyIndex(o.slot, k));
    this.dirtyRows.add(ring(k));
    this.extendBounds(o, k, y);
  }

  extendBounds(o, k, y) {
    const [px, py] = cartesian(y);
    const c = Math.floor(k / chunkRows);
    const b = o.chunks.get(c);
    if (b) {
      b[0] = Math.min(b[0], px); b[1] = Math.min(b[1], py);
      b[2] = Math.max(b[2], px); b[3] = Math.max(b[3], py);
    } else {
      o.chunks.set(c, [px, py, px, py]);
    }
  }

  // The rows of `o` that are still stored and valid.
  validRows(o) {
    return [Math.max(o.firstRow, this.windowStart(), o.lastRow - historyRows + 1), o.lastRow];
  }

  // Bounding box (in flat cartesian r cos phi, r sin phi) of the object's
  // stored history, padded by its size: the chunks overlapping its valid rows.
  bounds(o) {
    const [first, last] = this.validRows(o);
    const pad = objectRadius(o.type);
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (let c = Math.floor(first / chunkRows); c <= Math.floor(last / chunkRows); c++) {
      const b = o.chunks.get(c);
      if (!b) continue;
      box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]);
      box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]);
    }
    // drop chunks that have left the window
    for (const key of [...o.chunks.keys()]) if (key < Math.floor(first / chunkRows)) o.chunks.delete(key);
    return [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
  }

  // --- GPU

  createTextures() {
    const gl = this.gl;
    const texture = (w, h) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, new Float32Array(w * h * 4));
      return tex;
    };
    this.texA = texture(maxObjects, historyRows); // (r, phi, tau, -)
    this.texB = texture(maxObjects, historyRows); // (u^t, u^r, u^phi, -)
    this.texInfo = texture(maxObjects, 2);        // (first row, last row, sprite, used), bounds
    this.rowA = new Float32Array(maxObjects * 4);
    this.rowB = new Float32Array(maxObjects * 4);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  compile(program) {
    const gl = this.gl;
    this.locA = gl.getUniformLocation(program, 'obj_a');
    this.locB = gl.getUniformLocation(program, 'obj_b');
    this.locInfo = gl.getUniformLocation(program, 'obj_info');
    this.locCount = gl.getUniformLocation(program, 'n_objects');
    this.locDt = gl.getUniformLocation(program, 'history_dt');
  }

  // Upload what changed, and bind the textures (units 3, 4, 5).
  render() {
    const gl = this.gl;
    for (const r of this.dirtyRows) {
      for (let slot = 0; slot < maxObjects; slot++) {
        const i = (r * maxObjects + slot) * 7;
        const h = this.history;
        this.rowA.set([h[i + 1], h[i + 2], h[i + 6], 0], slot * 4);
        this.rowB.set([h[i + 3], h[i + 4], h[i + 5], 0], slot * 4);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.texA);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r, maxObjects, 1, gl.RGBA, gl.FLOAT, this.rowA);
      gl.bindTexture(gl.TEXTURE_2D, this.texB);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r, maxObjects, 1, gl.RGBA, gl.FLOAT, this.rowB);
    }
    this.dirtyRows.clear();

    const info = this.infoData;
    info.fill(0);
    let count = 0;
    for (const o of this.objects) {
      const [first, last] = this.validRows(o);
      info.set([first, last, o.type, 1], o.slot * 4);
      info.set(this.bounds(o), (maxObjects + o.slot) * 4);
      count = Math.max(count, o.slot + 1);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texInfo);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, maxObjects, 2, gl.RGBA, gl.FLOAT, info);

    gl.uniform1i(this.locA, 3);
    gl.uniform1i(this.locB, 4);
    gl.uniform1i(this.locInfo, 5);
    gl.uniform1i(this.locCount, count);
    gl.uniform1f(this.locDt, this.dt);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.texInfo);
    // don't leave a unit of ours active, for textures bound later
    gl.activeTexture(gl.TEXTURE0);
  }
}
