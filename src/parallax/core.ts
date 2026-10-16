/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Core WebGL / WebGL2 2.5D Parallax Shader Engine.
 * State-free and shared across client preview, browser exporter, and Remotion.
 */

import type { DepthField } from './depthProcessing';
import type { Rect, Point } from './math';

export interface ParallaxParams {
  fg: Rect;
  bg: Rect;
  orbit: Point;
  strength: number;
  focusDepth: number;
  dofFocus?: number;
  multi: boolean;
  roll: number;
  blur: number;
  fill: number;
  haze: number;
  hazeColor: [number, number, number];
  dust: number;
  dustSize?: number;
  dustDensity?: number;
  time: number;
  seed: number;
  imgAspect: number;
  quality?: 'preview' | 'cloud' | 'export';
}

export const QUALITY = {
  preview: { steps: 16, taps: 8 },
  cloud: { steps: 20, taps: 10 },
  export: { steps: 32, taps: 14 },
};

interface TextureEntry {
  tex: WebGLTexture;
  width: number;
  height: number;
  bytes: number;
  lastUsed: number;
}

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

const FRAGMENT_SHADER_SOURCE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_texCoord;

uniform sampler2D u_image;
uniform sampler2D u_depth;

uniform vec4 u_fgRect;       // x, y, w, h in [0, 1]
uniform vec4 u_bgRect;       // x, y, w, h in [0, 1]
uniform vec2 u_orbit;
uniform float u_strength;
uniform float u_focusDepth;   // pinned parallax plane (0..1)
uniform float u_dofFocus;     // optical focus plane (0..1)
uniform float u_multi;        // 1.0 = multi-layer / 0.0 = single plate
uniform float u_roll;         // camera roll in radians
uniform float u_blur;         // circle-of-confusion radius
uniform float u_fill;         // disocclusion inpainting bias
uniform float u_haze;
uniform vec3 u_hazeColor;
uniform float u_dust;
uniform float u_dustSize;
uniform float u_dustDensity;
uniform float u_time;
uniform float u_seed;
uniform float u_aspect;
uniform float u_frameAspect;
uniform int u_marchSteps;
uniform int u_blurTaps;

// Golden angle for Vogel spiral disk sampling
const float GOLDEN_ANGLE = 2.399963229728653;

// Mirror UV coordinates to avoid clamped edge smear on camera roll / large shifts
vec2 mirrorUV(vec2 p) {
  vec2 m = mod(p, 2.0);
  return vec2(
    m.x > 1.0 ? 2.0 - m.x : m.x,
    m.y > 1.0 ? 2.0 - m.y : m.y
  );
}

// Deterministic 2D hash for volumetric dust
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33 + u_seed * 17.13);
  return fract((p3.x + p3.y) * p3.z);
}

// Occlusion-aware depth ray-marching with binary refinement
vec2 marchDepth(vec2 startUV, vec2 dir, float maxDist) {
  float stepSize = 1.0 / float(u_marchSteps);
  float t = 0.0;
  vec2 currentUV = startUV;
  float prevT = 0.0;
  float hit = 0.0;

  for (int i = 0; i < 32; i++) {
    if (i >= u_marchSteps) break;
    currentUV = startUV + dir * (t * maxDist);
    vec2 clampedUV = mirrorUV(currentUV);
    float sceneDepth = texture2D(u_depth, clampedUV).r;
    float rayDepth = mix(u_focusDepth, 0.0, t); // ray traverses from focus plane to background

    if (sceneDepth >= rayDepth) {
      hit = 1.0;
      break;
    }
    prevT = t;
    t += stepSize;
  }

  // Binary refinement step
  if (hit > 0.5) {
    float tMin = prevT;
    float tMax = t;
    for (int j = 0; j < 4; j++) {
      float tMid = (tMin + tMax) * 0.5;
      vec2 midUV = mirrorUV(startUV + dir * (tMid * maxDist));
      float sceneDepth = texture2D(u_depth, midUV).r;
      float rayDepth = mix(u_focusDepth, 0.0, tMid);
      if (sceneDepth >= rayDepth) {
        tMax = tMid;
      } else {
        tMin = tMid;
      }
    }
    t = (tMin + tMax) * 0.5;
  }

  return startUV + dir * (t * maxDist);
}

