import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useFBX } from "@react-three/drei";
import ShellLayout from "../components/ShellLayout";
import MarkerBoard from "../components/MarkerBoard";
import AnimationStage from "../components/AnimationStage";
import { MARKER_LABELS, MARKER_ORDER, useFlow } from "../context/FlowContext";
import { getRigStatus, listAnimations, startRig } from "../lib/api";
import { toAbsoluteUrl } from "../lib/config";
import { DEV_BYPASS_FLOW } from "../lib/devMode";

const MIN_RIG_WAIT_MS = 4500;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickDefaultAnimation(items = []) {
  return (
    items.find((item) => /standing\s*idle/i.test(String(item?.file_name || ""))) ||
    items.find((item) => /idle/i.test(String(item?.file_name || ""))) ||
    items[0] ||
    null
  );
}

export default function RigAssistPage() {
  const navigate = useNavigate();
  const {
    modelResult,
    markers,
    setMarkers,
    selectedAnimation,
    setSelectedAnimation,
    sourceImageUrl,
    presetName,
    modelId,
  } = useFlow();

  const [activeMarker, setActiveMarker] = useState(MARKER_ORDER[0]);
  const [status, setStatus] = useState("请按顺序设置 8 个辅助点位。");
  const [animations, setAnimations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("markers");
  const [mirrorMode, setMirrorMode] = useState(false);

  function resolveAssetFetchUrl(fileUrl) {
    if (!fileUrl) return "";
    if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
    if (String(fileUrl).startsWith("/assets/")) return toAbsoluteUrl(fileUrl);
    return fileUrl;
  }

  function preloadFbx(fileUrl) {
    const target = resolveAssetFetchUrl(fileUrl);
    if (!target) return;
    useFBX.preload(target);
    fetch(target, { cache: "force-cache" }).catch(() => {});
  }

  async function preloadFbxTask(fileUrl) {
    const target = resolveAssetFetchUrl(fileUrl);
    if (!target) return;
    useFBX.preload(target);
    await fetch(target, { cache: "force-cache" });
  }

  function preloadAvatarBundle(modelUrl, animationItems = []) {
    preloadFbx(modelUrl);
    animationItems.forEach((item) => preloadFbx(item?.file_url));
  }

  async function preloadEssentialBundle(modelUrl, animationItems = []) {
    const defaultAnim = pickDefaultAnimation(animationItems);
    const idleAnim = animationItems.find((item) => /standing\s*idle/i.test(String(item?.file_name || "")));
    const urls = [modelUrl, defaultAnim?.file_url, idleAnim?.file_url].filter(Boolean);
    await Promise.all(urls.map((url) => preloadFbxTask(url).catch(() => {})));
    return defaultAnim;
  }

  const placedCount = useMemo(
    () => MARKER_ORDER.filter((key) => Array.isArray(markers[key])).length,
    [markers],
  );

  useEffect(() => {
    if (!modelResult) {
      return;
    }
    const nextMissing = MARKER_ORDER.find((key) => !markers[key]);
    if (nextMissing) {
      setActiveMarker(nextMissing);
    }
  }, [markers, modelResult]);

  if (!modelResult?.output_model_url && !DEV_BYPASS_FLOW) {
    return <Navigate to="/create" replace />;
  }

  function clearCurrentMarker() {
    setMarkers((prev) => ({ ...prev, [activeMarker]: null }));
  }

  function goPrevMarker() {
    const idx = MARKER_ORDER.indexOf(activeMarker);
    setActiveMarker(MARKER_ORDER[(idx - 1 + MARKER_ORDER.length) % MARKER_ORDER.length]);
  }

  function handleMarkerPlaced(placedKey) {
    const idx = MARKER_ORDER.indexOf(placedKey);
    setActiveMarker(MARKER_ORDER[(idx + 1 + MARKER_ORDER.length) % MARKER_ORDER.length]);
  }

  function handleMarkerCancel(key) {
    setMarkers((prev) => ({ ...prev, [key]: null }));
    setActiveMarker(key);
  }

  function resetAllMarkers() {
    setMarkers((prev) => {
      const next = { ...prev };
      MARKER_ORDER.forEach((key) => {
        next[key] = null;
      });
      return next;
    });
    setStatus("已重置全部点位，请重新放置。");
  }

  const markerQualityHint = useMemo(() => {
    const notes = [];
    const pairs = [
      ["wrist_left", "wrist_right", "手腕"],
      ["elbow_left", "elbow_right", "手肘"],
      ["knee_left", "knee_right", "膝盖"],
    ];

    pairs.forEach(([leftKey, rightKey, label]) => {
      const left = markers[leftKey];
      const right = markers[rightKey];
      if (!left || !right) return;
      const centerBias = Math.abs((left[0] + right[0]) / 2 - 50);
      const verticalDiff = Math.abs(left[1] - right[1]);
      if (centerBias > 10) {
        notes.push(`${label}左右整体略偏${(left[0] + right[0]) / 2 < 50 ? "左" : "右"}`);
      }
      if (verticalDiff > 10) {
        notes.push(`${label}两侧高度差稍大`);
      }
    });

    if (placedCount < 4) {
      return "提示：先完成更多关键点后再看质量建议。";
    }
    if (!notes.length) {
      return "提示：当前点位整体较平衡，可直接进入下一步。";
    }
    return `提示：${notes.slice(0, 2).join("；")}（可选微调）`;
  }, [markers, placedCount]);

  async function handleRig() {
    if (placedCount !== MARKER_ORDER.length) {
      setStatus("点位尚未完成，需先设置全部 8 个点位。");
      return;
    }

    setLoading(true);
    setStatus("正在执行辅助自动绑骨+重定向实现动作交互，请稍候...");
    setProgress(0);
    const flowStartAt = Date.now();

    try {
      preloadFbx(modelResult?.output_model_url || "");

      if (!modelResult?.output_model_url && DEV_BYPASS_FLOW) {
        for (let p = 0; p <= 100; p += 10) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 380));
          setProgress(Math.min(68, Math.round((p / 100) * 68)));
        }
        const animData = await listAnimations(presetName);
        preloadAvatarBundle(modelResult?.output_model_url || "/models/avatar.fbx", animData.items || []);
        const primary = await preloadEssentialBundle(modelResult?.output_model_url || "/models/avatar.fbx", animData.items || []);
        setProgress(92);
        const waitLeft = Math.max(0, MIN_RIG_WAIT_MS - (Date.now() - flowStartAt));
        if (waitLeft > 0) {
          await wait(waitLeft);
        }
        setProgress(100);
        setAnimations(animData.items || []);
        setSelectedAnimation(primary || animData.items?.[0] || null);
        setPhase("preview");
        setStatus("开发模式：已跳过流程前置条件，进入动作预览。");
        return;
      }

      const payload = {
        model_url: modelResult.output_model_url,
        markers: MARKER_ORDER.reduce((acc, key) => {
          acc[key] = markers[key];
          return acc;
        }, {}),
      };

      const start = await startRig(payload);
      let done = false;
      while (!done) {
        await new Promise((resolve) => setTimeout(resolve, 550));
        const task = await getRigStatus(start.task_id);
        setProgress(Math.min(70, Math.round((task.progress || 0) * 0.7)));
        if (task.status === "completed") {
          done = true;
        }
      }

      setStatus("流程已完成，正在预加载模型与关键动作...");
      const animData = await listAnimations(presetName);
      setProgress(76);
      preloadAvatarBundle(modelResult?.output_model_url || "/models/avatar.fbx", animData.items || []);
      const primary = await preloadEssentialBundle(modelResult?.output_model_url || "/models/avatar.fbx", animData.items || []);
      setProgress(94);
      const waitLeft = Math.max(0, MIN_RIG_WAIT_MS - (Date.now() - flowStartAt));
      if (waitLeft > 0) {
        await wait(waitLeft);
      }
      setProgress(100);
      setAnimations(animData.items || []);
      setSelectedAnimation(primary || animData.items?.[0] || null);
      setPhase("preview");
      setStatus("辅助流程完成。你可以预览动作并点击确认进入交互会话。");
    } catch (error) {
      setStatus(`流程失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ShellLayout
      title="辅助绑定"
      subtitle="该页采用辅助自动绑骨+重定向实现动作交互流程，确认后进入动作预览。"
    >
      {phase === "markers" ? (
        <div className="two-column">
          <section className="glass-panel">
            <h2>点位设置</h2>
            {!modelResult?.output_model_url && DEV_BYPASS_FLOW ? (
              <p className="muted">开发模式：当前页允许直接访问，未从第1页带入模型也可调试。</p>
            ) : null}
            <p className="muted marker-target-tip">请点击：{MARKER_LABELS[activeMarker]}</p>
            <p className="muted">初始点位会集中显示在左下角，点击面板即可绑定当前点位并自动切换到下一个；支持右键取消当前点位。</p>
            <label className="mirror-toggle">
              <input
                type="checkbox"
                checked={mirrorMode}
                onChange={(event) => setMirrorMode(event.target.checked)}
              />
              <span>镜像模式（默认关闭）</span>
            </label>
            <div className="marker-meta">
              <span>已完成 {placedCount} / 8</span>
              <div className="marker-chip-list">
                {MARKER_ORDER.map((key) => (
                  <button
                    key={key}
                    className={`marker-chip${activeMarker === key ? " active" : ""}${markers[key] ? " placed" : ""}`}
                    type="button"
                    onClick={() => setActiveMarker(key)}
                  >
                    {MARKER_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>
            <div className="quality-hint">{markerQualityHint}</div>

            <div className="stack-btns">
              <button type="button" className="secondary-btn" onClick={goPrevMarker}>
                上一步点位
              </button>
              <button type="button" className="secondary-btn" onClick={clearCurrentMarker}>
                撤销当前点
              </button>
              <button type="button" className="secondary-btn" onClick={resetAllMarkers}>
                重置全部点
              </button>
            </div>

            <button
              type="button"
              className="confirm-btn"
              disabled={loading || placedCount !== MARKER_ORDER.length}
              onClick={handleRig}
            >
              点击确认进入动作预览
            </button>

            <div className="status-box">{status}</div>
            {loading ? (
              <div className="progress-wrap">
                <div className="progress-bar" style={{ width: `${progress}%` }} />
                <p>{progress}%</p>
              </div>
            ) : null}
          </section>

          <section className="glass-panel preview-panel">
            <h2>正视图点位面板</h2>
            <p className="muted">按模型正视图进行点位确认。系统将执行辅助自动绑骨+重定向实现动作交互后进入动作预览。</p>
            <MarkerBoard
              markers={markers}
              setMarkers={setMarkers}
              activeMarker={activeMarker}
              backgroundImage={sourceImageUrl}
              mirrorMode={mirrorMode}
              onMarkerPlaced={handleMarkerPlaced}
              onMarkerCancel={handleMarkerCancel}
            />
          </section>
        </div>
      ) : (
        <div className="single-column">
          <section className="glass-panel rig-animation-panel">
            <h2>动作预览</h2>
            <p className="muted">动作文件直接来自“animations”目录（FBX）。点击动作名称可预览。</p>
            <AnimationStage
              animations={animations}
              selectedAnimation={selectedAnimation}
              onSelect={setSelectedAnimation}
              avatarModelUrl={modelResult?.output_model_url || "/models/avatar.fbx"}
              actionBasePath={presetName ? `/assets/presets/${presetName}/animations` : "/animations"}
              previewAnimationUrl={selectedAnimation?.file_url || ""}
            />
            <div className="row-btns" style={{ marginTop: 16 }}>
              <button type="button" className="secondary-btn" onClick={() => setPhase("markers")}>
                返回点位页
              </button>
              <button
                type="button"
                className="confirm-btn"
                onClick={() => navigate("/interact", { state: { modelId } })}
              >
                点击确认进入交互会话
              </button>
            </div>
          </section>
        </div>
      )}
    </ShellLayout>
  );
}
