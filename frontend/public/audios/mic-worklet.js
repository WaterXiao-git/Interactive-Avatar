class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._acc = [];
    this._accLen = 0;
    this.targetLen = 320; // 16kHz * 20ms

    // worklet 端是浮点32，采样率通常是 48k，需要在主线程重采样
    // 这里先把原始 float chunk 发回主线程
  }

  process(inputs) {
    const input = inputs[0];
    const ch0 = input && input[0];
    if (!ch0) return true;

    // 直接发 float32 给主线程（主线程做重采样/量化）
    this.port.postMessage(ch0);

    return true;
  }
}
registerProcessor("mic-processor", MicProcessor);
