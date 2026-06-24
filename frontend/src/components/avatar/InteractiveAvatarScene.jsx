import { useCallback, useEffect, useRef, useState } from "react";
import AvatarView from "./AvatarView";
import GestureDetector from "./GestureDetector";
import { createVoiceWsClient } from "../../audio/voiceWsClient";
import { API_BASE } from "../../lib/config";
import { getToken } from "../../lib/auth";

const USER_SPEAK_THRESHOLD = 0.14;
const USER_SPEAK_FRAMES = 10;
const USER_SPEAK_HANGOVER_MS = 350;
const AFTER_ASSISTANT_IDLE_MS = 20000;
const RX_STALE_MS = 200;
const TX_OVER_RX_RATIO = 2.8;
const TX_OVER_RX_DELTA = 0.02;
const PLAYBACK_GUARD_MS = 350;
const INTERRUPT_CONFIRM_MS = 180;
const GOODBYE_RE = /(再见|拜拜|拜了|拜啦|我走了|结束了|不聊了)/;

const WS_BASE = `${API_BASE.replace(/^http/i, "ws")}/ws/audio`;
const BG_STORAGE_KEY = "interactiveAvatar.backdropTexturePath";

const BACKGROUND_OPTIONS = [
  { label: "深色背景", value: "/textures/Black.jpg" },
  { label: "浅色背景", value: "/textures/BackGround.jpg" },
  { label: "书架背景", value: "/textures/Book.jpg" },
];

