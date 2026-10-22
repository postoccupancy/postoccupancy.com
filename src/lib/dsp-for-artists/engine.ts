import type { DspParameters } from './course';

export const DSP_BANDS = 256;
export const DSP_MIN_HZ = 60;
export const DSP_MAX_HZ = 6000;
export const DSP_ANALYSIS_INTERVAL_MS = 50;

export function dspBandFrequency(index: number) {
  return DSP_MIN_HZ * Math.pow(DSP_MAX_HZ / DSP_MIN_HZ, index / (DSP_BANDS - 1));
}

export interface DspOscillatorConfig {
  id: string;
  frequency: number;
  waveform: OscillatorType;
  level: number;
  cutoff: number;
  q: number;
  generating: boolean;
  analyzing: boolean;
  audible: boolean;
}

export interface DspAnalysisFrame {
  sequence: number;
  timestamp: number;
  sampleRate: number;
  fftSize: number;
  fftBinsDb: Float32Array<ArrayBuffer>;
  fftBandsDb: Float32Array<ArrayBuffer>;
  cwtBandsDb?: Float32Array<ArrayBuffer>;
  waveform: Float32Array<ArrayBuffer>;
  rms: number;
}

export interface DspEngineStatus {
  state: 'idle' | 'running' | 'paused' | 'error';
  source: DspParameters['source'];
  message: string;
}

export interface DspEngineContract {
  configure(parameters: DspParameters, oscillators?: DspOscillatorConfig[]): void;
  start(): Promise<void>;
  useMicrophone(): Promise<void>;
  pause(paused: boolean): Promise<void>;
  subscribe(listener: (frame: DspAnalysisFrame) => void): () => void;
  subscribeStatus(listener: (status: DspEngineStatus) => void): () => void;
  getLatestFrame(): DspAnalysisFrame | null;
  getStatus(): DspEngineStatus;
  destroy(): Promise<void>;
}

interface OscillatorVoice {
  oscillator: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  analysisConnected: boolean;
  monitorConnected: boolean;
}

interface CwtKernel {
  real: Float32Array<ArrayBuffer>;
  imaginary: Float32Array<ArrayBuffer>;
  radius: number;
  scale: number;
}

const mediaConstraints: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  video: false,
};

export function oscillatorsFromParameters(parameters: DspParameters): DspOscillatorConfig[] {
  return [parameters.frequency, parameters.secondFrequency].map((frequency, index) => ({
    id: `oscillator-${index + 1}`,
    frequency,
    waveform: parameters.oscillatorWave,
    level: parameters.oscillatorVolume / 100 * 0.5,
    cutoff: parameters.oscillatorCutoff,
    q: parameters.oscillatorQ,
    generating: true,
    analyzing: parameters.source === 'oscillator',
    audible: parameters.monitor,
  }));
}

export class DspEngine implements DspEngineContract {
  private parameters: DspParameters;
  private oscillatorConfigs: DspOscillatorConfig[];
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private cwtAnalyser: AnalyserNode | null = null;
  private analysisBus: GainNode | null = null;
  private monitorBus: GainNode | null = null;
  private voices = new Map<string, OscillatorVoice>();
  private microphoneStream: MediaStream | null = null;
  private microphoneSource: MediaStreamAudioSourceNode | null = null;
  private microphoneConnected = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sequence = 0;
  private latestFrame: DspAnalysisFrame | null = null;
  private listeners = new Set<(frame: DspAnalysisFrame) => void>();
  private statusListeners = new Set<(status: DspEngineStatus) => void>();
  private status: DspEngineStatus = { state: 'idle', source: 'oscillator', message: 'Audio off' };
  private fftData = new Float32Array(0);
  private waveformData = new Float32Array(0);
  private cwtData = new Float32Array(0);
  private cwtKernels: CwtKernel[] | null = null;
  private cwtKernelKey = '';
  private cwtSmoothed = new Float32Array(DSP_BANDS).fill(-120);
  private previousAnalysisAt = 0;

