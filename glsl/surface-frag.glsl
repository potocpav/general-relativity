# version 300 es
precision highp float;
precision mediump sampler3D;
precision highp sampler2D;


uniform float time;
uniform vec2 resolution;
uniform vec3 obsv_x;
uniform vec3 obsv_u;
uniform vec2 obsv_o; // orientation vector in the local orthonormal (r, phi) frame
uniform int obsv_sprite;

uniform float viewport_size;
uniform float rs;

uniform sampler3D sprites;

uniform sampler2D obj_xs;
uniform sampler2D obj_us;
uniform sampler2D obj_its;
uniform int n_objects; // number of valid columns in obj_* textures

// Must match the arrays in object-info.js
#define N_SPRITES 4
layout(std140) uniform objectInfo {
	vec3 objSize[N_SPRITES];
	vec3 objTexMin[N_SPRITES];
	vec3 objTexMax[N_SPRITES];
};

out vec4 out_color;

#define pi 3.141592653589793
#define epsilon 1e-5

// Set to 1 to shift hues with wavelength. Disabled, because it looks too wrong ATM;
// with it disabled, only intensity changes with redshift.
#define COLOR_SHIFT 0

// Screen-space to viewport-space, scaled by the mean of screen dimensions
// to look good on both vertical and horizontal devices
vec2 s2v(vec2 screen, float size) {
	float meanRes = (resolution.x + resolution.y) / 2.0;
	return ((screen - resolution / 2.0) / meanRes) * size / 2.0;
}

// Schwarzschild (t, r, phi) metric tensor
mat3 g(vec3 x) {
  float r = x.y;
  return mat3(
		-(1.0 - rs / r), 0.0, 0.0,
		0.0, 1.0 / (1.0 - rs / r), 0.0,
		0.0, 0.0, r * r);
}

// Christoffel symbols contracted with u twice: Gamma^mu_ab u^a u^b
// (only the non-zero symbols are evaluated)
vec3 gamma_uu(vec3 x, vec3 u) {
	float r = x.y;
	float a = rs / (2.0 * r * (r - rs)); // Gamma^t_tr = -Gamma^r_rr
	return vec3(
		2.0 * a * u.x * u.y,
		rs * (r - rs) / (2.0 * r*r*r) * u.x*u.x - a * u.y*u.y + (rs - r) * u.z*u.z,
		2.0 / r * u.y * u.z);
}

// Grid visualization

