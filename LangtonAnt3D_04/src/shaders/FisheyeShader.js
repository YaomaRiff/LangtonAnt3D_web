export const FisheyeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    distortion: { value: 0.3 },
    dispersion: { value: 0.0 },
    alpha: { value: 1.0 }
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
    uniform float distortion;
    uniform float dispersion;
    uniform float alpha;
    varying vec2 vUv;

    vec2 fisheye(vec2 uv, float strength) {
      vec2 center = vec2(0.5);
      vec2 delta = uv - center;
      float distance = length(delta);
      
      if (distance > 0.5) {
        return uv;
      }
      
      float factor = 1.0 + strength * pow(distance, 2.0);
      return center + delta * factor;
    }

    void main() {
      vec2 uv = vUv;
      
      // 应用鱼眼畸变
      vec2 distortedUV = fisheye(uv, distortion);
      
      // 色散效果
      vec2 redUV = fisheye(uv, distortion + dispersion * 0.01);
      vec2 greenUV = fisheye(uv, distortion);
      vec2 blueUV = fisheye(uv, distortion - dispersion * 0.01);
      
      float r = texture2D(tDiffuse, redUV).r;
      float g = texture2D(tDiffuse, greenUV).g;
      float b = texture2D(tDiffuse, blueUV).b;
      
      gl_FragColor = vec4(r, g, b, alpha);
    }
  `
};
