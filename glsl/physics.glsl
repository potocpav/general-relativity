// Spacetime physics shared by the surface shader and the physics tests.
// Mirrors js/metric.js, js/math.js and js/world.js; test/ checks that they agree.
// Light rays use a different (equivalent) formulation than js/math.js, see below.
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

// Schwarzschild metric in Schwarzschild (t, r, phi) coordinates.
//
// The reference frame is an orthonormal frame at every point, here the static
// observers. T(x) takes coordinate components of a vector at x to reference
// frame components, T_inv(x) back.
mat3 T(vec3 x) {
	float s = sqrt(1.0 - rs / x.y);
	return mat3(
		s, 0.0, 0.0,
		0.0, 1.0 / s, 0.0,
		0.0, 0.0, x.y);
}

mat3 T_inv(vec3 x) {
	float s = sqrt(1.0 - rs / x.y);
	return mat3(
		1.0 / s, 0.0, 0.0,
		0.0, s, 0.0,
		0.0, 0.0, 1.0 / x.y);
}

// normalize duplicate coordinate points
vec3 cyclic(vec3 x) {
	return vec3(x.x, x.y, mod(x.z + pi, pi*2.0) - pi);
}

// Lorentz boost of orthonormal frame components. `w` is the unit timelike
// 3-velocity of an observer in some frame; boost(w) takes components in that
// frame to the observer's rest frame, boost(neg_spatial(w)) back.
mat3 boost(vec3 w) {
	float fac = (w.x - 1.0) / (dot(w.yz, w.yz) + epsilon);
	return mat3(
		w.x, -w.y, -w.z,
		-w.y, 1.0 + fac * w.y*w.y, fac * w.y*w.z,
		-w.z, fac * w.y*w.z, 1.0 + fac * w.z*w.z
	);
}

vec3 neg_spatial(vec3 w) {
	return vec3(w.x, -w.yz);
}

// The rest frame of an observer with 4-velocity `u` at `x` is the reference
// frame boosted to the observer's velocity. rest_to_coord takes rest frame
// components to coordinate components, coord_to_rest the other way.
mat3 rest_to_coord(vec3 x, vec3 u) {
	return T_inv(x) * boost(neg_spatial(T(x) * u));
}

mat3 coord_to_rest(vec3 x, vec3 u) {
	mat3 Tx = T(x);
	return boost(Tx * u) * Tx;
}

// The light ray (past-directed null vector, coordinate components) that the
// observer at `x` with 4-velocity `u` sees at viewport vector `v`. The screen
// axes are the observer's rest frame axes, rotated to screen-aligned
// (cartesian) directions. The photon energy measured by the observer is |v|.
vec3 screen_ray(vec3 x, vec3 u, vec2 v) {
	float c = cos(x.z), s = sin(x.z);
	vec2 local = vec2(c * v.x + s * v.y, -s * v.x + c * v.y); // (r-hat, phi-hat)
	return rest_to_coord(x, u) * vec3(-length(local), local);
}

// Light rays

// Light rays are traced using their conserved energy E = (1 - rs/r) u^t and
// angular momentum L = r^2 u^phi, as y = (t, r, phi, v = dr/dl):
//   dt/dl = E / (1 - rs/r),  dr/dl = v,  dphi/dl = L / r^2,
//   dv/dl = L^2 (r - 1.5 rs) / r^4    (from v^2 = E^2 - L^2 (1 - rs/r) / r^2)
// Unlike the geodesic equation in Schwarzschild coordinates (as in js/math.js),
// the (r, phi, v) part is regular at the horizon: only u^t diverges there,
// and it doesn't feed back. Rays falling in therefore reach the horizon in a
// few steps, instead of crawling towards it with ever smaller steps.
vec4 ray_f(vec4 y, float E, float L) {
	float r = y.y;
	return vec4(E / (1.0 - rs / r), y.w, L / (r * r), L * L * (r - 1.5 * rs) / (r * r * r * r));
}

// spatial velocity (radial, tangential) of a ray state, for error control
vec2 ray_velocity(vec4 y, float L) {
	return vec2(y.w, L / y.y);
}

// Bogacki–Shampine RK23 step
// https://en.m.wikipedia.org/wiki/Bogacki%E2%80%93Shampine_method
// `k1` must be ray_f(y). Outputs `k4` = ray_f(y1), which is the `k1`
// of the next step if this one gets accepted (First Same As Last),
// and the 2nd order estimate `z1` for error control.
void rk23(vec4 y, vec4 k1, float h, float E, float L, out vec4 y1, out vec4 k4, out vec4 z1) {
	vec4 k2 = ray_f(y + 0.5 * h * k1, E, L);
	vec4 k3 = ray_f(y + 0.75 * h * k2, E, L);
	y1 = y + h * (2.0/9.0 * k1 + 1.0/3.0 * k2 + 4.0/9.0 * k3);
	k4 = ray_f(y1, E, L);
	z1 = y + h * (7.0/24.0 * k1 + 0.25 * k2 + 1.0/3.0 * k3 + 0.125 * k4);
}

#define RAY_REACHED 0       // traced to the end
#define RAY_HORIZON 1       // fell behind the horizon (within HORIZON_MARGIN)
#define RAY_OUT_OF_STEPS 2  // ran out of solver steps

// Trace a light ray (x0, u0 null) from affine parameter 0 to 1 with an adaptive
// RK23 solver. Returns one of the RAY_* statuses; `steps` is the number of
// solver iterations used.
int trace_ray(vec3 x0, vec3 u0, out vec3 x, out vec3 u, out int steps) {
	const float SAFETY = 0.9;
	const float INITIAL_H = 0.1;
	const float MIN_FACTOR = 0.1;
	const float MAX_FACTOR = 10.0;
	const float RTOL = 0.001;
	const float ERR_EXPONENT = -1.0/3.0;
	const int MAX_ITERS = 40;

	float E = (1.0 - rs / x0.y) * u0.x;
	float L = x0.y * x0.y * u0.z;
	vec4 y = vec4(x0, u0.y);
	vec4 k1 = ray_f(y, E, L);
	float l = 0.0;
	float h = INITIAL_H;
	bool step_accepted = true;
	int status = RAY_OUT_OF_STEPS;
	for (steps = 0; steps < MAX_ITERS; steps += 1) {
		if (y.y < rs * HORIZON_MARGIN) {
			status = RAY_HORIZON;
			break;
		}
		if (l >= 1.0) {
			status = RAY_REACHED;
			break;
		}

		float l1 = min(l + h, 1.0);
		h = l1 - l;

		vec4 y1, k4, z1;
		rk23(y, k1, h, E, L, y1, k4, z1);

		vec2 w1 = ray_velocity(y1, L);
		float scale = max(length(ray_velocity(y, L)), length(w1)) * RTOL + 1e-30;
		float error = length(ray_velocity(z1, L) - w1) / scale;

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
			y = y1;
			k1 = k4;
		}
	}
	if (status == RAY_OUT_OF_STEPS) { // the last step may have finished it
		if (y.y < rs * HORIZON_MARGIN) status = RAY_HORIZON;
		else if (l >= 1.0) status = RAY_REACHED;
	}
	x = y.xyz;
	u = vec3(E / (1.0 - rs / y.y), y.w, L / (y.y * y.y));
	return status;
}

// Trace a light ray from affine parameter 0 to 1.
// Returns false if it didn't get there (fell in, or ran out of solver steps).
bool raytrace(vec3 x0, vec3 u0, out vec3 x, out vec3 u) {
	int steps;
	return trace_ray(x0, u0, x, u, steps) == RAY_REACHED;
}
