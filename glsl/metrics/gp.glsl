// Schwarzschild metric in Gullstrand–Painlevé (T, r, phi) coordinates
// (GullstrandPainleve in js/metric.js). Implements the interface declared in
// glsl/common.glsl.
#define rs metric_params.x

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

// rotated by phi, from screen-aligned to (r-hat, phi-hat)
vec2 screen_to_frame(vec3 x, vec2 v) {
	float c = cos(x.z), s = sin(x.z);
	return vec2(c * v.x + s * v.y, -s * v.x + c * v.y);
}

// phi wrapped to (-pi, pi]
vec3 coord_delta(vec3 a, vec3 b) {
	vec3 d = a - b;
	return vec3(d.x, d.y, mod(d.z + pi, pi*2.0) - pi);
}

vec2 chart_plane(vec3 x) {
	return x.y * vec2(cos(x.z), sin(x.z));
}

// Light rays

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

// energy of a ray at x with momentum p, measured by the reference observer
float frame_energy(vec3 x, vec3 p) {
	return (T(x) * p).x;
}

// Whether a ray at x with momentum p, which started with reference frame
// energy e0, can't be followed further: where the coordinates break down
// (see frame_condition), or where the ray's frame energy changes sign, which
// it does beyond the past horizon (where it diverges).
bool ray_terminated(vec3 x, vec3 p, float e0) {
	return !(frame_condition(x) < MAX_FRAME_CONDITION && frame_energy(x, p) * e0 > 0.0);
}

// Light rays are traced using their conserved energy E = -p_t and angular
// momentum L = p_phi, as y = (t, r, phi, v = dr/dl):
//   dt/dl = ray_dtdl(r, v, E, L),  dr/dl = v,  dphi/dl = L / r^2,
//   dv/dl = L^2 (r - 1.5 rs) / r^4    (from v^2 = E^2 - L^2 (1 - rs/r) / r^2)
// The (r, phi, v) part is regular at the horizon, in any time coordinate;
// only dt/dl may diverge there (at the past horizon), and it doesn't feed
// back. Rays falling in therefore reach the horizon in a few steps.
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

// Trace a light ray (see glsl/common.glsl) with an adaptive RK23 solver.
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
		// |T(y1) T^-1(y) - 1| <= FRAME_STEP (as an error of 1, scaling like the
		// RK23 error); non-finite values reject the step. This also covers rays
		// without an error estimate (radial ones).
		const float FRAME_STEP = 0.5;
		float frame_change = frobenius(T(y1.xyz) * T_inv(y.xyz) - mat3(1.0)) / FRAME_STEP;
		float breakdown_error = pow(frame_change, 3.0);
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
