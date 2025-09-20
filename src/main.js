import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// 着色器定义
const FisheyeShader = {
  uniforms: {
    'tDiffuse': { value: null },
    'distortion': { value: 0.3 },
    'dispersion': { value: 0.0 },
    'cropAmount': { value: 0.0 }
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
  uniform float distortion;
  uniform float dispersion;
  uniform float cropAmount;
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
    
    // 先应用裁剪
    vec2 uv = (vUv - center) * (1.0 - cropAmount) + center;
    
    // 边界检查
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    
    // 色散效果 - 为不同颜色通道应用不同的畸变
    vec2 redUV = fisheye(uv, distortion + dispersion * 0.1);
    vec2 greenUV = fisheye(uv, distortion);
    vec2 blueUV = fisheye(uv, distortion - dispersion * 0.1);
    
    float r = (redUV.x >= 0.0 && redUV.x <= 1.0 && redUV.y >= 0.0 && redUV.y <= 1.0) ? 
              texture2D(tDiffuse, redUV).r : 0.0;
    float g = (greenUV.x >= 0.0 && greenUV.x <= 1.0 && greenUV.y >= 0.0 && greenUV.y <= 1.0) ? 
              texture2D(tDiffuse, greenUV).g : 0.0;
    float b = (blueUV.x >= 0.0 && blueUV.x <= 1.0 && blueUV.y >= 0.0 && blueUV.y <= 1.0) ? 
              texture2D(tDiffuse, blueUV).b : 0.0;
    
    gl_FragColor = vec4(r, g, b, 1.0);
  }
`


};

const RetroCRTShader = {
  uniforms: {
    'tDiffuse': { value: null },
    'resolution': { value: new THREE.Vector2(1920, 1080) },
    'scanlineIntensity': { value: 0.73 },
    'vignetteIntensity': { value: 0.92 },
    'noiseIntensity': { value: 0.3 },
    'time': { value: 0.0 }
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
    uniform vec2 resolution;
    uniform float scanlineIntensity;
    uniform float vignetteIntensity;
    uniform float noiseIntensity;
    uniform float time;
    varying vec2 vUv;
    
    void main() {
      vec2 coord = vUv;
      float scanline = sin(coord.y * resolution.y * 0.5) * scanlineIntensity;
      vec4 color = texture2D(tDiffuse, coord);
      color.rgb *= 1.0 - scanline * 0.04;
      
      vec2 center = coord - 0.5;
      float vignette = 1.0 - vignetteIntensity * 0.3 * dot(center, center);
      color.rgb *= vignette;
      
      float noise = fract(sin(dot(coord * time, vec2(12.9898, 78.233))) * 43758.5453);
      color.rgb += noise * noiseIntensity * 0.02;
      
      gl_FragColor = color;
    }
  `
};

// 基础设置
document.body.style.cssText = 'margin:0;background:#000;font-family:Arial,sans-serif;overflow:hidden;';

const container = document.createElement('div');
container.style.cssText = 'position:fixed;inset:0;';
document.body.appendChild(container);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x171B1C);
scene.fog = new THREE.FogExp2(0x171B1C, 0.015);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(10, 10, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// 控制器（保留中键平移功能）
const controls = new OrbitControls(camera, renderer.domElement);
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE
};
controls.enablePan = true;
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// 灯光
scene.add(new THREE.AmbientLight(0xffffff, 0.18));
const pointLight = new THREE.PointLight(0x88aaff, 1.2, 0, 2);
pointLight.position.set(6, 6, 6);
scene.add(pointLight);

// 后处理
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.8, 0.0);
composer.addPass(bloomPass);

const fisheyePass = new ShaderPass(FisheyeShader);
composer.addPass(fisheyePass);

const crtPass = new ShaderPass(RetroCRTShader);
crtPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
composer.addPass(crtPass);

// 状态变量
let antData = [];
let mappedPoints = [];
let currentStep = 0;
let animating = false;
let lerpT = 0;
let speedFactor = 0.1;
let fogVolumeScale = 1.0;
let baseDustPositions = null;
let dustFloatIntensity = 0.5;
let dustBreathIntensity = 0.2;
let dustPoints = null;

