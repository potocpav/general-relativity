// Spacetime physics shared by the surface shader and the physics tests.
// Mirrors js/metric.js, js/math.js and js/world.js; test/ checks that they agree.
// Assembled by js/shaders.js, which prepends `#version` and the shared defines.

precision highp float;

uniform float rs;

#define pi 3.141592653589793
#define epsilon 1e-5

// Screen-space [px] to viewport-space, scaled by the mean of screen dimensions
// to look good on both vertical and horizontal devices
vec2 s2v(vec2 screen, vec2 res, float size) {
	float meanRes = (res.x + res.y) / 2.0;
	return ((screen - res / 2.0) / meanRes) * size / 2.0;
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

// Transform metric at point x to Minkowski metric
mat3 T(vec3 x) {
	mat3 gx = g(x);
	return mat3(
		sqrt(-gx[0][0]), 0.0, 0.0,
		0.0, sqrt(gx[1][1]), 0.0,
		0.0, 0.0, sqrt(gx[2][2]));
}

// compute 3-vector out of a 2-vector so that ds = 0
// (supposing a diagonal metric)
vec3 light3(mat3 gx, vec2 u2) {
	float res = dot(gx * vec3(0.0, u2), vec3(0.0, u2)) / gx[0][0];
	return vec3(-sqrt(-res), u2);
}

// normalize duplicate coordinate points
vec3 cyclic(vec3 x) {
	return vec3(x.x, x.y, mod(x.z + pi, pi*2.0) - pi);
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

// 2D viewport element `x` to world element (dr, dphi) at (r, phi)
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

// Lorentz boost in arbitrary metric
mat3 general_boost(mat3 Tx, vec3 u) {
	return inverse_diag3(Tx) * boost(Tx * u) * Tx;
}

// Geodesics

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

// Integrate a geodesic from affine parameter 0 to 1.
// Returns false if the integration didn't reach the end.
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
