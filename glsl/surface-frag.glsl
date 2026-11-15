// Raytracing fragment shader. Appended to glsl/common.glsl, the metric's file and
// glsl/objects.glsl by js/shaders.js, which also defines the object types'
// ids (PROJECTILE_ID, PLANET_ID, CLOCK_ID, JUPITER_ID, SUN_ID). Everything is drawn procedurally.

precision highp sampler2D;

uniform float time;
uniform vec2 resolution;
uniform vec3 obsv_x;
uniform vec3 obsv_u;
uniform vec2 obsv_o; // heading, as spatial components in the ship's rest frame (see screen_to_frame)
uniform bool obsv_thrusting; // the ship shows its engine's flame
uniform float ship_scale; // the ship's size relative to its normal size
uniform bool show_ship_clock; // a clock above the ship, showing its proper time

uniform float viewport_size;
uniform vec2 view_offset; // where the ship is on the screen: from its center, as fractions of its width and height
uniform vec2 view_origin; // the view's lower left corner in the canvas [px] (it can have several views, see Renderer.views)
uniform bool show_photon_sphere;
uniform bool show_event_horizon;
uniform bool show_interior; // otherwise, the black hole's shadow is black
// What a pixel shows: 0, what the ship sees, the light arriving at it now (its
// past light cone); 1, what is happening now in its rest frame (its plane of
// simultaneity, along straight lines: flat spacetime only), without light.
uniform int view_mode;
uniform bool show_redshift; // otherwise, colors and brightness are as emitted
uniform float background_temperature; // [K] of the radiation filling space, between the grid lines (0: none)

out vec4 out_color;

// Grid visualization

// Antialiased line coverage: the fraction of a pixel covered by a line.
// `frac` is the distance from the line center and `half_width` the line's
// half-width, both in units where the pixel is `pixel` wide. The pixel is
// treated as a box, so lines thinner than a pixel fade out instead of
// flickering, and zero-width lines are invisible.
vec3 line_coverage(vec3 frac, vec3 half_width, vec3 pixel) {
	vec3 overlap = min(frac + 0.5 * pixel, half_width) - max(frac - 0.5 * pixel, -half_width);
	return clamp(overlap / max(pixel, 1e-20), 0.0, 1.0);
}

// Must be called in uniform control flow, because of `fwidth`.
vec3 grid_color(vec3 pos) {
	// adaptive stride calculation
	// length of a unit coordinate step, measured in the reference frame
	mat3 Tx = T(pos);
	vec3 coordinate_scale = vec3(abs(Tx[0][0]), length(Tx[1]), length(Tx[2]));
	float grids_per_screen = 10.0;
	vec3 stride_raw = viewport_size / coordinate_scale / grids_per_screen;
	vec3 stride_log = log2(stride_raw);
	vec3 stride_floor = floor(stride_log);
	vec3 stride_alpha = 1.0 - (stride_log - stride_floor);
	vec3 stride = exp2(stride_floor);
	// change of `pos` across one pixel (not of pos / stride, which jumps where the stride changes)
	vec3 pos_pixel = fwidth(pos);

	// `grid_frac` is twice the distance to the nearest line, in units of stride,
	// so a pixel is 2 * pos_pixel / stride wide in these units.
	vec3 pixel = 2.0 * pos_pixel / stride;
	vec3 pixel2 = 2.0 * pixel; // for the fine grid

	// Lines are a fixed width in rendered pixels (no lines of constant t).
	const float width = 2.0; // [rendered pixels]
	const vec3 has_lines = vec3(0.0, 1.0, 1.0);
	vec3 half_width = has_lines * 0.5 * width * pixel;
	vec3 half_width2 = 2.0 * half_width;
	// Their brightness is scaled so that the mean brightness of the grid doesn't
	// depend on how dense it is on screen (where lensing squeezes or stretches
	// it), which could be mistaken for beaming: as for lines whose half-width
	// is `grid_ratio` of the spacing (the mean coverage of a line family is
	// proportional to its half-width as a fraction of the spacing). The fine
	// grid, twice as dense with twice the half-width, gets the same factor.
	vec3 grid_ratio = has_lines * 0.05 * (1.0 - stride_alpha * 0.5);
	vec3 brightness = grid_ratio / max(half_width, 1e-20);

	// coarse grid which doesn't fade in
	vec3 grid_frac = abs(mod(pos / stride + 0.5, 1.0) * 2.0 - 1.0);
	vec3 on_grid = brightness * line_coverage(grid_frac, half_width, pixel);
	float grid = max(max(on_grid.x, on_grid.y), on_grid.z);

	// fine grid which fades in
	vec3 grid2_frac = abs(mod(pos / (stride/2.0) + 0.5, 1.0) * 2.0 - 1.0);
	vec3 on_grid2 = brightness * stride_alpha * line_coverage(grid2_frac, half_width2, pixel2);
	float grid2 = max(max(on_grid2.x, on_grid2.y), on_grid2.z);
	// Coverage blends light linearly, while the returned color is sRGB
	// (linearized in `redshift`), so the coverage is gamma-encoded. Lines are
	// 0.3 in sRGB at full coverage and brightness 1, and at most white.
	const float line_linear = pow(0.3, 2.2);
	return vec3(pow(min(line_linear * max(grid, grid2), 1.0), 1.0 / 2.2));
}

