
// Normalized square with center at origin and size of 1.
const surfaceCorners = new Float32Array([
  -1.0, -1.0, 1.0, -1.0, -1.0, 1.0,
  1.0, -1.0, 1.0, 1.0, -1.0, 1.0,
  ]);

// Initialise WebGL
function initGl(canvas) {
  try {
    gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  } catch(error) { }

  if (gl) {
    // Create surface and screen geometry (2 triangles)
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, surfaceCorners, gl.STATIC_DRAW);
  } else {
    alert('WebGL not supported.');
  }
  return gl;
}

function compileSurfaceProgram(vertex, fragment) {
  if (!gl) { return; }

  var program = gl.createProgram();

  var vs = createShader(vertex, gl.VERTEX_SHADER);
  var fs = createShader(fragment, gl.FRAGMENT_SHADER);

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    var error = gl.getProgramInfoLog(program);
    console.error(error);
    console.error('VALIDATE_STATUS: ' + gl.getProgramParameter(program, gl.VALIDATE_STATUS), 'ERROR: ' + gl.getError());
    return;
  }

  // Cache uniforms
  cacheUniformLocation(program, 'time');
  cacheUniformLocation(program, 'mouse');
  cacheUniformLocation(program, 'resolution');
  cacheUniformLocation(program, 'obsv_x');
  cacheUniformLocation(program, 'obsv_u');
  cacheUniformLocation(program, 'screen_size');
  cacheUniformLocation(program, 'rs');
  cacheUniformLocation(program, 'sprites');
  cacheUniformLocation(program, 'obj_x');
  cacheUniformLocation(program, 'obj_u');
  cacheUniformLocation(program, 'obj_it');

  // set up object info UBO
  // Described in detail in https://gist.github.com/jialiang/2880d4cc3364df117320e8cb324c2880
  objectInfoUboLocation = gl.getUniformBlockIndex(program, "objectInfo");
  objectInfoUboBlockSize = gl.getActiveUniformBlockParameter(program, objectInfoUboLocation, gl.UNIFORM_BLOCK_DATA_SIZE);
  objectInfoUboBuffer = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, objectInfoUboBuffer);
  gl.bufferData(gl.UNIFORM_BUFFER, objectInfoUboBlockSize, gl.DYNAMIC_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, objectInfoUboBuffer);
  // TODO: mirror the pattern of `cacheUniformLocation` here
  const objectInfoVarNames = ["objSize", "objTexMin", "objTexMax", "objTexDTau"];
  const objectInfoIndices = gl.getUniformIndices(program, objectInfoVarNames);
  const objectInfoOffsets = gl.getActiveUniforms(program, objectInfoIndices, gl.UNIFORM_OFFSET);
  objectInfoUboVariableInfo = {};
  objectInfoVarNames.forEach((name, index) => {
    objectInfoUboVariableInfo[name] = {
      index: objectInfoIndices[index],
      offset: objectInfoOffsets[index],
    };
  });
  gl.uniformBlockBinding(program, objectInfoUboLocation, 0);

  // console.log(objectInfoUboLocation, objectInfoUboBlockSize);
  // console.log(objectInfoIndices);
  // console.log(objectInfoOffsets);
  // console.log(objectInfoUboVariableInfo);
  // console.log(objectInfoUboLocation);

  // Load program into GPU
  gl.useProgram(program);

  // Set up buffers
  vertexPosition = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(vertexPosition);
  return program;
}

function compileScreenProgram(vertex, fragment) {
  if (!gl) { return; }

  var program = gl.createProgram();

  var vs = createShader(vertex, gl.VERTEX_SHADER);
  var fs = createShader(fragment, gl.FRAGMENT_SHADER);

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('VALIDATE_STATUS: ' + gl.getProgramParameter(program, gl.VALIDATE_STATUS), 'ERROR: ' + gl.getError());
    return;
  }

  gl.useProgram(program);

  cacheUniformLocation(program, 'resolution');
  cacheUniformLocation(program, 'color');

  screenVertexPosition = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(screenVertexPosition);

  return program;
}

