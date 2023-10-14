#extension GL_OES_standard_derivatives : enable

precision highp float;

uniform float time;
uniform vec2 mouse;
uniform vec2 resolution;
uniform vec3 obsv_x;
uniform vec3 obsv_u;

// Screen-space to world-space

// TODO: don't specify height, specify the (geometric?) mean of screen dimensions
// to look good on both vertical and horizontal devices
vec2 s2w(vec2 screen, vec2 origin, float height) {
	return (screen / resolution.y - vec2(resolution.x/resolution.y * origin.x, origin.y)) * height / 2.0;
}

// Minkowski metric

mat3 nu(vec3 x) {
	return mat3(-1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
}

// // Polar coordinate (t, r, phi) metric tensor and Christoffel symbols

// mat3 g(vec3 x) {
// 	return mat3(-1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, x.y * x.y);
// }

// mat3 Gamma0(vec3 x) {
// 	return mat3(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
// }

// mat3 Gamma1(vec3 x) {
// 	return mat3(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -x.y);
// }

// mat3 Gamma2(vec3 x) {
// 	return mat3(0.0, 0.0, 0.0, 0.0, 0.0, 1.0 / x.y, 0.0, 1.0 / x.y, 0.0);
// }

// Schwarzschield (t, r, phi) metric tensor and Christoffel symbols
float rs = 0.01;
mat3 g(vec3 x) {
  float r = x.y;
  return mat3(
		-(1.0 - rs / r), 0.0, 0.0,
		0.0, 1.0 / (1.0 + rs / r), 0.0,
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

vec4 grid_color(vec3 pos) {
	vec3 grid_ratio = vec3(0.01, 0.1, 0.1);
	vec3 stride = vec3(3.0, 0.1, 0.2);
	vec3 grid_frac = abs(mod(pos / stride + 0.5, 1.0) * 2.0 - 1.0);
	float grid = float((grid_frac.x > grid_ratio.x) && (grid_frac.y > grid_ratio.y) && (grid_frac.z > grid_ratio.z));
	float pos_viz = exp((rs - pos.y) * 30.0);

	return vec4(vec3((1.0 - grid)*0.2 - pos_viz), 1.0);
}

float origin_color(vec2 pos) {
	return length(pos) < 0.01 ? 1.0 : 0.0;
}

// compute 3-vector out of a 2-vector so that ds = 0
// (supposing a diagonal metric)
vec3 light_u3(vec3 x, vec2 u2) {
	float res = dot(g(x) * vec3(0.0, u2), vec3(0.0, u2)) / g(x)[0][0];
	return vec3(-sqrt(-res), u2);
}

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

mat2 inverse(mat2 m) {
  return mat2(
		m[1][1], -m[0][1],
    -m[1][0], m[0][0]
		) / (m[0][0]*m[1][1] - m[0][1]*m[1][0]);
}

vec2 cart2polar(float r, float phi, vec2 x) {
	mat2 A = mat2(cos(phi), -r * sin(phi), sin(phi), r * cos(phi));
	return x * inverse(A);
}

// Lorentz boost

mat3 boost(vec2 v) {
	float g = pow(1.0 - dot(v, v), -0.5);
	float vv = dot(v, v) + 0.0000001;
	return mat3(
		g, -g * v.x, -g * v.y,
		-g * v.x, 1.0 + (g - 1.0) * v.x * v.x / vv, (g - 1.0) * v.x * v.y / vv,
		-g * v.y, (g - 1.0) * v.y * v.x / vv, 1.0 + (g - 1.0) * v.y * v.y / vv
		);
}

const float max_iters = 100.0;

void main( void ) {
	// screen to observer space transformation
	vec2 screen_origin = vec2(0.5, 0.5) + (mouse - 0.5) * 0.0;
	float screen_height = 2.0;

	vec2 pix_cartesian = s2w(gl_FragCoord.xy, screen_origin, screen_height);
	vec2 pix_target = cart2polar(obsv_x.y, obsv_x.z, pix_cartesian);

	vec3 pix_x = obsv_x;
	// vec3 pix_u = boost(obsv_u.yz) * light_u3(pix_x, pix_target);
	vec3 pix_u = light_u3(pix_x, pix_target);

	float pix_norm = dot(pix_target, pix_target);
	float dl = 1.0 / max_iters;
	for (float tau = 0.0; tau < 1.0; tau += 1.0 / max_iters) {
		vec3 pix_u1 = rk4_u(pix_x, pix_u, dl);
		vec3 pix_x1 = rk4_x(pix_x, pix_u, dl);
		pix_u = pix_u1;
		pix_x = pix_x1;
		if (pix_x.y < rs * rs)  {
			break;
		}
	}

	gl_FragColor = mix(grid_color(pix_x), vec4(0.7), origin_color(pix_cartesian));
}