#ifdef BLACK_HOLE
// Overlays of the black hole.

// Coverage of an antialiased line where the per-pixel radius `r` equals
// `radius`, of a fixed width in rendered pixels; `fwidth` is the change of r
// across one pixel. `continuous` must be false where neighbouring pixels' `r`
// aren't comparable. Must be called in uniform control flow, because of `fwidth`.
float radius_line(float r, float radius, bool continuous) {
	const float width = 2.0; // [rendered pixels]
	float d = abs(r - radius);
	float w = fwidth(r) * width / 2.0;
	float a = 1.0 - smoothstep(0.5 * w, 1.5 * w, d);
	// Where neighbouring rays end far apart (around extreme lensing), `w` is
	// meaningless and would smear the line. The threshold grows with the world
	// size of a pixel, so that the line stays visible when zoomed out.
	float pixel_size = 2.0 * viewport_size / (resolution.x + resolution.y);
	bool discontinuous = !continuous || w > max(0.25 * rs, 2.0 * pixel_size);
	return (discontinuous || isnan(a)) ? 0.0 : a;
}

const vec3 shadow_color = vec3(0.1, 0.0, 0.0);
const vec3 photon_sphere_color = vec3(1.0, 0.85, 0.2);
const vec3 event_horizon_color = vec3(1.0, 0.15, 0.1);
#endif

 // a must be a heading vector, not necessarily normalized
mat2 rot(vec2 a) {
	a /= max(length(a), 1e-20);
	return mat2(a.y, a.x, -a.x, a.y);
}

// redshift calculation

// Redshift factor l: photon energy where emitted / where seen. Light is seen
// l^-3 times as bright as emitted (`tint` = 1), or with its color multiplied
// by `tint` (linear, of luminance 1).
vec3 redshift(float l, vec3 sRgb, vec3 tint) {
	const float power_exp = 3.0;
	vec3 linear = pow(sRgb, vec3(2.2)) * tint * pow(l, -power_exp);
	return pow(max(linear, 0.0), vec3(1.0/2.2));
}

// Chromaticity (x, y) of a blackbody at temperature T [K], for
// 1667 K <= T <= 25000 K: Kim et al., "Design of advanced color temperature
// control system for HDTV applications" (2002), a cubic spline fit of the
// Planckian locus.
vec2 planckian_xy(float T) {
	float t = 1e3 / T, t2 = t * t, t3 = t2 * t;
	float x = T <= 4000.0
		? -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t + 0.179910
		: -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t + 0.240390;
	float x2 = x * x, x3 = x2 * x;
	float y = T <= 2222.0 ? -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683
		: T <= 4000.0 ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
		: 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
	return vec2(x, y);
}