export default function InteractiveAvatarScene({
  avatarModelUrl = "/models/avatar.fbx",
  actionBasePath = "/animations",
  modelId = null,
}) {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [isWaving, setIsWaving] = useState(false);
  const [assistantTalking, setAssistantTalking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [interruptSeq, setInterruptSeq] = useState(0);
  const [backdropTexturePath, setBackdropTexturePath] = useState(BACKGROUND_OPTIONS[0].value);

  useEffect(() => {
    try {
      const cached = window.localStorage.getItem(BG_STORAGE_KEY);
      const exists = BACKGROUND_OPTIONS.some((item) => item.value === cached);
      if (cached && exists) {
        setBackdropTexturePath(cached);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const exists = BACKGROUND_OPTIONS.some((item) => item.value === backdropTexturePath);
    if (!exists) {
      setBackdropTexturePath(BACKGROUND_OPTIONS[0].value);
    }
  }, [backdropTexturePath]);

  useEffect(() => {
    try {
      window.localStorage.setItem(BG_STORAGE_KEY, backdropTexturePath);
    } catch {}
  }, [backdropTexturePath]);

  const wavedOnceAfterConnectRef = useRef(false);
  const assistantTalkingRef = useRef(false);
  const lastPlaybackStartedAtRef = useRef(0);
  const lastUserVoiceAtRef = useRef(0);
  const assistantDoneRef = useRef(false);
  const interruptSeqRef = useRef(0);
  const txLevelRef = useRef(0);
  const rxLevelRef = useRef(0);
  const rxLevelAtRef = useRef(0);
  const userSpeakFramesRef = useRef(0);
  const userSpeakingRef = useRef(false);
  const pendingInterruptRef = useRef(false);
  const voiceClientRef = useRef(null);
  const interruptGateRef = useRef(true);
  const lastUserSpokenAtRef = useRef(0);
  const pendingGoodbyeRef = useRef(false);
  const sessionLockingRef = useRef(false);
  const waveAfterConnectRef = useRef(false);
  const sessionActiveRef = useRef(false);

  useEffect(() => {
    sessionActiveRef.current = isSessionActive && isVoiceConnected;
  }, [isSessionActive, isVoiceConnected]);

  const endSession = useCallback(async () => {
    setIsConnecting(false);
    setIsVoiceConnected(false);
    setIsSessionActive(false);
    setIsWaving(false);
    wavedOnceAfterConnectRef.current = false;
    assistantTalkingRef.current = false;
    setAssistantTalking(false);
    assistantDoneRef.current = false;
    pendingGoodbyeRef.current = false;
    interruptGateRef.current = true;
    userSpeakFramesRef.current = 0;
    userSpeakingRef.current = false;
    pendingInterruptRef.current = false;
    lastPlaybackStartedAtRef.current = 0;
    rxLevelRef.current = 0;
    rxLevelAtRef.current = 0;
    sessionLockingRef.current = false;
    try {
      await voiceClientRef.current?.stop?.();
    } catch {}
    voiceClientRef.current = null;
    lastUserSpokenAtRef.current = 0;
    txLevelRef.current = 0;
    setUserSpeaking(false);
  }, []);

  const fireInterruptOnce = useCallback(() => {
    if (!assistantTalkingRef.current || !interruptGateRef.current) {
      return;
    }
    interruptGateRef.current = false;
    interruptSeqRef.current += 1;
    setInterruptSeq(interruptSeqRef.current);
    try {
      voiceClientRef.current?.interrupt?.();
      voiceClientRef.current?.interruptPlayback?.();
    } catch {}
  }, []);

  const connectToBackend = useCallback(async () => {
    if (isConnecting || isVoiceConnected || voiceClientRef.current) return;
    setIsConnecting(true);

    try {
      const now = Date.now();
      lastUserSpokenAtRef.current = now;
      assistantTalkingRef.current = false;
      setAssistantTalking(false);
      lastPlaybackStartedAtRef.current = 0;
      assistantDoneRef.current = false;
      pendingGoodbyeRef.current = false;
      interruptGateRef.current = true;
      txLevelRef.current = 0;
      rxLevelRef.current = 0;
      rxLevelAtRef.current = 0;
      userSpeakFramesRef.current = 0;
      userSpeakingRef.current = false;
      pendingInterruptRef.current = false;

      const client = createVoiceWsClient({
        url: `${WS_BASE}?token=${encodeURIComponent(getToken())}${modelId ? `&model_id=${modelId}` : ""}`,
        onWsClose: () => {
          console.log("[WS] connection closed -> endSession()");
          endSession();
        },
        onWsError: (e) => console.log("[WS] error", e),
        onWsOpen: () => console.log("[WS] open"),
        onRxLevel: (lvl) => {
          rxLevelRef.current = lvl;
          rxLevelAtRef.current = Date.now();
        },
        onTxLevel: (lvl) => {
          const nowTs = Date.now();
          txLevelRef.current = lvl;

          if (lvl >= 0.01) lastUserSpokenAtRef.current = nowTs;

          if (assistantTalkingRef.current) {
            const sinceStart = nowTs - lastPlaybackStartedAtRef.current;
            if (sinceStart >= 0 && sinceStart < PLAYBACK_GUARD_MS) return;
          }

          const rx = nowTs - rxLevelAtRef.current <= RX_STALE_MS ? rxLevelRef.current : 0;
          const echoLike =
            assistantTalkingRef.current && lvl < rx * TX_OVER_RX_RATIO + TX_OVER_RX_DELTA;
          const hit = lvl >= USER_SPEAK_THRESHOLD && !echoLike;

          if (hit) userSpeakFramesRef.current += 1;
          else userSpeakFramesRef.current = Math.max(0, userSpeakFramesRef.current - 1);

          const now2 = Date.now();
          if (hit) lastUserVoiceAtRef.current = now2;

          const speakingByFrames = userSpeakFramesRef.current >= USER_SPEAK_FRAMES;
          const speakingWithHangover =
            speakingByFrames || now2 - lastUserVoiceAtRef.current <= USER_SPEAK_HANGOVER_MS;

          userSpeakingRef.current = speakingWithHangover;
          setUserSpeaking((prev) => (prev === speakingWithHangover ? prev : speakingWithHangover));

          if (speakingWithHangover && assistantTalkingRef.current && !pendingInterruptRef.current) {
            pendingInterruptRef.current = true;
            setTimeout(() => {
              pendingInterruptRef.current = false;
              if (assistantTalkingRef.current && userSpeakingRef.current) {
                fireInterruptOnce();
              }
            }, INTERRUPT_CONFIRM_MS);
          }
        },

        onAssistantPlaybackStarted: () => {
          lastPlaybackStartedAtRef.current = Date.now();
          if (!assistantTalkingRef.current) {
            assistantTalkingRef.current = true;
            setAssistantTalking(true);
          }
          assistantDoneRef.current = false;
          interruptGateRef.current = true;
          userSpeakFramesRef.current = 0;
          userSpeakingRef.current = false;
          pendingInterruptRef.current = false;
        },

        onAssistantPlaybackEnded: () => {
          if (assistantTalkingRef.current) {
            assistantTalkingRef.current = false;
            setAssistantTalking(false);
          }
          interruptGateRef.current = true;
          userSpeakFramesRef.current = 0;
          userSpeakingRef.current = false;
          pendingInterruptRef.current = false;
        },

        onTextEvent: (msg) => {
          if (msg?.type === "user_final" && typeof msg.text === "string") {
            if (GOODBYE_RE.test(msg.text.trim())) {
              pendingGoodbyeRef.current = true;
            }
            return;
          }

          if (msg?.type === "assistant_done") {
            assistantDoneRef.current = true;
          }
        },
      });

      voiceClientRef.current = client;
      await client.start();

      setIsVoiceConnected(true);
      setIsSessionActive(true);

      requestAnimationFrame(() => {
        if (waveAfterConnectRef.current) {
          waveAfterConnectRef.current = false;
          setIsWaving(true);
        }
      });
    } catch {
      await endSession();
    } finally {
      setIsConnecting(false);
      sessionLockingRef.current = false;
    }
  }, [isConnecting, isVoiceConnected, endSession, fireInterruptOnce]);

  const handleUserGreet = useCallback(() => {
    if (isSessionActive || isConnecting || isVoiceConnected || sessionLockingRef.current) return;
    sessionLockingRef.current = true;
    waveAfterConnectRef.current = true;
    connectToBackend();
  }, [isSessionActive, isConnecting, isVoiceConnected, connectToBackend]);

  useEffect(() => {
    if (isSessionActive && isVoiceConnected && !wavedOnceAfterConnectRef.current) {
      wavedOnceAfterConnectRef.current = true;
      setIsWaving(true);
    }
  }, [isSessionActive, isVoiceConnected]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!sessionActiveRef.current) return;
      if (!assistantDoneRef.current || assistantTalkingRef.current) return;

      if (pendingGoodbyeRef.current) {
        pendingGoodbyeRef.current = false;
        endSession();
        return;
      }

      const now = Date.now();
      const userSilentMs = now - lastUserSpokenAtRef.current;
      if (userSilentMs >= AFTER_ASSISTANT_IDLE_MS) {
        endSession();
      }
    }, 200);

    return () => clearInterval(timer);
  }, [endSession]);

  return (
    <div className="interactive-stage">
      <div className="manual-controls">
        <div className="manual-controls-left">
          <label className="bg-select-label" htmlFor="bg-select">
            背景图
          </label>
          <select
            id="bg-select"
            className="bg-select"
            value={backdropTexturePath}
            onChange={(event) => setBackdropTexturePath(event.target.value)}
          >
            {BACKGROUND_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="manual-controls-right">
          <button
            type="button"
            className="primary-btn"
            onClick={isSessionActive ? endSession : handleUserGreet}
            disabled={isConnecting}
          >
            {isConnecting ? "连接中..." : isSessionActive ? "结束对话" : "手动开始会话"}
          </button>
        </div>
      </div>

      <AvatarView
        isWaving={isWaving}
        setIsWaving={setIsWaving}
        isTalking={assistantTalking}
        interruptSeq={interruptSeq}
        isSessionActive={isSessionActive}
        userSpeaking={userSpeaking}
        avatarModelUrl={avatarModelUrl}
        actionBasePath={actionBasePath}
        backdropTexturePath={backdropTexturePath}
      />

      <GestureDetector onGreet={handleUserGreet} onLeave={endSession} isSessionActive={isSessionActive} />
    </div>
  );
}
