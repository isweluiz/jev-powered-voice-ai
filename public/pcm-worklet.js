// Bandwidth: 16 kHz mono PCM16, 160 ms (2,560 samples / 5,120 bytes).
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(2560);
    this.offset = 0;
    this.stopped = false;
    this.port.onmessage = event => {
      if (event.data !== 'flush') return;
      this.stopped = true;
      if (this.offset) this.emit(Math.max(320, this.offset)); // Pad a sub-20 ms tail with silence.
      this.port.postMessage({ type: 'flushed' });
    };
  }
  emit(length) {
    const bytes = new ArrayBuffer(length * 2);
    const view = new DataView(bytes);
    for (let i = 0; i < length; i++) view.setInt16(i * 2, i < this.offset ? this.samples[i] : 0, true);
    this.port.postMessage({ type: 'audio', bytes }, [bytes]);
    this.offset = 0;
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      value = Math.max(-1, Math.min(1, value / channels.length));
      this.samples[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767));
      if (this.offset === this.samples.length) this.emit(this.offset);
    }
    return true; // Output remains silent; captured audio is never played back.
  }
}
registerProcessor('bandwidth-pcm', PCMProcessor);
