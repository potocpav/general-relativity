
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
  }

  compile(program) {
    this.xsUniformLocation = gl.getUniformLocation(program, 'obj_xs');
    this.usUniformLocation = gl.getUniformLocation(program, 'obj_us');
    this.itsUniformLocation = gl.getUniformLocation(program, 'obj_its');
  }

  add(trajectory) {
    // TODO: don't overwrite, add
    const nObjects = 1;
    const nPoints = 1000;
    const data = trajectory.simulate(nPoints);
    gl.bindTexture(gl.TEXTURE_2D, this.tex_x);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, nObjects, nPoints, 0, gl.RGB, gl.FLOAT,
      new Float32Array(data.xs));

    gl.bindTexture(gl.TEXTURE_2D, this.tex_u);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, nObjects, nPoints, 0, gl.RGB, gl.FLOAT,
      new Float32Array(data.us));

    gl.bindTexture(gl.TEXTURE_2D, this.tex_it);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, nObjects, nPoints, 0, gl.RG, gl.FLOAT,
      new Float32Array(data.it));

    gl.bindTexture(gl.TEXTURE_2D, null);
  }


  // setData(data) {
  //   const nObjects = 1;
  //   const nPoints = data.n;
  //   gl.bindTexture(gl.TEXTURE_2D, this.tex_x);
  //   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, nObjects, nPoints, 0, gl.RGB, gl.FLOAT,
  //     new Float32Array(data.xs));

  //   gl.bindTexture(gl.TEXTURE_2D, this.tex_u);
  //   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, nObjects, nPoints, 0, gl.RGB, gl.FLOAT,
  //     new Float32Array(data.us));

  //   gl.bindTexture(gl.TEXTURE_2D, this.tex_it);
  //   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, nObjects, nPoints, 0, gl.RG, gl.FLOAT,
  //     new Float32Array(data.it));

  //   gl.bindTexture(gl.TEXTURE_2D, null);
  // }

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
