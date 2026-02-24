import * as THREE from "https://unpkg.com/three@0.162.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.162.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://unpkg.com/three@0.162.0/examples/jsm/loaders/GLTFLoader.js";

const wrap = document.getElementById("canvasWrap");
const actionPanel = document.getElementById("actions");
const statusBox = document.getElementById("status");
const resultLinks = document.getElementById("resultLinks");
const actionReportBox = document.getElementById("actionReport");

const textPrompt = document.getElementById("textPrompt");
const imageInput = document.getElementById("imageInput");
const modelInput = document.getElementById("modelInput");
const runText = document.getElementById("runText");
const runImage = document.getElementById("runImage");
const runModel = document.getElementById("runModel");
const safeModeToggle = document.getElementById("safeModeToggle");
const actionPolicySelect = document.getElementById("actionPolicy");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(wrap.clientWidth, wrap.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
wrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0e1622");

const modelRoot = new THREE.Group();
scene.add(modelRoot);

const camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.1, 200);
camera.position.set(2.5, 1.8, 3.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.update();

scene.add(new THREE.HemisphereLight("#d9ecff", "#223", 1.0));
const dir = new THREE.DirectionalLight("#ffffff", 1.1);
dir.position.set(4, 6, 3);
scene.add(dir);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(6, 64),
  new THREE.MeshStandardMaterial({ color: "#1a3142", metalness: 0.1, roughness: 0.8 }),
);
ground.rotation.x = -Math.PI * 0.5;
ground.position.y = -0.01;
scene.add(ground);

const loader = new GLTFLoader();
const clock = new THREE.Clock();

let mixer = null;
let actions = [];
let actionIndex = 0;
let currentModel = null;
let currentFrameSize = null;
let currentFrameTarget = null;
let actionMeta = [];
let interactionResetTimer = null;

const SAFE_ACTION_KEYWORDS = ["preview", "idle", "wave", "wave_safe", "walk", "nod"];
const RISKY_ACTION_KEYWORDS = ["run", "jump", "attack", "kick", "punch", "dance"];

function computeFrameFromModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const target = box.getCenter(new THREE.Vector3());
  return { size, target };
}

function setStatus(message, mode = "idle") {
  statusBox.textContent = message;
  statusBox.className = "status";
  if (mode === "working") {
    statusBox.classList.add("working");
  }
  if (mode === "error") {
    statusBox.classList.add("error");
  }
}

function setBusyState(disabled) {
  [runText, runImage, runModel].forEach((button) => {
    button.disabled = disabled;
    button.style.opacity = disabled ? "0.7" : "1";
    button.style.cursor = disabled ? "not-allowed" : "pointer";
  });
}

function clearActions() {
  if (interactionResetTimer) {
    window.clearTimeout(interactionResetTimer);
    interactionResetTimer = null;
  }
  actions = [];
  actionMeta = [];
  actionIndex = 0;
  actionPanel.innerHTML = "";
  if (actionReportBox) {
    actionReportBox.textContent = "等待生成动作报告";
  }
}

function renderActionReport(report) {
  if (!actionReportBox) {
    return;
  }
  if (!Array.isArray(report) || !report.length) {
    actionReportBox.textContent = "本次没有返回动作报告";
    return;
  }

  const lines = report.map((item) => {
    const action = item.action || "unknown";
    const status = item.status === "kept" ? "保留" : "过滤";
    const source = item.source || "unknown";
    const reason = item.reason || "n/a";
    return `${status} | ${action} | ${source} | ${reason}`;
  });
  actionReportBox.innerHTML = lines.join("<br>");
}

async function fetchActionReportByModelUrl(modelUrl) {
  try {
    const filename = String(modelUrl || "").split("/").pop();
    if (!filename) {
      return;
    }
    const response = await fetch(`/reports/${filename}`);
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    renderActionReport(data.action_report || []);
  } catch (_error) {
  }
}

function playAction(index) {
  if (!actions.length || index < 0 || index >= actions.length) {
    return;
  }

  const buttons = [...actionPanel.querySelectorAll("button[data-action-index]")];
  buttons.forEach((button) => {
    const btnIndex = Number(button.dataset.actionIndex);
    button.classList.toggle("active", btnIndex === index);
  });

  actions.forEach((item, i) => {
    if (i === index) {
      item.reset().fadeIn(0.2).play();
    } else {
      item.fadeOut(0.2);
    }
  });
  actionIndex = index;
}

function pickDefaultIdleIndex() {
  if (!actionMeta.length) {
    return 0;
  }
  const preferred = ["00_idle_preview", "idle", "idle_static", "preview"];
  for (const keyword of preferred) {
    const found = actionMeta.find((item) =>
      normalizeActionName(item.name).toLowerCase().includes(keyword),
    );
    if (found) {
      return found.index;
    }
  }
  return actionMeta[0].index;
}

