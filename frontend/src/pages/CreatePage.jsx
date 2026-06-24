import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ShellLayout from "../components/ShellLayout";
import ModelPreview from "../components/ModelPreview";
import { createFromImage, createFromPreset, createFromText, listPresets, retryPipeline } from "../lib/api";
import { toAbsoluteUrl } from "../lib/config";
import { useFlow } from "../context/FlowContext";

export default function CreatePage() {
  const navigate = useNavigate();
  const {
    modelResult,
    setModelResult,
    resetMarkers,
    setSourceImageUrl,
    presetName,
    setPresetName,
    setModelId,
  } = useFlow();

  const [prompt, setPrompt] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("输入文字或上传图片，生成你的数字人形象。");
  const [presets, setPresets] = useState([]);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [lastRetry, setLastRetry] = useState(null);
  const speechRef = useRef(null);

  const previewUrl = useMemo(
    () => (modelResult?.output_model_url ? toAbsoluteUrl(modelResult.output_model_url) : ""),
    [modelResult],
  );

  useEffect(() => {
    listPresets()
      .then((data) => setPresets(data.items || []))
      .catch(() => setPresets([]));
  }, []);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }
    setSpeechSupported(true);
    const recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = Array.from(event.results || [])
        .map((item) => item?.[0]?.transcript || "")
        .join("")
        .trim();
      if (text) {
        setPrompt(text);
        setStatus("语音已识别并填入文本框。");
      }
    };
    recognition.onerror = () => {
      setStatus("语音识别失败，请重试或改为手动输入。");
    };
    recognition.onend = () => setListening(false);
    speechRef.current = recognition;
    return () => {
      try {
        recognition.stop();
      } catch {}
      speechRef.current = null;
    };
  }, []);

  async function toDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
  }

  function toggleSpeechInput() {
    if (!speechSupported || busy) {
      return;
    }
    const recognition = speechRef.current;
    if (!recognition) {
      setStatus("当前浏览器不支持语音识别。请手动输入文字。");
      return;
    }
    if (listening) {
      try {
        recognition.stop();
      } catch {}
      setListening(false);
      return;
    }
    try {
      recognition.start();
      setListening(true);
      setStatus("正在聆听，请说出你的描述...");
    } catch {
      setStatus("语音识别启动失败，请稍后重试。");
    }
  }

  async function handleRunText() {
    if (!prompt.trim()) {
      setStatus("请先输入文字描述。");
      return;
    }
    setBusy(true);
    setStatus("正在调用 Meshy 文本生成，请稍候...");
    try {
      const result = await createFromText(prompt.trim());
      setModelResult(result);
      setModelId(result.model_id || null);
      setPresetName(result.preset_name || "");
      setSourceImageUrl(result.background_url ? toAbsoluteUrl(result.background_url) : "");
      resetMarkers();
      setLastRetry(null);
      setStatus("形象生成完成。可以旋转预览后确认。");
    } catch (error) {
      setStatus(`生成失败：${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRunImage() {
    if (!imageFile) {
      setStatus("请先选择图片文件。");
      return;
    }
    setBusy(true);
    setStatus("正在使用用户上传图片生成，请稍候...");
    try {
      const result = await createFromImage(imageFile);
      const imageDataUrl = await toDataUrl(imageFile);
      setModelResult(result);
      setModelId(result.model_id || null);
      setPresetName("");
      setSourceImageUrl(imageDataUrl);
      resetMarkers();
      setLastRetry({ type: "image", image_data_url: imageDataUrl });
      setStatus("形象生成完成。可以旋转预览后确认。");
    } catch (error) {
      setStatus(`生成失败：${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleUsePreset(name) {
    setBusy(true);
    setStatus("正在加载预设形象...");
    try {
      const result = await createFromPreset(name);
      setModelResult(result);
      setModelId(result.model_id || null);
      setPresetName(name);
      setSourceImageUrl(toAbsoluteUrl(result.background_url || ""));
      resetMarkers();
      setLastRetry(null);
      setStatus(`预设形象 ${name} 已载入。`);
    } catch (error) {
      setStatus(`预设加载失败：${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry() {
    if (!lastRetry || busy) {
      return;
    }
    setBusy(true);
    setStatus("正在重试上一次图片生成，请稍候...");
    try {
      const result = await retryPipeline(lastRetry);
      setModelResult(result);
      setModelId(result.model_id || null);
      setPresetName("");
      setSourceImageUrl(lastRetry.image_data_url || "");
      resetMarkers();
      setStatus("重试成功。可以旋转预览后确认。");
    } catch (error) {
      setStatus(`重试失败：${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ShellLayout
      title="形象生成"
      subtitle="通过文字或图片生成 3D 数字人，确认后进入辅助绑定流程。"
    >
      <div className="two-column">
        <section className="glass-panel">
          <h2>输入方式</h2>
          <p className="muted">你可以选择文字输入或图片输入，提交后会自动生成模型。</p>

          <label className="field-label">预设形象</label>
          <div className="preset-grid">
            {presets.map((preset) => (
              <button
                type="button"
                key={preset.name}
                className={presetName === preset.name ? "preset-btn active" : "preset-btn"}
                onClick={() => handleUsePreset(preset.name)}
                disabled={busy}
              >
                <div className="preset-thumb">
                  {preset.background_url ? (
                    <img
                      src={toAbsoluteUrl((preset.background_url || "").replace("/background.png", "/view.png"))}
                      alt={`${preset.display_name} 预设图`}
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = toAbsoluteUrl(preset.background_url || "");
                      }}
                    />
                  ) : (
                    <div className="preset-thumb-fallback">{preset.display_name?.slice(0, 1) || "预"}</div>
                  )}
                </div>
                <div>{preset.display_name}</div>
                <small>{preset.name}</small>
              </button>
            ))}
          </div>

          <div className="prompt-label-row">
            <label className="field-label" htmlFor="prompt-input">
              文本描述
            </label>
            <button
              type="button"
              className="speech-btn"
              onClick={toggleSpeechInput}
              disabled={busy || !speechSupported}
            >
              {listening ? "停止语音" : "语音输入"}
            </button>
          </div>
          <textarea
            id="prompt-input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：一个风格化、友好的卡通人物"
          />
          <button type="button" className="primary-btn" onClick={handleRunText} disabled={busy}>
            {busy ? "生成中..." : "文字生成"}
          </button>

          <div className="divider" />

          <label className="field-label" htmlFor="image-input">
            图片上传
          </label>
          <input
            id="image-input"
            type="file"
            accept="image/*"
            onChange={(event) => setImageFile(event.target.files?.[0] || null)}
          />
          <button type="button" className="secondary-btn" onClick={handleRunImage} disabled={busy}>
            {busy ? "生成中..." : "图片生成"}
          </button>

          <div className="status-box">{status}</div>

          <button type="button" className="confirm-btn secondary-retry-btn" disabled={!lastRetry || busy} onClick={handleRetry}>
            {busy ? "处理中..." : "重试上一次图片生成"}
          </button>

          <button
            type="button"
            className="confirm-btn"
            disabled={!modelResult?.output_model_url || busy}
            onClick={() => navigate("/rig-preview")}
          >
            点击确认进入辅助绑定
          </button>
        </section>

        <section className="glass-panel preview-panel create-preview-panel">
          <h2>3D 预览</h2>
          <p className="muted">支持拖拽旋转和滚轮缩放，确认角色形象后再进入下一步。</p>
          {previewUrl ? (
            <ModelPreview
              modelUrl={previewUrl}
              actionBasePath={presetName ? `/assets/presets/${presetName}/animations` : "/animations"}
            />
          ) : (
            <div className="empty-stage">等待生成模型</div>
          )}
        </section>
      </div>
    </ShellLayout>
  );
}
