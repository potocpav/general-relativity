// Objects: their recent history, simulated and recorded by js/objects.js.
// Row k holds an object's state at coordinate time k * history_dt, stored in
// texture row k mod (number of rows); one column per object.

uniform highp sampler2D obj_a;    // (r, phi, tau, orientation angle)
uniform highp sampler2D obj_b;    // (u^t, u^r, u^phi, -)
uniform highp sampler2D obj_info; // row 0: (first row, last row, sprite, used); row 1: bounding box
uniform int n_objects;            // objects are in columns below this
uniform float history_dt;

// largest remaining time offset (in the object's rest frame) of an accepted
// lookup; also bounds the error in the object's position
#define OBJECT_TIME_TOLERANCE 0.02

// An object's state at fractional row k, interpolating linearly between rows.
// `angle` is the orientation of the object's (parallel-transported) axis in
// its rest frame, from r-hat towards phi-hat.
void object_sample(int i, float k, out vec3 x, out vec3 u, out float tau, out float angle) {
	float rows = float(textureSize(obj_a, 0).y);
	float k0 = floor(k), a = k - k0;
	ivec2 p0 = ivec2(i, int(mod(k0, rows))), p1 = ivec2(i, int(mod(k0 + 1.0, rows)));
	vec4 A = mix(texelFetch(obj_a, p0, 0), texelFetch(obj_a, p1, 0), a);
	vec4 B = mix(texelFetch(obj_b, p0, 0), texelFetch(obj_b, p1, 0), a);
	x = vec3(k * history_dt, A.xy);
	u = B.xyz;
	tau = A.z;
	angle = A.w;
}

int object_sprite(int i) {
	return int(texelFetch(obj_info, ivec2(i, 0), 0).z);
}

// The event on object i's worldline that is simultaneous with the pixel's
// event `pix_x` in the object's rest frame, if the object exists then and
// can be near the pixel. Outputs the object's position, 4-velocity, proper
// time and orientation angle there, the transformation to its rest frame (`obj_rest`, coordinate
// components to rest frame components, at the pixel), and the offset from the
// pixel to the object in its rest frame.
//
// The pixel's coordinate time gives the row directly; Newton steps then move
// along the worldline to rest-frame simultaneity: a time offset dtau in the
// rest frame is dtau * u^t / history_dt rows.
bool object_event(int i, vec3 pix_x, out vec3 obj_x, out vec3 obj_u, out float obj_tau,
		out float obj_angle, out mat3 obj_rest, out vec3 obj_deltax) {
	vec4 info = texelFetch(obj_info, ivec2(i, 0), 0);
	if (info.w == 0.0) return false;
	// cull: the pixel is outside the box around the object's stored history
	vec4 box = texelFetch(obj_info, ivec2(i, 1), 0);
	vec2 p = chart_plane(pix_x);
	if (any(lessThan(p, box.xy)) || any(greaterThan(p, box.zw))) return false;

	float k = pix_x.x / history_dt;
	// far outside the stored time range (the margin covers simultaneity shifts)
	if (k < info.x - 64.0 || k > info.y + 64.0) return false;
	for (int n = 0; n < 3; n++) {
		float kc = clamp(k, info.x, info.y);
		object_sample(i, kc, obj_x, obj_u, obj_tau, obj_angle);
		obj_rest = coord_to_rest(pix_x, obj_u);
		obj_deltax = obj_rest * coord_delta(obj_x, pix_x);
		k = kc - obj_deltax.x * obj_u.x / history_dt;
	}
	// The simultaneous event must be within the stored history, and the Newton
	// steps must have converged: where they don't (objects falling towards the
	// horizon), the last sample may be far
	// from simultaneous yet have a small spatial offset, drawing a ghost copy.
	return k >= info.x - 0.01 && k <= info.y + 0.01 && abs(obj_deltax.x) < OBJECT_TIME_TOLERANCE;
}