  constructor(parameters: DspParameters) {
    this.parameters = parameters;
    this.oscillatorConfigs = oscillatorsFromParameters(parameters);
    this.status.source = parameters.source;
  }

  configure(parameters: DspParameters, oscillators = oscillatorsFromParameters(parameters)) {
    const fftChanged = parameters.fftSize !== this.parameters.fftSize;
    const cwtChanged = parameters.cwtCycles !== this.parameters.cwtCycles;
    this.parameters = parameters;
    this.oscillatorConfigs = oscillators;
    this.status = { ...this.status, source: parameters.source };
    if (!this.context) return;
    if (fftChanged && this.analyser) {
      this.analyser.fftSize = parameters.fftSize;
      this.fftData = new Float32Array(this.analyser.frequencyBinCount);
    }
    if (cwtChanged) this.cwtKernels = null;
    this.syncVoices();
    this.syncInputRouting();
  }

  async start() {
    try {
      this.ensureGraph();
      await this.context!.resume();
      this.syncVoices();
      this.syncInputRouting();
      if (!this.timer) this.timer = setInterval(() => this.analyze(), DSP_ANALYSIS_INTERVAL_MS);
      this.setStatus('running', this.parameters.source === 'microphone' ? 'Microphone analyzing' : 'Oscillators analyzing');
    } catch (error) {
      this.setStatus('error', `Audio unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
      throw error;
    }
  }

  async useMicrophone() {
    try {
      this.ensureGraph();
      if (!this.microphoneStream) {
        this.microphoneStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        this.microphoneSource = this.context!.createMediaStreamSource(this.microphoneStream);
      }
      await this.context!.resume();
      this.parameters = { ...this.parameters, source: 'microphone' };
      this.syncInputRouting();
      if (!this.timer) this.timer = setInterval(() => this.analyze(), DSP_ANALYSIS_INTERVAL_MS);
      this.setStatus('running', 'Microphone analyzing');
    } catch (error) {
      this.setStatus('error', `Microphone unavailable: ${error instanceof Error ? error.message : 'permission denied'}`);
      throw error;
    }
  }

  async pause(paused: boolean) {
    if (!this.context) return;
    if (paused) {
      await this.context.suspend();
      this.setStatus('paused', 'Audio paused');
    } else {
      await this.context.resume();
      this.setStatus('running', this.parameters.source === 'microphone' ? 'Microphone analyzing' : 'Oscillators analyzing');
    }
  }

  subscribe(listener: (frame: DspAnalysisFrame) => void) {
    this.listeners.add(listener);
    if (this.latestFrame) listener(this.latestFrame);
    return () => { this.listeners.delete(listener); };
  }

  subscribeStatus(listener: (status: DspEngineStatus) => void) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => { this.statusListeners.delete(listener); };
  }

  getLatestFrame() { return this.latestFrame; }
  getStatus() { return this.status; }

  async destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.microphoneStream?.getTracks().forEach(track => track.stop());
    this.microphoneStream = null;
    for (const voice of this.voices.values()) {
      try { voice.oscillator.stop(); } catch {}
      voice.oscillator.disconnect();
      voice.filter.disconnect();
      voice.gain.disconnect();
    }
    this.voices.clear();
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') await context.close();
    this.listeners.clear();
    this.statusListeners.clear();
  }

  private ensureGraph() {
    if (this.context) return;
    this.context = new AudioContext();
    this.analysisBus = this.context.createGain();
    this.monitorBus = this.context.createGain();
    this.monitorBus.connect(this.context.destination);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = this.parameters.fftSize;
    this.analyser.smoothingTimeConstant = 0;
    this.analyser.minDecibels = -120;
    this.analyser.maxDecibels = 0;
    this.cwtAnalyser = this.context.createAnalyser();
    this.cwtAnalyser.fftSize = 16384;
    this.cwtAnalyser.smoothingTimeConstant = 0;
    this.analysisBus.connect(this.analyser);
    this.analysisBus.connect(this.cwtAnalyser);
    this.fftData = new Float32Array(this.analyser.frequencyBinCount);
    this.waveformData = new Float32Array(this.analyser.fftSize);
    this.cwtData = new Float32Array(this.cwtAnalyser.fftSize);
    this.syncVoices();
  }

  private syncVoices() {
    if (!this.context || !this.analysisBus || !this.monitorBus) return;
    const wanted = new Set(this.oscillatorConfigs.map(config => config.id));
    for (const [id, voice] of this.voices) {
      if (wanted.has(id)) continue;
      try { voice.oscillator.stop(); } catch {}
      voice.oscillator.disconnect();
      voice.filter.disconnect();
      voice.gain.disconnect();
      this.voices.delete(id);
    }
    for (const config of this.oscillatorConfigs) {
      let voice = this.voices.get(config.id);
      if (!voice) {
        const oscillator = this.context.createOscillator();
        const filter = this.context.createBiquadFilter();
        const gain = this.context.createGain();
        filter.type = 'lowpass';
        oscillator.connect(filter);
        filter.connect(gain);
        oscillator.start();
        voice = { oscillator, filter, gain, analysisConnected: false, monitorConnected: false };
        this.voices.set(config.id, voice);
      }
      const now = this.context.currentTime;
      voice.oscillator.type = config.waveform;
      voice.oscillator.frequency.setTargetAtTime(config.frequency, now, 0.008);
      voice.filter.frequency.setTargetAtTime(config.cutoff, now, 0.01);
      voice.filter.Q.setTargetAtTime(config.q, now, 0.01);
      voice.gain.gain.setTargetAtTime(config.generating ? config.level : 0, now, 0.01);
      const analyze = config.analyzing && this.parameters.source === 'oscillator';
      if (analyze !== voice.analysisConnected) {
        if (analyze) voice.gain.connect(this.analysisBus); else voice.gain.disconnect(this.analysisBus);
        voice.analysisConnected = analyze;
      }
      if (config.audible !== voice.monitorConnected) {
        if (config.audible) voice.gain.connect(this.monitorBus); else voice.gain.disconnect(this.monitorBus);
        voice.monitorConnected = config.audible;
      }
    }
  }

  private syncInputRouting() {
    if (!this.analysisBus) return;
    const microphoneShouldAnalyze = this.parameters.source === 'microphone' && !!this.microphoneSource;
    if (microphoneShouldAnalyze !== this.microphoneConnected) {
      if (microphoneShouldAnalyze) this.microphoneSource!.connect(this.analysisBus);
      else this.microphoneSource?.disconnect(this.analysisBus);
      this.microphoneConnected = microphoneShouldAnalyze;
    }
    this.syncVoices();
  }

  private analyze() {
    if (!this.context || !this.analyser || !this.cwtAnalyser || this.context.state !== 'running') return;
    if (this.fftData.length !== this.analyser.frequencyBinCount) this.fftData = new Float32Array(this.analyser.frequencyBinCount);
    if (this.waveformData.length !== this.analyser.fftSize) this.waveformData = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatFrequencyData(this.fftData);
    this.analyser.getFloatTimeDomainData(this.waveformData);
    const fftBinsDb = this.fftData.slice();
    const waveform = this.waveformData.slice();
    const fftBandsDb = this.fftBands(fftBinsDb);
    let cwtBandsDb: Float32Array<ArrayBuffer> | undefined;
    if (this.parameters.analysis === 'cwt' || this.parameters.mode === 'scalogram') cwtBandsDb = this.cwtBands();
    let energy = 0;
    for (const sample of waveform) energy += sample * sample;
    const frame: DspAnalysisFrame = {
      sequence: ++this.sequence,
      timestamp: performance.now(),
      sampleRate: this.context.sampleRate,
      fftSize: this.analyser.fftSize,
      fftBinsDb,
      fftBandsDb,
      cwtBandsDb,
      waveform,
      rms: Math.sqrt(energy / Math.max(1, waveform.length)),
    };
    this.latestFrame = frame;
    for (const listener of this.listeners) listener(frame);
  }

  private fftBands(bins: Float32Array<ArrayBuffer>) {
    const output = new Float32Array(DSP_BANDS);
    const binHz = this.context!.sampleRate / this.analyser!.fftSize;
    for (let index = 0; index < DSP_BANDS; index++) {
      const leftHz = index === 0 ? DSP_MIN_HZ : Math.sqrt(dspBandFrequency(index - 1) * dspBandFrequency(index));
      const rightHz = index === DSP_BANDS - 1 ? DSP_MAX_HZ : Math.sqrt(dspBandFrequency(index) * dspBandFrequency(index + 1));
      const left = Math.max(0, Math.floor(leftHz / binHz));
      const right = Math.min(bins.length - 1, Math.ceil(rightHz / binHz));
      let best = -120;
      for (let bin = left; bin <= right; bin++) if (Number.isFinite(bins[bin])) best = Math.max(best, bins[bin]);
      output[index] = best;
    }
    return output;
  }

  private cwtBands() {
    this.cwtAnalyser!.getFloatTimeDomainData(this.cwtData);
    const kernels = this.getCwtKernels();
    const output = new Float32Array(DSP_BANDS);
    const center = (this.cwtData.length / 2 - 1) | 0;
    const now = performance.now();
    const dt = this.previousAnalysisAt ? Math.min(0.5, Math.max(0.001, (now - this.previousAnalysisAt) / 1000)) : DSP_ANALYSIS_INTERVAL_MS / 1000;
    this.previousAnalysisAt = now;
    const averaging = this.parameters.cwtAverage / 1000;
    const alpha = averaging <= 0 ? 1 : 1 - Math.exp(-dt / averaging);
    for (let index = 0; index < DSP_BANDS; index++) {
      const kernel = kernels[index];
      let real = 0, imaginary = 0;
      for (let offset = -kernel.radius; offset <= kernel.radius; offset++) {
        const sample = this.cwtData[center + offset];
        const kernelIndex = offset + kernel.radius;
        real += sample * kernel.real[kernelIndex];
        imaginary += sample * kernel.imaginary[kernelIndex];
      }
      const db = Math.max(-120, 20 * Math.log10(Math.max(1e-6, Math.hypot(real, imaginary) * kernel.scale)));
      this.cwtSmoothed[index] = this.cwtSmoothed[index] <= -119 ? db : this.cwtSmoothed[index] + alpha * (db - this.cwtSmoothed[index]);
      output[index] = this.cwtSmoothed[index];
    }
    return output;
  }

  private getCwtKernels() {
    const key = `${this.context!.sampleRate}:${this.parameters.cwtCycles}`;
    if (this.cwtKernels && this.cwtKernelKey === key) return this.cwtKernels;
    this.cwtKernelKey = key;
    this.cwtSmoothed.fill(-120);
    this.cwtKernels = Array.from({ length: DSP_BANDS }, (_, index) => {
      const frequency = dspBandFrequency(index);
      const sigma = this.parameters.cwtCycles / (2 * Math.PI * frequency);
      const radius = Math.min(8191, Math.ceil(3 * sigma * this.context!.sampleRate));
      const real = new Float32Array(2 * radius + 1);
      const imaginary = new Float32Array(2 * radius + 1);
      let weight = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const time = offset / this.context!.sampleRate;
        const envelope = Math.exp(-0.5 * (time / sigma) ** 2);
        const phase = 2 * Math.PI * frequency * time;
        real[offset + radius] = envelope * Math.cos(phase);
        imaginary[offset + radius] = envelope * Math.sin(phase);
        weight += envelope;
      }
      return { real, imaginary, radius, scale: 2 / weight };
    });
    return this.cwtKernels;
  }

  private setStatus(state: DspEngineStatus['state'], message: string) {
    this.status = { state, source: this.parameters.source, message };
    for (const listener of this.statusListeners) listener(this.status);
  }
}
