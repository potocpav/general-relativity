#extension GL_OES_standard_derivatives : enable

precision highp float;

uniform float time;
uniform vec2 mouse;
uniform vec2 resolution;

vec2 s2w(vec2 screen, vec2 origin, float height) {
	return (screen / resolution.y - vec2(resolution.x/resolution.y * origin.x, origin.y)) * height / 2.0;
}

vec4 grid(vec3 pos) {
	float grid_ratio = 0.1;
	vec3 grid_frac = abs(mod(pos + 0.5, 1.0) * 2.0 - 1.0);
	float grid = float((grid_frac.x > grid_ratio) && (grid_frac.y > grid_ratio) && (grid_frac.z > grid_ratio));
	float pos_viz = length(pos.yz) * 0.05;

	return vec4(vec3(grid*0.2 + pos_viz), 1.0);
}

mat3 boost(vec2 v) {
	float g = pow(1.0 - dot(v, v), -0.5);
	float vv = dot(v, v);
	return mat3(
		g, -g * v.x, -g * v.y,
		-g * v.x, 1.0 + (g - 1.0) * v.x * v.x / vv, (g - 1.0) * v.x * v.y / vv,
		-g * v.y, (g - 1.0) * v.y * v.x / vv, 1.0 + (g - 1.0) * v.y * v.y / vv
		);
}

mat3 metric(vec3 x) {
	return mat3(-1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
}

// movement in special relativity observing the square coordinate grid
// observer time velocity is constant, because I was lazy to compute it
// properly

void main( void ) {
	// observer velocity and position
	float tau = time * 0.1;
	vec2 obsv_v = vec2(sin(tau) * 0.7, cos(tau * 1.5) * 0.1);
	vec3 obsv_X = vec3(tau, -cos(tau) * 0.5, sin(tau * 1.5) * 0.1 * 1.5);

	// screen to observer space transformation
	vec2 screen_origin = vec2(0.5, 0.5) + (mouse - 0.5) * 0.0;
	float screen_height = 20.0;

	vec2 pix_x = s2w(gl_FragCoord.xy, screen_origin, screen_height);
	vec3 pix_X = vec3(-sqrt(dot(pix_x, pix_x)), pix_x);
	gl_FragColor = grid(boost(obsv_v) * pix_X + obsv_X);
}
