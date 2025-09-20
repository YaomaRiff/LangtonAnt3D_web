import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FisheyeShader } from './shaders/FisheyeShader.js';
import { RetroCRTShader } from './shaders/RetroCRTShader.js';

// -------------------- 基础场景与渲染器 --------------------
const container = document.createElement('div');
container.id = 'three-container';
Object.assign(container.style, {
  position: 'fixed',
  inset: '0',
  overflow: 'hidden',
});
document.body.appendChild(container);

document.body.style.margin = '0';
document.body.style.background = '#000000';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// ------ 体积雾（加厚底部） ------
scene.fog = new THREE.FogExp2(0x111122, 0.015);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  5000
);
camera.position.set(5, 5, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
container.appendChild(renderer.domElement);

// controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.update();

// 更新OrbitControls配置
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,  // 中键平移
  RIGHT: THREE.MOUSE.ROTATE
};
controls.enablePan = true;
controls.panSpeed = 1.0;
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// 添加三视图控制变量
let isOrthographicView = false;
let perspectiveCamera = camera; // 保存透视相机
let orthographicCamera = null;
let currentView = 'perspective'; // 'perspective', 'front', 'left', 'top'

// 创建正交相机
function createOrthographicCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const frustumSize = 20;
  orthographicCamera = new THREE.OrthographicCamera(
    frustumSize * aspect / -2,
    frustumSize * aspect / 2,
    frustumSize / 2,
    frustumSize / -2,
    0.1,
    1000
  );
  return orthographicCamera;
}

createOrthographicCamera();


// -------------------- 灯光 --------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.18));
const pointLight = new THREE.PointLight(0x88aaff, 1.2, 0, 2);
pointLight.position.set(6, 6, 6);
scene.add(pointLight);

// -------------------- 后处理（Bloom + 鱼眼 + CRT） --------------------
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.5,
  0.8,
  0.0
);
composer.addPass(bloomPass);

// 添加鱼眼效果
const fisheyePass = new ShaderPass(FisheyeShader);
composer.addPass(fisheyePass);

// 添加CRT效果
const crtPass = new ShaderPass(RetroCRTShader);
crtPass.uniforms.resolution.value = new THREE.Vector2(window.innerWidth, window.innerHeight);
composer.addPass(crtPass);

// -------------------- 状态与对象 --------------------
let antData = [];
let mappedPoints = [];
let currentStep = 0;

const lineGroup = new THREE.Group();
scene.add(lineGroup);

let progressLine = null;
let currentMarker = null;

// 路径用受雾影响的shader材质（增强远近差异）
const lineVertexShader = `
  varying vec3 vViewPos;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const lineFragmentShader = `
  uniform vec3 uColor;
  uniform float uFogIntensity;
  varying vec3 vViewPos;
  
  void main() {
    float dist = length(vViewPos);
    float fogFactor = exp(-pow(dist * uFogIntensity, 1.5));
    fogFactor = clamp(fogFactor, 0.05, 1.0);
    
    gl_FragColor = vec4(uColor, fogFactor);
  }