// Linear sRGB color of luminance 1 of a blackbody at temperature T [K],
// clamped to 1667..25000 K (deep orange .. pale blue); colors outside the
// sRGB gamut are clipped.
vec3 blackbody_rgb(float T) {
	vec2 xy = planckian_xy(clamp(T, 1667.0, 25000.0));
	vec3 XYZ = vec3(xy.x / xy.y, 1.0, (1.0 - xy.x - xy.y) / xy.y);
	const mat3 xyzToSrgb = mat3(
		 3.2406,-0.9689,  0.0557,
		-1.5372, 1.8757, -0.2040,
		-0.4986, 0.0415,  1.0569
	);
	vec3 rgb = max(xyzToSrgb * XYZ, 0.0);
	return rgb / dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

// The grid as a blackbody, shown grey where unshifted: the color of a
// blackbody at grid_temperature / l relative to (white-balanced against) the
// one at grid_temperature, of luminance 1. Doppler and gravitational shifts
// map a blackbody spectrum exactly to another blackbody's, at T / l.
const float grid_temperature = 6500.0; // [K]
// The visible luminance of a blackbody at temperature T [K], relative to the
// Sun's surface (shown white, see render_sun): Planck's law at a single
// effective wavelength, 0.583 µm, fitted to the eye-weighted integral (within
// about 30% from 1000 K to 6000 K; next to nothing where T is low).
float blackbody_luminance(float T) {
	const float c = 24660.0; // [K], h c / (k * 0.583 µm)
	return (exp(c / 5772.0) - 1.0) / (exp(min(c / max(T, 1.0), 80.0)) - 1.0); // (bounded, not to overflow)
}
vec3 grid_tint(float l) {
	vec3 rgb = blackbody_rgb(grid_temperature / l) / blackbody_rgb(grid_temperature);
	return rgb / dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

const vec3 projectile_color = vec3(1.0, 0.9, 0.2);

// An Earth-like planet, drawn procedurally: a globe seen from the side, its
// axis along the object's orientation axis, turning once per planet_period of
// its proper time `tau`. `p` is the pixel's offset from its center, in units
// of its radius, along (right, axis).
float hash3(vec3 p) {
	p = fract(p * 0.3183099 + 0.1) * 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
	vec3 i = floor(x), f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
		f.z);
}
// octaves of noise, each rotated against the last, so that the noise's grid doesn't show
const mat3 octave_rotation = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
float fbm(vec3 p) {
	float sum = 0.0, amplitude = 0.5;
	for (int i = 0; i < 5; i++) {
		sum += amplitude * noise3(p);
		p = octave_rotation * p * 2.03 + 1.7;
		amplitude *= 0.5;
	}
	return sum;
}
const vec3 planet_light = vec3(-0.48, 0.48, 0.73); // toward the light, which comes from the upper left (unit)
const float planet_period = 16.0;
vec4 render_planet(float rshift, float tau, vec2 p, float pixel) {
	float r = length(p);
	float coverage = clamp((1.0 - r) / pixel + 0.5, 0.0, 1.0); // antialiased edge
	if (coverage == 0.0) return vec4(0.0);
	vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r * r))); // the surface normal: right, axis, toward the viewer
	float a = 6.2831853 * tau / planet_period, c = cos(a), s = sin(a);
	vec3 q = vec3(c * n.x + s * n.z, n.y, c * n.z - s * n.x); // the surface point, turning with the planet
	float h = fbm(2.5 * q);
	vec3 color = h > 0.52
		? mix(vec3(0.13, 0.35, 0.1), vec3(0.5, 0.42, 0.25), smoothstep(0.55, 0.7, h)) // land: green to brown
		: mix(vec3(0.0, 0.04, 0.18), vec3(0.04, 0.18, 0.42), smoothstep(0.3, 0.52, h)); // sea: deep to shallow
	color = mix(color, vec3(0.9), smoothstep(0.78, 0.82, abs(q.y) + 0.2 * (h - 0.5))); // ice caps
	color = mix(color, vec3(1.0), 0.8 * smoothstep(0.55, 0.75, fbm(4.0 * q + vec3(0.0, 0.0, 0.02 * tau)))); // clouds
	color *= 0.15 + 0.85 * max(dot(n, planet_light), 0.0); // day and night
	color += vec3(0.25, 0.45, 1.0) * 0.5 * pow(1.0 - n.z, 3.0); // the atmosphere, seen edge-on at the limb
	return vec4(redshift(rshift, color, vec3(1.0)), coverage);
}

