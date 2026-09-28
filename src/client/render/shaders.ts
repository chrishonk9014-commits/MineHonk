/** GLSL for chunk rendering (WebGL2 / GLSL ES 3.0 via three.js ShaderMaterial). */
export const CHUNK_VERT = /* glsl */ `
precision highp float;
in vec4 aPos;    // x, y, z in 1/256 block (region relative), w = quad size in tiles (u | v << 5)
in vec2 aLocal;  // texture coordinates in tiles * 256 (repeat across merged faces)
in vec2 aTile;   // atlas origin of the texture tile
in vec4 aCol;
in vec4 aLight;
uniform float uTime;
uniform vec2 uTileSize;
out vec2 vLocal;
flat out vec2 vTile;
flat out vec2 vSize;
out vec3 vTint;
out float vShade;
out vec2 vLight;
out float vFogDepth;
void main() {
  vec3 pos = aPos.xyz / 256.0;
  vec2 tile = aTile;
  float frames = aLight.z;
  if (frames > 1.5) {
    float ft = max(aLight.w, 1.0);
    float frame = mod(floor(uTime / ft), frames);
    tile.x += frame * uTileSize.x;
  }
  vTile = tile;
  vSize = vec2(mod(aPos.w, 32.0), floor(aPos.w / 32.0));
  vLocal = aLocal / 256.0;
  vTint = aCol.rgb;
  vShade = aCol.a;
  vLight = aLight.xy / 240.0;
  vec4 mv = viewMatrix * (modelMatrix * vec4(pos, 1.0));
  vFogDepth = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const CHUNK_FRAG = /* glsl */ `
precision highp float;
in vec2 vLocal;
flat in vec2 vTile;
flat in vec2 vSize;
in vec3 vTint;
in float vShade;
in vec2 vLight;
in float vFogDepth;
uniform sampler2D uAtlas;
uniform vec2 uTileSize;
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
  // Repeat the tile across merged faces; stay a hair inside the quad's own edges
  vec2 l = clamp(vLocal, vec2(0.002), vSize - 0.002);
  vec2 uv = vTile + fract(l) * uTileSize;
  // Gradients of the unwrapped coordinates keep mip selection seamless
  vec4 tex = textureGrad(uAtlas, uv, dFdx(vLocal) * uTileSize, dFdy(vLocal) * uTileSize);
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
