// 물속 물체(바닥·수초·돌·통나무·물고기·기둥)가 '물속에 있어 보이게' 하는 공통 셰이더 조각.
// 수면 아래 깊이와 눈까지 물속을 지나는 거리만큼 빛이 줄고(빨강이 먼저) 물빛이 섞입니다.
// 바닥에는 일렁이는 물빛 무늬(코스틱)를 더합니다.
import * as THREE from 'three';

export const UW = {
  uWaterY: { value: 0 },
  // 1m 당 감쇠(r, g, b). 맑은 호수: 빨강이 가장 빨리 줄어 초록·청록이 남습니다.
  uExt: { value: new THREE.Vector3(0.36, 0.12, 0.105) },
  // 물속에서 퍼진 빛(멀고 깊을수록 이 색이 됩니다)
  uDeep: { value: new THREE.Color('#1c5b5e') },
  // 눈까지의 물속 경로 상한(m). 멀리 있는 물고기도 형체가 남도록 너무 길게 잡지 않습니다.
  uPathMax: { value: 4.2 },
  uTime: { value: 0 },
  uCausticCol: { value: new THREE.Color('#fff4d6').multiplyScalar(0.85) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }
};

const PARS_V = 'varying vec3 vUwW;\n';
const PARS_F = `
uniform float uWaterY;
uniform vec3 uExt;
uniform vec3 uDeep;
uniform float uPathMax;
varying vec3 vUwW;
`;
const CAUSTIC_F = `
uniform float uTime;
uniform vec3 uCausticCol;
vec2 uwHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// 움직이는 점들 사이 경계(보로노이 F2-F1)가 밝은 그물처럼 보입니다.
float uwEdge(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = uwHash(i + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(d2) - sqrt(d1);
}
float uwCaustic(vec2 p, float t) {
  float a = uwEdge(p * 0.95 + vec2(t * 0.05, t * 0.03), t * 0.7);
  float b = uwEdge(p * 1.37 + vec2(3.7 - t * 0.04, 1.3 + t * 0.05), t * 0.55 + 1.3);
  float c = (1.0 - smoothstep(0.0, 0.2, a)) * 0.6 + (1.0 - smoothstep(0.0, 0.15, b)) * 0.45;
  return c * c * 1.3;
}
`;

function inject(sh, caustics) {
  sh.uniforms.uWaterY = UW.uWaterY;
  sh.uniforms.uExt = UW.uExt;
  sh.uniforms.uDeep = UW.uDeep;
  sh.uniforms.uPathMax = UW.uPathMax;
  if (caustics) {
    sh.uniforms.uTime = UW.uTime;
    sh.uniforms.uCausticCol = UW.uCausticCol;
  }
  sh.vertexShader = PARS_V + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
    #ifdef USE_INSTANCING
      vUwW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
    #else
      vUwW = (modelMatrix * vec4(transformed, 1.0)).xyz;
    #endif`);
  sh.fragmentShader = PARS_F + (caustics ? CAUSTIC_F : '') + sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
    {
      float uwD = uWaterY - vUwW.y;
      if (uwD > 0.0) {
        ${caustics ? `float uwFade = exp(-uwD * 0.32) * smoothstep(0.0, 0.25, uwD) * (1.0 - smoothstep(14.0, 30.0, length(cameraPosition.xz - vUwW.xz)));
        gl_FragColor.rgb += diffuseColor.rgb * uCausticCol * uwCaustic(vUwW.xz * 1.55, uTime) * uwFade;` : ''}
        vec3 uwToC = cameraPosition - vUwW;
        float uwL = length(uwToC);
        float uwH = max(cameraPosition.y - uWaterY, 0.05);
        float uwPath = min(uwL * uwD / (uwD + uwH), uPathMax) + uwD * 0.75;
        vec3 uwT = exp(-uExt * uwPath);
        gl_FragColor.rgb = gl_FragColor.rgb * uwT + uDeep * (1.0 - uwT);
      }
    }`);
}

// 재질에 물속 효과를 덧붙입니다. 이미 onBeforeCompile 이 있으면(꼬리치기·흔들림) 그 뒤에 이어 붙입니다.
// key 는 셰이더 변형마다 달라야 합니다(같으면 three 가 다른 재질의 프로그램을 재사용함).
export function underwater(mat, key, { caustics = false } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    inject(sh, caustics);
  };
  mat.customProgramCacheKey = () => `uw:${key}:${caustics ? 'c' : 'n'}`;
  return mat;
}

// 물속 투과율(평균). 그림자 얼룩처럼 직접 만든 셰이더가 같은 계산을 쓰도록 문자열로 내보냅니다.
export const UW_TRANSMIT_GLSL = `
float uwTransmit(vec3 w) {
  float uwD = uWaterY - w.y;
  if (uwD <= 0.0) return 1.0;
  float uwL = length(cameraPosition - w);
  float uwH = max(cameraPosition.y - uWaterY, 0.05);
  float uwPath = min(uwL * uwD / (uwD + uwH), uPathMax) + uwD * 0.75;
  vec3 uwT = exp(-uExt * uwPath);
  return dot(uwT, vec3(0.2, 0.5, 0.3));
}
`;