// Jupiter, drawn like the planet above, lit from the same side: cream zones
// and brown belts, turbulent at their edges, greyer toward the poles, and the
// Great Red Spot. It turns as much faster than the Earth-like planet as the
// real one does than the Earth (9.9 h a turn, against 23.9 h).
const float jupiter_period = planet_period * 9.93 / 23.93;
vec4 render_jupiter(float rshift, float tau, vec2 p, float pixel) {
	float r = length(p);
	float coverage = clamp((1.0 - r) / pixel + 0.5, 0.0, 1.0); // antialiased edge
	if (coverage == 0.0) return vec4(0.0);
	vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r * r))); // the surface normal: right, axis, toward the viewer
	float a = 6.2831853 * tau / jupiter_period, c = cos(a), s = sin(a);
	vec3 q = vec3(c * n.x + s * n.z, n.y, c * n.z - s * n.x); // the surface point, turning with the planet
	// bands across the sine of the latitude, their edges wavy with noise
	float w = q.y + 0.035 * (fbm(vec3(4.0, 10.0, 4.0) * q) - 0.5);
	float band = 0.5 + 0.5 * sin(19.0 * w + 2.5 * sin(6.0 * w));
	vec3 color = mix(vec3(0.62, 0.42, 0.28), vec3(0.93, 0.86, 0.74), smoothstep(0.3, 0.7, band)); // belt to zone
	color *= 0.88 + 0.24 * fbm(vec3(3.0, 40.0, 3.0) * q); // fine streaks, along the bands
	color = mix(color, vec3(0.6, 0.55, 0.5), smoothstep(0.75, 0.95, abs(q.y))); // the poles
	// the Great Red Spot, at 22° south, an oval about 0.3 by 0.15 rad, with a pale rim
	float lon = atan(q.x, q.z), lat = asin(clamp(q.y, -1.0, 1.0));
	vec2 d = vec2(lon, lat + 0.38) / vec2(0.15, 0.075);
	float spot = length(d);
	color = mix(color, vec3(0.95, 0.88, 0.78), 0.6 * (1.0 - smoothstep(0.0, 0.25, abs(spot - 1.15))));
	color = mix(color, vec3(0.78, 0.36, 0.22), 1.0 - smoothstep(0.85, 1.0, spot));
	color *= 0.1 + 0.9 * max(dot(n, planet_light), 0.0); // day and night
	color *= 0.75 + 0.25 * n.z; // a slightly darker limb
	return vec4(redshift(rshift, color, vec3(1.0)), coverage);
}

// The Sun, drawn procedurally: a glowing disk, not lit but shining as a
// blackbody of sun_temperature, darker and cooler toward the limb (limb
// darkening), with granulation and sunspots, turning once per 25.4 days for
// every 23.9 hours of the Earth-like planet's turn. The redshift `rshift`
// shifts its color as a blackbody's (see grid_tint), and its brightness.
const float sun_temperature = 5772.0; // [K]
const float sun_period = planet_period * 25.4 * 24.0 / 23.93;
vec4 render_sun(float rshift, float tau, vec2 p, float pixel) {
	float r = length(p);
	float coverage = clamp((1.0 - r) / pixel + 0.5, 0.0, 1.0); // antialiased edge
	if (coverage == 0.0) return vec4(0.0);
	vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r * r))); // the surface normal: right, axis, toward the viewer
	float a = 6.2831853 * tau / sun_period, c = cos(a), s = sin(a);
	vec3 q = vec3(c * n.x + s * n.z, n.y, c * n.z - s * n.x); // the surface point, turning with the Sun
	// limb darkening, linear in the cosine of the angle from the normal
	float intensity = 1.0 - 0.6 * (1.0 - n.z);
	// granulation, slowly changing, faded out where finer than a pixel
	float granules = fbm(40.0 * q + vec3(0.0, 0.0, 0.05 * tau)) - 0.5;
	intensity *= 1.0 + 0.25 * granules * (1.0 - smoothstep(0.01, 0.05, pixel));
	// sunspots, within 35° of the equator
	float spots = smoothstep(0.71, 0.74, fbm(5.0 * q + 3.1)) * (1.0 - smoothstep(0.4, 0.6, abs(q.y)));
	intensity *= 1.0 - 0.75 * spots;
	// the local temperature, as the fourth root of the brightness (Stefan–Boltzmann)
	vec3 tint = blackbody_rgb(sun_temperature * pow(intensity, 0.25) / rshift);
	return vec4(redshift(rshift, vec3(pow(intensity, 1.0 / 2.2)), tint), coverage);
}

