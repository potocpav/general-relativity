import { fetchText, physicsFragmentShader } from './shaders.js';

// Draws a world (World, Objects, ObjectInfo) into a WebGL 2 context: the
// raytracing shader renders into an HDR target, which is then copied to the
// canvas. One per Simulation.
export class Renderer {
  // `root` is the URL of the repository root, relative to the page.
  constructor(gl, world, objectInfo, objects, root = '') {
    this.gl = gl;
    this.world = world;
    this.objectInfo = objectInfo;
    this.objects = objects;
    this.root = root;
    this.colorBufferFloat = gl.getExtension('EXT_color_buffer_float');
    if (!this.colorBufferFloat) {
      console.warn("HDR not supported");
    }
    this.surfaceProgram = null;
    this.target = null;
  }

  async init(metric) {
    const gl = this.gl;
    const surfaceCorners = new Float32Array([
      -1.0, -1.0, 1.0, -1.0, -1.0, 1.0,
      1.0, -1.0, 1.0, 1.0, -1.0, 1.0,
    ]);
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, surfaceCorners, gl.STATIC_DRAW);

    let screenVert, screenFrag;
    [this.surfaceVert, this.surfaceFragMain, screenVert, screenFrag] = await Promise.all([
      "glsl/surface-vert.glsl", "glsl/surface-frag.glsl", "glsl/screen-vert.glsl", "glsl/screen-frag.glsl",
    ].map(f => fetchText(this.root + f)));

    await this.setMetric(metric);

    this.screenProgram = this.compileProgram(screenVert, screenFrag);
    this.cacheUniformLocation(this.screenProgram, 'resolution');
    this.cacheUniformLocation(this.screenProgram, 'color');
  }

  // (Re)compile the raytracing program for `metric`.
  async setMetric(metric) {
    const program = this.compileProgram(this.surfaceVert,
      await physicsFragmentShader(this.surfaceFragMain, metric, this.root));
    this.cacheUniformLocation(program, 'resolution');
    this.world.compile(program);
    this.objects.compile(program);
    this.objectInfo.compile(program);
    if (this.surfaceProgram) this.gl.deleteProgram(this.surfaceProgram);
    this.surfaceProgram = program;
  }

  // Compile & link a program, throwing on failure. Leaves the program in use.
  compileProgram(vertex, fragment) {
    const gl = this.gl;
    const program = gl.createProgram();
    const vs = this.createShader(vertex, gl.VERTEX_SHADER);
    const fs = this.createShader(fragment, gl.FRAGMENT_SHADER);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Shader program failed to link: ' + gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);
    program.vertexPosition = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(program.vertexPosition);
    return program;
  }

  createShader(src, type) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader).trimEnd();
      gl.deleteShader(shader);
      throw new Error('Shader failed to compile: ' + error);
    }
    return shader;
  }

  cacheUniformLocation(program, label) {
    if (program.uniformsCache === undefined) {
      program.uniformsCache = {};
    }
    program.uniformsCache[label] = this.gl.getUniformLocation(program, label);
  }

  // Set the size of the drawing buffer [pixels].
  resize(width, height) {
    const gl = this.gl;
    this.width = width;
    this.height = height;
    gl.viewport(0, 0, width, height);
    if (this.target) {
      gl.deleteFramebuffer(this.target.framebuffer);
      gl.deleteTexture(this.target.texture);
    }
    this.target = this.createTarget(width, height);
  }

  createTarget(width, height) {
    const gl = this.gl;
    const target = {};
    target.framebuffer = gl.createFramebuffer();
    target.texture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    // enable HDR rendering if supported
    if (this.colorBufferFloat) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status != gl.FRAMEBUFFER_COMPLETE) {
      console.error("Framebuffer incomplete: 0x" + status.toString(16));
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return target;
  }

  render() {
    const gl = this.gl, surface = this.surfaceProgram, screen = this.screenProgram;
    gl.useProgram(surface);
    gl.uniform2f(surface.uniformsCache['resolution'], this.width, this.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.vertexAttribPointer(surface.vertexPosition, 2, gl.FLOAT, false, 0, 0);

    this.world.render();
    this.objects.render();
    this.objectInfo.render();

    // the raytracing shader, into the target (covers all of it, no clear needed)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.framebuffer);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // the target, onto the canvas
    gl.useProgram(screen);
    gl.uniform2f(screen.uniformsCache['resolution'], this.width, this.height);
    gl.uniform1i(screen.uniformsCache['color'], 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.vertexAttribPointer(screen.vertexPosition, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.target.texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
