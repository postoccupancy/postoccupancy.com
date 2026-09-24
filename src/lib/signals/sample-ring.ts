export interface Sample { seq: number; t: number; v: number }

// Adapted from electric-sky/esp32-s3-cam/include/Dashboard.h's Ring.
// Retain at most 25 seconds / 25,000 samples, including the presentation delay.
export class SampleRing {
  private samples: (Sample | undefined)[] = new Array(25_000);
  private head = 0;
  private count = 0;
  gaps = 0;

  clear() {
    this.head = 0;
    this.count = 0;
    this.gaps = 0;
  }

  push(sample: Sample) {
    const previous = this.latest();
    if (previous && (sample.t < previous.t || sample.seq <= previous.seq)) return;
    if (previous) this.gaps += Math.max(0, sample.seq - previous.seq - 1);
    this.samples[this.head] = sample;
    this.head = (this.head + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
    while (this.count > 0) {
      const oldest = (this.head - this.count + this.samples.length) % this.samples.length;
      if (sample.t - this.samples[oldest]!.t <= 25_000_000) break;
      this.samples[oldest] = undefined;
      this.count--;
    }
  }

  latest() {
    return this.count ? this.samples[(this.head - 1 + this.samples.length) % this.samples.length] : undefined;
  }

  visitRange(start: number, end: number, visit: (sample: Sample) => void) {
    const first = (this.head - this.count + this.samples.length) % this.samples.length;
    for (let i = 0; i < this.count; i++) {
      const sample = this.samples[(first + i) % this.samples.length]!;
      if (sample.t >= start && sample.t <= end) visit(sample);
    }
  }
}