// Multi-tap Vogel disk gather blur with depth-of-field circle of confusion
vec4 gatherDoF(vec2 uv, float centerDepth) {
  float coc = abs(centerDepth - u_dofFocus) * u_blur;
  if (coc <= 0.001) {
    return texture2D(u_image, mirrorUV(uv));
  }

  vec4 accum = vec4(0.0);
  float totalWeight = 0.0;
  float tapsF = float(u_blurTaps);

  for (int i = 0; i < 16; i++) {
    if (i >= u_blurTaps) break;
    float fi = float(i) + 0.5;
    float r = sqrt(fi / tapsF) * coc;
    float theta = fi * GOLDEN_ANGLE;
    vec2 offset = vec2(cos(theta), sin(theta) * u_aspect) * r;
    vec2 tapUV = mirrorUV(uv + offset);

    float tapDepth = texture2D(u_depth, tapUV).r;
    // Bleed guard: foreground blur bleeds over background, but background does not bleed over sharp foreground
    float weight = tapDepth >= centerDepth ? 1.0 : max(0.1, 1.0 - (centerDepth - tapDepth) * 8.0);

    accum += texture2D(u_image, tapUV) * weight;
    totalWeight += weight;
  }

  return totalWeight > 0.0 ? accum / totalWeight : texture2D(u_image, mirrorUV(uv));
}

// 3D Volumetric atmospheric dust simulation occluded by scene geometry
vec3 renderAtmosphericDust(vec2 uv, float sceneDepth) {
  if (u_dust <= 0.01) return vec3(0.0);
  vec3 dustAcc = vec3(0.0);

  float sizeScale = clamp(u_dustSize, 0.05, 3.0);
  float densityScale = clamp(u_dustDensity, 0.05, 3.0);

  // Layer 1: Near motes (gentle drift, subtle bokeh)
  {
    float zLayer = 0.85;
    if (zLayer >= sceneDepth - 0.05) {
      vec2 drift = vec2(u_time * 0.02, -u_time * 0.012) + u_orbit * 0.8;
      vec2 gridUV = (uv + drift) * vec2(28.0 * u_frameAspect, 28.0);
      vec2 id = floor(gridUV);
      vec2 gv = fract(gridUV) - 0.5;
      float rnd = hash12(id);
      float spawnThreshold = 1.0 - 0.12 * densityScale;
      if (rnd > spawnThreshold) {
        vec2 pOffset = vec2(sin(u_time * 0.7 + rnd * 6.28), cos(u_time * 0.5 + rnd * 6.28)) * 0.25;
        float d = length(gv - pOffset);
        float radiusA = 0.12 * sizeScale;
        float mote = smoothstep(radiusA, 0.002, d);
        float twinkle = 0.6 + 0.4 * sin(u_time * 1.8 + rnd * 12.0);
        dustAcc += vec3(1.0, 0.95, 0.85) * mote * twinkle * 0.45 * u_dust;
      }
    }
  }

  // Layer 2: Mid-ground motes (fine atmospheric dust)
  {
    float zLayer = 0.45;
    if (zLayer >= sceneDepth - 0.05) {
      vec2 drift = vec2(u_time * 0.008, -u_time * 0.005) + u_orbit * 0.3;
      vec2 gridUV = (uv + drift) * vec2(54.0 * u_frameAspect, 54.0);
      vec2 id = floor(gridUV);
      vec2 gv = fract(gridUV) - 0.5;
      float rnd = hash12(id + vec2(7.3, 13.9));
      float spawnThreshold = 1.0 - 0.10 * densityScale;
      if (rnd > spawnThreshold) {
        vec2 pOffset = vec2(sin(u_time * 1.1 + rnd * 6.28), cos(u_time * 0.9 + rnd * 6.28)) * 0.2;
        float d = length(gv - pOffset);
        float radiusB = 0.08 * sizeScale;
        float mote = smoothstep(radiusB, 0.002, d);
        float twinkle = 0.5 + 0.5 * cos(u_time * 2.2 + rnd * 9.0);
        dustAcc += vec3(0.95, 0.95, 1.0) * mote * twinkle * 0.35 * u_dust;
      }
    }
  }

  return dustAcc;
}

