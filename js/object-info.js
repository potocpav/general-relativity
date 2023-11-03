
var gl;

const spritesFile = "models/sprites.webp";
const spritesShape = [64*3, 64, 60]; // x, y, d
export const
  shipId = 0,
  shipThrustingId = 1,
  asteroidId = 2,
  photonClockId = 3;

// Sprite extents in world coordinates, including time coordinate.
const objSize = new Float32Array([
  2, 0.5, 0.5, -1,   // rocket
  2, 0.5, 0.5, -1,   // thrusting rocket
  5, 0.3, 0.3, -1, // asteroid
  1, 64/38/2, 64/38/2, -1,   // photon clock
  ]);

// Minimum pixel coordinates of sprites in the combined sprite image
const objTexMin = new Float32Array([
  0, 0, 0, -1,
  0, 0, 31, -1,
  64, 0, 0, -1,
  128, 0, 0, -1,
  ]);

// Maximum pixel coordinates of sprites in the combined sprite image
const objTexMax = new Float32Array([
  63, 63, 29, -1,
  63, 63, 59, -1,
  127, 63, 59, -1,
  191, 63, 59, -1,
  ]);


// Information about where objects are in the combined sprite map,
// and what are their extents in world coordinates.
export class ObjectInfo {
  // All obj* input objects must be `Float32Array`s padded to
  // four elements per object.
  constructor(gl_) {
    gl = gl_;
  }

  // needs to be awaited before using the object!
  // creates a 3D texture info from a hard-coded URL.
  async initialize() {
    const loadPromise = new Promise((resolve) => {
      var img = new Image();
      img.addEventListener('load', () => resolve(img));
      img.src = spritesFile;
    });
    this.img = await loadPromise;

    [this.width, this.height, this.depth] = spritesShape;
    if (this.img.width * this.img.height != this.width * this.height * this.depth) {
      console.error("Image has unexpected number of pixels.", [this.img.width, this.img.height], [this.width, this.height, this.depth]);
    }
  }

  compile(program) {
    this.spriteTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.spriteTexture);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA, this.width, this.height, this.depth, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.img);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    this.spriteUniformLocation = gl.getUniformLocation(program, 'sprites');

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
    const varNames = ["objSize", "objTexMin", "objTexMax"];
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
    gl.uniform1i(this.spriteUniformLocation, 2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, this.spriteTexture);

    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, this.variableInfo["objSize"].offset, objSize, 0);
    gl.bufferSubData(gl.UNIFORM_BUFFER, this.variableInfo["objTexMin"].offset, objTexMin, 0);
    gl.bufferSubData(gl.UNIFORM_BUFFER, this.variableInfo["objTexMax"].offset, objTexMax, 0);
  }
}