// A digital clock showing `tau` (its proper time) as minutes:seconds, like
// 1:00 or 10:00, wrapping after 59:59: dark red seven-segment digits on
// white, in a dark red frame. `p` is the pixel's offset from its center along
// (right, up), `pixel` the size of a pixel, both in units of its height; it
// is 2.5 wide.
const vec3 clock_red = vec3(0.45, 0.02, 0.02), clock_white = vec3(0.95);
// the segments lit for each digit, as bits: top, upper right, lower right,
// bottom, lower left, upper left, middle
const int clock_digits[10] = int[10](0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F);
// distance to the line segment from a to b
float segment_distance(vec2 p, vec2 a, vec2 b) {
	vec2 ab = b - a;
	return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
}
// distance to the lit segments of `digit` (-1: blank), centered at the origin, 0.32 wide and 0.6 tall
float digit_distance(vec2 p, int digit) {
	if (digit < 0) return 1e3;
	const float w = 0.13, h = 0.25, gap = 0.03; // segment centerlines' half extents; gap at the ends
	vec2 ends[14] = vec2[14](
		vec2(-w + gap, h), vec2(w - gap, h),     // top
		vec2(w, h - gap), vec2(w, gap),          // upper right
		vec2(w, -gap), vec2(w, -h + gap),        // lower right
		vec2(-w + gap, -h), vec2(w - gap, -h),   // bottom
		vec2(-w, -gap), vec2(-w, -h + gap),      // lower left
		vec2(-w, h - gap), vec2(-w, gap),        // upper left
		vec2(-w + gap, 0.0), vec2(w - gap, 0.0)); // middle
	int lit = clock_digits[digit];
	float d = 1e3;
	for (int i = 0; i < 7; i++) {
		if ((lit & (1 << i)) != 0) d = min(d, segment_distance(p, ends[2 * i], ends[2 * i + 1]));
	}
	return d - 0.035; // the segments' half thickness
}
vec4 render_clock(float rshift, float tau, vec2 p, float pixel) {
	vec2 half_size = vec2(1.25, 0.5);
	float outside = max(abs(p.x) - half_size.x, abs(p.y) - half_size.y);
	if (outside > pixel) return vec4(0.0);
	int t = int(floor(mod(tau, 3600.0))), minutes = t / 60, seconds = t % 60;
	// digits at x = -0.74, -0.32 (minutes; the tens blank below 10), 0.32, 0.74 (seconds); a colon between
	float ink = min(min(digit_distance(p - vec2(-0.74, 0.0), minutes >= 10 ? minutes / 10 : -1),
	                    digit_distance(p - vec2(-0.32, 0.0), minutes % 10)),
	                min(digit_distance(p - vec2(0.32, 0.0), seconds / 10),
	                    digit_distance(p - vec2(0.74, 0.0), seconds % 10)));
	ink = min(ink, length(vec2(p.x, abs(p.y) - 0.12)) - 0.04); // the colon
	ink = min(ink, -outside - 0.08); // the frame
	vec3 color = mix(clock_white, clock_red, clamp(0.5 - ink / pixel, 0.0, 1.0));
	return vec4(redshift(rshift, color, vec3(1.0)), clamp(0.5 - outside / pixel, 0.0, 1.0));
}

// A planet, clock, Jupiter, the Sun or a projectile, of size `size` (see js/object-types.js).
// `deltax` is the offset from the pixel to the object, as components in the
// object's frame.
vec4 render_obj(int type, float size, float rshift, float tau, vec3 deltax, vec2 orientation) {
	// for antialiasing: twice the world size of a pixel near the observer (edges are smoothed over about two pixels)
	float pixel_size = 4.0 * viewport_size / (resolution.x + resolution.y);
	// the pixel's offset from the object, along the object's (right, axis)
	vec2 p = rot(orientation) * -deltax.yz;
	if (type == PLANET_ID) {
		float radius = 0.5 * size;
		return render_planet(rshift, tau, p / radius, pixel_size / radius);
	}
	if (type == JUPITER_ID || type == SUN_ID) {
		float radius = 0.5 * size;
		return type == JUPITER_ID
			? render_jupiter(rshift, tau, p / radius, pixel_size / radius)
			: render_sun(rshift, tau, p / radius, pixel_size / radius);
	}
	if (type == CLOCK_ID) {
		float height = size / sqrt(1.0 + 2.5 * 2.5); // the diagonal is `size`
		return render_clock(rshift, tau, p / height, pixel_size / height);
	}
	// a projectile: a dot, round in its rest frame, antialiased over about a pixel
	float d = length(deltax.yz) - 0.5 * size;
	float a = clamp(0.5 - d / pixel_size, 0.0, 1.0);
	return vec4(redshift(rshift, projectile_color, vec3(1.0)), a);
}

