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

// The metric is selected by METRIC (defined by js/shaders.js, matching the
// metric's `glslId` in js/metric.js). Coordinates are (time, r, phi).
//
// Each metric defines a reference frame, an orthonormal frame at every point.
// T(x) takes coordinate components of a vector at x to reference frame
// components, T_inv(x) back.
#define METRIC_SCHWARZSCHILD 0
#define METRIC_GP 1

#if METRIC == METRIC_GP

// Schwarzschild metric in Gullstrand–Painlevé (T, r, phi) coordinates.
// Reference frame: raindrop observers, falling from rest at infinity,
// e_0 = (1, -s, 0), e_r = (0, 1, 0), e_phi = (0, 0, 1/r), s = sqrt(rs/r).
mat3 T(vec3 x) {
	float s = sqrt(rs / x.y);
	return mat3( // columns
		1.0, s, 0.0,
		0.0, 1.0, 0.0,
		0.0, 0.0, x.y);
}

mat3 T_inv(vec3 x) {
	float s = sqrt(rs / x.y);
	return mat3( // columns
		1.0, -s, 0.0,
		0.0, 1.0, 0.0,
		0.0, 0.0, 1.0 / x.y);
}

// conserved energy E = -p_T of a ray with momentum p at x
float ray_energy(vec3 x, vec3 p) {
	float a = rs / x.y;
	return (1.0 - a) * p.x - sqrt(a) * p.y;
}

// dT/dl of a light ray at radius r, with dr/dl = v and conserved E, L:
// (E + s v) / (1 - rs/r), rewritten using the null condition to be finite
// at the horizon, except for rays heading into the past horizon (white hole),
// which these coordinates don't cover: there it diverges, and the ray is
// stopped (see ray_terminated).
float ray_dtdl(float r, float v, float E, float L) {
	return (E * E + rs * L * L / (r * r * r)) / (E - sqrt(rs / r) * v);
}

#else

// Schwarzschild metric in Schwarzschild (t, r, phi) coordinates.
// Reference frame: static observers.
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

// conserved energy E = -p_t of a ray with momentum p at x
float ray_energy(vec3 x, vec3 p) {
	return (1.0 - rs / x.y) * p.x;
}

// dt/dl of a light ray at radius r, with dr/dl = v and conserved E, L
float ray_dtdl(float r, float v, float E, float L) {
	return E / (1.0 - rs / r);
}

#endif

// Where the coordinates break down, from local quantities only (the same for
// all metrics, see maxFrameCondition in js/metric.js): the reference frame
// becomes degenerate, or a light ray's energy measured by the reference
// observer changes sign or by more than MAX_RAY_ENERGY_RATIO. Non-finite
// values fail the comparisons too.
float frobenius(mat3 m) {
	return sqrt(dot(m[0], m[0]) + dot(m[1], m[1]) + dot(m[2], m[2]));
}

float frame_condition(vec3 x) {
	return frobenius(T(x)) * frobenius(T_inv(x));
}

// energy of a ray at x with momentum p, measured by the reference observer
float frame_energy(vec3 x, vec3 p) {
	return (T(x) * p).x;
}