function pickInteractionIndex(visible) {
  const candidateNames = ["wave_safe", "wave", "nod", "greet", "hello"];
  for (const keyword of candidateNames) {
    const found = visible.find((idx) => {
      const item = actionMeta.find((meta) => meta.index === idx);
      return item && normalizeActionName(item.name).toLowerCase().includes(keyword);
    });
    if (typeof found === "number") {
      return found;
    }
  }
  return visible.find((idx) => idx !== pickDefaultIdleIndex()) ?? pickDefaultIdleIndex();
}

function playInteractionAction() {
  if (!actions.length) {
    return;
  }
  const visible = getVisibleActionIndices();
  if (!visible.length) {
    playAction(pickDefaultIdleIndex());
    return;
  }

  const interactionIndex = pickInteractionIndex(visible);
  const idleIndex = pickDefaultIdleIndex();
  playAction(interactionIndex);

  if (interactionResetTimer) {
    window.clearTimeout(interactionResetTimer);
  }
  if (interactionIndex !== idleIndex) {
    interactionResetTimer = window.setTimeout(() => {
      playAction(idleIndex);
      interactionResetTimer = null;
    }, 2200);
  }
}

function classifyActionTier(name) {
  const text = String(name || "").toLowerCase();
  if (SAFE_ACTION_KEYWORDS.some((kw) => text.includes(kw))) {
    return "safe";
  }
  if (RISKY_ACTION_KEYWORDS.some((kw) => text.includes(kw))) {
    return "risky";
  }
  return "risky";
}

function normalizeActionName(name) {
  return String(name || "").replace(/\.\d+$/, "");
}

function createActionButtons() {
  const safeOnly = safeModeToggle?.checked ?? true;
  const filtered = safeOnly ? actionMeta.filter((item) => item.tier === "safe") : actionMeta;
  const visible = filtered.length ? filtered : actionMeta;

  actionPanel.innerHTML = "";
  visible.forEach((item) => {
    const button = document.createElement("button");
    const displayName = normalizeActionName(item.name);
    button.textContent = item.tier === "risky" ? `${displayName} · 高风险` : displayName;
    button.dataset.actionIndex = String(item.index);
    button.addEventListener("click", () => playAction(item.index));
    actionPanel.appendChild(button);
  });

  const safeCount = actionMeta.filter((item) => item.tier === "safe").length;
  const riskyCount = actionMeta.filter((item) => item.tier === "risky").length;
  const visibleCount = visible.length;
  if (safeOnly) {
    if (riskyCount === 0) {
      setStatus(`模型加载成功，当前显示 ${visibleCount} 个安全动作；该模型暂无高风险动作`);
    } else {
      setStatus(`模型加载成功，当前显示 ${visibleCount} 个安全动作，隐藏高风险动作 ${riskyCount}`);
    }
  } else {
    if (riskyCount === 0) {
      setStatus(`模型加载成功，显示全部动作（当前仅有安全动作 ${safeCount}）`);
    } else {
      setStatus(`模型加载成功，显示全部动作（安全 ${safeCount} / 高风险 ${riskyCount}）`);
    }
  }
}

function getVisibleActionIndices() {
  const safeOnly = safeModeToggle?.checked ?? true;
  const filtered = safeOnly ? actionMeta.filter((item) => item.tier === "safe") : actionMeta;
  const visible = filtered.length ? filtered : actionMeta;
  return visible.map((item) => item.index);
}

function normalizeModelPlacement(model) {
  model.position.set(0, 0, 0);

  const initialBox = new THREE.Box3().setFromObject(model);
  const center = initialBox.getCenter(new THREE.Vector3());
  model.position.sub(center);

  const centeredBox = new THREE.Box3().setFromObject(model);
  model.position.y -= centeredBox.min.y;

  return computeFrameFromModel(model);
}

function computeFitDistance(size) {
  const fitOffset = 1.35;
  const radius = Math.max(size.length() * 0.5, 0.001);

  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const limitingFov = Math.max(0.1, Math.min(vFov, hFov));

  return (radius / Math.sin(limitingFov / 2)) * fitOffset;
}

function frameCamera(size, target) {
  const distance = computeFitDistance(size);
  const direction = new THREE.Vector3(1.0, 0.62, 1.15).normalize();
  const position = target.clone().add(direction.multiplyScalar(distance));

  camera.position.copy(position);
  camera.near = Math.max(distance / 200, 0.01);
  camera.far = Math.max(distance * 40, 100);
  camera.updateProjectionMatrix();

  controls.target.copy(target);
  controls.minDistance = Math.max(distance * 0.2, 0.05);
  controls.maxDistance = distance * 6;
  controls.update();
}

function updateGround(size) {
  const horizontal = Math.max(size.x, size.z, 0.001);
  const verticalRatio = size.y / horizontal;
  const compactModel = verticalRatio < 1.2;

  const radius = horizontal * (compactModel ? 2.2 : 1.5);
  const y = -size.y * (compactModel ? 0.3 : 0.04);

  ground.scale.setScalar(Math.max(radius / 6, 0.6));
  ground.position.y = y;
}