void main() {
  vec2 screenUV = v_texCoord;

  // Apply camera roll around center (0.5, 0.5) using frame aspect
  if (abs(u_roll) > 0.0001) {
    vec2 center = vec2(0.5, 0.5);
    vec2 p = (screenUV - center);
    p.y /= u_frameAspect;
    float cosR = cos(u_roll);
    float sinR = sin(u_roll);
    p = vec2(p.x * cosR - p.y * sinR, p.x * sinR + p.y * cosR);
    p.y *= u_frameAspect;
    screenUV = center + p;
  }

  // Map screen UV to Ken Burns viewport interpolating between fg and bg
  vec2 baseUV = u_fgRect.xy + screenUV * u_fgRect.zw;
  vec2 bgBaseUV = u_bgRect.xy + screenUV * u_bgRect.zw;
  vec2 shiftVector = (bgBaseUV - baseUV) * u_strength + u_orbit;

  // Sample initial depth at screen position
  float initialDepth = texture2D(u_depth, mirrorUV(baseUV)).r;

  vec2 sampledUV;
  if (u_multi > 0.5) {
    // 3-Layer multi-plane / ray-marched parallax
    vec2 dir = -shiftVector;
    float maxDist = length(dir);
    sampledUV = maxDist > 0.0001 ? marchDepth(baseUV, normalize(dir), maxDist) : baseUV;
  } else {
    // Single plate continuous depth displacement
    float depthDiff = (initialDepth - u_focusDepth);
    sampledUV = baseUV + shiftVector * depthDiff;
  }

  float finalDepth = texture2D(u_depth, mirrorUV(sampledUV)).r;

  // Disocclusion inpainting fill: blend edge transitions using u_fill
  if (u_fill > 0.001) {
    float depthEdge = abs(finalDepth - initialDepth);
    if (depthEdge > 0.15) {
      vec2 fillUV = mix(sampledUV, baseUV, clamp(depthEdge * u_fill * 0.8, 0.0, 0.75));
      sampledUV = fillUV;
      finalDepth = texture2D(u_depth, mirrorUV(sampledUV)).r;
    }
  }

  // Gather color with DoF
  vec4 color = gatherDoF(sampledUV, finalDepth);

  // Atmospheric distance haze
  if (u_haze > 0.001) {
    float hazeFactor = pow(clamp(1.0 - finalDepth, 0.0, 1.0), 1.6) * u_haze * 0.7;
    color.rgb = mix(color.rgb, u_hazeColor, hazeFactor);
  }

  // Volumetric atmospheric dust motes
  if (u_dust > 0.001) {
    vec3 dust = renderAtmosphericDust(screenUV, finalDepth);
    color.rgb += dust;
  }

  gl_FragColor = color;
}
`;

export interface ParallaxRendererOptions {
  canvas?: HTMLCanvasElement;
  context?: WebGLRenderingContext | WebGL2RenderingContext;
}

export class ParallaxRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;

  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private textures = new Map<any, TextureEntry>();
  private maxTextureMemory = 128 * 1024 * 1024; // 128 MB LRU budget
  private isLost = false;

  constructor(options: ParallaxRendererOptions = {}) {
    if (options.context) {
      this.gl = options.context;
      this.canvas = options.context.canvas as HTMLCanvasElement;
    } else {
      this.canvas = options.canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : ({} as any));
      const gl = this.canvas.getContext?.('webgl2', { alpha: false, depth: false, antialias: false, preserveDrawingBuffer: true }) ||
                 this.canvas.getContext?.('webgl', { alpha: false, depth: false, antialias: false, preserveDrawingBuffer: true });
      if (!gl) {
        throw new Error('WebGL not supported');
      }
      this.gl = gl as WebGLRenderingContext;
    }

    if (this.canvas.addEventListener) {
      this.canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.isLost = true;
      });
      this.canvas.addEventListener('webglcontextrestored', () => {
        this.isLost = false;
        this.initGL();
      });
    }

    this.initGL();
  }

  private initGL() {
    const gl = this.gl;
    this.textures.clear();

    const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    const prog = gl.createProgram();
    if (!prog || !vs || !fs) return;

    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Parallax shader link failed:', gl.getProgramInfoLog(prog));
      return;
    }

    this.program = prog;

    // Uniform lookups
    const uniformNames = [
      'u_image', 'u_depth', 'u_fgRect', 'u_bgRect', 'u_orbit', 'u_strength',
      'u_focusDepth', 'u_dofFocus', 'u_multi', 'u_roll', 'u_blur', 'u_fill',
      'u_haze', 'u_hazeColor', 'u_dust', 'u_dustSize', 'u_dustDensity',
      'u_time', 'u_seed', 'u_aspect', 'u_frameAspect',
      'u_marchSteps', 'u_blurTaps'
    ];
    this.uniforms = {};
    for (const name of uniformNames) {
      this.uniforms[name] = gl.getUniformLocation(prog, name);
    }

    // Full-screen quad
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const texCoords = new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]);
    this.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
  }

  private compileShader(type: number, src: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private uploadTexture(key: any, imgData: any, isGrayscale = false): WebGLTexture | null {
    const gl = this.gl;
    const existing = this.textures.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.tex;
    }

    const tex = gl.createTexture();
    if (!tex) return null;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    let width = 0;
    let height = 0;
    let bytes = 0;

    if (imgData instanceof Uint8Array || (imgData && imgData.data instanceof Uint8Array)) {
      const data = imgData.data || imgData;
      width = imgData.width || 1;
      height = imgData.height || 1;
      if (isGrayscale) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
        bytes = width * height;
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        bytes = width * height * 4;
      }
    } else if (imgData && imgData.image && imgData.image.data) {
      width = imgData.image.width;
      height = imgData.image.height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgData.image.data);
      bytes = width * height * 4;
    } else if (
      (typeof ImageBitmap !== 'undefined' && imgData instanceof ImageBitmap) ||
      (typeof HTMLImageElement !== 'undefined' && imgData instanceof HTMLImageElement) ||
      (typeof HTMLCanvasElement !== 'undefined' && imgData instanceof HTMLCanvasElement) ||
      (typeof OffscreenCanvas !== 'undefined' && imgData instanceof OffscreenCanvas) ||
      (imgData && typeof imgData === 'object' && 'width' in imgData && 'height' in imgData && !('data' in imgData))
    ) {
      width = (imgData as any).naturalWidth || imgData.width;
      height = (imgData as any).naturalHeight || imgData.height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgData);
      bytes = width * height * 4;
    }

    this.textures.set(key, { tex, width, height, bytes, lastUsed: Date.now() });
    this.evictLRU();
    return tex;
  }

  private evictLRU() {
    let totalBytes = 0;
    for (const entry of this.textures.values()) totalBytes += entry.bytes;
    if (totalBytes <= this.maxTextureMemory && this.textures.size <= 32) return;

    const sorted = Array.from(this.textures.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [k, v] of sorted) {
      if (totalBytes <= this.maxTextureMemory && this.textures.size <= 24) break;
      this.gl.deleteTexture(v.tex);
      this.textures.delete(k);
      totalBytes -= v.bytes;
    }
  }

  public render(
    src: { image: any; key: any; width: number; height: number },
    depth: DepthField,
    targetW: number,
    targetH: number,
    params: ParallaxParams
  ): HTMLCanvasElement | WebGLRenderingContext | null {
    if (this.isLost || !this.program) return null;
    const gl = this.gl;

    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    gl.viewport(0, 0, targetW, targetH);
    gl.useProgram(this.program);

    const imageTex = this.uploadTexture(src.key || src.image, src.image, false);
    const depthTex = this.uploadTexture(depth.data, depth, true);
    if (!imageTex || !depthTex) return null;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imageTex);
    gl.uniform1i(this.uniforms.u_image, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.uniform1i(this.uniforms.u_depth, 1);

    // Uniforms
    gl.uniform4f(this.uniforms.u_fgRect, params.fg.x, params.fg.y, params.fg.w, params.fg.h);
    gl.uniform4f(this.uniforms.u_bgRect, params.bg.x, params.bg.y, params.bg.w, params.bg.h);
    gl.uniform2f(this.uniforms.u_orbit, params.orbit.x, params.orbit.y);
    gl.uniform1f(this.uniforms.u_strength, params.strength);
    gl.uniform1f(this.uniforms.u_focusDepth, params.focusDepth);
    gl.uniform1f(this.uniforms.u_dofFocus, params.dofFocus ?? params.focusDepth);
    gl.uniform1f(this.uniforms.u_multi, params.multi ? 1.0 : 0.0);
    gl.uniform1f(this.uniforms.u_roll, params.roll);
    gl.uniform1f(this.uniforms.u_blur, params.blur);
    gl.uniform1f(this.uniforms.u_fill, params.fill);
    gl.uniform1f(this.uniforms.u_haze, params.haze);
    gl.uniform3f(this.uniforms.u_hazeColor, params.hazeColor[0], params.hazeColor[1], params.hazeColor[2]);
    gl.uniform1f(this.uniforms.u_dust, params.dust);
    gl.uniform1f(this.uniforms.u_dustSize, params.dustSize ?? 0.5);
    gl.uniform1f(this.uniforms.u_dustDensity, params.dustDensity ?? 0.5);
    gl.uniform1f(this.uniforms.u_time, params.time);
    gl.uniform1f(this.uniforms.u_seed, params.seed);
    gl.uniform1f(this.uniforms.u_aspect, params.imgAspect || (targetW / targetH));
    gl.uniform1f(this.uniforms.u_frameAspect, targetW / targetH);

    const qualityConfig = QUALITY[params.quality || 'preview'] || QUALITY.preview;
    gl.uniform1i(this.uniforms.u_marchSteps, qualityConfig.steps);
    gl.uniform1i(this.uniforms.u_blurTaps, qualityConfig.taps);

    // Vertex Attributes
    const aPos = gl.getAttribLocation(this.program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const aTex = gl.getAttribLocation(this.program, 'a_texCoord');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return this.canvas;
  }

  public dispose() {
    const gl = this.gl;
    for (const entry of this.textures.values()) {
      gl.deleteTexture(entry.tex);
    }
    this.textures.clear();
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
    if (this.program) gl.deleteProgram(this.program);
    this.program = null;
    try {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {}
  }
}
