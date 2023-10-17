# version 300 es
precision highp float;
precision mediump sampler3D;
precision highp sampler2D;


uniform float time;
uniform vec2 mouse;
uniform vec2 resolution;
uniform vec3 obsv_x;
uniform vec3 obsv_u;

uniform float screen_size;
uniform float rs;

uniform sampler3D sprites;

uniform sampler2D obj_x;
uniform sampler2D obj_u;
uniform sampler2D obj_it;

uniform objectInfo {
	float objSize[1];
	vec3 objTexMin[1];
	vec3 objTexMax[1];
	float objTexDTau[1];
};

out vec4 out_color;

#define pi 3.141592653589793

// Screen-space to world-space

// TODO: don't specify height, specify the (geometric?) mean of screen dimensions
// to look good on both vertical and horizontal devices
vec2 s2w(vec2 screen, vec2 origin, float size) {
	float meanRes = (resolution.x + resolution.y) / 2.0;
	return ((screen - resolution / 2.0) / meanRes) * size / 2.0;
}

// Minkowski metric

mat3 nu(vec3 x) {
	return mat3(-1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
}

// Schwarzschield (t, r, phi) metric tensor and Christoffel symbols
mat3 g(vec3 x) {
  float r = x.y;
  return mat3(
		-(1.0 - rs / r), 0.0, 0.0,
		0.0, 1.0 / (1.0 - rs / r), 0.0,
		0.0, 0.0, r * r);
}

mat3 Gamma0(vec3 x) {
  float r = x.y;
  return mat3(
    0.0, rs / (2.0 * r * (r - rs)), 0.0,
    rs / (2.0 * r * (r - rs)), 0.0, 0.0,
    0.0, 0.0, 0.0
  );
}
mat3 Gamma1(vec3 x) {
  float r = x.y;
  return mat3(
    rs * (r - rs) / (2.0 * r*r*r), 0.0, 0.0,
    0.0, -rs / (2.0 * r * (r - rs)), 0.0,
    0.0, 0.0, rs - r
  );
}
mat3 Gamma2(vec3 x) {
  float r = x.y;
  return mat3(
    0.0, 0.0, 0.0,
    0.0, 0.0, 1.0 / r,
    0.0, 1.0 / r, 0.0
  );
}

// Grid visualization

vec3 grid_color(vec3 pos) {
	// adaptive stride calculation
	mat3 gx = g(pos);
	float grids_per_screen = 20.0;
	vec3 stride_raw = screen_size / vec3(sqrt(-gx[0][0]), sqrt(gx[1][1]), sqrt(gx[2][2])) / grids_per_screen;
	vec3 stride_log = log2(stride_raw);
	vec3 stride_floor = floor(stride_log);
	vec3 stride_alpha = 1.0 - (stride_log - stride_floor);
	vec3 stride = vec3(
		pow(2.0, stride_floor[0]),
		pow(2.0, stride_floor[1]),
		pow(2.0, stride_floor[2]));

	// coarse grid which doesn't fade in
	vec3 grid_ratio = vec3(0.0, 0.1, 0.1) * (1.0 - stride_alpha * 0.5);
	vec3 grid_frac = abs(mod(pos / stride + 0.5, 1.0) * 2.0 - 1.0);
	float grid = float((grid_frac.x < grid_ratio.x) || (grid_frac.y < grid_ratio.y) || (grid_frac.z < grid_ratio.z));

	// fine grid which fades in
	vec3 grid2_ratio = 2.0 * grid_ratio;
	vec3 grid2_frac = abs(mod(pos / (stride/2.0) + 0.5, 1.0) * 2.0 - 1.0);
	vec3 on_grid2 = stride_alpha * vec3(
		float(grid2_frac.x < grid2_ratio.x), float(grid2_frac.y < grid2_ratio.y), float(grid2_frac.z < grid2_ratio.z));
	float grid2 = max(max(on_grid2.x, on_grid2.y), on_grid2.z);
	return vec3((0.0 + max(grid, grid2))*0.3);
}

float black_hole(vec3 pos) {
	float pos_viz = (rs - pos.y) * 100.0;
	return min(1.0, max(0.0, -pos_viz));
}

float origin_color(vec2 pos) {
	return length(pos) < 0.005 ? 1.0 : 0.0;
}

// compute 3-vector out of a 2-vector so that ds = 0
// (supposing a diagonal metric)
vec3 light_u3(vec3 x, vec2 u2) {
	float res = dot(g(x) * vec3(0.0, u2), vec3(0.0, u2)) / g(x)[0][0];
	return vec3(-sqrt(-res), u2);
}

vec3 geo_u(vec3 x, vec3 u) {
	return vec3(
		-dot(Gamma0(x) * u, u),
		-dot(Gamma1(x) * u, u),
		-dot(Gamma2(x) * u, u));
}

vec3 rk4_u(vec3 x, vec3 u, float h) {
	vec3 k1 = geo_u(x, u);
	vec3 k2 = geo_u(x, u + k1 * h / 2.0);
	vec3 k3 = geo_u(x, u + k2 * h / 2.0);
	vec3 k4 = geo_u(x, u + k3 * h);
	return u + h / 6.0 * (k1 + 2.0*k2 + 2.0*k3 + k4);
}

vec3 rk4_x(vec3 x, vec3 u, float h) {
	return x + u * h;
}

mat2 inverse2(mat2 m) {
  return mat2(
		m[1][1], -m[0][1],
    -m[1][0], m[0][0]
		) / (m[0][0]*m[1][1] - m[0][1]*m[1][0]);
}

mat3 inverse_diag3(mat3 m) {
	return mat3(
		1.0 / m[0][0], 0.0, 0.0,
		0.0, 1.0 / m[1][1], 0.0,
		0.0, 0.0, 1.0 / m[2][2]);
}

vec2 cart2polar(float r, float phi, vec2 x) {
	mat2 A = mat2(cos(phi), -r * sin(phi), sin(phi), r * cos(phi));
	return x * inverse2(A);
}

// Lorentz boost

mat3 boost(vec3 u) {
	float fac = (u.x - 1.0) / dot(u.yz, u.yz);
	return mat3(
		u.x, -u.y, -u.z,
		-u.y, 1.0 + fac * u.y*u.y, fac * u.y*u.z,
		-u.z, fac * u.y*u.z, 1.0 + fac * u.z*u.z
	);
}

vec3 redshift(float a, vec3 c) {
	// random functions to make it look sorta good
	// TODO: make something proper
	return max(vec3(0.0), min(vec3(1.0),
		vec3(
				c.r * min(1.0, pow(a,2.0)),
				c.g * 0.5,
				c.b * min(1.0, 1.0 / pow(a,2.0))
			)
		));
}

// Transform metric at point x to Minkowski metric
mat3 T(vec3 x) {
	mat3 gx = g(x);
	return mat3(
		sqrt(-gx[0][0]), 0.0, 0.0,
		0.0, sqrt(gx[1][1]), 0.0,
		0.0, 0.0, sqrt(gx[2][2]));
}

vec3 cyclic(vec3 x) {
	return vec3(x.x, x.y, mod(x.z + pi, pi*2.0) - pi);
}

const float max_iters = 100.0;

void main( void ) {
	// screen to observer space transformation
	vec2 screen_origin = vec2(0.5, 0.5);

	vec2 pix_cartesian = s2w(gl_FragCoord.xy, screen_origin, screen_size);
	vec2 pix_target = cart2polar(obsv_x.y, obsv_x.z, pix_cartesian);

	vec3 pix_v3 = light_u3(obsv_x, pix_target); // 3-vec pointing at pix

	mat3 gx = g(obsv_x);
	// vector transformation to Minkowski metric
	mat3 Tx = T(obsv_x);
	vec3 grid_u = vec3(obsv_u.x, -obsv_u.yz);
	mat3 boostG = inverse_diag3(Tx) * boost(Tx * grid_u) * Tx;
	vec3 pix_u0 = boostG * pix_v3;

	// raytracing along null geodesics
	vec3 pix_x = obsv_x;
	vec3 pix_u = pix_u0;
	float pix_norm = dot(pix_target, pix_target);
	float dl = 1.0 / max_iters;
	for (float tau = 0.0; tau < 1.0; tau += 1.0 / max_iters) {
		vec3 pix_u1 = rk4_u(pix_x, pix_u, dl);
		vec3 pix_x1 = rk4_x(pix_x, pix_u, dl);
		pix_u = pix_u1;
		pix_x = pix_x1;
		if (pix_x.y < rs * rs)
			break;
	}
	float lorentz_rshift = pix_u0.x / pix_v3.x;
	float grav_rshift = sqrt(g(obsv_x)[0][0] / g(pix_x)[0][0]);
	float rshift = lorentz_rshift * grav_rshift;

	// compute output colors
	vec3 world_color = redshift(rshift, grid_color(pix_x));
	vec4 output_color = mix(vec4(world_color, 1.0), vec4(0.7), origin_color(pix_cartesian / screen_size));

	// show objects
	vec4 objects_color = vec4(0.0);
	for (int i = 0; i < textureSize(obj_it, 0).x; i++) {
		vec3 obj_pos = texelFetch(obj_x, ivec2(i, 0.0), 0).xyz;
		vec2 obj_coord2 = (T(pix_x) * cyclic(obj_pos - pix_x)).yz / objSize[0] + 0.5;
		vec3 obj_coord = vec3(mod(time/objTexDTau[0], 1.0), obj_coord2);
		vec3 obj_texcoord = mix(objTexMin[0], objTexMax[0], obj_coord.yzx);
		vec4 obj_color = texture(sprites, obj_texcoord / vec3(textureSize(sprites, 0)));
		objects_color = mix(objects_color, obj_color, obj_color.a);
	}

	out_color = black_hole(pix_x) * mix(output_color, objects_color, objects_color.a);
}
