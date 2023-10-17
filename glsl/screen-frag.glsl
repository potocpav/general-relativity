# version 300 es
precision highp float;

uniform vec2 resolution;
uniform sampler2D color;

out vec4 out_color;

void main() {
	vec2 uv = gl_FragCoord.xy / resolution.xy;
	out_color = texture(color, uv);
}
