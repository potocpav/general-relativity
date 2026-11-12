// Flat spacetime in Cartesian (t, x, y) coordinates (Minkowski in
// js/metric.js). Implements the interface declared in glsl/common.glsl.

// Reference frame: observers at rest.
mat3 T(vec3 x) {
	return mat3(1.0);
}

mat3 T_inv(vec3 x) {
	return mat3(1.0);
}

vec2 screen_to_frame(vec3 x, vec2 v) {
	return v;
}

vec3 coord_delta(vec3 a, vec3 b) {
	return a - b;
}

vec2 chart_plane(vec3 x) {
	return x.yz;
}

// Light rays are straight lines: traced exactly, in one step.
int trace_ray(vec3 x0, vec3 u0, out vec3 x, out vec3 u, out float l_end, out int steps) {
	x = x0 + u0;
	u = u0;
	l_end = 1.0;
	steps = 1;
	return RAY_REACHED;
}
