
var gl;

export class ObjectInfo {
  constructor(gl_) {
    gl = gl_;
  }

  compile(program) {
    // set up object info UBO
    // Described in detail in https://gist.github.com/jialiang/2880d4cc3364df117320e8cb324c2880
    const uboLocation = gl.getUniformBlockIndex(program, "objectInfo");
    const uniformBlockBinding = 0;
    const blockSize = gl.getActiveUniformBlockParameter(program, uboLocation, gl.UNIFORM_BLOCK_DATA_SIZE);

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, blockSize, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, uniformBlockBinding, this.buffer);
    // TODO: mirror the pattern of `cacheUniformLocation` here
    const varNames = ["objSize", "objTexMin", "objTexMax", "objTexDTau"];
    const indices = gl.getUniformIndices(program, varNames);
    const offsets = gl.getActiveUniforms(program, indices, gl.UNIFORM_OFFSET);
    this.variableInfo = {};
    varNames.forEach((name, index) => {
      this.variableInfo[name] = {
        index: indices[index],
        offset: offsets[index],
      };
    });
    gl.uniformBlockBinding(program, uboLocation, uniformBlockBinding);
  }

  // Fill object info UBO for surface shader
  render() {
    // padding values are -1
    // TODO: ensure that this padding is portable
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, this.variableInfo["objSize"].offset, new Float32Array([
      0.1, -1, -1, -1,
      0.1, -1, -1, -1,
      0.1, -1, -1, -1,
      ]), 0);
    gl.bufferSubData(gl.UNIFORM_BUFFER, this.variableInfo["objTexMin"].offset, new Float32Array([
      64, 0, 0, -1,
      64, 0, 31, -1,
      0, 0, 0, -1,
      ]), 0);
    gl.bufferSubData(gl.UNIFORM_BUFFER, this.variableInfo["objTexMax"].offset, new Float32Array([
      127, 63, 29, -1,
      127, 63, 59, -1,
      63, 63, 59, -1,
      ]), 0);
    gl.bufferSubData(gl.UNIFORM_BUFFER, this.variableInfo["objTexDTau"].offset, new Float32Array([
      2, -1, -1, -1,
      2, -1, -1, -1,
      5, -1, -1, -1,
      ]), 0);
  }
}