`;

let progressMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(0x3399ff) },
    uFogIntensity: { value: 0.08 }
  },
  vertexShader: lineVertexShader,
  fragmentShader: lineFragmentShader,
  transparent: true
});

let markerMaterial = new THREE.MeshStandardMaterial({
  color: 0x3399ff,
  emissive: 0x3399ff,
  emissiveIntensity: 3.0,
  roughness: 0.2,
  metalness: 0.0
});

// 动画控制参数
let animating = false;
let lerpT = 0;
let speedFactor = 0.01;
let segmentIndex = 0;

// 体积雾和粒子控制参数
let fogVolumeScale = 1.0;
let baseDustPositions = null;
let dustFloatIntensity = 0.5;
let dustBreathIntensity = 0.2;

// 配置对象（添加滤镜参数）
const config = {
  speed: 60,
  pathColor: '#F0B7B7',
  dustColor: '#AF85B7',
  bgColor: '##171B1C',
  fogDensity: 15,
  fogVolume: 1.0,
  pathFogIntensity: 10,
  dustFloatIntensity: 50,
  dustBreathIntensity: 20,
  // 新增滤镜参数
  fisheyeDistortion: 100,
  fisheyeDispersion: 33,
  crtScanlines: 73,
  crtVignette: 92,
  crtNoise: 11,
  crtCurvature: 50,
  enableFisheye: true,
  enableCRT: true,
  currentView: 'perspective'
};

// -------------------- 配置保存/加载 --------------------
function saveConfig() {
  const currentConfig = {
    speed: parseInt(document.getElementById('speedSlider').value),
    pathColor: document.getElementById('pathColor').value,
    dustColor: document.getElementById('dustColor').value,
    bgColor: document.getElementById('bgColor').value,
    fogDensity: parseInt(document.getElementById('fogSlider').value),
    fogVolume: parseFloat(document.getElementById('fogVolumeSlider').value),
    pathFogIntensity: parseInt(document.getElementById('pathFogSlider').value),
    dustFloatIntensity: parseInt(document.getElementById('dustFloatSlider').value),
    dustBreathIntensity: parseInt(document.getElementById('dustBreathSlider').value),
    // 新增滤镜配置
    fisheyeDistortion: parseInt(document.getElementById('fisheyeDistortionSlider').value),
    fisheyeDispersion: parseInt(document.getElementById('fisheyeDispersionSlider').value),
    crtScanlines: parseInt(document.getElementById('crtScanlinesSlider').value),
    crtVignette: parseInt(document.getElementById('crtVignetteSlider').value),
    crtNoise: parseInt(document.getElementById('crtNoiseSlider').value),
    crtCurvature: parseInt(document.getElementById('crtCurvatureSlider').value),
    enableFisheye: document.getElementById('enableFisheye').checked,
    enableCRT: document.getElementById('enableCRT').checked,
    currentView: currentView
  };
  
  localStorage.setItem('ant3d_config', JSON.stringify(currentConfig));
  
  const saveBtn = document.getElementById('saveBtn');
  const originalText = saveBtn.textContent;
  saveBtn.textContent = '已保存!';
  saveBtn.style.background = '#4CAF50';
  setTimeout(() => {
    saveBtn.textContent = originalText;
    saveBtn.style.background = '';
  }, 1000);
}

function loadConfig() {
  try {
    const savedConfig = localStorage.getItem('ant3d_config');
    if (savedConfig) {
      const cfg = JSON.parse(savedConfig);
      Object.assign(config, cfg);
      applyConfig();
    }
  } catch (e) {
    console.warn('Failed to load config:', e);
  }
}

function applyConfig() {
  // 应用基础配置
  document.getElementById('speedSlider').value = config.speed;
  document.getElementById('speedDisplay').textContent = config.speed;
  speedFactor = config.speed * 0.002;
  
  document.getElementById('pathColor').value = config.pathColor;
  document.getElementById('dustColor').value = config.dustColor;
  document.getElementById('bgColor').value = config.bgColor;
  
  document.getElementById('fogSlider').value = config.fogDensity;
  document.getElementById('fogVolumeSlider').value = config.fogVolume;
  document.getElementById('fogVolumeDisplay').textContent = config.fogVolume.toFixed(1);
  
  document.getElementById('pathFogSlider').value = config.pathFogIntensity;
  document.getElementById('pathFogDisplay').textContent = config.pathFogIntensity;
  
  document.getElementById('dustFloatSlider').value = config.dustFloatIntensity;
  document.getElementById('dustFloatDisplay').textContent = config.dustFloatIntensity;
  
  document.getElementById('dustBreathSlider').value = config.dustBreathIntensity;
  document.getElementById('dustBreathDisplay').textContent = config.dustBreathIntensity;
  
  // 应用滤镜配置
  document.getElementById('fisheyeDistortionSlider').value = config.fisheyeDistortion;
  document.getElementById('fisheyeDistortionDisplay').textContent = config.fisheyeDistortion;
  
  document.getElementById('fisheyeDispersionSlider').value = config.fisheyeDispersion;
  document.getElementById('fisheyeDispersionDisplay').textContent = config.fisheyeDispersion;
  
  document.getElementById('crtScanlinesSlider').value = config.crtScanlines;
  document.getElementById('crtScanlinesDisplay').textContent = config.crtScanlines;
  
  document.getElementById('crtVignetteSlider').value = config.crtVignette;
  document.getElementById('crtVignetteDisplay').textContent = config.crtVignette;
  
  document.getElementById('crtNoiseSlider').value = config.crtNoise;
  document.getElementById('crtNoiseDisplay').textContent = config.crtNoise;
  
  document.getElementById('crtCurvatureSlider').value = config.crtCurvature;
  document.getElementById('crtCurvatureDisplay').textContent = config.crtCurvature;
  
  document.getElementById('enableFisheye').checked = config.enableFisheye;
  document.getElementById('enableCRT').checked = config.enableCRT;
  
  // 应用颜色和效果
  const pathC = new THREE.Color(config.pathColor);
  progressMaterial.uniforms.uColor.value.copy(pathC);
  markerMaterial.color.copy(pathC);
  markerMaterial.emissive.copy(pathC);
  
  if (dustPoints) dustPoints.material.color.set(config.dustColor);
  
  scene.background.set(config.bgColor);
  scene.fog.color.set(config.bgColor);
  scene.fog.density = config.fogDensity / 1000;
  
  fogVolumeScale = config.fogVolume;
  progressMaterial.uniforms.uFogIntensity.value = config.pathFogIntensity / 500;
  dustFloatIntensity = config.dustFloatIntensity / 100;
  dustBreathIntensity = config.dustBreathIntensity / 100;
  
  // 应用滤镜效果
  fisheyePass.uniforms.distortion.value = config.fisheyeDistortion / 100;
  fisheyePass.uniforms.dispersion.value = config.fisheyeDispersion;
  
  crtPass.uniforms.scanlineIntensity.value = config.crtScanlines / 100;
  crtPass.uniforms.vignetteIntensity.value = config.crtVignette / 100;
  crtPass.uniforms.noiseIntensity.value = config.crtNoise / 100;
  crtPass.uniforms.curvature.value = config.crtCurvature / 100;
  
  fisheyePass.enabled = config.enableFisheye;
  crtPass.enabled = config.enableCRT;
  
  updateDustVolume();

  // 应用视图配置
if (config.currentView && mappedPoints.length > 0) {
  setTimeout(() => {
    switchToView(config.currentView);
  }, 100);
}
}

// -------------------- UI 控件（扩展） --------------------
function createControls() {
  const controlPanel = document.createElement('div');
  controlPanel.style.position = 'absolute';
  controlPanel.style.top = '20px';
  controlPanel.style.left = '20px';
  controlPanel.style.background = 'rgba(0,0,0,0.7)';
  controlPanel.style.color = 'white';
  controlPanel.style.padding = '15px';
  controlPanel.style.borderRadius = '8px';
  controlPanel.style.fontFamily = 'Arial, sans-serif';
  controlPanel.style.fontSize = '12px';
  controlPanel.style.zIndex = '10';
  controlPanel.style.minWidth = '350px';
  controlPanel.style.maxHeight = '90vh';
  controlPanel.style.overflowY = 'auto';

  controlPanel.innerHTML = `
    <div id="info">等待加载数据...</div>
    <br>
    <button id="playBtn">播放</button>
    <button id="pauseBtn">暂停</button>
    <button id="resetBtn">重置</button>
    <button id="saveBtn" style="margin-left:10px;">保存配置</button>
    <br><br>

    <!-- 视图控制 -->
    <div style="border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 10px;">
      <strong>视图控制</strong><br>
      <div style="margin: 5px 0;">
        当前: <span id="currentViewDisplay">透视视图</span>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 5px; margin: 5px 0;">
        <button id="perspectiveViewBtn" style="padding: 4px 8px; font-size: 11px;">透视</button>
        <button id="orthographicViewBtn" style="padding: 4px 8px; font-size: 11px;">正交</button>
        <button id="frontViewBtn" style="padding: 4px 8px; font-size: 11px;">前视图</button>
        <button id="leftViewBtn" style="padding: 4px 8px; font-size: 11px;">左视图</button>
        <button id="topViewBtn" style="padding: 4px 8px; font-size: 11px;">顶视图</button>
        <button id="flipViewBtn" style="padding: 4px 8px; font-size: 11px;">翻转</button>
      </div>
      <div style="margin: 5px 0; font-size: 11px; color: #aaa;">
        提示: 中键拖拽平移视角
      </div>
    </div>
    
    <!-- 动画控制 -->
    <div style="border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 10px;">
      <strong>动画控制</strong><br>
      <label>进度: </label>
      <input type="range" id="stepSlider" min="0" max="0" value="0" style="width: 200px;">
      <span id="stepDisplay">0/0</span><br>
      <label>速度: </label>
      <input type="range" id="speedSlider" min="1" max="60" value="15" style="width: 160px;">
      <span id="speedDisplay">15</span>
    </div>
    
    <!-- 颜色控制 -->
    <div style="border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 10px;">
      <strong>颜色设置</strong><br>
      <label>路径+光点颜色:</label>
      <input type="color" id="pathColor" value="#3399ff"><br>
      <label>背景粒子颜色:</label>
      <input type="color" id="dustColor" value="#88aaff"><br>
      <label>背景颜色:</label>
      <input type="color" id="bgColor" value="#000011">
    </div>
    
    <!-- 雾效控制 -->
    <div style="border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 10px;">
      <strong>雾效设置</strong><br>
      <label>雾密度: </label>
      <input type="range" id="fogSlider" min="5" max="50" value="${Math.round(scene.fog.density * 1000)}" style="width: 160px;"><br>
      <label>雾体积大小: </label>
      <input type="range" id="fogVolumeSlider" min="0.5" max="3.0" step="0.1" value="1.0" style="width: 160px;">
      <span id="fogVolumeDisplay">1.0</span><br>
      <label>路径雾化强度: </label>
      <input type="range" id="pathFogSlider" min="0" max="200" value="80" style="width: 160px;">
      <span id="pathFogDisplay">80</span>
    </div>
    
    <!-- 粒子控制 -->
    <div style="border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 10px;">
      <strong>粒子效果</strong><br>
      <label>粒子浮动强度: </label>
      <input type="range" id="dustFloatSlider" min="0" max="100" value="50" style="width: 160px;">
      <span id="dustFloatDisplay">50</span><br>
      <label>粒子呼吸强度: </label>
      <input type="range" id="dustBreathSlider" min="0" max="100" value="20" style="width: 160px;">
      <span id="dustBreathDisplay">20</span>
    </div>
    
    <!-- 鱼眼滤镜 -->
    <div style="border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 10px;">
      <strong>鱼眼滤镜</strong><br>
      <label><input type="checkbox" id="enableFisheye" checked> 启用鱼眼效果</label><br>
      <label>畸变强度: </label>
      <input type="range" id="fisheyeDistortionSlider" min="0" max="100" value="30" style="width: 160px;">
      <span id="fisheyeDistortionDisplay">30</span><br>
      <label>色散强度: </label>
      <input type="range" id="fisheyeDispersionSlider" min="0" max="50" value="0" style="width: 160px;">
      <span id="fisheyeDispersionDisplay">0</span>
    </div>
    
    <!-- CRT滤镜 -->
    <div style="border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 10px;">
      <strong>CRT复古滤镜</strong><br>
      <label><input type="checkbox" id="enableCRT" checked> 启用CRT效果</label><br>
      <label>扫描线强度: </label>
      <input type="range" id="crtScanlinesSlider" min="0" max="100" value="80" style="width: 160px;">
      <span id="crtScanlinesDisplay">80</span><br>
      <label>暗角强度: </label>
      <input type="range" id="crtVignetteSlider" min="0" max="100" value="30" style="width: 160px;">
      <span id="crtVignetteDisplay">30</span><br>
      <label>噪点强度: </label>
      <input type="range" id="crtNoiseSlider" min="0" max="50" value="10" style="width: 160px;">
      <span id="crtNoiseDisplay">10</span><br>
      <label>屏幕弯曲: </label>
      <input type="range" id="crtCurvatureSlider" min="0" max="50" value="10" style="width: 160px;">
      <span id="crtCurvatureDisplay">10</span>
    </div>
    
    <!-- 文件加载 -->
    <input type="file" id="csvFile" accept=".csv" style="margin-top: 6px;">
  `;

  document.body.appendChild(controlPanel);

  // 基础控制事件
  document.getElementById('playBtn').addEventListener('click', () => {
    animating = true;
  });
  document.getElementById('pauseBtn').addEventListener('click', () => {
    animating = false;
  });
  document.getElementById('resetBtn').addEventListener('click', resetAnimation);
  document.getElementById('saveBtn').addEventListener('click', saveConfig);

  // 进度条控制
  document.getElementById('stepSlider').addEventListener('input', (e) => {
    const targetStep = parseInt(e.target.value, 10);
    jumpToStep(targetStep);
  });

  // 速度控制
  document.getElementById('speedSlider').addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('speedDisplay').textContent = val;
    speedFactor = val * 0.002;
  });

  // 颜色控制
  document.getElementById('pathColor').addEventListener('input', (e) => {
    const c = new THREE.Color(e.target.value);
    progressMaterial.uniforms.uColor.value.copy(c);
    markerMaterial.color.copy(c);
    markerMaterial.emissive.copy(c);
  });

  document.getElementById('dustColor').addEventListener('input', (e) => {
    if (dustPoints) dustPoints.material.color.set(e.target.value);
  });

  document.getElementById('bgColor').addEventListener('input', (e) => {
    scene.background.set(e.target.value);
    scene.fog.color.set(e.target.value);
  });

  // 雾效控制
  document.getElementById('fogSlider').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    scene.fog.density = v / 1000;
  });

  document.getElementById('fogVolumeSlider').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    document.getElementById('fogVolumeDisplay').textContent = v.toFixed(1);
    fogVolumeScale = v;
    updateDustVolume();
  });

  document.getElementById('pathFogSlider').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    document.getElementById('pathFogDisplay').textContent = v;
    progressMaterial.uniforms.uFogIntensity.value = v / 500;
  });

  // 粒子控制
  document.getElementById('dustFloatSlider').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    document.getElementById('dustFloatDisplay').textContent = v;
    dustFloatIntensity = v / 100;
  });

  document.getElementById('dustBreathSlider').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    document.getElementById('dustBreathDisplay').textContent = v;
    dustBreathIntensity = v / 100;
  });

  // 鱼眼滤镜控制
  document.getElementById('enableFisheye').addEventListener('change', (e) => {
    fisheyePass.enabled = e.target.checked;
  });

  document.getElementById('fisheyeDistortionSlider').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    document.getElementById('fisheyeDistortionDisplay').textContent = v;
    fisheyePass.uniforms.distortion.value = v / 100;
  });

  document.getElementById('fisheyeDispersionSlider').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    document.getElementById('fisheyeDispersionDisplay').textContent = v;
    fisheyePass.uniforms.dispersion.value = v;
  });

  // CRT滤镜控制
  document.getElementById('enableCRT').addEventListener('change', (e) => {
    crtPass.enabled = e.target.checked;
  });

  document.getElementById('crtScanlinesSlider').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    document.getElementById('crtScanlinesDisplay').textContent = v;
    crtPass.uniforms.scanlineIntensity.value = v / 100;
  });

  document.getElementById('crtVignetteSlider').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    document.getElementById('crtVignetteDisplay').textContent = v;
    crtPass.uniforms.vignetteIntensity.value = v / 100;
  });

  document.getElementById('crtNoiseSlider').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    document.getElementById('crtNoiseDisplay').textContent = v;
    crtPass.uniforms.noiseIntensity.value = v / 100;
  });

  document.getElementById('crtCurvatureSlider').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    document.getElementById('crtCurvatureDisplay').textContent = v;
    crtPass.uniforms.curvature.value = v / 100;
  });

  // 视图控制事件
document.getElementById('perspectiveViewBtn').addEventListener('click', () => {
  switchToView('perspective');
});

document.getElementById('orthographicViewBtn').addEventListener('click', () => {
  switchToView('orthographic');
});

document.getElementById('frontViewBtn').addEventListener('click', () => {
  switchToView('front');
});

document.getElementById('leftViewBtn').addEventListener('click', () => {
  switchToView('left');
});

document.getElementById('topViewBtn').addEventListener('click', () => {
  switchToView('top');
});

document.getElementById('flipViewBtn').addEventListener('click', () => {
  switchToView('flip');
});

  // 文件加载事件
  document.getElementById('csvFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        parseCSVTextAndBuild(String(event.target.result));
      };
      reader.readAsText(file);
    }
  });
}

createControls();

// 三视图控制函数
function switchToView(viewType) {
  if (!mappedPoints.length) return;

  const box = new THREE.Box3().setFromPoints(mappedPoints);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);

  currentView = viewType;
  
  switch(viewType) {
    case 'perspective':
      camera = perspectiveCamera;
      isOrthographicView = false;
      controls.object = camera;
      // 关键修复：更新后处理器的相机引用
      renderPass.camera = camera;
      fitCameraToPoints(mappedPoints);
      break;

    case 'orthographic':
      camera = orthographicCamera;
      isOrthographicView = true;
      controls.object = camera;

      // 关键修复：更新后处理器的相机引用
      renderPass.camera = camera;
  
      // 保持当前视角，只切换到正交投影
      const orthographicPos = perspectiveCamera.position.clone();
      const orthographicTarget = controls.target.clone();
  
      camera.position.copy(orthographicPos);
      camera.lookAt(orthographicTarget);
      camera.up.copy(perspectiveCamera.up);
  
      // 调整正交相机视野
      const orthographicDistance = orthographicPos.distanceTo(orthographicTarget);
      const orthographicAspect = window.innerWidth / window.innerHeight;
      const orthographicFrustumSize = orthographicDistance * 0.8;
      camera.left = orthographicFrustumSize * orthographicAspect / -2;
      camera.right = orthographicFrustumSize * orthographicAspect / 2;
      camera.top = orthographicFrustumSize / 2;
      camera.bottom = orthographicFrustumSize / -2;
      camera.updateProjectionMatrix();
      break;
      
    case 'front':
      camera = orthographicCamera;
      isOrthographicView = true;
      controls.object = camera;

      // 关键修复：更新后处理器的相机引用
      renderPass.camera = camera;
      
      camera.position.set(center.x, center.y, center.z + maxSize * 2);
      camera.lookAt(center);
      camera.up.set(0, 1, 0);
      
      const frontAspect = window.innerWidth / window.innerHeight;
      const frontFrustumSize = maxSize * 1.5;
      camera.left = frontFrustumSize * frontAspect / -2;
      camera.right = frontFrustumSize * frontAspect / 2;
      camera.top = frontFrustumSize / 2;
      camera.bottom = frontFrustumSize / -2;
      camera.updateProjectionMatrix();
      break;
      
    case 'left':
      camera = orthographicCamera;
      isOrthographicView = true;
      controls.object = camera;

      // 关键修复：更新后处理器的相机引用
      renderPass.camera = camera;
      
      camera.position.set(center.x - maxSize * 2, center.y, center.z);
      camera.lookAt(center);
      camera.up.set(0, 1, 0);
      
      const leftAspect = window.innerWidth / window.innerHeight;
      const leftFrustumSize = maxSize * 1.5;
      camera.left = leftFrustumSize * leftAspect / -2;
      camera.right = leftFrustumSize * leftAspect / 2;
      camera.top = leftFrustumSize / 2;
      camera.bottom = leftFrustumSize / -2;
      camera.updateProjectionMatrix();
      break;
      
    case 'top':
      camera = orthographicCamera;
      isOrthographicView = true;
      controls.object = camera;

      // 关键修复：更新后处理器的相机引用
      renderPass.camera = camera;
      
      camera.position.set(center.x, center.y + maxSize * 2, center.z);
      camera.lookAt(center);
      camera.up.set(0, 0, -1);
      
      const topAspect = window.innerWidth / window.innerHeight;
      const topFrustumSize = maxSize * 1.5;
      camera.left = topFrustumSize * topAspect / -2;
      camera.right = topFrustumSize * topAspect / 2;
      camera.top = topFrustumSize / 2;
      camera.bottom = topFrustumSize / -2;
      camera.updateProjectionMatrix();
      break;
      
    case 'flip':
      const flipCurrentPos = camera.position.clone();
      const targetPos = center.clone().multiplyScalar(2).sub(flipCurrentPos);
      camera.position.copy(targetPos);
      camera.lookAt(center);
      break;
  }
  
  controls.target.copy(center);
  controls.update();
  updateViewDisplay(viewType);
}


function updateViewDisplay(viewType) {
  const viewNames = {
    'perspective': '透视视图',
    'orthographic': '正交视图',
    'front': '前视图', 
    'left': '左视图',
    'top': '顶视图'
  };
  
  const viewDisplay = document.getElementById('currentViewDisplay');
  if (viewDisplay) {
    viewDisplay.textContent = viewNames[viewType] || '当前视图';
  }
}

// 更新粒子体积分布
function updateDustVolume() {
  if (!dustPoints || !baseDustPositions) return;

  const positions = dustPoints.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const baseX = baseDustPositions[i * 3];
    const baseY = baseDustPositions[i * 3 + 1];
    const baseZ = baseDustPositions[i * 3 + 2];

    positions.setX(i, baseX * fogVolumeScale);
    positions.setY(i, baseY * fogVolumeScale);
    positions.setZ(i, baseZ * fogVolumeScale);
  }
  positions.needsUpdate = true;
}

// 跳转到指定步数
function jumpToStep(targetStep) {
  if (!mappedPoints.length) return;

  currentStep = Math.max(0, Math.min(targetStep, mappedPoints.length - 1));
  segmentIndex = Math.min(currentStep, mappedPoints.length - 2);
  lerpT = currentStep > segmentIndex ? 1 : 0;

  // 更新光点位置
  if (currentMarker) {
    currentMarker.position.copy(mappedPoints[currentStep]);
  }

  // 更新路径
  updateProgressLineToStep(currentStep);

  // 更新UI
  document.getElementById('stepSlider').value = currentStep;
  document.getElementById('stepDisplay').textContent = `${currentStep}/${mappedPoints.length - 1}`;
}

function updateProgressLineToStep(step) {
  if (!progressLine || !mappedPoints.length) return;

  const pts = mappedPoints.slice(0, step + 1);
  if (pts.length < 2) pts.push(pts[0]);

  progressLine.geometry.dispose();
  progressLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
}

// -------------------- CSV 加载与解析 --------------------
async function loadCSVData() {
  try {
    const response = await fetch('./data.csv?ts=' + Date.now());
    const csvText = await response.text();
    parseCSVTextAndBuild(csvText);
  } catch {
    updateInfo('未找到 data.csv，使用示例数据');
    const sample = `step,x,y,z