const lineGroup = new THREE.Group();
scene.add(lineGroup);
let progressLine = null;
let currentMarker = null;

// 材质
const progressMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(0xF0B7B7) },
    uFogIntensity: { value: 0.08 }
  },
  vertexShader: `
    varying vec3 vViewPos;
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPos = mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uFogIntensity;
    varying vec3 vViewPos;
    
    void main() {
      float dist = length(vViewPos);
      float fogFactor = exp(-pow(dist * uFogIntensity, 1.5));
      fogFactor = clamp(fogFactor, 0.05, 1.0);
      gl_FragColor = vec4(uColor, fogFactor);
    }
  `,
  transparent: true
});

const markerMaterial = new THREE.MeshStandardMaterial({
  color: 0xF0B7B7,
  emissive: 0xF0B7B7,
  emissiveIntensity: 3.0
});

// 粒子系统
function createDustParticles() {
  const particleCount = 800;
  const positions = new Float32Array(particleCount * 3);
  baseDustPositions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    const spread = 100;
    const baseX = (Math.random() - 0.5) * spread;
    const baseY = (Math.random() - 0.5) * spread * 0.6;
    const baseZ = (Math.random() - 0.5) * spread;

    baseDustPositions[i * 3] = baseX;
    baseDustPositions[i * 3 + 1] = baseY;
    baseDustPositions[i * 3 + 2] = baseZ;

    positions[i * 3] = baseX;
    positions[i * 3 + 1] = baseY;
    positions[i * 3 + 2] = baseZ;
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const dustMaterial = new THREE.PointsMaterial({
    size: 0.8,
    map: new THREE.CanvasTexture(canvas),
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.4,
    color: 0xAF85B7
  });

  dustPoints = new THREE.Points(dustGeometry, dustMaterial);
  scene.add(dustPoints);
}

// 数据处理
function findColumnIndex(headers, candidates) {
  for (const candidate of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase() === candidate.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

async function loadCSVData() {
  try {
    const response = await fetch('./data.csv');
    const csvText = await response.text();
    parseCSVData(csvText);
  } catch {
    generateSampleData();
    updateInfo('未找到data.csv，使用示例数据');
  }
}

function parseCSVData(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return;

  const header = lines[0].split(',').map(h => h.trim());
  const colX = findColumnIndex(header, ['x', 'lng', 'longitude']);
  const colY = findColumnIndex(header, ['y', 'lat', 'latitude']);
  const colZ = findColumnIndex(header, ['z', 'time', 'step']);

  if (colX === -1 || colY === -1 || colZ === -1) {
    alert('CSV格式错误，需要包含x/y/z或lng/lat/time列');
    return;
  }

  antData = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const x = parseFloat(cols[colX]);
    const y = parseFloat(cols[colY]);
    const z = parseFloat(cols[colZ]);
    
    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
      antData.push({ x, y, z });
    }
  }

  buildVisualization();
  updateInfo(`已加载${antData.length}个数据点`);
}

function generateSampleData() {
  antData = [];
  for (let i = 0; i < 30; i++) {
    const t = i / 29;
    antData.push({
      x: Math.sin(t * Math.PI * 3) * 8,
      y: t * 15 - 7.5,
      z: Math.cos(t * Math.PI * 2) * 6
    });
  }
  buildVisualization();
  updateInfo(`已加载示例数据: ${antData.length}个点`);
}

