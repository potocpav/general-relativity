// Raytracing fragment shader. Appended to glsl/physics.glsl and
// glsl/objects.glsl by js/shaders.js, which also defines N_SPRITES.

precision mediump sampler3D;
precision highp sampler2D;

uniform float time;
uniform vec2 resolution;
uniform vec3 obsv_x;
uniform vec3 obsv_u;
uniform vec2 obsv_o; // orientation vector in the local orthonormal (r, phi) frame
uniform int obsv_sprite;

uniform float viewport_size;
uniform bool show_photon_sphere;
uniform bool show_event_horizon;
uniform bool show_interior; // otherwise, the black hole's shadow is black
uniform bool show_redshift; // otherwise, colors and brightness are as emitted

uniform sampler3D sprites;


layout(std140) uniform objectInfo {
	vec3 objSize[N_SPRITES];
	vec3 objTexMin[N_SPRITES];
	vec3 objTexMax[N_SPRITES];
};

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
	float grids_per_screen = 20.0;
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
	float pixel_size = viewport_size / (resolution.x + resolution.y);
	bool discontinuous = !continuous || w > max(0.25 * rs, 2.0 * pixel_size);
	return (discontinuous || isnan(a)) ? 0.0 : a;
}

const vec3 shadow_color = vec3(0.1, 0.0, 0.0);
const vec3 photon_sphere_color = vec3(1.0, 0.85, 0.2);
const vec3 event_horizon_color = vec3(1.0, 0.15, 0.1);

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
vec3 grid_tint(float l) {
	vec3 rgb = blackbody_rgb(grid_temperature / l) / blackbody_rgb(grid_temperature);
	return rgb / dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

const vec3 projectile_color = vec3(1.0, 0.9, 0.2);

// `deltax` is the pixel's offset from the object, as components in the object's frame.
vec4 render_obj(int sprite_i, float rshift, float tau, vec3 deltax, vec2 orientation) {
	if (sprite_i == PROJECTILE_ID) {
		// a dot, round in its rest frame, antialiased over about a pixel
		// (the world size of a pixel near the observer)
		float pixel_size = 2.0 * viewport_size / (resolution.x + resolution.y);
		float d = length(deltax.yz) - 0.5 * objSize[sprite_i].y;
		float a = clamp(0.5 - d / pixel_size, 0.0, 1.0);
		return vec4(redshift(rshift, projectile_color, vec3(1.0)), a);
	}
	vec2 obj_texcoord2 = rot(orientation) * deltax.yz / objSize[sprite_i].yz;
	if (max(abs(obj_texcoord2.x), abs(obj_texcoord2.y)) < 0.5) {
		vec3 lo = objTexMin[sprite_i], hi = objTexMax[sprite_i];
		// Pixel coordinates -> texel centers, so that linear filtering
		// doesn't bleed into neighbouring sprites.
		vec2 xy = mix(lo.xy, hi.xy, obj_texcoord2 + 0.5) + 0.5;
		// Animation frames are sampled exactly at slice centers, which avoids
		// blending in frames of other sprites and makes the loop seamless.
		float n_frames = hi.z - lo.z + 1.0;
		float frame = min(floor(fract(tau / objSize[sprite_i].x) * n_frames), n_frames - 1.0);
		vec3 obj_texcoord = vec3(xy, lo.z + frame + 0.5);
		vec4 obj_color = texture(sprites, obj_texcoord / vec3(textureSize(sprites, 0)));
		return vec4(redshift(rshift, obj_color.xyz, vec3(1.0)), obj_color.a);
	} else {
		return vec4(0.0);
	}
}

void main( void ) {
	// screen to observer space transformation
	vec2 pix_cartesian = s2v(gl_FragCoord.xy, resolution, viewport_size);
	vec3 pix_u0 = screen_ray(obsv_x, obsv_u, pix_cartesian);

	// raytracing along null geodesics
	vec3 pix_x, pix_u;
	float pix_l;
	int steps;
	int status = trace_ray(obsv_x, pix_u0, pix_x, pix_u, pix_l, steps);
	bool reached = status == RAY_REACHED;

	// Redshift: photon energy where it was emitted, measured by the reference
	// observer there (who carries the grid), divided by the energy measured
	// by the observer, which is |pix_cartesian| (see screen_ray).
	mat3 T_pix_x = T(pix_x);
	float obsv_energy = length(pix_cartesian);
	float rshift = abs((T_pix_x * pix_u).x) / obsv_energy;

	// compute output colors; rays that didn't arrive show the black hole's shadow
	float grid_l = show_redshift ? rshift : 1.0;
	vec3 world_color = reached ? redshift(grid_l, grid_color(pix_x), grid_tint(grid_l))
		: show_interior ? shadow_color : vec3(0.0);

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

	// show objects
	vec4 objects_color = vec4(0.0);
	// rays that didn't arrive (the black hole's shadow) show no objects
	for (int i = 0; i < (reached ? n_objects : 0); i++) {
		vec3 obj_x, obj_u, obj_deltax;
		float obj_tau, obj_angle;
		mat3 obj_rest; // coordinate components -> object's rest frame components
		if (!object_event(i, pix_x, obj_x, obj_u, obj_tau, obj_angle, obj_rest, obj_deltax)) continue;
		vec4 obj_color = render_obj(
			object_sprite(i),
			show_redshift ? abs((obj_rest * pix_u).x) / obsv_energy : 1.0,
			obj_tau,
			obj_deltax,
			vec2(cos(obj_angle), sin(obj_angle))
			);
		objects_color = mix(objects_color, obj_color, obj_color.a);
	}

	vec4 obsv_color = render_obj(
		obsv_sprite, 1.0, time, T_pix_x * vec3(0.0, cyclic(obsv_x - pix_x).yz), obsv_o);

	objects_color = mix(objects_color, obsv_color, reached ? obsv_color.a : 0.0);

	out_color = mix(vec4(world_color, 1.0), objects_color, objects_color.a);
}
