class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) {
      for (const x of input) this.samples.push(x);
      if (this.samples.length >= 512) {
        this.port.postMessage(new Float32Array(this.samples));
        this.samples = [];
      }
    }
    return true;
  }
}
registerProcessor("cue-capture", Capture);
