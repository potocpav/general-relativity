

const spritesFile = "models/sprites.webp";
const spritesShape = [64*3, 64, 60]; // x, y, d
export const
  shipId = 0,
  shipThrustingId = 1,
  asteroidId = 2,
  photonClockId = 3,
  projectileId = 4; // drawn as a dot by the shader, not from the sprite image

// Sprite extents in world coordinates, including time coordinate.
const objSize = new Float32Array([
  2, 0.5, 0.5, -1,   // rocket
  2, 0.5, 0.5, -1,   // thrusting rocket
  5, 0.3, 0.3, -1, // asteroid
  1, 64/38/2, 64/38/2, -1,   // photon clock
  1, 0.125, 0.125, -1,       // projectile: the dot's diameter, 1/4 of the rocket's width
  ]);

// Minimum pixel coordinates of sprites in the combined sprite image (inclusive)
const objTexMin = new Float32Array([
  0, 0, 0, -1,
  0, 0, 30, -1,
  64, 0, 0, -1,
  128, 0, 0, -1,
  0, 0, 0, -1,     // projectile: unused
  ]);

// Maximum pixel coordinates of sprites in the combined sprite image (inclusive)
const objTexMax = new Float32Array([
  63, 63, 29, -1,
  63, 63, 59, -1,
  127, 63, 59, -1,
  191, 63, 59, -1,
  0, 0, 0, -1,     // projectile: unused
  ]);

const uniformBlockBinding = 0;

// Half of the diagonal of a sprite's spatial extent: the farthest it reaches
// from the object's position.
export const objectRadius = type => 0.5 * Math.hypot(objSize[type * 4 + 1], objSize[type * 4 + 2]);

// Number of sprites; passed to the shader as N_SPRITES.
export const nSprites = objSize.length / 4;
console.assert(objTexMin.length == nSprites * 4 && objTexMax.length == nSprites * 4);


// The sprite image's pixels (RGBA), loaded once per page and shared by all
// simulations on it. They are uploaded from an array, not from the image:
// Chrome rejects images taller than MAX_3D_TEXTURE_SIZE (2048 on some GPUs,
// and in SwiftShader) as a 3D texture source, although the texture fits.
const spritePixels = new Map(); // root -> Promise<Uint8Array>
function loadSprites(root) {
  if (!spritePixels.has(root)) spritePixels.set(root, (async () => {
    const url = root + spritesFile;
    const img = await new Promise((resolve, reject) => {
      const img = new Image();
      img.addEventListener('load', () => resolve(img));
      img.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)));
      img.src = url;
    });
    const [width, height, depth] = spritesShape;
    if (img.width != width || img.height != height * depth) {
      throw new Error(`${url} has unexpected size ${img.width}x${img.height}, expected ${width}x${height * depth}`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return new Uint8Array(ctx.getImageData(0, 0, img.width, img.height).data.buffer);
  })());
  return spritePixels.get(root);
}

// Information about where objects are in the combined sprite map,
// and what are their extents in world coordinates.
export class ObjectInfo {
  // All obj* input objects must be `Float32Array`s padded to
  // four elements per object.
  constructor(gl_) {
    this.gl = gl_;
  }

  // Needs to be awaited before using the object: loads the sprite image, from
  // `root` (the URL of the repository root, relative to the page).
  async initialize(root = '') {
    [this.width, this.height, this.depth] = spritesShape;
    this.pixels = await loadSprites(root);
  }

  // Set up for a (new) shader program. GPU resources are created only once.
  compile(program) {
    const gl = this.gl;
    if (!this.spriteTexture) this.createResources(program);
    this.spriteUniformLocation = gl.getUniformLocation(program, 'sprites');
    gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, "objectInfo"), uniformBlockBinding);
  }

  createResources(program) {
    const gl = this.gl;
    this.spriteTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.spriteTexture);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA, this.width, this.height, this.depth, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_3D, null);

    // set up object info UBO; its contents are constant, so upload them once.
    // The layout is the same in every program (std140).
    // Described in detail in https://gist.github.com/jialiang/2880d4cc3364df117320e8cb324c2880
    const uboLocation = gl.getUniformBlockIndex(program, "objectInfo");
    const blockSize = gl.getActiveUniformBlockParameter(program, uboLocation, gl.UNIFORM_BLOCK_DATA_SIZE);

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, blockSize, gl.STATIC_DRAW);

    const data = {objSize, objTexMin, objTexMax};
    const varNames = Object.keys(data);
    const indices = gl.getUniformIndices(program, varNames);
    const offsets = gl.getActiveUniforms(program, indices, gl.UNIFORM_OFFSET);
    varNames.forEach((name, i) => gl.bufferSubData(gl.UNIFORM_BUFFER, offsets[i], data[name]));

    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, uniformBlockBinding, this.buffer);
  }

  render() {
    const gl = this.gl;
    gl.uniform1i(this.spriteUniformLocation, 2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, this.spriteTexture);
  }
}
