/* eslint-disable no-empty, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from "react";

const ERROR_HINT = {
  "not-allowed": "麦克风权限被拒绝",
  "service-not-allowed": "浏览器语音服务不可用",
  network: "语音服务网络异常",
  "no-speech": "未识别到语音",
  "audio-capture": "音频采集失败",
  aborted: "语音识别被中断",
};

export function useSpeechInput({
  lang = "zh-CN",
  onText,
  onStatus,
  onFallbackTranscribe,
  startHint = "正在聆听，请开始说话...",
  doneHint = "语音已识别并填入输入框。",
}) {
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const isStartingRef = useRef(false);
  const fallbackTriedRef = useRef(false);
  const manualStopRef = useRef(false);
  const fallbackRecorderRef = useRef(null);
  const fallbackChunksRef = useRef([]);
  const fallbackStreamRef = useRef(null);
  const fallbackTimerRef = useRef(null);

  async function stopFallbackRecorder() {
    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    const recorder = fallbackRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  async function startFallbackRecorder() {
    if (!onFallbackTranscribe) {
      onStatus?.("浏览器语音服务异常，请改为手动输入。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      fallbackStreamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      fallbackRecorderRef.current = recorder;
      fallbackChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          fallbackChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        setListening(false);
        const chunks = fallbackChunksRef.current;
        fallbackChunksRef.current = [];
        try {
          const blob = new Blob(chunks, { type: "audio/webm" });
          const text = await onFallbackTranscribe(blob);
          if (text) {
            onText?.(text);
            onStatus?.(doneHint);
          } else {
            onStatus?.("备用语音识别未返回有效文本，请手动输入。");
          }
        } catch (error) {
          onStatus?.(`备用语音识别失败：${error?.message || "未知错误"}`);
        } finally {
          try {
            fallbackStreamRef.current?.getTracks?.().forEach((track) => track.stop());
          } catch {}
          fallbackStreamRef.current = null;
          fallbackRecorderRef.current = null;
          if (fallbackTimerRef.current) {
            window.clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
          }
        }
      };

      recorder.start();
      setListening(true);
      onStatus?.("浏览器语音服务异常，已自动切换备用识别，请开始说话...");
      fallbackTimerRef.current = window.setTimeout(() => {
        stopFallbackRecorder();
      }, 6500);
    } catch {
      onStatus?.("无法启动备用语音识别，请检查麦克风权限或改为手动输入。");
    }
  }

  useEffect(() => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setSpeechSupported(false);
      return;
    }

    setSpeechSupported(true);
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      isStartingRef.current = false;
      setListening(true);
    };

    recognition.onresult = (event) => {
      const text = Array.from(event.results || [])
        .map((item) => item?.[0]?.transcript || "")
        .join("")
        .trim();
      if (text) {
        onText?.(text);
        onStatus?.(doneHint);
      }
    };

    recognition.onerror = (event) => {
      const code = String(event?.error || "unknown");
      const hint = ERROR_HINT[code] || code;

      if ((code === "network" || code === "service-not-allowed") && !fallbackTriedRef.current) {
        fallbackTriedRef.current = true;
        stopFallbackRecorder();
        startFallbackRecorder();
        return;
      }

      onStatus?.(`语音识别失败（${hint}），请重试或改为手动输入。`);
    };

    recognition.onend = () => {
      setListening(false);
      isStartingRef.current = false;
      manualStopRef.current = false;
    };

    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.stop();
      } catch {}
      try {
        stopFallbackRecorder();
      } catch {}
      recognitionRef.current = null;
      setListening(false);
      isStartingRef.current = false;
    };
  }, [doneHint, lang, onStatus, onText]);

  function toggleSpeechInput(disabled = false) {
    if (disabled || !speechSupported) return;
    if (!window.isSecureContext) {
      onStatus?.("当前环境非安全上下文，语音识别仅支持 https 或 localhost。");
      return;
    }

    const recognition = recognitionRef.current;
    if (!recognition) {
      onStatus?.("当前浏览器不支持语音识别。请手动输入文字。");
      return;
    }

    if (listening || isStartingRef.current) {
      manualStopRef.current = true;
      stopFallbackRecorder();
      try {
        recognition.stop();
      } catch {}
      setListening(false);
      isStartingRef.current = false;
      return;
    }

    fallbackTriedRef.current = false;
    try {
      isStartingRef.current = true;
      recognition.start();
      onStatus?.(startHint);
    } catch {
      isStartingRef.current = false;
      onStatus?.("语音识别启动失败，请稍后重试。");
    }
  }

  return {
    speechSupported,
    listening,
    toggleSpeechInput,
  };
}
