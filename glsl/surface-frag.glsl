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
	mat3 gx = g(pos);
	float grids_per_screen = 20.0;
	vec3 stride_raw = viewport_size / vec3(sqrt(-gx[0][0]), sqrt(gx[1][1]), sqrt(gx[2][2])) / grids_per_screen;
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

// Photon sphere: circular light orbits at r = 1.5 rs. Drawn as a line of a fixed
// width in rendered pixels; `fwidth` is the change of r across one pixel.
// Must be called in uniform control flow, because of `fwidth`.
vec4 photon_sphere_color(vec3 pos, bool reached) {
	const float width = 2.0; // [rendered pixels]
	float d = abs(pos.y - 1.5 * rs);
	float w = fwidth(pos.y) * width / 2.0;
	float a = 1.0 - smoothstep(0.5 * w, 1.5 * w, d);
	// Where neighbouring rays end far apart (next to rays that didn't arrive,
	// or around extreme lensing), `w` is meaningless and would smear the line.
	// The threshold grows with the world size of a pixel, so that the line
	// stays visible when zoomed out.
	float pixel_size = viewport_size / (resolution.x + resolution.y);
	bool discontinuous = fwidth(float(reached)) > 0.0 || w > max(0.25 * rs, 2.0 * pixel_size);
	return vec4(1.0, 0.85, 0.2, (discontinuous || isnan(a)) ? 0.0 : a);
}

vec4 out_of_bounds(bool reached, vec4 c) {
	return reached ? c : vec4(0.1, 0.0, 0.0, 1.0);
}

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

vec4 render_obj(vec3 pix_x, int sprite_i, float rshift, float tau, vec3 deltax, vec2 orientation) {
	mat3 T_pix_x = T(pix_x);
	vec2 obj_texcoord2 = rot(orientation) * (T_pix_x * deltax).yz / objSize[sprite_i].yz;
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
	vec2 pix_target = viewport2world(obsv_x, pix_cartesian);

	mat3 gx = g(obsv_x);
	vec3 pix_v3 = light3(gx, pix_target); // 3-vec pointing at pix

	// boost the grid
	vec3 pix_u0 = general_boost(T(obsv_x), neg_u(obsv_u)) * pix_v3;

	// raytracing along null geodesics
	vec3 pix_x, pix_u;
	bool reached = raytrace(obsv_x, pix_u0, pix_x, pix_u);
	float lorentz_rshift = pix_u0.x / pix_v3.x;
	float grav_rshift = sqrt(gx[0][0] / g(pix_x)[0][0]);
	float rshift = lorentz_rshift * grav_rshift;

	// compute output colors
	vec3 world_color = redshift(rshift, grid_color(pix_x));

	// annotations, not redshifted
	vec4 photon_sphere = photon_sphere_color(pix_x, reached);
	world_color = mix(world_color, photon_sphere.rgb, show_photon_sphere ? photon_sphere.a : 0.0);

	// show objects
	mat3 T_pix_x = T(pix_x);
	vec4 objects_color = vec4(0.0);
	int nPoints = textureSize(obj_its, 0).y;
	float last = float(nPoints - 1);
	int bisect_iters = int(log2(float(nPoints)) + 7.0);
	for (int i = 0; i < n_objects; i++) { // for each object
		mat3 obj_boost;
		vec3 obj_deltax;
		// bisect time for the object trajectory
		float j0 = 0.0, j1 = last;
		float j;
		for (int it = 0; it < bisect_iters; it++) {
			j = (j0 + j1) / 2.0;
			vec3 obj_x = sample_linear(obj_xs, j, i);
			vec3 obj_u = sample_linear(obj_us, j, i);

			obj_boost = general_boost(T_pix_x, obj_u);
			obj_deltax = obj_boost * cyclic(obj_x - pix_x);

			if (obj_deltax.x > 0.0 || isnan(obj_deltax.x))
				j1 = j;
			else
				j0 = j;
		}
		// The pixel's event is before the trajectory starts or after it ends.
		if (j0 == 0.0 || j1 == last) continue;

		vec4 obj_color = render_obj(
			pix_x,
			int(texelFetch(obj_its, ivec2(i, int(j)), 0).x),
			rshift * (obj_boost * pix_u).x / pix_u.x,
			sample_linear(obj_its, j, i).y,
			obj_deltax,
			vec2(0.0, 1.0)
			);
		objects_color = mix(objects_color, obj_color, obj_color.a);
	}

	vec4 obsv_color = render_obj(
		pix_x, obsv_sprite, 1.0, time, vec3(0.0, cyclic(obsv_x-pix_x).yz), obsv_o);

	objects_color = mix(objects_color, obsv_color, obsv_color.a);

	out_color = out_of_bounds(reached, mix(vec4(world_color, 1.0), objects_color, objects_color.a));
}