// The ship, drawn procedurally: a white rocket with a window, two fins, a
// nozzle and, while `thrusting`, a flickering flame. `p` is the pixel's
// offset from the ship's center along (right, forward), `pixel` the size of
// a pixel, both in units of the ship's size; `t` (time) animates the flame.
// The body is 0.125 wide, the fins 0.2 across, 0.37 from nose to nozzle.
const float ship_body_width = 0.0625; // half
const float ship_nose = 0.203, ship_shoulder = 0.094, ship_tail = -0.094, ship_nozzle = -0.164;
vec4 render_ship(bool thrusting, float t, vec2 p, float pixel) {
	if (abs(p.x) > 0.25 || p.y > 0.25 || p.y < -0.3) return vec4(0.0);
	float x = abs(p.x);
	// body: straight, then a pointed nose; distances are horizontal, a good
	// approximation except at the very tip
	float nose = clamp((p.y - ship_shoulder) / (ship_nose - ship_shoulder), 0.0, 1.0);
	float body_w = ship_body_width * pow(1.0 - nose, 0.6);
	float body = max(x - body_w, max(p.y - ship_nose, ship_tail - p.y));
	// fins: flaring out from the body's lower part
	float fin_w = ship_body_width + 0.036 * clamp(-p.y / 0.07, 0.0, 1.0);
	float fins = max(x - fin_w, max(p.y, -0.08 - p.y));
	// nozzle, slightly flared
	float nozzle = max(x - 0.035 - 0.08 * (ship_tail - p.y), max(p.y - ship_tail, ship_nozzle - p.y));
	// flame: an ellipse below the nozzle, flickering in length
	float flicker = 0.5 + 0.25 * sin(t * 47.0) + 0.25 * sin(t * 73.0 + 1.3);
	float flame_len = 0.035 + 0.025 * flicker; // half
	vec2 f = vec2(x / 0.042, (p.y - ship_nozzle - 0.01 + flame_len) / flame_len); // from just inside the nozzle
	float flame = thrusting ? (length(f) - 1.0) * 0.042 : 1.0;

	// colored as the nearest part
	float hull = min(body, fins);
	vec3 color;
	if (nozzle <= min(hull, flame)) {
		color = vec3(0.25);
	} else if (hull <= flame) {
		// white, shaded as a cylinder lit from the upper left
		float c = clamp(p.x / max(body_w, 1e-3), -1.0, 1.0);
		float shade = (0.55 + 0.45 * sqrt(1.0 - c * c)) * (1.0 - 0.2 * c);
		color = body < fins ? vec3(0.92) * shade : vec3(0.75) * (1.0 - 0.2 * sign(p.x));
		// the window
		float window = length(p - vec2(-0.012, 0.075)) - 0.022;
		color = mix(color, vec3(0.15, 0.25, 0.75) * (1.2 - 0.6 * c), clamp(0.5 - window / pixel, 0.0, 1.0) * float(body < fins));
	} else {
		// yellow, whiter towards the nozzle
		color = mix(vec3(1.0, 0.95, 0.7), vec3(1.0, 0.75, 0.1), clamp(length(f), 0.0, 1.0));
	}
	return vec4(color, clamp(0.5 - min(min(hull, nozzle), flame) / pixel, 0.0, 1.0));
}

