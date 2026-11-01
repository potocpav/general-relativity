import { convertState } from './metric.js';
import { Trajectory } from './trajectory.js';

var gl;

function createDataTexture(internalFormat, format, width, height, data) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.FLOAT, data);
  return tex;
}

// Ring buffer of object trajectories, stored one object per texture column.
export class Trajectories {
  constructor(gl_) {
    gl = gl_;

    this.nObjects = 16;
    this.nPoints = 1000;

    const zeroBuffer = new Float32Array(this.nObjects * this.nPoints * 3);
    this.tex_x = createDataTexture(gl.RGB32F, gl.RGB, this.nObjects, this.nPoints, zeroBuffer);
    this.tex_u = createDataTexture(gl.RGB32F, gl.RGB, this.nObjects, this.nPoints, zeroBuffer);
    this.tex_it = createDataTexture(gl.RG32F, gl.RG, this.nObjects, this.nPoints, zeroBuffer);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.clear();
  }

  clear() {
    this.count = 0; // number of valid columns, always the first `count` ones
    this.next = 0;  // column to be written next
    this.items = [];  // the Trajectory objects shown, oldest first
  }

  // Convert all trajectories to the coordinates of `metric` and re-simulate
  // them. Ones starting where the new coordinates don't reach are dropped.
  setMetric(metric) {
    const items = this.items;
    this.clear();
    for (const t of items) {
      const state = convertState(t.metric, metric, t.x, t.u);
      if (state) this.add(new Trajectory(metric, t.obj_i, ...state));
    }
  }

  compile(program) {
    this.xsUniformLocation = gl.getUniformLocation(program, 'obj_xs');
    this.usUniformLocation = gl.getUniformLocation(program, 'obj_us');
    this.itsUniformLocation = gl.getUniformLocation(program, 'obj_its');
    this.countUniformLocation = gl.getUniformLocation(program, 'n_objects');
  }

  add(trajectory) {
    this.items.push(trajectory);
    if (this.items.length > this.nObjects) this.items.shift();
    const slot = this.next;
    this.next = (this.next + 1) % this.nObjects;
    this.count = Math.min(this.count + 1, this.nObjects);

    const data = trajectory.simulate(this.nPoints);

    gl.bindTexture(gl.TEXTURE_2D, this.tex_x);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, slot, 0, 1, this.nPoints, gl.RGB, gl.FLOAT, data.xs);

    gl.bindTexture(gl.TEXTURE_2D, this.tex_u);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, slot, 0, 1, this.nPoints, gl.RGB, gl.FLOAT, data.us);

    gl.bindTexture(gl.TEXTURE_2D, this.tex_it);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, slot, 0, 1, this.nPoints, gl.RG, gl.FLOAT, data.it);

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  render() {
    gl.uniform1i(this.xsUniformLocation, 3);
    gl.uniform1i(this.usUniformLocation, 4);
    gl.uniform1i(this.itsUniformLocation, 5);
    gl.uniform1i(this.countUniformLocation, this.count);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.tex_x);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.tex_u);

    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.tex_it);
  }
}
