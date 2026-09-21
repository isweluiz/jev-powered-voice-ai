export class VoiceWaveform {
  constructor(canvas, card) {
    this.canvas = canvas; this.card = card; this.mode = 'idle'; this.analyser = null;
    this.samples = new Uint8Array(256); this.levels = new Float32Array(44);
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.frame = requestAnimationFrame(() => this.draw());
  }
  setMode(mode) { this.mode = mode; this.card.dataset.state = mode; }
  setAnalyser(analyser) {
    this.analyser = analyser;
    if (analyser) this.samples = new Uint8Array(analyser.fftSize);
  }
  draw() {
    const { canvas } = this;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    }
    const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    const live = this.analyser && ['playing', 'listening'].includes(this.mode);
    if (live) this.analyser.getByteTimeDomainData(this.samples);
    ctx.fillStyle = getComputedStyle(this.card).getPropertyValue('--wave-color').trim() || '#8192ff';
    const step = width / this.levels.length;
    for (let i = 0; i < this.levels.length; i++) {
      let level = 0;
      if (live) {
        const start = Math.floor(i * this.samples.length / this.levels.length);
        const end = Math.floor((i + 1) * this.samples.length / this.levels.length);
        for (let j = start; j < end; j++) level = Math.max(level, Math.abs(this.samples[j] - 128) / 128);
      }
      this.levels[i] = this.reducedMotion.matches ? level : Math.max(level, this.levels[i] * .82);
      const bar = Math.max(3, Math.min(height - 6, this.levels[i] * height * 2.8));
      ctx.beginPath(); ctx.roundRect(i * step + 1, (height - bar) / 2, Math.max(2, step - 3), bar, 2); ctx.fill();
    }
    this.frame = requestAnimationFrame(() => this.draw());
  }
  destroy() { cancelAnimationFrame(this.frame); }
}