void main( void ) {
	// screen to observer space transformation
	vec2 pix_cartesian = s2v(gl_FragCoord.xy - view_origin - view_offset * resolution, resolution, viewport_size);
	bool seen = view_mode == 0;

	vec3 pix_x, pix_u;
	int status;
	if (seen) {
		// raytracing along null geodesics
		vec3 pix_u0 = screen_ray(obsv_x, obsv_u, pix_cartesian);
		float pix_l;
		int steps;
		status = trace_ray(obsv_x, pix_u0, pix_x, pix_u, pix_l, steps);
	} else {
		// the viewport vector as a spatial offset in the ship's rest frame, now
		pix_x = obsv_x + rest_to_coord(obsv_x, obsv_u) * vec3(0.0, screen_to_frame(obsv_x, pix_cartesian));
		pix_u = vec3(0.0);
		status = RAY_REACHED;
	}
	bool reached = status == RAY_REACHED;

	// Redshift: photon energy where it was emitted, measured by the reference
	// observer there (who carries the grid), divided by the energy measured
	// by the observer, which is |pix_cartesian| (see screen_ray). Without
	// light (view_mode 1), none.
	mat3 T_pix_x = T(pix_x);
	float obsv_energy = length(pix_cartesian);
	float rshift = seen ? abs((T_pix_x * pix_u).x) / obsv_energy : 1.0;

	// compute output colors; rays that didn't arrive show the black hole's shadow
	float grid_l = show_redshift ? rshift : 1.0;
	vec3 world_color = reached ? redshift(grid_l, grid_color(pix_x), grid_tint(grid_l)) : vec3(0.0);
	// The radiation filling space, a blackbody of background_temperature at rest at infinity, in equilibrium
	// with it, so the same along every ray (a shift keeps a blackbody's spectrum one): seen at
	// background_temperature times the ray's energy seen by the ship over its energy at infinity (Doppler and
	// gravitational shifts), added to the grid's light (linear).
	if (reached && background_temperature > 0.0) {
		float shift = show_redshift && seen ? obsv_energy / max(abs(ray_energy(pix_x, pix_u)), 1e-20) : 1.0;
		float T = background_temperature * shift;
		vec3 glow = blackbody_rgb(T) * blackbody_luminance(T);
		world_color = pow(pow(world_color, vec3(2.2)) + glow, vec3(1.0 / 2.2));
	}

#ifdef BLACK_HOLE
	if (!reached && show_interior) world_color = shadow_color;

	// annotations, not redshifted
	float photon_sphere = radius_line(pix_x.y, 1.5 * rs, fwidth(float(reached)) == 0.0 && reached);
	world_color = mix(world_color, photon_sphere_color, show_photon_sphere ? photon_sphere : 0.0);
	// The (future) event horizon, where rays traced back from inside cross it
	// outwards (Gullstrand–Painlevé only). The past light cone of an observer
	// outside never reaches it: rays falling in there end on the white hole's
	// horizon instead, which isn't drawn, nor is it for rays heading inwards.
	bool on_future_horizon = reached && pix_u.y > 0.0;
	float event_horizon = radius_line(pix_x.y, rs,
		fwidth(float(on_future_horizon)) == 0.0 && on_future_horizon);
	world_color = mix(world_color, event_horizon_color, show_event_horizon ? event_horizon : 0.0);
#endif

	// show objects
	vec4 objects_color = vec4(0.0);
	// rays that didn't arrive (the black hole's shadow) show no objects
	for (int i = 0; i < (reached ? n_objects : 0); i++) {
		vec3 obj_x, obj_u, obj_deltax;
		float obj_tau, obj_angle;
		mat3 obj_rest; // coordinate components -> object's rest frame components
		if (!object_event(i, pix_x, obj_x, obj_u, obj_tau, obj_angle, obj_rest, obj_deltax)) continue;
		vec4 obj_color = render_obj(
			object_type(i),
			object_size(i),
			show_redshift && seen ? abs((obj_rest * pix_u).x) / obsv_energy : 1.0,
			obj_tau,
			obj_deltax,
			vec2(cos(obj_angle), sin(obj_angle))
			);
		objects_color = mix(objects_color, obj_color, obj_color.a);
	}

	// The ship as seen by itself: in its rest frame, whose axes are the
	// screen's, where the viewport vector is the pixel's offset from it (light
	// travel across the ship is negligible), so it is never contracted.
	float pixel_size = 4.0 * viewport_size / (resolution.x + resolution.y); // twice a pixel, as in render_obj
	vec4 obsv_color = render_ship(obsv_thrusting, time,
		rot(obsv_o) * screen_to_frame(obsv_x, pix_cartesian) / ship_scale, pixel_size / ship_scale);

	objects_color = mix(objects_color, obsv_color, reached ? obsv_color.a : 0.0);

	// the ship's clock, above it on the screen (upright, whatever the ship's heading), 0.5 wide
	if (show_ship_clock) {
		const float clock_height = 0.2, clock_above = 0.38;
		vec2 p = (pix_cartesian / ship_scale - vec2(0.0, clock_above)) / clock_height;
		vec4 clock_color = render_clock(1.0, time, p, pixel_size / ship_scale / clock_height);
		objects_color = mix(objects_color, clock_color, reached ? clock_color.a : 0.0);
	}

	out_color = mix(vec4(world_color, 1.0), objects_color, objects_color.a);
}