0,0,0,0
1,1,0,0
2,1,1,0
3,1,1,1
4,2,1,1
5,2,2,1
6,3,2,1
7,4,2,2
8,5,3,2`;
    parseCSVTextAndBuild(sample);
  }
}

function parseCSVTextAndBuild(csvText) {
  const lines = csvText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const firstCols = lines[0].split(',');
  const hasHeader = firstCols.some(c => /[A-Za-z]/.test(c));
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const out = [];
  for (let i = 0; i < dataLines.length; i++) {
    const parts = dataLines[i].split(',').map(p => p.trim());
    if (parts.length >= 3) {
      if (parts.length === 3) {
        out.push({ step: i, x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) });
      } else {
        out.push({ step: Number(parts[0]), x: Number(parts[1]), y: Number(parts[2]), z: Number(parts[3]) });
      }
    }
  }

  antData = out.filter(r => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z));
  updateInfo(`解析完成，共 ${antData.length} 条记录`);
  buildVisuals();
  resetAnimation();
}

// -------------------- 构建视觉内容 --------------------
function buildVisuals() {
  disposeGroup(lineGroup);
  if (currentMarker) {
    disposeObject(currentMarker);
    currentMarker = null;
  }

  if (!antData || antData.length === 0) return;

  mappedPoints = antData.map(d => new THREE.Vector3(d.x, d.y, d.z));

  const p0 = mappedPoints[0];
  const placeholder = [p0.clone(), p0.clone()];
  let progressGeom = new THREE.BufferGeometry().setFromPoints(placeholder);
  progressLine = new THREE.Line(progressGeom, progressMaterial);
  lineGroup.add(progressLine);

  const markerGeom = new THREE.SphereGeometry(0.2, 16, 16);
  currentMarker = new THREE.Mesh(markerGeom, markerMaterial);
  scene.add(currentMarker);

  // 更新UI最大值
  document.getElementById('stepSlider').max = mappedPoints.length - 1;
  document.getElementById('stepDisplay').textContent = `0/${mappedPoints.length - 1}`;

  fitCameraToPoints(mappedPoints);
}

// -------------------- 动画控制 --------------------
function resetAnimation() {
  animating = false;
  segmentIndex = 0;
  lerpT = 0;
  currentStep = 0;

  if (mappedPoints.length > 0 && currentMarker) {
    currentMarker.position.copy(mappedPoints[0]);
    updateProgressLineToStep(0);
  }

  document.getElementById('stepSlider').value = 0;
  document.getElementById('stepDisplay').textContent = `0/${Math.max(0, mappedPoints.length - 1)}`;
}

// -------------------- 粒子系统 --------------------
let dustPoints = null;

function makeParticleTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}

function createDustParticles(options = {}) {
  const particleCount = options.count ?? 1200;
  const spread = options.spread ?? 200;

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const phases = new Float32Array(particleCount);
  const scales = new Float32Array(particleCount);

  // 存储基础位置用于体积缩放
  baseDustPositions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    const baseX = (Math.random() - 0.5) * spread;
    const baseY = (Math.random() - 0.5) * spread * 0.6;
    const baseZ = (Math.random() - 0.5) * spread;

    baseDustPositions[i*3] = baseX;
    baseDustPositions[i*3 + 1] = baseY;
    baseDustPositions[i*3 + 2] = baseZ;

    positions[i*3] = baseX;
    positions[i*3 + 1] = baseY;
    positions[i*3 + 2] = baseZ;

    phases[i] = Math.random() * Math.PI * 2;
    scales[i] = 0.8 + Math.random() * 0.4;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('scale', new THREE.BufferAttribute(scales, 1));

  const material = new THREE.PointsMaterial({
    size: 1.2,
    map: makeParticleTexture(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.2,
    sizeAttenuation: true,
    color: 0x88aaff
  });

  dustPoints = new THREE.Points(geometry, material);
  dustPoints.frustumCulled = false;
  scene.add(dustPoints);
}

createDustParticles();

// -------------------- 资源释放 --------------------
function disposeGroup(g) {
  if (!g) return;
  while (g.children.length) {
    const c = g.children[0];
    disposeObject(c);
    g.remove(c);
  }
}

function disposeObject(o) {
  try {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) {
        o.material.forEach(m => m.dispose && m.dispose());
      } else {
        o.material.dispose && o.material.dispose();
      }
    }
    if (o.parent) o.parent.remove(o);
  } catch {}
}

// -------------------- 相机自适应 --------------------
function fitCameraToPoints(points) {
  const box = new THREE.Box3().setFromPoints(points);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z) || 1;

  // 只对透视相机进行自适应调整
  if (camera.isPerspectiveCamera) {
    const fov = camera.fov * (Math.PI / 180);
    let distance = Math.abs(maxSize / (2 * Math.tan(fov / 2)));
    if (!isFinite(distance)) distance = 5;
    distance *= 1.2;

    const dir = new THREE.Vector3(1, 1, 1).normalize();
    camera.position.copy(center).add(dir.multiplyScalar(distance));
    camera.near = Math.max(0.01, distance / 100);
    camera.far = Math.max(200, distance * 100);
    camera.updateProjectionMatrix();
  }
  
  controls.target.copy(center);
  controls.update();
}


// -------------------- UI 帮助 --------------------
function updateInfo(text) {
  const el = document.getElementById('info');
  if (el) el.textContent = text;
}

// -------------------- 窗口调整 --------------------
window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  
  // 更新当前活动的相机
  if (camera.isPerspectiveCamera) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  } else if (camera.isOrthographicCamera) {
    const frustumSize = 20;
    camera.left = frustumSize * aspect / -2;
    camera.right = frustumSize * aspect / 2;
    camera.top = frustumSize / 2;
    camera.bottom = frustumSize / -2;
    camera.updateProjectionMatrix();
  }
  
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  crtPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
});


// -------------------- 渲染循环 --------------------
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  const time = performance.now() * 0.001;

  // 更新后处理时间uniforms
  fisheyePass.uniforms.time.value = time;
  crtPass.uniforms.time.value = time;

  // 流畅匀速动画
  if (animating && mappedPoints.length > 1) {
    lerpT += speedFactor;

    while (lerpT >= 1.0 && segmentIndex < mappedPoints.length - 2) {
      lerpT -= 1.0;
      segmentIndex++;
    }

    if (segmentIndex >= mappedPoints.length - 2) {
      if (lerpT >= 1.0) {
        animating = false;
        lerpT = 1.0;
      }
    }

    const p0 = mappedPoints[segmentIndex];
    const p1 = mappedPoints[Math.min(segmentIndex + 1, mappedPoints.length - 1)];
    const pos = new THREE.Vector3().lerpVectors(p0, p1, lerpT);

    if (currentMarker) {
      currentMarker.position.copy(pos);
    }

    // 更新轨迹线
    const pts = mappedPoints.slice(0, segmentIndex + 1);
    pts.push(pos.clone());
    if (progressLine) {
      progressLine.geometry.dispose();
      progressLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }

    // 更新进度条
    const currentProgress = segmentIndex + lerpT;
    document.getElementById('stepSlider').value = Math.floor(currentProgress);
    document.getElementById('stepDisplay').textContent = `${Math.floor(currentProgress)}/${mappedPoints.length - 1}`;
  }

  // 光点呼吸
  if (currentMarker) {
    const s = 1 + 0.05 * Math.sin(time * 6);
    currentMarker.scale.set(s, s, s);
  }

  // 背景粒子浮动和呼吸效果
  if (dustPoints && baseDustPositions) {
    const positions = dustPoints.geometry.attributes.position;
    const phases = dustPoints.geometry.attributes.phase;

    for (let i = 0; i < positions.count; i++) {
      const baseX = baseDustPositions[i * 3] * fogVolumeScale;
      const baseY = baseDustPositions[i * 3 + 1] * fogVolumeScale;
      const baseZ = baseDustPositions[i * 3 + 2] * fogVolumeScale;
      const phase = phases.getX(i);

      // 浮动效果
      const floatX = baseX + dustFloatIntensity * 2 * Math.sin(time * 0.3 + phase);
      const floatY = baseY + dustFloatIntensity * 3 * Math.sin(time * 0.4 + phase * 1.3);
      const floatZ = baseZ + dustFloatIntensity * 2 * Math.cos(time * 0.5 + phase * 0.8);

      positions.setX(i, floatX);
      positions.setY(i, floatY);
      positions.setZ(i, floatZ);
    }
    positions.needsUpdate = true;

    // 粒子呼吸效果
    const breathScale = 1.0 + dustBreathIntensity * 0.3 * Math.sin(time * 2.0);
    dustPoints.material.size = 1.2 * breathScale;
  }

  composer.render();
}

// -------------------- 初始化启动 --------------------
loadConfig();
loadCSVData();
animate();

//:)