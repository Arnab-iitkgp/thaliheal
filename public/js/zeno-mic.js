/* Batch the mono 16 kHz browser input into 64 ms PCM frames. */
class ZenoMic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new DataView(new ArrayBuffer(2048));
    this.offset = 0;
    this.phase = 0;
    this.sum = 0;
    this.samples = 0;
  }

  process(inputs) {
    const mono = inputs[0]?.[0];
    if (!mono) return true;
    for (const sample of mono) {
      this.sum += sample;
      this.samples++;
      this.phase += 16000;
      if (this.phase < sampleRate) continue;
      const level = Math.max(-1, Math.min(1, this.sum / this.samples));
      this.frame.setInt16(this.offset, level * (level < 0 ? 32768 : 32767), true);
      this.offset += 2;
      this.phase -= sampleRate;
      this.sum = this.samples = 0;
      if (this.offset === this.frame.byteLength) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new DataView(new ArrayBuffer(2048));
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("zeno-mic", ZenoMic);
