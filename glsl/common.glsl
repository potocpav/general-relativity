// Spacetime physics shared by all metrics, used by the surface shader and the
// physics tests. Mirrors js/metric.js, js/math.js and js/world.js; test/
// checks that they agree. Assembled by js/shaders.js: `#version` and the
// shared defines, this file, the metric's file (glsl/metrics/, see the
// interface below), glsl/objects.glsl and the main shader.

precision highp float;

uniform vec4 metric_params; // the metric's parameters, see glslParams in js/metric.js

#define pi 3.141592653589793
#define epsilon 1e-5

// --- The metric's interface, defined in its file in glsl/metrics/.

// The metric defines a reference frame, an orthonormal frame at every point.
// T(x) takes coordinate components of a vector at x to reference frame
// components, T_inv(x) back.
mat3 T(vec3 x);
mat3 T_inv(vec3 x);

// A screen-aligned (cartesian) 2-vector at x as spatial components in the
// reference frame (cartesianToLocal in js/metric.js).
vec2 screen_to_frame(vec3 x, vec2 v);

// The coordinate difference a - b, with periodic coordinates wrapped.
vec3 coord_delta(vec3 a, vec3 b);

// The position x in a flat plane, for culling boxes (toPlane in js/metric.js).
vec2 chart_plane(vec3 x);

#define RAY_REACHED 0       // traced to the end
#define RAY_HORIZON 1       // went where it can't be followed (e.g. the black hole's shadow)
#define RAY_OUT_OF_STEPS 2  // ran out of solver steps

// Trace a light ray (x0, u0 null) from affine parameter 0 to 1. Returns one of
// the RAY_* statuses; x, u and l_end are the ray's position, momentum and
// affine parameter where it ended, and `steps` is the number of solver
// iterations used.
int trace_ray(vec3 x0, vec3 u0, out vec3 x, out vec3 u, out float l_end, out int steps);

// --- Shared

// Screen-space [px] to viewport-space, scaled by the mean of screen dimensions
// to look good on both vertical and horizontal devices
vec2 s2v(vec2 screen, vec2 res, float size) {
	float meanRes = (res.x + res.y) / 2.0;
	return ((screen - res / 2.0) / meanRes) * size / 2.0;
}

// Where the coordinates break down, from local quantities only (the same for
// all metrics, see maxFrameCondition in js/metric.js): the reference frame
// becomes degenerate. Non-finite values fail the comparisons too.
float frobenius(mat3 m) {
	return sqrt(dot(m[0], m[0]) + dot(m[1], m[1]) + dot(m[2], m[2]));
}

float frame_condition(vec3 x) {
	return frobenius(T(x)) * frobenius(T_inv(x));
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
	vec2 local = screen_to_frame(x, v);
	return rest_to_coord(x, u) * vec3(-length(local), local);
}

// Trace a light ray from affine parameter 0 to 1.
// Returns false if it didn't get there (fell in, or ran out of solver steps).
bool raytrace(vec3 x0, vec3 u0, out vec3 x, out vec3 u) {
	float l_end;
	int steps;
	return trace_ray(x0, u0, x, u, l_end, steps) == RAY_REACHED;
}
