export const RetroCRTShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    resolution: { value: null },
    scanlineIntensity: { value: 0.8 },
    scanlineCount: { value: 800.0 },
    vignetteIntensity: { value: 0.5 },
    noiseIntensity: { value: 0.3 },
    curvature: { value: 0.1 },
    brightness: { value: 1.1 },
    contrast: { value: 1.2 }
  },

  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform vec2 resolution;
    uniform float scanlineIntensity;
    uniform float scanlineCount;
    uniform float vignetteIntensity;
    uniform float noiseIntensity;
    uniform float curvature;
    uniform float brightness;
    uniform float contrast;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    vec2 curve(vec2 uv) {
      uv = (uv - 0.5) * 2.0;
      uv.x *= 1.0 + pow(abs(uv.y) / 5.0, 2.0) * curvature;
      uv.y *= 1.0 + pow(abs(uv.x) / 4.0, 2.0) * curvature;
      uv = (uv + 2.0) / 4.0;
      return uv;
    }

    void main() {
      vec2 uv = vUv;
      
      uv = curve(uv);
      
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      
      vec4 color = texture2D(tDiffuse, uv);
      
      color.rgb = ((color.rgb - 0.5) * contrast) + 0.5;
      color.rgb *= brightness;
      
      // 增强扫描线效果
      float scanline = sin(uv.y * scanlineCount) * 0.15 + 0.85;
      color.rgb *= mix(1.0, scanline, scanlineIntensity);

      float rgbScanline = sin(uv.x * resolution.x * 3.14159 * 0.5) * 0.08 + 0.92;
      color.rgb *= rgbScanline;

      // 大幅增强噪点效果
      float noise = (rand(uv + floor(time * 20.0) * 0.1) - 0.5) * noiseIntensity;
      color.rgb += noise * 0.8;

      // 大幅增强暗角效果
      vec2 vignetteUV = uv * (1.0 - uv.yx);
      float vignette = vignetteUV.x * vignetteUV.y * 15.0;
      vignette = pow(vignette, 0.3);
      vignette = mix(0.3, 1.0, vignette * (1.0 + vignetteIntensity * 2.0));
      color.rgb *= vignette;

      float flicker = 1.0 + sin(time * 30.0) * 0.01;
      color.rgb *= flicker;
      
      gl_FragColor = color;
    }
  `
};