vec3 grid_color(vec3 pos) {
	// adaptive stride calculation
	mat3 gx = g(pos);
	float grids_per_screen = 20.0;
	vec3 stride_raw = viewport_size / vec3(sqrt(-gx[0][0]), sqrt(gx[1][1]), sqrt(gx[2][2])) / grids_per_screen;
	vec3 stride_log = log2(stride_raw);
	vec3 stride_floor = floor(stride_log);
	vec3 stride_alpha = 1.0 - (stride_log - stride_floor);
	vec3 stride = exp2(stride_floor);

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

vec4 out_of_bounds(bool reached, vec4 c) {
	return reached ? c : vec4(0.1, 0.0, 0.0, 1.0);
}

// compute 3-vector out of a 2-vector so that ds = 0
// (supposing a diagonal metric)
vec3 light3(mat3 gx, vec2 u2) {
	float res = dot(gx * vec3(0.0, u2), vec3(0.0, u2)) / gx[0][0];
	return vec3(-sqrt(-res), u2);
}

// geodesic equation: du/dl (dx/dl = u)
vec3 geo_u(vec3 x, vec3 u) {
	return -gamma_uu(x, u);
}

// Bogacki–Shampine RK23 adaptive solver
// https://en.m.wikipedia.org/wiki/Bogacki%E2%80%93Shampine_method
// `k1u` must be geo_u(x, u). Outputs `k4u` = geo_u(x1, u1), which is the `k1u`
// of the next step if this one gets accepted (First Same As Last).
void rk23(vec3 x, vec3 u, vec3 k1u, float h, out vec3 x1, out vec3 u1, out vec3 k4u, out vec3 z1u) {
	vec3 k1x = u;
	vec3 k2x = u + k1u * h * 0.5;
	vec3 k2u = geo_u(x + k1x * h * 0.5, k2x);
	vec3 k3x = u + k2u * h * 0.75;
	vec3 k3u = geo_u(x + k2x * h * 0.75, k3x);
	x1 = x + h * (2.0/9.0 * k1x + 1.0/3.0 * k2x + 4.0/9.0 * k3x);
	u1 = u + h * (2.0/9.0 * k1u + 1.0/3.0 * k2u + 4.0/9.0 * k3u);
	k4u = geo_u(x1, u1);
	z1u = u + h * (7.0/24.0 * k1u + 0.25 * k2u + 1.0/3.0 * k3u + 0.125 * k4u);
}

bool raytrace(vec3 x0, vec3 u0, out vec3 x, out vec3 u) {
	const float SAFETY = 0.9;
	const float INITIAL_H = 0.1;
	const float MIN_FACTOR = 0.1;
	const float MAX_FACTOR = 10.0;
	const float ATOL = 0.0;
	const float RTOL = 0.001;
	const float ERR_EXPONENT = -1.0/3.0;
	const int MAX_ITERS = 40;

	x = x0;
	u = u0;
	vec3 k1u = geo_u(x, u);
	float l = 0.0;
	float h = INITIAL_H;
	bool step_accepted = true;
	for (int n = 0; n < MAX_ITERS && l < 1.0; n += 1) {
		float l1 = min(l + h, 1.0);
		h = l1 - l;

		vec3 x1, u1, k4u, z1u;
		rk23(x, u, k1u, h, x1, u1, k4u, z1u);

		float scale = ATOL + max(length(u), length(u1)) * RTOL;
		float error = length(z1u - u1) / scale;

		float factor;
		if (error < 1.0) {
			if (error == 0.0) {
				factor = MAX_FACTOR;
			} else {
				factor = min(MAX_FACTOR, SAFETY * pow(error, ERR_EXPONENT));
			}
			if (!step_accepted) {
				factor = min(1.0, factor);
			}
			h *= factor;
			step_accepted = true;
		} else {
			factor = max(MIN_FACTOR, SAFETY * pow(error, ERR_EXPONENT));
			h *= factor;
			step_accepted = false;
		}

		if (step_accepted) {
			l = l1;
			u = u1;
			x = x1;
			k1u = k4u;
		}
	}
	return l >= 1.0;
}

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
	a /= max(length(a), 1e-20);
	return mat2(a.y, a.x, -a.x, a.y);
}

vec2 viewport2world(float r, float phi, vec2 x) {
	mat2 A = mat2(cos(phi), -r * sin(phi), sin(phi), r * cos(phi));
	return x * inverse2(A);
}

// Lorentz boost matrix