function buildVisualization() {
  // 清理
  lineGroup.clear();
  if (currentMarker) {
    scene.remove(currentMarker);
    currentMarker = null;
  }

  if (!antData.length) return;

  // 标准化
  const xVals = antData.map(p => p.x);
  const yVals = antData.map(p => p.y);
  const zVals = antData.map(p => p.z);
  
  const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
  const yMin = Math.min(...yVals), yMax = Math.max(...yVals);
  const zMin = Math.min(...zVals), zMax = Math.max(...zVals);
  
  const scale = 20;
  mappedPoints = antData.map(p => new THREE.Vector3(
    ((p.x - xMin) / (xMax - xMin) - 0.5) * scale,
    ((p.y - yMin) / (yMax - yMin) - 0.5) * scale * 0.6,
    ((p.z - zMin) / (zMax - zMin) - 0.5) * scale
  ));

  // 创建标记
  currentMarker = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 16), markerMaterial);
  currentMarker.position.copy(mappedPoints[0]);
  scene.add(currentMarker);

  // 适配相机
  const box = new THREE.Box3().setFromPoints(mappedPoints);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim / (2 * Math.tan(camera.fov * Math.PI / 360)) * 2.5;

  camera.position.set(
    center.x + distance * 0.5,
    center.y + distance * 0.5,
    center.z + distance * 0.5
  );
  controls.target.copy(center);
  controls.update();

  // 重置动画
  currentStep = 0;
  updateStepDisplay();
}

// 动画控制
function resetAnimation() {
  currentStep = 0;
  lerpT = 0;
  animating = false;
  lineGroup.clear();
  if (currentMarker && mappedPoints.length) {
    currentMarker.position.copy(mappedPoints[0]);
  }
  updateStepDisplay();
}

function jumpToStep(targetStep) {
  if (!mappedPoints.length) return;
  
  currentStep = Math.max(0, Math.min(targetStep, mappedPoints.length - 1));
  
  lineGroup.clear();
  if (currentStep > 0) {
    const pathPoints = mappedPoints.slice(0, currentStep + 1);
    const pathGeometry = new THREE.BufferGeometry().setFromPoints(pathPoints);
    progressLine = new THREE.Line(pathGeometry, progressMaterial);
    lineGroup.add(progressLine);
  }
  
  if (currentMarker) {
    currentMarker.position.copy(mappedPoints[currentStep]);
  }
  updateStepDisplay();
}

function updateStepDisplay() {
  const stepDisplay = document.getElementById('stepDisplay');
  const stepSlider = document.getElementById('stepSlider');
  
  if (stepDisplay) stepDisplay.textContent = `${currentStep}/${mappedPoints.length - 1}`;
  if (stepSlider) {
    stepSlider.max = mappedPoints.length - 1;
    stepSlider.value = currentStep;
  }
}

function updateInfo(text) {
  const info = document.getElementById('info');
  if (info) info.textContent = text;
}

// 配置系统
function updateSceneFromConfig() {
  const getValue = id => {
    const el = document.getElementById(id);
    return el ? (el.type === 'checkbox' ? el.checked : parseFloat(el.value)) : 0;
  };

  const bgColor = document.getElementById('bgColor')?.value || '#171B1C';
  scene.background.setStyle(bgColor);
  scene.fog.color.setStyle(bgColor);
  scene.fog.density = getValue('fogSlider') * 0.001;

  fogVolumeScale = getValue('fogVolumeSlider');
  dustFloatIntensity = getValue('dustFloatSlider') * 0.005;
  dustBreathIntensity = getValue('dustBreathSlider') * 0.005;

  const pathColor = document.getElementById('pathColor')?.value || '#F0B7B7';
  const dustColor = document.getElementById('dustColor')?.value || '#AF85B7';

  progressMaterial.uniforms.uColor.value.setStyle(pathColor);
  progressMaterial.uniforms.uFogIntensity.value = getValue('pathFogSlider') * 0.01;
  markerMaterial.color.setStyle(pathColor);
  markerMaterial.emissive.setStyle(pathColor);

  if (dustPoints) dustPoints.material.color.setStyle(dustColor);

  fisheyePass.uniforms.distortion.value = getValue('fisheyeDistortionSlider') * 0.01;
  fisheyePass.uniforms.dispersion.value = getValue('fisheyeDispersionSlider') * 0.01;
  fisheyePass.uniforms.cropAmount.value = getValue('fisheyeCropSlider') * 0.01;
  fisheyePass.enabled = getValue('enableFisheye');

  crtPass.uniforms.scanlineIntensity.value = getValue('crtScanlinesSlider') * 0.01;
  crtPass.uniforms.vignetteIntensity.value = getValue('crtVignetteSlider') * 0.01;
  crtPass.uniforms.noiseIntensity.value = getValue('crtNoiseSlider') * 0.01;
  crtPass.enabled = getValue('enableCRT');

  speedFactor = getValue('speedSlider') * 0.002;
}

