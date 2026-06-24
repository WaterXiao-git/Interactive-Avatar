import * as THREE from "three";

export function createAvatarFbxController({
  actions,
  mixer,
  setIsWaving,
  setIsWavingExternal,
  TALK_WEIGHTS,
  weightedPick,
}) {
  const FADE_BASE = 0.22;
  const FADE_WAVE = 0.28;
  const FADE_INTERRUPT = 0.18;
  const TALK_HANGOVER_MS = 650;
  const WAVE_COOLDOWN_MS = 1200;
  const IDLE_FLOOR_WEIGHT = 0.62;
  const WAVE_IDLE_FENCE_WEIGHT = 0.08;
  const WAVE_ACTIVE_IDLE_WEIGHT = 0;
  const WAVE_EXIT_IDLE_FLOOR = 0;
  const WAVE_START_GUARD_MS = 100;
  const WAVE_EXIT_RATIO = 0.96;

  const state = {
    mode: "idle",
    currentTalkKey: null,
    waveLocked: false,
    waveCooldownUntil: 0,
    lastInterruptSeq: 0,
    interruptCooldownUntil: 0,
    cleanupListeningOnce: null,
    cleanupWave: null,
    talkingHoldUntil: 0,
    currentMainAction: null,
    sessionEnded: false,
  };

  const stopTimers = new WeakMap();

  const clearStopTimer = (action) => {
    const timer = stopTimers.get(action);
    if (timer) clearTimeout(timer);
    stopTimers.delete(action);
  };

  const softStop = (action, fade = FADE_BASE) => {
    if (!action) return;
    clearStopTimer(action);
    try {
      action.fadeOut(fade);
    } catch {}
  };

  const hardStopNow = (action) => {
    if (!action) return;
    clearStopTimer(action);
    try {
      action.stop();
      action.enabled = false;
      action.paused = false;
      action.setEffectiveWeight?.(0);
      action.setEffectiveTimeScale?.(1);
    } catch {}
  };

  const prepLoop = (action) => {
    action.enabled = true;
    action.paused = false;
    action.setEffectiveTimeScale(1);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
  };

  const prepOnce = (action) => {
    action.enabled = true;
    action.paused = false;
    action.setEffectiveTimeScale(1);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  };

  const ensureIdleRunning = () => {
    const idle = actions?.Idle;
    if (!idle) return;
    try {
      idle.enabled = true;
      idle.paused = false;
      idle.setEffectiveTimeScale(1);
      idle.setLoop(THREE.LoopRepeat, Infinity);
      idle.clampWhenFinished = false;
      if (!idle.isRunning()) {
        idle.reset();
        idle.setEffectiveWeight(1);
        idle.fadeIn(0.12).play();
      }
    } catch {}
  };

  const ensureIdleFloor = () => {
    const idle = actions?.Idle;
    if (!idle) return;
    ensureIdleRunning();
    try {
      const targetFloor = state.mode === "wave" ? WAVE_ACTIVE_IDLE_WEIGHT : IDLE_FLOOR_WEIGHT;
      const weight = idle.getEffectiveWeight?.() ?? 1;
      if (weight < targetFloor) {
        idle.enabled = true;
        idle.setEffectiveWeight(targetFloor);
      }
    } catch {}
  };

  const transitionMainTo = (nextKey, { fade = FADE_BASE, reset = true, once = false } = {}) => {
    const next = actions?.[nextKey];
    if (!next || state.sessionEnded) return false;
    if (state.currentMainAction === next && next.isRunning()) return true;

    clearStopTimer(next);

    try {
      if (once) {
        prepOnce(next);
        next.setEffectiveWeight(1);
        next.reset();
        next.fadeIn(fade).play();
      } else {
        prepLoop(next);
        next.setEffectiveWeight(1);
        if (reset) next.reset();
        if (!next.isRunning()) next.fadeIn(fade).play();
      }
    } catch {
      return false;
    }

    const prev = state.currentMainAction;
    if (prev && prev !== next) {
      try {
        prev.crossFadeTo(next, fade, false);
      } catch {
        prev.fadeOut?.(fade);
      }
      try {
        prev.fadeOut(fade);
      } catch {}
    }

    state.currentMainAction = next;
    return true;
  };

  const stopAllTalking = () => {
    ["Talking1", "Talking2", "Talking3"].forEach((key) => softStop(actions?.[key], FADE_BASE));
    state.currentTalkKey = null;
  };

  const stopListeningLoop = () => softStop(actions?.Listening, FADE_BASE);

  const backToIdle = (fade = FADE_BASE) => {
    if (state.sessionEnded) return;
    if (state.currentMainAction) {
      softStop(state.currentMainAction, fade);
      state.currentMainAction = null;
    }
    stopAllTalking();
    stopListeningLoop();
    state.mode = "idle";
    state.currentTalkKey = null;
    ensureIdleFloor();
  };

  let blendGuardRAF = 0;
  let waveStartGuardRAF = 0;

  const cancelWaveToIdleGuard = () => {
    if (blendGuardRAF) {
      cancelAnimationFrame(blendGuardRAF);
      blendGuardRAF = 0;
    }
  };

  const cancelWaveStartGuard = () => {
    if (waveStartGuardRAF) {
      cancelAnimationFrame(waveStartGuardRAF);
      waveStartGuardRAF = 0;
    }
  };

  const startWaveStartGuard = (idle, ms = WAVE_START_GUARD_MS) => {
    if (!idle) return;
    cancelWaveStartGuard();
    const t0 = performance.now();
    const tick = (now) => {
      if (state.sessionEnded || state.mode !== "wave") {
        waveStartGuardRAF = 0;
        return;
      }
      try {
        idle.enabled = true;
        idle.paused = false;
        const weight = idle.getEffectiveWeight?.() ?? 0;
        if (weight < WAVE_IDLE_FENCE_WEIGHT) {
          idle.setEffectiveWeight(WAVE_IDLE_FENCE_WEIGHT);
        }
      } catch {}

      if (now - t0 < ms) {
        waveStartGuardRAF = requestAnimationFrame(tick);
      } else {
        try {
          idle.setEffectiveWeight(WAVE_ACTIVE_IDLE_WEIGHT);
          if (WAVE_ACTIVE_IDLE_WEIGHT <= 0) {
            idle.fadeOut?.(0.08);
          }
        } catch {}
        waveStartGuardRAF = 0;
      }
    };

    waveStartGuardRAF = requestAnimationFrame(tick);
  };

  const startWaveToIdleGuard = (wave, idle, ms = 280) => {
    cancelWaveToIdleGuard();
    cancelWaveStartGuard();
    const t0 = performance.now();
    const floor = WAVE_EXIT_IDLE_FLOOR;

    try {
      idle.enabled = true;
      idle.paused = false;
      idle.setEffectiveWeight(Math.max(floor, idle.getEffectiveWeight?.() ?? floor));
      wave.enabled = true;
      wave.paused = false;
      wave.setEffectiveWeight(Math.min(1 - floor, wave.getEffectiveWeight?.() ?? 1 - floor));
    } catch {}

    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const idleW = Math.max(floor, floor + (1 - floor) * t);
      const waveW = (1 - floor) * (1 - t);

      try {
        idle.enabled = true;
        idle.paused = false;
        idle.setEffectiveWeight(idleW);
        wave.enabled = true;
        wave.paused = false;
        wave.setEffectiveWeight(waveW);
      } catch {}

      if (t < 1) {
        blendGuardRAF = requestAnimationFrame(tick);
      } else {
        try {
          idle.setEffectiveWeight(1);
          wave.setEffectiveWeight(0);
          wave.stop();
          wave.enabled = false;
        } catch {}
        blendGuardRAF = 0;
      }
    };

    blendGuardRAF = requestAnimationFrame(tick);
  };

  const crossFadeToIdleWithGuard = (wave, fade = FADE_WAVE) => {
    const idle = actions?.Idle;
    if (!idle || !wave) return;

    ensureIdleRunning();
    try {
      idle.enabled = true;
      idle.paused = false;
      idle.setLoop(THREE.LoopRepeat, Infinity);
      idle.clampWhenFinished = false;
      if (!idle.isRunning()) idle.play();
      idle.setEffectiveWeight(1);
      wave.crossFadeTo(idle, fade, true);
    } catch {}

    startWaveToIdleGuard(wave, idle, Math.ceil(fade * 1000));
    ensureIdleFloor();
  };

  const startTalkingLoop = () => {
    const wave = actions?.Wave;
    if (state.mode === "wave" || (wave && wave.isRunning())) return;
    if (state.mode === "listening") stopListeningLoop();
    if (state.mode === "talking" && state.currentTalkKey) {
      const current = actions?.[state.currentTalkKey];
      if (current && current.isRunning()) return ensureIdleFloor();
    }
    const pick = state.currentTalkKey || weightedPick(TALK_WEIGHTS);
    const talk = actions?.[pick];
    if (!talk) return backToIdle(0.18);

    stopAllTalking();
    state.currentTalkKey = pick;
    state.mode = "talking";
    transitionMainTo(pick, { fade: 0.18, reset: true, once: false });
    ensureIdleFloor();
  };

  const playListeningOnceThenIdle = () => {
    const listen = actions?.Listening;
    if (!listen || state.mode === "listening") return null;

    state.mode = "listening";
    stopAllTalking();
    transitionMainTo("Listening", { fade: FADE_INTERRUPT, reset: true, once: true });
    ensureIdleFloor();

    const back = () => !state.sessionEnded && backToIdle(FADE_BASE);
    const onFinished = (event) => {
      const name = event?.action?._clip?.name || event?.action?.getClip?.()?.name;
      if (name === "Listening") back();
    };

    mixer?.addEventListener("finished", onFinished);
    const duration = listen.getClip()?.duration ?? 1.6;
    const timer = setTimeout(() => back(), Math.ceil(duration * 1000) + 220);

    return () => {
      mixer?.removeEventListener("finished", onFinished);
      clearTimeout(timer);
    };
  };

  const startListeningLoop = () => {
    const wave = actions?.Wave;
    if (state.mode === "wave" || (wave && wave.isRunning())) return;
    if (state.mode === "talking") stopAllTalking();
    const entering = state.mode !== "listening";
    state.mode = "listening";
    transitionMainTo("Listening", { fade: FADE_BASE, reset: entering, once: false });
    ensureIdleFloor();
  };

  const startWaveOnce = () => {
    const wave = actions?.Wave;
    if (!wave) {
      setIsWaving?.(false);
      setIsWavingExternal?.(false);
      state.waveLocked = false;
      return backToIdle(FADE_BASE);
    }

    const now = Date.now();
    if (now < state.waveCooldownUntil || state.waveLocked) return;

    cancelWaveToIdleGuard();
    cancelWaveStartGuard();
    state.waveLocked = true;
    state.mode = "wave";
    stopAllTalking();
    stopListeningLoop();

    transitionMainTo("Wave", { fade: 0.12, reset: true, once: true });
    try {
      mixer?.update(1 / 120);
    } catch {}
    const idle = actions?.Idle;
    if (idle) {
      try {
        idle.enabled = true;
        idle.paused = false;
        idle.setEffectiveWeight(Math.max(WAVE_IDLE_FENCE_WEIGHT, idle.getEffectiveWeight?.() ?? 0));
      } catch {}
      startWaveStartGuard(idle, WAVE_START_GUARD_MS);
    }

    let exited = false;
    const doExit = () => {
      if (exited || state.sessionEnded) return;
      exited = true;
      cancelWaveStartGuard();
      crossFadeToIdleWithGuard(wave, FADE_WAVE);
      state.currentMainAction = null;
      state.waveLocked = false;
      state.mode = "idle";
      setIsWaving?.(false);
      setIsWavingExternal?.(false);
      state.waveCooldownUntil = Date.now() + WAVE_COOLDOWN_MS;
    };

    const duration = wave.getClip()?.duration ?? 2.5;
    const durationMs = duration * 1000;
    const tRatio = Math.floor(durationMs * WAVE_EXIT_RATIO);
    const tFade = Math.floor(Math.max(0, durationMs - FADE_WAVE * 1000 - 60));
    const exitAt = Math.max(50, Math.min(tRatio, tFade));
    const timerExit = setTimeout(() => doExit(), exitAt);

    const onFinished = (event) => {
      const name = event?.action?._clip?.name || event?.action?.getClip?.()?.name;
      if (name === "Wave") doExit();
    };

    mixer?.addEventListener("finished", onFinished);
    state.cleanupWave = () => {
      clearTimeout(timerExit);
      mixer?.removeEventListener("finished", onFinished);
    };
  };

  const endSessionNow = () => {
    state.sessionEnded = true;
    cancelWaveToIdleGuard();
    cancelWaveStartGuard();
    try {
      state.cleanupListeningOnce?.();
    } catch {}
    try {
      state.cleanupWave?.();
    } catch {}
    state.cleanupListeningOnce = null;
    state.cleanupWave = null;
    state.waveLocked = false;
    state.currentTalkKey = null;
    state.mode = "idle";
    state.talkingHoldUntil = 0;
    state.currentMainAction = null;

    ["Wave", "Listening", "Talking1", "Talking2", "Talking3"].forEach((key) => {
      const action = actions?.[key];
      if (action) hardStopNow(action);
    });

    const idle = actions?.Idle;
    if (idle) {
      try {
        idle.enabled = true;
        idle.paused = false;
        idle.setEffectiveWeight(1);
        idle.setEffectiveTimeScale(1);
        idle.reset();
        idle.setLoop(THREE.LoopRepeat, Infinity);
        idle.clampWhenFinished = false;
        idle.play();
      } catch {}
    }

    setIsWaving?.(false);
    setIsWavingExternal?.(false);
  };

  const beginSessionNow = () => {
    state.sessionEnded = false;
    state.mode = "idle";
    state.currentTalkKey = null;
    state.currentMainAction = null;
    ensureIdleRunning();
    ensureIdleFloor();
  };

  ensureIdleRunning();
  ensureIdleFloor();

  return {
    update({ isWaving, isTalking, interruptSeq, userSpeaking }) {
      const now = Date.now();
      if (state.sessionEnded) {
        ensureIdleFloor();
        return;
      }
      if (isWaving) {
        startWaveOnce();
        return;
      }
      if (userSpeaking) {
        startListeningLoop();
        ensureIdleFloor();
        return;
      }
      if (isTalking) {
        state.talkingHoldUntil = now + TALK_HANGOVER_MS;
      } else if (now < state.talkingHoldUntil) {
        isTalking = true;
      }

      if (
        interruptSeq &&
        interruptSeq !== state.lastInterruptSeq &&
        now >= state.interruptCooldownUntil
      ) {
        state.lastInterruptSeq = interruptSeq;
        const wave = actions?.Wave;
        const waveRunning = state.mode === "wave" || (wave && wave.isRunning());
        const canInterrupt = !waveRunning && (isTalking || state.mode === "talking");
        if (canInterrupt) {
          stopAllTalking();
          state.cleanupListeningOnce = playListeningOnceThenIdle();
          state.interruptCooldownUntil = now + 400;
        }
        ensureIdleFloor();
        return;
      }

      if (isTalking) {
        startTalkingLoop();
        ensureIdleFloor();
        return;
      }

      if (state.mode !== "idle") backToIdle(FADE_BASE);
      ensureIdleFloor();
    },
    endSessionNow,
    beginSessionNow,
    dispose() {
      cancelWaveToIdleGuard();
      cancelWaveStartGuard();
      try {
        state.cleanupListeningOnce?.();
        state.cleanupWave?.();
      } catch {}
      ["Idle", "Wave", "Listening", "Talking1", "Talking2", "Talking3"].forEach((key) => {
        const action = actions?.[key];
        if (action) clearStopTimer(action);
      });
    },
  };
}