mat3 boost(vec3 u) {
	float fac = (u.x - 1.0) / (dot(u.yz, u.yz) + epsilon);
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

#if COLOR_SHIFT
float x(float l) {
	return 1.065 * exp(-0.5 * pow((l - 595.8) / 33.33, 2.0)) + 0.366 * exp(-0.5 * pow((l - 446.8) / 19.44, 2.0));
}

float y(float l) {
	return 1.014 * exp(-0.5 * pow((log(l) - log(556.3)) / 0.075, 2.0));
}

float z(float l) {
	return 1.839 * exp(-0.5 * pow((log(l) - log(449.8)) / 0.051, 2.0));
}
#endif

vec3 redshift(float l, vec3 sRgb) {
	const float power_exp = 3.0;
	vec3 linear = pow(sRgb, vec3(2.2));
#if COLOR_SHIFT
	const mat3 sRgbToSpectral = mat3(
		0.4148, 0.0140, 0.0129,
 		0.0580, 0.6812, 0.0797,
 		0.0191, 0.0257, 0.6391
	);
	vec3 spectral = sRgbToSpectral * linear;
	float R = 610.0, G = 550.0, B = 465.0;
	mat3 shift = mat3(
		x(R*l), y(R*l), z(R*l),
		x(G*l), y(G*l), z(G*l),
		x(B*l), y(B*l), z(B*l)
	);
	const mat3 xyzToSrgb = mat3(
		 3.2406,-0.9689,  0.0557,
		-1.5372, 1.8757, -0.2040,
		-0.4986, 0.0415,  1.0569
	);
	vec3 shifted = xyzToSrgb * shift * spectral * pow(l, -power_exp);
#else
	// Without the wavelength shift, the spectral round-trip above is
	// the identity matrix to within 2e-4, so it is skipped.
	vec3 shifted = linear * pow(l, -power_exp);
#endif
	return pow(max(shifted, 0.0), vec3(1.0/2.2));
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
	int last = textureSize(x, 0).y - 1;
	int i0 = min(int(i), last);
	int i1 = min(i0 + 1, last);
	vec3 p1 = texelFetch(x, ivec2(j, i0), 0).xyz;
	vec3 p2 = texelFetch(x, ivec2(j, i1), 0).xyz;
	float a = i - floor(i);
	return p1 * (1.0 - a) + p2 * a;
}

vec4 render_obj(vec3 pix_x, int sprite_i, float rshift, float tau, vec3 deltax, vec2 orientation) {
	mat3 T_pix_x = T(pix_x);
	vec2 obj_texcoord2 = rot(orientation) * (T_pix_x * deltax).yz / objSize[sprite_i].yz;
	if (max(abs(obj_texcoord2.x), abs(obj_texcoord2.y)) < 0.5) {
		vec3 lo = objTexMin[sprite_i], hi = objTexMax[sprite_i];
		// Pixel coordinates -> texel centers, so that linear filtering
		// doesn't bleed into neighbouring sprites.
		vec2 xy = mix(lo.xy, hi.xy, obj_texcoord2 + 0.5) + 0.5;
		// Animation frames are sampled exactly at slice centers, which avoids
		// blending in frames of other sprites and makes the loop seamless.
		float n_frames = hi.z - lo.z + 1.0;
		float frame = min(floor(fract(tau / objSize[sprite_i].x) * n_frames), n_frames - 1.0);
		vec3 obj_texcoord = vec3(xy, lo.z + frame + 0.5);
		vec4 obj_color = texture(sprites, obj_texcoord / vec3(textureSize(sprites, 0)));
		return vec4(redshift(rshift, obj_color.xyz), obj_color.a);
	} else {
		return vec4(0.0);
	}
}

void main( void ) {
	// screen to observer space transformation
	vec2 pix_cartesian = s2v(gl_FragCoord.xy, viewport_size);
	vec2 pix_target = viewport2world(obsv_x.y, obsv_x.z, pix_cartesian);

	mat3 gx = g(obsv_x);
	vec3 pix_v3 = light3(gx, pix_target); // 3-vec pointing at pix

	// boost the grid
	vec3 pix_u0 = general_boost(T(obsv_x), neg_u(obsv_u)) * pix_v3;

	// raytracing along null geodesics
	vec3 pix_x, pix_u;
	bool reached = raytrace(obsv_x, pix_u0, pix_x, pix_u);
	float lorentz_rshift = pix_u0.x / pix_v3.x;
	float grav_rshift = sqrt(gx[0][0] / g(pix_x)[0][0]);
	float rshift = lorentz_rshift * grav_rshift;

	// compute output colors
	vec3 world_color = redshift(rshift, grid_color(pix_x));

	// show objects
	mat3 T_pix_x = T(pix_x);
	vec4 objects_color = vec4(0.0);
	int nPoints = textureSize(obj_its, 0).y;
	float last = float(nPoints - 1);
	int bisect_iters = int(log2(float(nPoints)) + 7.0);
	for (int i = 0; i < n_objects; i++) { // for each object
		mat3 obj_boost;
		vec3 obj_deltax;
		// bisect time for the object trajectory
		float j0 = 0.0, j1 = last;
		float j;
		for (int it = 0; it < bisect_iters; it++) {
			j = (j0 + j1) / 2.0;
			vec3 obj_x = sample_linear(obj_xs, j, i);
			vec3 obj_u = sample_linear(obj_us, j, i);

			obj_boost = general_boost(T_pix_x, obj_u);
			obj_deltax = obj_boost * cyclic(obj_x - pix_x);

			if (obj_deltax.x > 0.0 || isnan(obj_deltax.x))
				j1 = j;
			else
				j0 = j;
		}
		// The pixel's event is before the trajectory starts or after it ends.
		if (j0 == 0.0 || j1 == last) continue;

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
		pix_x, obsv_sprite, 1.0, time, vec3(0.0, cyclic(obsv_x-pix_x).yz), obsv_o);

	objects_color = mix(objects_color, obsv_color, obsv_color.a);

	out_color = out_of_bounds(reached, mix(vec4(world_color, 1.0), objects_color, objects_color.a));
}