function createTarget(width, height) {
  var target = {};

  target.framebuffer = gl.createFramebuffer();
  target.renderbuffer = gl.createRenderbuffer();
  target.texture = gl.createTexture();

  // set up framebuffer
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);

  // set up renderbuffer
  gl.bindRenderbuffer(gl.RENDERBUFFER, target.renderbuffer);

  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, target.renderbuffer);

  // clean up
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindBuffer(gl.UNIFORM_BUFFER, null);

  return target;
}

function createShader(src, type) {
  var shader = gl.createShader(type);

  gl.shaderSource(shader, src);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    var error = gl.getShaderInfoLog(shader);

    // Remove trailing linefeed, for FireFox's benefit.
    while ((error.length > 1) && (error.charCodeAt(error.length - 1) < 32)) {
      error = error.substring(0, error.length - 1);
    }

    console.log(src, error);
    return null;
  }
  return shader;
}

function cacheUniformLocation(program, label) {
  if (program.uniformsCache === undefined) {
    program.uniformsCache = {};
  }
  program.uniformsCache[label] = gl.getUniformLocation(program, label);
}

function render(glContext, frontTarget, backTarget) {
  // Set uniforms for surface shader
  gl.useProgram(glContext.surfaceProgram);

  gl.uniform1f(glContext.surfaceProgram.uniformsCache['time'], params.time);
  gl.uniform2f(glContext.surfaceProgram.uniformsCache['mouse'], params.mouseX, params.mouseY);
  gl.uniform2f(glContext.surfaceProgram.uniformsCache['resolution'], params.screenWidth, params.screenHeight);
  gl.uniform3f(glContext.surfaceProgram.uniformsCache['obsv_x'], params.obsvX.get(0), params.obsvX.get(1), params.obsvX.get(2));
  gl.uniform3f(glContext.surfaceProgram.uniformsCache['obsv_u'], params.obsvU.get(0), params.obsvU.get(1), params.obsvU.get(2));
  gl.uniform1f(glContext.surfaceProgram.uniformsCache['screen_size'], params.screenSize);
  gl.uniform1f(glContext.surfaceProgram.uniformsCache['rs'], params.rs);

  gl.uniform1i(glContext.surfaceProgram.uniformsCache['sprites'], 2);
  gl.uniform1i(glContext.surfaceProgram.uniformsCache['obj_x'], 3);
  gl.uniform1i(glContext.surfaceProgram.uniformsCache['obj_u'], 4);
  gl.uniform1i(glContext.surfaceProgram.uniformsCache['obj_it'], 5);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.vertexAttribPointer(vertexPosition, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, backTarget.texture);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_3D, params.spriteTexture);

  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, objectTextures.tex_x);

  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, objectTextures.tex_u);

  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, objectTextures.tex_it);

  // Set object info UBO for surface shader

  gl.bindBuffer(gl.UNIFORM_BUFFER, objectInfoUboBuffer);
  gl.bufferSubData(gl.UNIFORM_BUFFER, objectInfoUboVariableInfo["objSize"].offset, new Float32Array([0.1]), 0);
  gl.bufferSubData(gl.UNIFORM_BUFFER, objectInfoUboVariableInfo["objTexMin"].offset, new Float32Array([0, 0, 0]), 0);
  gl.bufferSubData(gl.UNIFORM_BUFFER, objectInfoUboVariableInfo["objTexMax"].offset, new Float32Array([63, 63, 59]), 0);
  gl.bufferSubData(gl.UNIFORM_BUFFER, objectInfoUboVariableInfo["objTexDTau"].offset, new Float32Array([5]), 0);

  gl.bindBuffer(gl.UNIFORM_BUFFER, null);

  // Render custom shader to front buffer

  gl.bindFramebuffer(gl.FRAMEBUFFER, frontTarget.framebuffer);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Set uniforms for screen shader

  gl.useProgram(glContext.screenProgram);

  gl.uniform2f(glContext.screenProgram.uniformsCache['resolution'], params.screenWidth, params.screenHeight);
  gl.uniform1i(glContext.screenProgram.uniformsCache['color'], 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.vertexAttribPointer(screenVertexPosition, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, frontTarget.texture);

  // Render front buffer to screen

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}