// Whether a ray at x with momentum p, which started with reference frame
// energy e0, can't be followed further.
bool ray_terminated(vec3 x, vec3 p, float e0) {
	float ratio = frame_energy(x, p) / e0;
	return !(frame_condition(x) < MAX_FRAME_CONDITION
		&& ratio > 1.0 / MAX_RAY_ENERGY_RATIO && ratio < MAX_RAY_ENERGY_RATIO);
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

// Light rays are traced using their conserved energy E = -p_t and angular
// momentum L = p_phi, as y = (t, r, phi, v = dr/dl):
//   dt/dl = ray_dtdl(r, v, E, L),  dr/dl = v,  dphi/dl = L / r^2,
//   dv/dl = L^2 (r - 1.5 rs) / r^4    (from v^2 = E^2 - L^2 (1 - rs/r) / r^2)
// Unlike the geodesic equation in Schwarzschild coordinates (as in js/math.js),
// the (r, phi, v) part is regular at the horizon, in any time coordinate;
// only dt/dl may diverge there, and it doesn't feed back. Rays falling in
// therefore reach the horizon in a few steps, instead of crawling towards it
// with ever smaller steps.
vec4 ray_f(vec4 y, float E, float L) {
	float r = y.y;
	return vec4(ray_dtdl(r, y.w, E, L), y.w, L / (r * r), L * L * (r - 1.5 * rs) / (r * r * r * r));
}

// momentum (coordinate components) of a ray state
vec3 ray_momentum(vec4 y, float E, float L) {
	return vec3(ray_dtdl(y.y, y.w, E, L), y.w, L / (y.y * y.y));
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
#define RAY_HORIZON 1       // went where it can't be followed (the black hole's shadow)
#define RAY_OUT_OF_STEPS 2  // ran out of solver steps

// Trace a light ray (x0, u0 null) from affine parameter 0 to 1 with an adaptive
// RK23 solver. Returns one of the RAY_* statuses; x, u and l_end are the ray's
// position, momentum and affine parameter where it ended, and `steps` is the
// number of solver iterations used.
int trace_ray(vec3 x0, vec3 u0, out vec3 x, out vec3 u, out float l_end, out int steps) {
	const float SAFETY = 0.9;
	const float INITIAL_H = 0.1;
	const float MIN_FACTOR = 0.1;
	const float MAX_FACTOR = 10.0;
	const float RTOL = 0.001;
	const float ERR_EXPONENT = -1.0/3.0;
	const int MAX_ITERS = 40;

	float E = ray_energy(x0, u0);
	float L = x0.y * x0.y * u0.z;
	float e0 = frame_energy(x0, u0);
	vec4 y = vec4(x0, u0.y);
	float e = e0; // frame energy at y
	vec4 k1 = ray_f(y, E, L);
	float l = 0.0;
	float h = INITIAL_H;
	bool step_accepted = true;
	int status = RAY_OUT_OF_STEPS;
	for (steps = 0; steps < MAX_ITERS; steps += 1) {
		if (ray_terminated(y.xyz, ray_momentum(y, E, L), e0)) {
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
		// Don't step across where the coordinates break down: the step size is
		// also controlled by how much the reference frame changes over the step,
		// |T(y1) T^-1(y) - 1| <= FRAME_STEP, and the ray's frame energy, by at
		// most a factor of ENERGY_STEP (each as an error of 1, scaling like the
		// RK23 error); a change of sign, or non-finite values, reject the step.
		// This also covers rays without an error estimate (radial ones).
		const float FRAME_STEP = 0.5;
		const float ENERGY_STEP = 2.0;
		float frame_change = frobenius(T(y1.xyz) * T_inv(y.xyz) - mat3(1.0)) / FRAME_STEP;
		float e1 = frame_energy(y1.xyz, ray_momentum(y1, E, L));
		float change = e1 / e;
		float energy_change = change > 0.0 ? abs(log(change)) / log(ENERGY_STEP) : 1e3;
		float breakdown_error = pow(max(frame_change, energy_change), 3.0);
		error = max(error, breakdown_error < 1e3 ? breakdown_error : 1e3);

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
			e = e1;
		}
	}
	if (status == RAY_OUT_OF_STEPS) { // the last step may have finished it
		if (ray_terminated(y.xyz, ray_momentum(y, E, L), e0)) status = RAY_HORIZON;
		else if (l >= 1.0) status = RAY_REACHED;
	}
	x = y.xyz;
	u = ray_momentum(y, E, L);
	l_end = l;
	return status;
}

// Trace a light ray from affine parameter 0 to 1.
// Returns false if it didn't get there (fell in, or ran out of solver steps).
bool raytrace(vec3 x0, vec3 u0, out vec3 x, out vec3 u) {
	float l_end;
	int steps;
	return trace_ray(x0, u0, x, u, l_end, steps) == RAY_REACHED;
}
