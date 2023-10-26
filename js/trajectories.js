
var gl;

export class Trajectories {
  constructor(gl_) {
    gl = gl_;

    this.tex_x = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex_x);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

    this.tex_u = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex_u);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);


    this.tex_it = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex_it);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, null);

    this.nObjects = 2;
    this.nPoints = 30;
    this.lastObjectAdded = -1;

    // allocate texture buffers
    const zeroBuffer = new Float32Array(this.nObjects * this.nPoints * 3);
    gl.bindTexture(gl.TEXTURE_2D, this.tex_x);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, this.nObjects, this.nPoints, 0, gl.RGB, gl.FLOAT,
      zeroBuffer);

    gl.bindTexture(gl.TEXTURE_2D, this.tex_u);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, this.nObjects, this.nPoints, 0, gl.RGB, gl.FLOAT,
      zeroBuffer);

    gl.bindTexture(gl.TEXTURE_2D, this.tex_it);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, this.nObjects, this.nPoints, 0, gl.RG, gl.FLOAT,
      zeroBuffer);

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  compile(program) {
    this.xsUniformLocation = gl.getUniformLocation(program, 'obj_xs');
    this.usUniformLocation = gl.getUniformLocation(program, 'obj_us');
    this.itsUniformLocation = gl.getUniformLocation(program, 'obj_its');
  }

  add(trajectory) {
    this.lastObjectAdded += 1;
    this.lastObjectAdded %= this.nObjects;

    this.data = trajectory.simulate(this.nPoints);

    gl.bindTexture(gl.TEXTURE_2D, this.tex_x);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, this.lastObjectAdded, 0, 1, this.nPoints, gl.RGB, gl.FLOAT,
      new Float32Array(this.data.xs));

    gl.bindTexture(gl.TEXTURE_2D, this.tex_u);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, this.lastObjectAdded, 0, 1, this.nPoints, gl.RGB, gl.FLOAT,
      new Float32Array(this.data.us));

    gl.bindTexture(gl.TEXTURE_2D, this.tex_it);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, this.lastObjectAdded, 0, 1, this.nPoints, gl.RG, gl.FLOAT,
      new Float32Array(this.data.it));

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  render() {
    gl.uniform1i(this.xsUniformLocation, 3);
    gl.uniform1i(this.usUniformLocation, 4);
    gl.uniform1i(this.itsUniformLocation, 5);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.tex_x);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.tex_u);

    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.tex_it);
  }
}
