// Raytracing fragment shader. Appended to glsl/physics.glsl by js/shaders.js,
// which also defines N_SPRITES.

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
uniform bool show_redshift; // otherwise, colors and brightness are as emitted

uniform sampler3D sprites;

uniform sampler2D obj_xs;
uniform sampler2D obj_us;
uniform sampler2D obj_its;
uniform int n_objects; // number of valid columns in obj_* textures

layout(std140) uniform objectInfo {
	vec3 objSize[N_SPRITES];
	vec3 objTexMin[N_SPRITES];
	vec3 objTexMax[N_SPRITES];
};

out vec4 out_color;

// Set to 1 to shift hues with wavelength. Disabled, because it looks too wrong ATM;
// with it disabled, only intensity changes with redshift.
#define COLOR_SHIFT 0

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

	// coarse grid which doesn't fade in
	vec3 grid_ratio = vec3(0.0, 0.05, 0.05) * (1.0 - stride_alpha * 0.5);
	vec3 grid_frac = abs(mod(pos / stride + 0.5, 1.0) * 2.0 - 1.0);
	vec3 on_grid = line_coverage(grid_frac, grid_ratio, 2.0 * pos_pixel / stride);
	float grid = max(max(on_grid.x, on_grid.y), on_grid.z);

	// fine grid which fades in
	vec3 grid2_ratio = 2.0 * grid_ratio;
	vec3 grid2_frac = abs(mod(pos / (stride/2.0) + 0.5, 1.0) * 2.0 - 1.0);
	vec3 on_grid2 = stride_alpha * line_coverage(grid2_frac, grid2_ratio, 4.0 * pos_pixel / stride);
	float grid2 = max(max(on_grid2.x, on_grid2.y), on_grid2.z);
	// Coverage blends light linearly, while the returned color is sRGB
	// (linearized in `redshift`), so the coverage is gamma-encoded.
	return vec3(0.3 * pow(max(grid, grid2), 1.0 / 2.2));
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

#if COLOR_SHIFT
float x(float l) {
	return 1.065 * exp(-0.5 * pow((l - 595.8) / 33.33, 2.0)) + 0.366 * exp(-0.5 * pow((l - 446.8) / 19.44, 2.0));
}

float y(float l) {
	return 1.014 * exp(-0.5 * pow((log(l) - log(556.3)) / 0.075, 2.0));
}

float z(float l) {
	return 1.839 * exp(-0.5 * pow((log(l) - log(449.8)) / 0.051, 2.0));
}
#endif

vec3 redshift(float l, vec3 sRgb) {
	const float power_exp = 3.0;
	vec3 linear = pow(sRgb, vec3(2.2));
#if COLOR_SHIFT
	const mat3 sRgbToSpectral = mat3(
		0.4148, 0.0140, 0.0129,
 		0.0580, 0.6812, 0.0797,
 		0.0191, 0.0257, 0.6391
	);
	vec3 spectral = sRgbToSpectral * linear;
	float R = 610.0, G = 550.0, B = 465.0;
	mat3 shift = mat3(
		x(R*l), y(R*l), z(R*l),
		x(G*l), y(G*l), z(G*l),
		x(B*l), y(B*l), z(B*l)
	);
	const mat3 xyzToSrgb = mat3(
		 3.2406,-0.9689,  0.0557,
		-1.5372, 1.8757, -0.2040,
		-0.4986, 0.0415,  1.0569
	);
	vec3 shifted = xyzToSrgb * shift * spectral * pow(l, -power_exp);
#else
	// Without the wavelength shift, the spectral round-trip above is
	// the identity matrix to within 2e-4, so it is skipped.
	vec3 shifted = linear * pow(l, -power_exp);
#endif
	return pow(max(shifted, 0.0), vec3(1.0/2.2));
}

// sample from x point [i,j] where i dimension is linearly interpolated
vec3 sample_linear(sampler2D x, float i, int j) {
	int last = textureSize(x, 0).y - 1;
	int i0 = min(int(i), last);
	int i1 = min(i0 + 1, last);
	vec3 p1 = texelFetch(x, ivec2(j, i0), 0).xyz;
	vec3 p2 = texelFetch(x, ivec2(j, i1), 0).xyz;
	float a = i - floor(i);
	return p1 * (1.0 - a) + p2 * a;
}

// `deltax` is the pixel's offset from the object, as components in the object's frame.
vec4 render_obj(int sprite_i, float rshift, float tau, vec3 deltax, vec2 orientation) {
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
		return vec4(redshift(rshift, obj_color.xyz), obj_color.a);
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
	vec3 world_color = reached ? redshift(show_redshift ? rshift : 1.0, grid_color(pix_x)) : shadow_color;

	// annotations, not redshifted
	float photon_sphere = radius_line(pix_x.y, 1.5 * rs, fwidth(float(reached)) == 0.0 && reached);
	world_color = mix(world_color, photon_sphere_color, show_photon_sphere ? photon_sphere : 0.0);
	// The event horizon at the edge of the shadow (from outside) or where rays
	// cross it (from inside, Gullstrand–Painlevé only); ray_end_radius is
	// continuous across the shadow's edge.
	// Rays stopped while heading outwards (inside, towards the white hole) see
	// the white hole's horizon as a whole, so no line is drawn for them.
	bool end_radius_valid = reached || (status == RAY_HORIZON && pix_u.y < 0.0);
	float event_horizon = radius_line(ray_end_radius(status, pix_x, pix_u, pix_l), rs,
		fwidth(float(end_radius_valid)) == 0.0 && end_radius_valid);
	world_color = mix(world_color, event_horizon_color, show_event_horizon ? event_horizon : 0.0);

	// show objects
	vec4 objects_color = vec4(0.0);
	int nPoints = textureSize(obj_its, 0).y;
	float last = float(nPoints - 1);
	int bisect_iters = int(log2(float(nPoints)) + 7.0);
	// rays that didn't arrive (the black hole's shadow) show no objects
	for (int i = 0; i < (reached ? n_objects : 0); i++) { // for each object
		mat3 obj_rest; // coordinate components -> object's rest frame components
		vec3 obj_deltax;
		// bisect time for the object trajectory
		float j0 = 0.0, j1 = last;
		float j;
		for (int it = 0; it < bisect_iters; it++) {
			j = (j0 + j1) / 2.0;
			vec3 obj_x = sample_linear(obj_xs, j, i);
			vec3 obj_u = sample_linear(obj_us, j, i);

			obj_rest = coord_to_rest(pix_x, obj_u);
			obj_deltax = obj_rest * cyclic(obj_x - pix_x);

			if (obj_deltax.x > 0.0 || isnan(obj_deltax.x))
				j1 = j;
			else
				j0 = j;
		}
		// The pixel's event is before the trajectory starts or after it ends.
		if (j0 == 0.0 || j1 == last) continue;

		vec4 obj_color = render_obj(
			int(texelFetch(obj_its, ivec2(i, int(j)), 0).x),
			show_redshift ? abs((obj_rest * pix_u).x) / obsv_energy : 1.0,
			sample_linear(obj_its, j, i).y,
			obj_deltax,
			vec2(0.0, 1.0)
			);
		objects_color = mix(objects_color, obj_color, obj_color.a);
	}

	vec4 obsv_color = render_obj(
		obsv_sprite, 1.0, time, T_pix_x * vec3(0.0, cyclic(obsv_x - pix_x).yz), obsv_o);

	objects_color = mix(objects_color, obsv_color, reached ? obsv_color.a : 0.0);

	out_color = mix(vec4(world_color, 1.0), objects_color, objects_color.a);
}
