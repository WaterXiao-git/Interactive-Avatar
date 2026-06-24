export function createVoiceWsClient({
  url,
  onRxLevel,
  onTxLevel,
  onTextEvent,
  onAssistantPlaybackStarted,
  onAssistantPlaybackEnded,
  onAssistantAudioIn,
  onWsOpen,
  onWsClose,
  onWsError,
}) {
  let ws = null;
  let ctx = null;
  let srcNode = null;
  let workletNode = null;

  let curNode = null;
  const playQueue = [];
  let isPlaying = false;

  let playbackActive = false;
  let drainTimer = null;

  let txAcc = new Int16Array(0);

  function floatToInt16(f) {
    const v = Math.max(-1, Math.min(1, f));
    return v < 0 ? v * 0x8000 : v * 0x7fff;
  }

  function resampleTo16k(float32, inputRate) {
    const targetRate = 16000;
    if (inputRate === targetRate) return float32;

    const ratio = inputRate / targetRate;
    const outLen = Math.floor(float32.length / ratio);
    const out = new Float32Array(outLen);

    for (let i = 0; i < outLen; i += 1) {
      const idx = i * ratio;
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, float32.length - 1);
      const t = idx - i0;
      out[i] = float32[i0] * (1 - t) + float32[i1] * t;
    }
    return out;
  }

  function pushTx(float32_16k) {
    const i16 = new Int16Array(float32_16k.length);
    for (let i = 0; i < float32_16k.length; i += 1) i16[i] = floatToInt16(float32_16k[i]);

    const merged = new Int16Array(txAcc.length + i16.length);
    merged.set(txAcc, 0);
    merged.set(i16, txAcc.length);
    txAcc = merged;

    const CHUNK = 320;
    while (txAcc.length >= CHUNK) {
      const chunk = txAcc.slice(0, CHUNK);
      txAcc = txAcc.slice(CHUNK);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(chunk.buffer);
      }
    }
  }

  function int16ToFloat32(int16) {
    const f = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i += 1) f[i] = int16[i] / 0x8000;
    return f;
  }

  function calcRms(float32) {
    let sum = 0;
    for (let i = 0; i < float32.length; i += 1) sum += float32[i] * float32[i];
    return Math.sqrt(sum / float32.length);
  }

  function setPlaybackActive(next) {
    if (playbackActive === next) return;
    playbackActive = next;
    if (next) onAssistantPlaybackStarted?.(Date.now());
    else onAssistantPlaybackEnded?.(Date.now());
  }

  function scheduleDrainCheck() {
    if (drainTimer) clearTimeout(drainTimer);
    drainTimer = setTimeout(() => {
      drainTimer = null;
      const empty = playQueue.length === 0 && !isPlaying && !curNode;
      if (empty) setPlaybackActive(false);
    }, 450);
  }

  function interruptPlayback() {
    playQueue.length = 0;
    isPlaying = false;
    try {
      curNode?.stop();
    } catch {}
    curNode = null;
    scheduleDrainCheck();
    setPlaybackActive(false);
  }

  function sendJson(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {}
  }

  function interrupt() {
    interruptPlayback();
    sendJson({ type: "interrupt" });
  }

  async function playPcm16(pcmBuf) {
    if (!ctx) return;

    onAssistantAudioIn?.(Date.now());

    const int16 = new Int16Array(pcmBuf);
    const f32 = int16ToFloat32(int16);

    onRxLevel?.(calcRms(f32));

    const audioBuffer = ctx.createBuffer(1, f32.length, 24000);
    audioBuffer.copyToChannel(f32, 0);

    playQueue.push(audioBuffer);
    setPlaybackActive(true);

    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }

    if (!isPlaying) {
      const drainPlayQueue = () => {
        if (!ctx) return;

        const buf = playQueue.shift();
        if (!buf) {
          isPlaying = false;
          scheduleDrainCheck();
          return;
        }

        isPlaying = true;

        const node = ctx.createBufferSource();
        curNode = node;
        node.buffer = buf;
        node.connect(ctx.destination);
        node.onended = () => {
          if (curNode === node) curNode = null;
          drainPlayQueue();
        };

        try {
          node.start();
        } catch {
          drainPlayQueue();
        }
      };

      drainPlayQueue();
    }
  }

  async function start() {
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      onWsOpen?.();
    };

    ws.onerror = (event) => {
      onWsError?.(event);
    };

    ws.onclose = (event) => {
      onWsClose?.(event);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        playPcm16(event.data);
        return;
      }
      try {
        const msg = JSON.parse(event.data);
        onTextEvent?.(msg);
      } catch {}
    };

    await new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", (event) => reject(event), { once: true });
    });

    ctx = new (window.AudioContext || window.webkitAudioContext)();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    srcNode = ctx.createMediaStreamSource(stream);

    await ctx.audioWorklet.addModule("/audios/mic-worklet.js");
    workletNode = new AudioWorkletNode(ctx, "mic-processor");
    srcNode.connect(workletNode);

    workletNode.port.onmessage = (event) => {
      if (!ws || ws.readyState !== WebSocket.OPEN || !ctx) return;

      const floatChunk = event.data;
      const f16k = resampleTo16k(floatChunk, ctx.sampleRate);

      onTxLevel?.(calcRms(f16k));
      pushTx(f16k);
    };
  }

  async function stop() {
    try {
      interruptPlayback();
    } catch {}

    try {
      if (drainTimer) clearTimeout(drainTimer);
      drainTimer = null;
    } catch {}

    try {
      if (workletNode) workletNode.port.onmessage = null;
      if (workletNode) workletNode.disconnect();
      if (srcNode) srcNode.disconnect();
      if (ctx) await ctx.close();
    } catch {}

    try {
      if (ws) ws.close();
    } catch {}

    ws = null;
    ctx = null;
    srcNode = null;
    workletNode = null;
    playQueue.length = 0;
    isPlaying = false;
    txAcc = new Int16Array(0);
    curNode = null;
    setPlaybackActive(false);
  }

  return { start, stop, interruptPlayback, interrupt };
}
