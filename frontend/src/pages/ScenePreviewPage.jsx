/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import ShellLayout from "../components/ShellLayout";
import Experience from "../components/avatar/Experience";
import { MARKER_ORDER, useFlow } from "../context/FlowContext";
import { generateSceneBackground, listSceneLibrary, polishSceneText, transcribeSpeech } from "../lib/api";
import { API_BASE, toAbsoluteUrl } from "../lib/config";
import { useSpeechInput } from "../hooks/useSpeechInput";

function normalizeSceneUrl(value) {
  if (!value) return "";
  if (/^(data:|blob:)/i.test(value)) return value;
  if (String(value).startsWith(`${API_BASE}/scenes/proxy-image?`)) return value;
  if (/^https?:\/\//i.test(value)) {
    return `${API_BASE}/scenes/proxy-image?url=${encodeURIComponent(value)}`;
  }
  return toAbsoluteUrl(value);
}

export default function ScenePreviewPage() {
  const navigate = useNavigate();
  const {
    modelResult,
    presetName,
    sceneBackgroundUrl,
    setSceneBackgroundUrl,
    sceneAvatarPosition,
    setSceneAvatarPosition,
    sceneCamera,
    setSceneCamera,
    sceneLight,
    setSceneLight,
    markers,
    modelId,
  } = useFlow();

  const [q, setQ] = useState("办公室");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("请选择一个场景背景，再进入展示页面。");
  const [items, setItems] = useState([]);
  const [customItems, setCustomItems] = useState([]);
  const [selectedUrl, setSelectedUrl] = useState(sceneBackgroundUrl || "");
  const [bgPrompt, setBgPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [polishing, setPolishing] = useState(false);

  const { speechSupported, listening, toggleSpeechInput } = useSpeechInput({
    lang: "zh-CN",
    onText: (text) => setBgPrompt(text),
    onStatus: (text) => setStatus(text),
    onFallbackTranscribe: async (audioBlob) => {
      const file = new File([audioBlob], `speech_scene_${Date.now()}.webm`, { type: "audio/webm" });
      const data = await transcribeSpeech(file);
      return String(data.text || "").trim();
    },
    startHint: "正在聆听，请说出背景描述...",
    doneHint: "语音已识别并填入背景描述。可继续润色或直接生成。",
  });

  const previewUrl = useMemo(() => normalizeSceneUrl(selectedUrl), [selectedUrl]);

  useEffect(() => {
    let mounted = true;
    async function run() {
      setLoading(true);
      try {
        const data = await listSceneLibrary({ query: q, page: 1, perPage: 12 });
        const next = data.items || [];
        if (!mounted) return;
        setItems(next);
        if (!selectedUrl) {
          const first = next[0]?.full_url || next[0]?.thumb_url || "";
          setSelectedUrl(first);
        }
        setStatus(data.source === "unsplash" ? "已载入场景图库。" : "当前使用本地预设场景图库。");
      } catch (error) {
        if (!mounted) return;
        setStatus(`加载场景图库失败：${error.message}`);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    run();
    return () => {
      mounted = false;
    };
  }, []);

  async function handlePolishPrompt() {
    if (!bgPrompt.trim()) {
      setStatus("请先输入需要润色的背景描述。");
      return;
    }
    setPolishing(true);
    setStatus("正在润色背景描述，请稍候...");
    try {
      const data = await polishSceneText(bgPrompt.trim());
      const polished = String(data.polished_prompt || "").trim();
      if (!polished) {
        setStatus("润色未返回有效内容，请保留原描述继续生成。");
        return;
      }
      setBgPrompt(polished);
      setStatus("背景描述已润色并覆盖到输入框。");
    } catch (error) {
      setStatus(`润色失败：${error.message}`);
    } finally {
      setPolishing(false);
    }
  }

  async function refreshLibrary() {
    setLoading(true);
    setStatus("正在刷新场景图库...");
    try {
      const data = await listSceneLibrary({ query: q.trim() || "office", page: 1, perPage: 12 });
      const next = data.items || [];
      setItems(next);
      const first = next[0]?.full_url || next[0]?.thumb_url || "";
      setSelectedUrl(first);
      setStatus(data.source === "unsplash" ? "已刷新 Unsplash 场景图库。" : "当前使用本地预设场景图库。");
    } catch (error) {
      setStatus(`刷新失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleUploadBackground(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    }).catch((error) => {
      setStatus(`上传失败：${error.message}`);
      return "";
    });
    if (!dataUrl) return;
    const customItem = {
      id: `upload_${Date.now()}`,
      thumb_url: dataUrl,
      full_url: dataUrl,
      title: file.name || "自定义背景",
      source: "upload",
    };
    setCustomItems((prev) => [customItem, ...prev]);
    setSelectedUrl(dataUrl);
    setStatus("已添加你的背景图，右侧可实时预览。");
  }

  async function handleGenerateBackground() {
    if (!bgPrompt.trim()) {
      setStatus("请先输入用于生成背景图的文字描述。");
      return;
    }
    setGenerating(true);
    setStatus("正在根据描述生成背景图...");
    try {
      const item = await generateSceneBackground(bgPrompt.trim());
      setCustomItems((prev) => [item, ...prev]);
      setSelectedUrl(item.full_url || item.thumb_url || "");
      setStatus("背景图生成成功，已自动选中。你可继续切换其他场景。");
    } catch (error) {
      setStatus(`背景图生成失败：${error.message}`);
    } finally {
      setGenerating(false);
    }
  }

  function handleConfirm() {
    if (!selectedUrl) {
      setStatus("请先选择一个场景背景。");
      return;
    }
    setSceneBackgroundUrl(normalizeSceneUrl(selectedUrl));
    navigate("/interact", { state: { modelId } });
  }

  function updateAvatarPosition(axis, value) {
    const next = [...sceneAvatarPosition];
    next[axis] = Number(value);
    setSceneAvatarPosition(next);
  }

  function updateCamera(axis, value) {
    const nextPos = [...(sceneCamera?.position || [0, -0.25, 9.6])];
    nextPos[axis] = Number(value);
    setSceneCamera({
      position: nextPos,
      fov: Number(sceneCamera?.fov || 23),
    });
  }

  function updateLight(field, value) {
    setSceneLight((prev) => ({ ...prev, [field]: Number(value) }));
  }

  function updateDirectionalPos(axis, value) {
    const current = Array.isArray(sceneLight?.directionalPosition) ? [...sceneLight.directionalPosition] : [5, 10, 5];
    current[axis] = Number(value);
    setSceneLight((prev) => ({ ...prev, directionalPosition: current }));
  }

  const markersReady = MARKER_ORDER.every((key) => Array.isArray(markers?.[key]));

  if (!modelResult?.output_model_url) {
    return <Navigate to="/create" replace />;
  }

  if (!markersReady) {
    return <Navigate to="/rig-preview" replace />;
  }

  return (
    <ShellLayout title="场景预览" subtitle="选择展示场景背景，确认后进入展示页面进行实时交互。" backTo="/rig-preview">
      <div className="two-column">
        <section className="glass-panel workflow-side-panel workflow-side-panel-scene">
          <h2>场景图库</h2>
          <p className="muted">可输入关键词刷新背景图库。点击左侧图片即可在右侧实时预览。</p>
          <div className="workflow-scroll-body workflow-scroll-body-scene">
            <div className="scene-search-row">
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="例如：办公室、教室、studio" />
            <button type="button" className="secondary-btn" onClick={refreshLibrary} disabled={loading}>
              {loading ? "加载中..." : "刷新图库"}
            </button>
          </div>

          <div className="scene-gallery-list">
            {items.map((item) => {
              const thumb = normalizeSceneUrl(item.thumb_url || item.full_url);
              const full = item.full_url || item.thumb_url || "";
              const active = selectedUrl === full;
              return (
                <button
                  key={item.id || full}
                  type="button"
                  className={active ? "scene-thumb active" : "scene-thumb"}
                  onClick={() => setSelectedUrl(full)}
                >
                  <img src={thumb} alt="场景缩略图" loading="lazy" />
                </button>
              );
            })}
          </div>

          <div className="status-box">{status}</div>

          <div className="scene-extra-tools">
            <label className="field-label" htmlFor="scene-upload-input">
              上传背景图
            </label>
            <input id="scene-upload-input" type="file" accept="image/*" onChange={handleUploadBackground} />

            <div className="prompt-label-row">
              <label className="field-label" htmlFor="scene-prompt-input">
                文字生成背景图
              </label>
              <div className="prompt-tools">
                <button
                  type="button"
                  className="speech-btn"
                  onClick={handlePolishPrompt}
                  disabled={generating || polishing}
                >
                  {polishing ? "润色中..." : "润色描述"}
                </button>
                <button
                  type="button"
                  className="speech-btn"
                  onClick={() => toggleSpeechInput(generating)}
                  disabled={generating || !speechSupported}
                >
                  {listening ? "停止语音" : "语音输入"}
                </button>
              </div>
            </div>
            <textarea
              id="scene-prompt-input"
              value={bgPrompt}
              onChange={(event) => setBgPrompt(event.target.value)}
              placeholder="例如：现代科技感办公室，落地窗，柔和自然光"
            />
            <button type="button" className="secondary-btn" onClick={handleGenerateBackground} disabled={generating}>
              {generating ? "生成中..." : "生成背景图"}
            </button>

            {customItems.length ? (
              <div className="scene-custom-list">
                <p className="muted" style={{ margin: "2px 0 0" }}>
                  我的背景
                </p>
                {customItems.map((item) => {
                  const thumb = normalizeSceneUrl(item.thumb_url || item.full_url);
                  const full = item.full_url || item.thumb_url || "";
                  const active = selectedUrl === full;
                  return (
                    <button
                      key={item.id || full}
                      type="button"
                      className={active ? "scene-thumb active" : "scene-thumb"}
                      onClick={() => setSelectedUrl(full)}
                    >
                      <img src={thumb} alt="自定义背景缩略图" loading="lazy" />
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="scene-editor-panel">
              <div className="scene-editor-panel-head">
                <strong>场景参数调节</strong>
                <p className="muted">合并角色位置、镜头和灯光参数，支持上下滚动调节。</p>
              </div>

              <div className="scene-editor-scroll">
                <section className="scene-editor-section" aria-label="角色位置">
                  <h4>角色位置</h4>
                  <label className="field-label">左右 X：{sceneAvatarPosition[0].toFixed(2)}</label>
                  <input
                    type="range"
                    min="-3"
                    max="3"
                    step="0.01"
                    value={sceneAvatarPosition[0]}
                    onChange={(event) => updateAvatarPosition(0, event.target.value)}
                  />
                  <label className="field-label">上下 Y：{sceneAvatarPosition[1].toFixed(2)}</label>
                  <input
                    type="range"
                    min="-2.8"
                    max="1.2"
                    step="0.01"
                    value={sceneAvatarPosition[1]}
                    onChange={(event) => updateAvatarPosition(1, event.target.value)}
                  />
                  <label className="field-label">前后 Z：{sceneAvatarPosition[2].toFixed(2)}</label>
                  <input
                    type="range"
                    min="-3.5"
                    max="3.5"
                    step="0.01"
                    value={sceneAvatarPosition[2]}
                    onChange={(event) => updateAvatarPosition(2, event.target.value)}
                  />
                </section>

                <section className="scene-editor-section" aria-label="镜头参数">
                  <h4>镜头</h4>
                  <label className="field-label">镜头距离：{(sceneCamera?.position?.[2] || 9.6).toFixed(2)}</label>
                  <input
                    type="range"
                    min="6.8"
                    max="12"
                    step="0.01"
                    value={sceneCamera?.position?.[2] || 9.6}
                    onChange={(event) => updateCamera(2, event.target.value)}
                  />
                </section>

                <section className="scene-editor-section" aria-label="灯光参数">
                  <h4>灯光</h4>
                  <label className="field-label">环境光：{(sceneLight?.ambient || 0.95).toFixed(2)}</label>
                  <input
                    type="range"
                    min="0.2"
                    max="1.8"
                    step="0.01"
                    value={sceneLight?.ambient || 0.95}
                    onChange={(event) => updateLight("ambient", event.target.value)}
                  />
                  <label className="field-label">主光强度：{(sceneLight?.directional || 1.35).toFixed(2)}</label>
                  <input
                    type="range"
                    min="0.3"
                    max="2.2"
                    step="0.01"
                    value={sceneLight?.directional || 1.35}
                    onChange={(event) => updateLight("directional", event.target.value)}
                  />
                  <label className="field-label">主光 X：{(sceneLight?.directionalPosition?.[0] || 5).toFixed(2)}</label>
                  <input
                    type="range"
                    min="-10"
                    max="10"
                    step="0.1"
                    value={sceneLight?.directionalPosition?.[0] || 5}
                    onChange={(event) => updateDirectionalPos(0, event.target.value)}
                  />
                  <label className="field-label">主光 Y：{(sceneLight?.directionalPosition?.[1] || 10).toFixed(2)}</label>
                  <input
                    type="range"
                    min="2"
                    max="16"
                    step="0.1"
                    value={sceneLight?.directionalPosition?.[1] || 10}
                    onChange={(event) => updateDirectionalPos(1, event.target.value)}
                  />
                </section>
              </div>
            </div>
          </div>

          </div>

          <button type="button" className="confirm-btn" onClick={handleConfirm} disabled={!selectedUrl}>
            点击确认进入展示
          </button>
        </section>

        <section className="glass-panel preview-panel scene-preview-panel">
          <h2>场景效果预览</h2>
          <p className="muted">可在此页面确认背景与角色展示效果。</p>
          <div className="animation-stage scene-animation-stage">
            <Canvas
              key={`${(sceneCamera?.position || [0, -0.25, 9.6]).join("|")}|${sceneCamera?.fov || 23}`}
              shadows
              dpr={[1, 1.5]}
              gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
              camera={{ position: sceneCamera?.position || [0, -0.25, 9.6], fov: sceneCamera?.fov || 23 }}
              style={{ height: "100%", width: "100%" }}
            >
              <ambientLight intensity={sceneLight?.ambient || 0.95} />
              <directionalLight position={sceneLight?.directionalPosition || [5, 10, 5]} intensity={sceneLight?.directional || 1.35} />
              <Experience
                isWaving={false}
                setIsWaving={() => {}}
                isTalking={false}
                interruptSeq={0}
                isSessionActive
                userSpeaking={false}
                previewAnimationName="Standing Idle.fbx"
                previewAnimationUrl={presetName ? `/assets/presets/${presetName}/animations/Standing Idle.fbx` : "/animations/Standing Idle.fbx"}
                loadInteractionClips={false}
                avatarModelUrl={modelResult?.output_model_url || "/models/avatar.fbx"}
                actionBasePath={presetName ? `/assets/presets/${presetName}/animations` : "/animations"}
                backdropTexturePath={previewUrl}
                showBackdrop
                showEnvironment={false}
                avatarPosition={sceneAvatarPosition}
                enableAvatarDrag
                onAvatarPositionChange={setSceneAvatarPosition}
              />
            </Canvas>
          </div>
        </section>
      </div>
    </ShellLayout>
  );
}
