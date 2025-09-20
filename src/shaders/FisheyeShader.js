export const FisheyeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    distortion: { value: 0.3 },
    dispersion: { value: 0.0 },
    cropAmount: { value: 0.0 },
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
    uniform float cropAmount;
    uniform float alpha;
    varying vec2 vUv;

    vec2 fisheye(vec2 uv, float strength) {
      vec2 center = vec2(0.5);
      vec2 delta = uv - center;
      float distance = length(delta);
      
      if (distance > 0.5) {
        return vec2(-1.0);
      }
      
      float factor = 1.0 + strength * pow(distance, 2.0);
      return center + delta * factor;
    }

    void main() {
      vec2 center = vec2(0.5);
      
      // 先应用裁剪 - 向内缩放UV来去除黑边
      vec2 uv = (vUv - center) * (1.0 - cropAmount) + center;
      
      // 边界检查
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      
      // 色散效果 - 为不同颜色通道应用不同的畸变
      vec2 redUV = fisheye(uv, distortion + dispersion * 0.005);
      vec2 greenUV = fisheye(uv, distortion);
      vec2 blueUV = fisheye(uv, distortion - dispersion * 0.005);
      
      float r = (redUV.x >= 0.0 && redUV.x <= 1.0 && redUV.y >= 0.0 && redUV.y <= 1.0) ? 
                texture2D(tDiffuse, redUV).r : 0.0;
      float g = (greenUV.x >= 0.0 && greenUV.x <= 1.0 && greenUV.y >= 0.0 && greenUV.y <= 1.0) ? 
                texture2D(tDiffuse, greenUV).g : 0.0;
      float b = (blueUV.x >= 0.0 && blueUV.x <= 1.0 && blueUV.y >= 0.0 && blueUV.y <= 1.0) ? 
                texture2D(tDiffuse, blueUV).b : 0.0;
      
      gl_FragColor = vec4(r, g, b, alpha);
    }
  `
};
