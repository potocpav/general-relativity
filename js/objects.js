// Objects (asteroids, photon clocks, ...) simulated live, with a rolling
// history of their recent past.
//
// Rendering only needs the past: each pixel shows an event on the ship's past
// light cone. So objects are advanced together with the ship, and their
// states are recorded at regular steps of coordinate time: row k holds the
// state at time k * historyDt. The last `historyRows` rows are
// kept, as a ring buffer (row k is stored at k mod historyRows), both in JS
// (float64, the source of truth, used when rewinding) and on the GPU
// (float32 textures, one column per object), where glsl/objects.glsl looks
// up the event of an object that a pixel shows.
//
// Objects are kept one row ahead of the ship's coordinate time, so that the
// pixels around the ship have data. Rewinding trims the rows after the new
// time; an object rewound past its first row is removed.

import * as math from './math.js';
import { objectRadius } from './object-info.js';

export const maxObjects = 256;
export const historyRows = 1024;
export const historyDt = 0.05; // coordinate time between history rows
const chunkRows = 64;          // rows per chunk of bounding boxes

// Integrate y = [x, u, tau] or [x, u, tau, h] of a free-falling body (or
// accelerated, with `accel_rest` in its rest frame) to coordinate time T1,
// forwards or backwards, with coordinate time as the parameter:
//   dx/dT = u / u^T,  du/dT = (-Gamma(u, u) + a) / u^T,  dtau/dT = 1 / u^T,
// and h, the body's orientation axis, Fermi–Walker transported (see geo_fw_f):
//   dh/dT = (-Gamma(u, h) + (h.a) u) / u^T.
// Returns null if the body gets where it can't be followed.
export function integrateToTime(metric, y, T1, accel_rest) {
  const withAxis = y.length >= 10;
  const f = math.geo_fw_f(metric, accel_rest);
  const g = y => {
    const d = f([...y.slice(0, 6), ...(withAxis ? y.slice(7, 10) : [0, 0, 0])]), ut = y[3];
    const dT = d.map(v => v / ut);
    return withAxis ? [...dT.slice(0, 6), 1 / ut, ...dT.slice(6, 9)] : [...dT.slice(0, 6), 1 / ut];
  };
  for (let i = 0; Math.abs(T1 - y[0]) > 1e-12 * Math.max(1, Math.abs(T1)); i++) {
    if (i > 100000) return null;
    const hTau = Math.min(math.maxProperStep, metric.stepLimit(y));
    const h = Math.min(Math.abs(T1 - y[0]), hTau * Math.abs(y[3]));
    const next = math.rk4(g, y, Math.sign(T1 - y[0]) * h);
    if (!metric.canFollow(next)) return null;
    y = next;
  }
  y[0] = T1;
  return y;
}

// state: [x, u, tau, h]; history rows add the orientation angle (see writeRow)
const stateSize = 10, rowSize = 11;
const ring = k => ((k % historyRows) + historyRows) % historyRows;

class SimObject {
  constructor(type, slot) {
    this.type = type;
    this.slot = slot;
    this.state = null;       // [x, u, tau, h] at row lastRow
    this.angle = undefined;  // orientation angle of the last row written, for continuity
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
    this.history = new Float64Array(maxObjects * historyRows * rowSize);
    this.dirtyRows = new Set();
    this.infoData = new Float32Array(maxObjects * 2 * 4);
    if (gl) this.createTextures();
    this.reset(metric, 0);
  }

  get dt() {
    return historyDt;
  }

  // Remove all objects; the ship is at coordinate time T.
  reset(metric, T) {
    this.metric = metric;
    this.objects = [];
    this.slots = new Array(maxObjects).fill(null);
    this.now = Math.ceil(T / this.dt); // row the objects are advanced to
  }

  // Add an object at event x with 4-velocity u (x[0] may be in the past),
  // simulating it up to now. Its orientation axis starts pointing up on the
  // screen. Returns false if there is no free slot or it can't be followed
  // from there.
  spawn(type, x, u) {
    const slot = this.slots.indexOf(null);
    if (slot < 0) return false;
    const o = new SimObject(type, slot);
    const first = Math.ceil(x[0] / this.dt);
    const up = this.metric.cartesianToLocal(x, [0, 1]);
    const h = math.matVec(math.restToCoord(this.metric, x, u), [0, ...up]);
    const y = integrateToTime(this.metric, [...x, ...u, 0, ...h], first * this.dt);
    if (y === null) return false;
    o.firstRow = o.lastRow = first;
    this.slots[slot] = o;
    this.objects.push(o);
    o.state = this.writeRow(o, first, y);
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
        o.lastRow = k;
        o.state = this.writeRow(o, k, y);
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
    const r = this.rowState(o, row);
    o.state = r.slice(0, stateSize);
    o.angle = r[stateSize];
    // recompute the bounding boxes of the chunks after it
    const c = Math.floor(row / chunkRows);
    for (const key of [...o.chunks.keys()]) if (key >= c) o.chunks.delete(key);
    for (let k = Math.max(c * chunkRows, o.firstRow); k <= row; k++) this.extendBounds(o, k, this.rowState(o, k));
  }

  remove(o) {
    this.objects.splice(this.objects.indexOf(o), 1);
    this.slots[o.slot] = null;
  }

  historyIndex(slot, k) {
    return (ring(k) * maxObjects + slot) * rowSize;
  }

  // the stored row: [x, u, tau, h, orientation angle]
  rowState(o, k) {
    const i = this.historyIndex(o.slot, k);
    return Array.from(this.history.subarray(i, i + rowSize));
  }

  // Store state y as row k of object o. The orientation axis h is
  // re-orthonormalized against numerical drift, and stored also as its angle
  // in the object's rest frame (from r-hat towards phi-hat), kept continuous
  // with the previously written row so that it can be interpolated.
  // Returns the state with the re-orthonormalized axis.
  writeRow(o, k, y) {
    const x = y.slice(0, 3), u = y.slice(3, 6);
    const hr = math.matVec(math.coordToRest(this.metric, x, u), y.slice(7, 10));
    let angle = Math.atan2(hr[2], hr[1]);
    if (o.angle !== undefined) angle += 2 * Math.PI * Math.round((o.angle - angle) / (2 * Math.PI));
    o.angle = angle;
    const h = math.matVec(math.restToCoord(this.metric, x, u), [0, Math.cos(angle), Math.sin(angle)]);
    const state = [...y.slice(0, 7), ...h];
    this.history.set([...state, angle], this.historyIndex(o.slot, k));
    this.dirtyRows.add(ring(k));
    this.extendBounds(o, k, state);
    return state;
  }

  extendBounds(o, k, y) {
    const [px, py] = this.metric.toPlane(y);
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
    this.texA = texture(maxObjects, historyRows); // (r, phi, tau, orientation angle)
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
        const i = (r * maxObjects + slot) * rowSize;
        const h = this.history;
        this.rowA.set([h[i + 1], h[i + 2], h[i + 6], h[i + 10]], slot * 4);
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
