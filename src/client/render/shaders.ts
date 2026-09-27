/** GLSL for chunk rendering (WebGL2 / GLSL ES 3.0 via three.js ShaderMaterial). */
export const CHUNK_VERT = /* glsl */ `
precision highp float;
in vec3 aPos;
in vec2 aUv;
in vec4 aCol;
in vec4 aLight;
uniform float uTime;
uniform float uTileU;
uniform float uWave;
out vec2 vUv;
out vec3 vTint;
out float vShade;
out vec2 vLight;
out float vFogDepth;
out vec3 vWorld;
void main() {
  vec3 pos = aPos / 256.0;
  vec2 uv = aUv;
  float frames = aLight.z;
  if (frames > 1.5) {
    float ft = max(aLight.w, 1.0);
    float frame = mod(floor(uTime / ft), frames);
    uv.x += frame * uTileU;
  }
  vUv = uv;
  vTint = aCol.rgb;
  vShade = aCol.a;
  vLight = aLight.xy / 240.0;
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vFogDepth = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const CHUNK_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
in vec3 vTint;
in float vShade;
in vec2 vLight;
in float vFogDepth;
in vec3 vWorld;
uniform sampler2D uAtlas;
uniform float uDaylight;
uniform vec3 uSkyTint;
uniform vec3 uBlockTint;
uniform float uBrightness;
uniform float uAmbient;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlphaMode; // 0 opaque, 1 cutout, 2 translucent
uniform float uNightVision;
uniform float uFlicker;

float curve(float l) {
  float f = l / (4.0 - 3.0 * l);
  return mix(f, 1.0 - pow(1.0 - f, 4.0), uBrightness);
}

void main() {
  vec4 tex = texture(uAtlas, vUv);
  if (uAlphaMode < 1.5) {
    if (tex.a < 0.5) discard;
  } else if (tex.a < 0.02) discard;
  vec3 base = tex.rgb;
  if (tex.a < 0.999) base *= vTint;
  float sky = curve(vLight.x) * uDaylight;
  float blk = curve(vLight.y) * uFlicker;
  vec3 light = max(uSkyTint * sky, uBlockTint * blk);
  light = max(light, vec3(uAmbient));
  light = mix(light, vec3(1.0), uNightVision);
  vec3 col = base * light * vShade;
  float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
  col = mix(col, uFogColor, fog);
  float a = uAlphaMode > 1.5 ? (tex.a > 0.99 ? 1.0 : tex.a) : 1.0;
  gl_FragColor = vec4(col, a);
}
`;