// UI创建
function createUI() {
  const style = document.createElement('style');
  style.textContent = `
    .control-panel {
      position: fixed;
      top: 20px;
      left: 20px;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      padding: 20px;
      color: white;
      font-size: 14px;
      z-index: 1000;
      max-width: 300px;
      max-height: 80vh;
      overflow-y: auto;
    }
    .control-section {
      margin-bottom: 15px;
      padding-bottom: 15px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .section-title {
      font-weight: bold;
      margin-bottom: 10px;
      color: #F0B7B7;
      font-size: 16px;
    }
    .control-row {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      gap: 10px;
    }
    .control-row label {
      flex: 1;
      min-width: 80px;
    }
    .control-row input[type="range"] {
      flex: 2;
      min-width: 80px;
    }
    .control-row input[type="color"] {
      width: 40px;
      height: 25px;
      border: none;
      border-radius: 3px;
    }
    .control-row span {
      min-width: 30px;
      text-align: right;
      font-family: monospace;
      font-size: 12px;
    }
    .button-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .control-button {
      padding: 6px 10px;
      background: rgba(240, 183, 183, 0.2);
      border: 1px solid #F0B7B7;
      border-radius: 5px;
      color: white;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
    }
    .control-button:hover {
      background: rgba(240, 183, 183, 0.4);
    }
    .info-display {
      position: fixed;
      bottom: 20px;
      left: 20px;
      background: rgba(0, 0, 0, 0.7);
      padding: 10px 15px;
      border-radius: 5px;
      color: white;
      font-family: monospace;
      font-size: 12px;
      z-index: 999;
    }
    .help-display {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.7);
      padding: 10px 15px;
      border-radius: 5px;
      color: #F0B7B7;
      font-family: monospace;
      font-size: 12px;
      z-index: 999;
      line-height: 1.4;
    }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'control-panel';
  panel.innerHTML = `
    <div class="control-section">
      <div class="section-title">数据控制</div>
      <div class="button-row">
        <input type="file" id="csvFile" accept=".csv" style="display:none">
        <button class="control-button" onclick="document.getElementById('csvFile').click()">加载CSV</button>
        <button class="control-button" id="playBtn">播放</button>
        <button class="control-button" id="resetBtn">重置</button>
      </div>
    </div>
      <div class="control-row">
        <label>黑边裁剪:</label>
        <input type="range" id="fisheyeCropSlider" min="0" max="50" value="33">
        <span id="fisheyeCropDisplay">33</span>
      </div>
    </div>

    <div class="control-section">
      <div class="section-title">动画设置</div>
      <div class="control-row">
        <label>速度:</label>
        <input type="range" id="speedSlider" min="1" max="200" value="50">
        <span id="speedDisplay">50</span>
      </div>
    </div>

    <div class="control-section">
      <div class="section-title">颜色设置</div>
      <div class="control-row">
        <label>路径:</label>
        <input type="color" id="pathColor" value="#F0B7B7">
      </div>
      <div class="control-row">
        <label>粒子:</label>
        <input type="color" id="dustColor" value="#AF85B7">
      </div>
      <div class="control-row">
        <label>背景:</label>
        <input type="color" id="bgColor" value="#171B1C">
      </div>
    </div>

    <div class="control-section">
      <div class="section-title">环境设置</div>
      <div class="control-row">
        <label>雾密度:</label>
        <input type="range" id="fogSlider" min="1" max="50" value="15">
        <span id="fogDisplay">15</span>
      </div>
      <div class="control-row">
        <label>粒子体积:</label>
        <input type="range" id="fogVolumeSlider" min="0.1" max="3" step="0.1" value="1">
        <span id="fogVolumeDisplay">1.0</span>
      </div>
      <div class="control-row">
        <label>路径雾化:</label>
        <input type="range" id="pathFogSlider" min="1" max="50" value="10">
        <span id="pathFogDisplay">10</span>
      </div>
      <div class="control-row">
        <label>粒子浮动:</label>
        <input type="range" id="dustFloatSlider" min="0" max="100" value="12">
        <span id="dustFloatDisplay">12</span>
      </div>
      <div class="control-row">
        <label>粒子呼吸:</label>
        <input type="range" id="dustBreathSlider" min="0" max="100" value="2">
        <span id="dustBreathDisplay">2</span>
      </div>
    </div>

    <div class="control-section">
      <div class="section-title">后处理效果</div>
      <div class="control-row">
        <label>鱼眼效果:</label>
        <input type="checkbox" id="enableFisheye" checked>
      </div>
      <div class="control-row">
        <label>鱼眼强度:</label>
        <input type="range" id="fisheyeDistortionSlider" min="0" max="100" value="30">
        <span id="fisheyeDistortionDisplay">30</span>
      </div>
      <div class="control-row">
        <label>色散效果:</label>
        <input type="range" id="fisheyeDispersionSlider" min="0" max="100" value="60">
        <span id="fisheyeDispersionDisplay">60</span>
      </div>

      <div class="control-row">
        <label>步骤:</label>
        <input type="range" id="stepSlider" min="0" max="0" value="0">
        <span id="stepDisplay">0/0</span>
      </div>
      <div class="control-row">
        <label>CRT效果:</label>
        <input type="checkbox" id="enableCRT" checked>
      </div>
      <div class="control-row">
        <label>扫描线:</label>
        <input type="range" id="crtScanlinesSlider" min="0" max="100" value="73">
        <span id="crtScanlinesDisplay">73</span>
      </div>
      <div class="control-row">
        <label>暗角:</label>
        <input type="range" id="crtVignetteSlider" min="0" max="100" value="92">
        <span id="crtVignetteDisplay">92</span>
      </div>
      <div class="control-row">
        <label>噪点:</label>
        <input type="range" id="crtNoiseSlider" min="0" max="100" value="30">
        <span id="crtNoiseDisplay">11</span>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // 信息显示
  const infoDisplay = document.createElement('div');
  infoDisplay.id = 'info';
  infoDisplay.className = 'info-display';
  infoDisplay.textContent = '等待加载数据...';
  document.body.appendChild(infoDisplay);

  // 操作提示
  const helpDisplay = document.createElement('div');
  helpDisplay.className = 'help-display';
  helpDisplay.innerHTML = `
    鼠标操作:<br>
    左键: 旋转视角<br>
    中键: 平移视图<br>
    滚轮: 缩放<br>
  `;
  document.body.appendChild(helpDisplay);
}