function updateViewportSize() {
  const width = Math.max(wrap.clientWidth, 1);
  const height = Math.max(wrap.clientHeight, 1);
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function loadModelIntoViewer(url, clipNames = []) {
  setStatus("正在加载模型到交互视图...", "working");
  clearActions();
  fetchActionReportByModelUrl(url);

  if (currentModel) {
    modelRoot.remove(currentModel);
    currentModel.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((mat) => mat.dispose());
        } else {
          obj.material?.dispose();
        }
      }
    });
    currentModel = null;
  }

  loader.load(url, (gltf) => {
    const model = gltf.scene;
    normalizeModelPlacement(model);
    modelRoot.add(model);
    currentModel = model;
    const frame = computeFrameFromModel(model);
    currentFrameSize = frame.size.clone();
    currentFrameTarget = frame.target.clone();
    frameCamera(currentFrameSize, currentFrameTarget);
    updateGround(currentFrameSize);

    mixer = new THREE.AnimationMixer(model);
    actions = gltf.animations.map((clip) => mixer.clipAction(clip));
    actionMeta = gltf.animations.map((clip, index) => ({
      index,
      name: clip.name,
      tier: classifyActionTier(normalizeActionName(clip.name)),
    }));

    if (gltf.animations.length) {
      createActionButtons();
      playAction(pickDefaultIdleIndex());
      return;
    }

    if (clipNames.length) {
      actionPanel.innerHTML = `<p class="help">接口返回动作：${clipNames.join(", ")}；当前模型无内嵌动画。</p>`;
    }
    setStatus("模型加载成功，但未检测到内嵌动画");
  }, undefined, (error) => {
    console.error(error);
    setStatus("模型加载失败，请检查返回模型地址", "error");
  });
}

function updateResultLinks(data) {
  resultLinks.innerHTML = "";
  const modelLink = document.createElement("a");
  modelLink.href = data.output_model_url;
  modelLink.target = "_blank";
  modelLink.textContent = `模型地址: ${data.output_model_url}`;

  const viewerLink = document.createElement("a");
  viewerLink.href = data.viewer_url;
  viewerLink.target = "_blank";
  viewerLink.textContent = `页面地址: ${data.viewer_url}`;

  resultLinks.appendChild(modelLink);
  resultLinks.appendChild(viewerLink);
}

async function submitTextPipeline() {
  const prompt = textPrompt.value.trim();
  if (!prompt) {
    setStatus("请先输入文字描述", "error");
    return;
  }

  const actionPolicy = actionPolicySelect?.value === "balanced" ? "balanced" : "strict";

  setBusyState(true);
  setStatus("文字流程处理中，请稍候...", "working");
  try {
    const response = await fetch("/pipeline/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, action_policy: actionPolicy }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "文字流程失败");
    }

    updateResultLinks(data);
    renderActionReport(data.action_report || []);
    loadModelIntoViewer(data.output_model_url, data.animations || []);
  } catch (error) {
    setStatus(`文字流程失败: ${error.message}`, "error");
  } finally {
    setBusyState(false);
  }
}

async function submitFilePipeline(endpoint, file, emptyTip) {
  if (!file) {
    setStatus(emptyTip, "error");
    return;
  }

  const actionPolicy = actionPolicySelect?.value === "balanced" ? "balanced" : "strict";

  setBusyState(true);
  setStatus("文件流程处理中，请稍候...", "working");
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("action_policy", actionPolicy);
    const response = await fetch(endpoint, {
      method: "POST",
      body: form,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "文件流程失败");
    }

    updateResultLinks(data);
    renderActionReport(data.action_report || []);
    loadModelIntoViewer(data.output_model_url, data.animations || []);
  } catch (error) {
    setStatus(`文件流程失败: ${error.message}`, "error");
  } finally {
    setBusyState(false);
  }
}

runText.addEventListener("click", submitTextPipeline);
runImage.addEventListener("click", () => submitFilePipeline("/pipeline/image", imageInput.files[0], "请先选择图片文件"));
runModel.addEventListener("click", () => submitFilePipeline("/pipeline/model", modelInput.files[0], "请先选择模型文件"));

safeModeToggle?.addEventListener("change", () => {
  if (!actionMeta.length) {
    return;
  }
  createActionButtons();
  playAction(pickDefaultIdleIndex());
});

renderer.domElement.addEventListener("click", () => {
  playInteractionAction();
});

const params = new URLSearchParams(window.location.search);
const initModel = params.get("model");
if (initModel) {
  loadModelIntoViewer(initModel);
}

window.addEventListener("resize", () => {
  updateViewportSize();
  if (currentModel) {
    const frame = computeFrameFromModel(currentModel);
    currentFrameSize = frame.size.clone();
    currentFrameTarget = frame.target.clone();
    frameCamera(currentFrameSize, currentFrameTarget);
    updateGround(currentFrameSize);
  }
});

function animate() {
  requestAnimationFrame(animate);
  if (mixer) {
    mixer.update(clock.getDelta());
  }
  renderer.render(scene, camera);
}

animate();
