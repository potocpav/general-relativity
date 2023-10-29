# version 300 es
precision highp float;
precision mediump sampler3D;
precision highp sampler2D;


uniform float time;
uniform vec2 resolution;
uniform vec3 obsv_x;
uniform vec3 obsv_u;
uniform vec2 obsv_o; // orientation vector
uniform int obsv_sprite;
uniform vec3 event_x; // debugging event

uniform float screen_size;
uniform float rs;

uniform sampler3D sprites;

uniform sampler2D obj_xs;
uniform sampler2D obj_us;
uniform sampler2D obj_its;

layout(std140) uniform objectInfo {
	vec3 objSize[3];
	vec3 objTexMin[3];
	vec3 objTexMax[3];
};

out vec4 out_color;

#define pi 3.141592653589793

// Screen-space to viwport-space

// TODO: don't specify height, specify the (geometric?) mean of screen dimensions
// to look good on both vertical and horizontal devices
vec2 s2v(vec2 screen, float size) {
	float meanRes = (resolution.x + resolution.y) / 2.0;
	return ((screen - resolution / 2.0) / meanRes) * size / 2.0;
}

// Minkowski metric

mat3 nu(vec3 x) {
	return mat3(-1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
}

// Schwarzschild (t, r, phi) metric tensor and Christoffel symbols
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

// compute 3-vector out of a 2-vector so that ds = 0
// (supposing a diagonal metric)
vec3 light3(vec3 x, vec2 u2) {
	float res = dot(g(x) * vec3(0.0, u2), vec3(0.0, u2)) / g(x)[0][0];
	return vec3(-sqrt(-res), u2);
}

// RK4 with constant step solver

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

// Bogacki–Shampine RK23 adaptive solver

// vec3 rk23_u(vec3 x, vec3 u, float h) {
// 	const vec3 rtol = vec3(0.001);
// 	const vec3 atol = vec3(0.000001);
// 	float lmax = undefined;

// 	const mat3 A = mat3(
// 		0.0, 0.5, 0.0,
// 		0.0, 0.0, 0.75,
// 		0.0, 0.0, 0.0);
// 	const vec3 B = vec3(2.0/9.0, 1.0/3.0, 4.0/9.0);
// 	const vec3 C = vec3(0.0, 0.5, 0.75);
// 	const vec4 E = vec4(5.0/72.0, -1.0/12.0, -1.0/9.0, 1.0/8.0);
// 	// TODO: K

// 	vec3 K;
// 	K0 = geo_u(x, u);
// 	dy = K0 *

// 	// vec3 k1 = geo_u(x, u);
// 	// vec3 k2 = geo_u(x, u + k1 * h / 2.0);
// 	// vec3 k3 = geo_u(x, u + k2 * h / 2.0);
// 	// vec3 k4 = geo_u(x, u + k3 * h);
// 	// return u + h / 6.0 * (k1 + 2.0*k2 + 2.0*k3 + k4);
// }


// Matrix manipulation

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

 // a must be a heading vector, not necessarily normalized
mat2 rot(vec2 a) {
	a /= length(a);
	return mat2(a.y, a.x, -a.x, a.y);
}

vec2 viewport2world(float r, float phi, vec2 x) {
	mat2 A = mat2(cos(phi), -r * sin(phi), sin(phi), r * cos(phi));
	return x * inverse2(A);
}

// Lorentz boost matrix

mat3 boost(vec3 u) {
	float fac = (u.x - 1.0) / dot(u.yz, u.yz);
	return mat3(
		u.x, -u.y, -u.z,
		-u.y, 1.0 + fac * u.y*u.y, fac * u.y*u.z,
		-u.z, fac * u.y*u.z, 1.0 + fac * u.z*u.z
	);
}

// negate space coordinates of 3-velocity
vec3 neg_u(vec3 u) {
	return vec3(u.x, -u.yz);
}

// redshift calculation

float x(float l) {
	return 1.065 * exp(-0.5 * pow((l - 595.8) / 33.33, 2.0)) + 0.366 * exp(-0.5 * pow((l - 446.8) / 19.44, 2.0));
}

float y(float l) {
	return 1.014 * exp(-0.5 * pow((log(l) - log(556.3)) / 0.075, 2.0));
}

float z(float l) {
	return 1.839 * exp(-0.5 * pow((log(l) - log(449.8)) / 0.051, 2.0));
}

vec3 redshift(float l, vec3 sRgb) {
	const float power_exp = 3.0;
	const mat3 sRgbToSpectral = mat3(
		0.4148, 0.0140, 0.0129,
 		0.0580, 0.6812, 0.0797,
 		0.0191, 0.0257, 0.6391
	);
	vec3 linear = pow(sRgb, vec3(2.2));
	vec3 spectral = sRgbToSpectral * linear;
	float R = 610.0, G = 550.0, B = 465.0;

	float lS = 1.0; // disable color redshift, because it looks too wrong ATM
	mat3 shift = mat3(
		x(R*lS), y(R*lS), z(R*lS),
		x(G*lS), y(G*lS), z(G*lS),
		x(B*lS), y(B*lS), z(B*lS)
	);
	mat3 xyzToSrgb = mat3(
		 3.2406,-0.9689,  0.0557,
		-1.5372, 1.8757, -0.2040,
		-0.4986, 0.0415,  1.0569
	);
	vec3 shifted = xyzToSrgb * shift * spectral * pow(l, -power_exp);
	return max(vec3(0.0), min(vec3(1.0), pow(shifted, vec3(1.0/2.2))));
}

// Transform metric at point x to Minkowski metric
mat3 T(vec3 x) {
	mat3 gx = g(x);
	return mat3(
		sqrt(-gx[0][0]), 0.0, 0.0,
		0.0, sqrt(gx[1][1]), 0.0,
		0.0, 0.0, sqrt(gx[2][2]));
}

// Lorentz boost in arbitrary metric
mat3 general_boost(mat3 Tx, vec3 u) {
	return inverse_diag3(Tx) * boost(Tx * u) * Tx;
}

// normalize duplicate coordinate points
vec3 cyclic(vec3 x) {
	return vec3(x.x, x.y, mod(x.z + pi, pi*2.0) - pi);
}

// sample from x point [i,j] where i dimension is linearly interpolated
vec3 sample_linear(sampler2D x, float i, int j) {
	vec3 p1 = texelFetch(x, ivec2(j, int(i)), 0).xyz;
	vec3 p2 = texelFetch(x, ivec2(j, int(i) + 1), 0).xyz;
	float a = i - floor(i);
	return p1 * (1.0 - a) + p2 * a;
}

vec4 render_obj(vec3 pix_x, int sprite_i, float rshift, float tau, vec3 deltax, vec2 orientation) {
	mat3 T_pix_x = T(pix_x);
	vec2 obj_texcoord2 = rot(orientation) * (T_pix_x * deltax).yz / objSize[sprite_i].yz;
	if (max(abs(obj_texcoord2.x), abs(obj_texcoord2.y)) < 0.5) {
		vec3 obj_texcoord3 = vec3(mod(tau/objSize[sprite_i].x, 1.0), obj_texcoord2 + 0.5);
		vec3 obj_texcoord = mix(objTexMin[sprite_i], objTexMax[sprite_i], obj_texcoord3.yzx);
		vec4 obj_color = texture(sprites, obj_texcoord / vec3(textureSize(sprites, 0)));
		vec4 rshifted_obj_color = vec4(redshift(rshift, obj_color.xyz), obj_color.a);
		return rshifted_obj_color;
	} else {
		return vec4(0.0);
	}
}

const float max_iters = 100.0;

void main( void ) {
	// screen to observer space transformation
	vec2 pix_cartesian = s2v(gl_FragCoord.xy, screen_size);
	vec2 pix_target = viewport2world(obsv_x.y, obsv_x.z, pix_cartesian);

	vec3 pix_v3 = light3(obsv_x, pix_target); // 3-vec pointing at pix

	mat3 gx = g(obsv_x);

	// boost the grid
	vec3 pix_u0 = general_boost(T(obsv_x), neg_u(obsv_u)) * pix_v3;

	// raytracing along null geodesics
	vec3 pix_x = obsv_x;
	vec3 pix_u = pix_u0;
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

	// show objects
	mat3 T_pix_x = T(pix_x);
	// mat3 invT_pix_x = inverse_diag3(T_pix_x);
	vec4 objects_color = vec4(0.0);
	int nPoints = textureSize(obj_its, 0).y;
	mat3 obj_boost;
	vec3 obj_deltax;
	for (int i = 0; i < textureSize(obj_its, 0).x; i++) { // for each object
		vec3 obj_x;
		vec3 obj_u;
		// bisect time for the object trajectory
		float j0 = 0.0, j1 = float(nPoints - 1);
		float j;
		for (int it = 0; it < int(log2(float(nPoints))+7.0); it++) {
			j = (j0 + j1) / 2.0;
			// TODO: stop if outside range
			obj_x = sample_linear(obj_xs, j, i);
			obj_u = sample_linear(obj_us, j, i);

			obj_boost = general_boost(T_pix_x, obj_u);
			obj_deltax = obj_boost * cyclic(obj_x - pix_x);

			if (obj_deltax.x > 0.0 || isnan(obj_deltax.x))
				j1 = j;
			else
				j0 = j;
		}

		vec4 obj_color = render_obj(
			pix_x,
			int(texelFetch(obj_its, ivec2(i, int(j)), 0).x),
			rshift * (obj_boost * pix_u).x / pix_u.x,
			sample_linear(obj_its, j, i).y,
			obj_deltax,
			vec2(0.0, 1.0)
			);
		objects_color = mix(objects_color, obj_color, obj_color.a);
	}

	vec4 obsv_color = render_obj(
		pix_x, obsv_sprite, 1.0, time, vec3(0.0, cyclic(obsv_x-pix_x).yz/1.0), obsv_o);

	objects_color = mix(objects_color, obsv_color, obsv_color.a);

	// vec4 event_color = render_obj(
	// 	pix_x, 2, 1.0, time, vec3(0.0, cyclic(event_x-pix_x).yz/1.0), vec2(1.0, 0.0));
	// objects_color = mix(objects_color, event_color, event_color.a);

	out_color = black_hole(pix_x) * mix(vec4(world_color, 1.0), objects_color, objects_color.a);
}