// 事件绑定
function setupEvents() {
  // 文件加载
  document.getElementById('csvFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => parseCSVData(e.target.result);
    reader.readAsText(file);
  });

  // 播放控制
  document.getElementById('playBtn').addEventListener('click', () => {
    if (!mappedPoints.length) return;
    animating = !animating;
    document.getElementById('playBtn').textContent = animating ? '暂停' : '播放';
  });

  document.getElementById('resetBtn').addEventListener('click', resetAnimation);
  document.getElementById('stepSlider').addEventListener('input', (e) => {
    jumpToStep(parseInt(e.target.value));
  });

  // 所有滑块和颜色选择器
  const controls = [
    'speedSlider', 'pathColor', 'dustColor', 'bgColor',
    'fogSlider', 'fogVolumeSlider', 'pathFogSlider',
    'dustFloatSlider', 'dustBreathSlider', 
    'fisheyeDistortionSlider', 'fisheyeCropSlider','fisheyeDispersionSlider','enableFisheye',
    'crtScanlinesSlider', 'crtVignetteSlider', 'crtNoiseSlider', 'enableCRT'
  ];

  controls.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    const displayId = id.replace('Slider', 'Display').replace('enable', '').toLowerCase();
    const display = document.getElementById(displayId + 'Display') || document.getElementById(id.replace('Slider', 'Display'));

    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', (e) => {
      const value = el.type === 'checkbox' ? el.checked : (el.type === 'color' ? el.value : parseFloat(el.value));
      
      if (display && el.type !== 'color' && el.type !== 'checkbox') {
        display.textContent = value;
      }
      
      updateSceneFromConfig();
    });
  });

    // 窗口调整
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    crtPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
  });

  // 初始化所有display值
  controls.forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.type === 'checkbox' || el.type === 'color') return;

    const display = document.getElementById(id.replace('Slider', 'Display'));
    if (display) {
      display.textContent = el.value;
    }
  });

  // 初始化配置
  updateSceneFromConfig();
}

// 主动画循环
function animate(time) {
  requestAnimationFrame(animate);

  // 动画更新
if (animating && mappedPoints.length > 1) {
  lerpT += speedFactor;

  if (lerpT >= 1.0) {
    lerpT = 0;
    currentStep++;

    if (currentStep >= mappedPoints.length - 1) {
      currentStep = mappedPoints.length - 1;
      animating = false;
      document.getElementById('playBtn').textContent = '播放';
    }

    updateStepDisplay();
  }

  // 插值更新标记点位置
  if (currentStep < mappedPoints.length - 1 && currentMarker) {
    const from = mappedPoints[currentStep];
    const to = mappedPoints[currentStep + 1];
    currentMarker.position.lerpVectors(from, to, lerpT);
  }

  // 实时更新轨迹线，让路径跟随光点
  lineGroup.clear();
  if (currentStep > 0 || lerpT > 0) {
    // 创建包含当前插值位置的路径点数组
    const pathPoints = [];
    
    // 添加已完成的路径点
    for (let i = 0; i <= currentStep; i++) {
      pathPoints.push(mappedPoints[i]);
    }
    
    // 添加当前光点的插值位置
    if (currentStep < mappedPoints.length - 1 && currentMarker) {
      pathPoints.push(currentMarker.position.clone());
    }
    
    if (pathPoints.length > 1) {
      const pathGeometry = new THREE.BufferGeometry().setFromPoints(pathPoints);
      progressLine = new THREE.Line(pathGeometry, progressMaterial);
      lineGroup.add(progressLine);
    }
  }
}


  // 更新粒子动画
  if (dustPoints && baseDustPositions) {
    const positions = dustPoints.geometry.attributes.position.array;
    const count = positions.length / 3;

    for (let i = 0; i < count; i++) {
      const baseX = baseDustPositions[i * 3];
      const baseY = baseDustPositions[i * 3 + 1];
      const baseZ = baseDustPositions[i * 3 + 2];

      // 浮动效果
      const floatX = Math.sin(time * 0.001 + i * 0.1) * dustFloatIntensity;
      const floatY = Math.cos(time * 0.0008 + i * 0.15) * dustFloatIntensity;
      const floatZ = Math.sin(time * 0.0012 + i * 0.08) * dustFloatIntensity;

      // 呼吸效果
      const breathScale = 1.0 + Math.sin(time * 0.002 + i * 0.05) * dustBreathIntensity;

      positions[i * 3] = (baseX + floatX) * fogVolumeScale * breathScale;
      positions[i * 3 + 1] = (baseY + floatY) * fogVolumeScale * breathScale;
      positions[i * 3 + 2] = (baseZ + floatZ) * fogVolumeScale * breathScale;
    }

    dustPoints.geometry.attributes.position.needsUpdate = true;
  }

  // 更新CRT时间uniform
  crtPass.uniforms.time.value = time * 0.001;

  // 更新控制器
  controls.update();

  // 渲染
  composer.render();
}

// 初始化应用
function init() {
  createUI();
  createDustParticles();
  setupEvents();
  loadCSVData();
  animate(0);
}

// 启动
init();
