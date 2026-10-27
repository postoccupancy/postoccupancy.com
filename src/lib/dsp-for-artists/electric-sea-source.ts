import type { DspOscillator } from './course';
import type { RouterClient, RouterMessage } from '../signals/router-client';
import { mapEnvironmentalPitch, type PitchMode } from '../voices/pitch-mapping';
import { DEFAULT_MAXIMUM_VOICES, VoiceAllocator, type IncomingVoice } from '../voices/voice-allocator';

export interface ElectricSeaSettings {
  streamId: string;
  baseMidiNote: number;
  pitchSpanSemitones: number;
  pitchMode: PitchMode;
  maximumVoices: number;
}

export interface ElectricSeaSnapshot {
  connection: RouterClient['status'];
  streams: string[];
  activeVoiceCount: number;
  allocatedVoiceCount: number;
  oscillators: DspOscillator[];
}

export const defaultElectricSeaSettings: ElectricSeaSettings = {
  streamId: 'all',
  baseMidiNote: 48,
  pitchSpanSemitones: 36,
  pitchMode: 'continuous',
  maximumVoices: DEFAULT_MAXIMUM_VOICES,
};

type Schedule = (callback: () => void) => void;
type Timer = ReturnType<typeof setTimeout>;
interface SourceOptions {
  schedule?: Schedule;
  staleAfterMs?: number;
  setTimer?: (callback: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}
interface StreamSnapshot { voices: IncomingVoice[]; staleTimer: Timer }

export class ElectricSeaSource {
  private snapshots = new Map<string, StreamSnapshot>();
  private allocator = new VoiceAllocator();
  private listeners = new Set<() => void>();
  private settings = defaultElectricSeaSettings;
  private snapshot: ElectricSeaSnapshot;
  private pending = false;
  private unsubscribeMessages: (() => void) | null = null;
  private unsubscribeStatus: (() => void) | null = null;
  private releaseResidentSubscription: (() => void) | null = null;
  private lastConnection: RouterClient['status'];
  private schedule: Schedule;
  private staleAfterMs: number;
  private setTimer: (callback: () => void, delay: number) => Timer;
  private clearTimer: (timer: Timer) => void;

  constructor(private router: RouterClient, options: SourceOptions = {}) {
    this.schedule = options.schedule ?? (callback => requestAnimationFrame(callback));
    this.staleAfterMs = options.staleAfterMs ?? 30_000;
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer));
    this.lastConnection = router.status;
    this.snapshot = { connection: router.status, streams: [], activeVoiceCount: 0, allocatedVoiceCount: 0, oscillators: [] };
  }

  start() {
    if (this.unsubscribeMessages) return () => this.stop();
    this.unsubscribeMessages = this.router.subscribeMessages(this.receive);
    this.unsubscribeStatus = this.router.subscribe(this.syncConnection);
    this.releaseResidentSubscription = this.router.acquireResidentSubscription();
    this.publishNow();
    return () => this.stop();
  }

  stop() {
    this.unsubscribeMessages?.();
    this.unsubscribeStatus?.();
    this.unsubscribeMessages = this.unsubscribeStatus = null;
    this.releaseResidentSubscription?.();
    this.releaseResidentSubscription = null;
    this.clearSnapshots();
    this.allocator.reset();
    this.publishNow();
  }

  configure(settings: ElectricSeaSettings) {
    this.settings = {
      streamId: settings.streamId || 'all',
      baseMidiNote: finite(settings.baseMidiNote, 48, 0, 127),
      pitchSpanSemitones: finite(settings.pitchSpanSemitones, 36, 0, 127),
      pitchMode: settings.pitchMode === 'quantized' ? 'quantized' : 'continuous',
      maximumVoices: finite(settings.maximumVoices, DEFAULT_MAXIMUM_VOICES, 0, 128),
    };
    this.queuePublish();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.snapshot;

  private receive = (message: RouterMessage) => {
    if (message instanceof ArrayBuffer || message.type !== 'resident_voices'
      || typeof message.device !== 'string' || !message.device) return;
    const voices = message.ready === true && Array.isArray(message.voices)
      ? message.voices.map(voice => normalizeVoice(message.device as string, voice)).filter((voice): voice is IncomingVoice => voice !== null)
      : [];
    const streamId = message.device;
    const previous = this.snapshots.get(streamId);
    if (previous) this.clearTimer(previous.staleTimer);
    const staleTimer = this.setTimer(() => {
      const current = this.snapshots.get(streamId);
      if (!current || current.staleTimer !== staleTimer) return;
      this.snapshots.delete(streamId);
      this.publishNow();
    }, this.staleAfterMs);
    this.snapshots.set(streamId, { voices, staleTimer });
    this.queuePublish();
  };

  private syncConnection = () => {
    if (this.router.status === this.lastConnection) return;
    this.lastConnection = this.router.status;
    if (this.router.status !== 'connected') {
      this.clearSnapshots();
      this.allocator.reset();
      this.publishNow();
      return;
    }
    this.queuePublish();
  };

  private queuePublish() {
    if (this.pending) return;
    this.pending = true;
    this.schedule(() => {
      this.pending = false;
      this.publishNow();
    });
  }

  private publishNow() {
    const streams = [...this.snapshots.keys()].sort();
    const voices = [...this.snapshots.entries()]
      .filter(([streamId]) => this.settings.streamId === 'all' || streamId === this.settings.streamId)
      .flatMap(([, stream]) => stream.voices);
    const allocation = this.allocator.update(voices, this.settings.maximumVoices);
    const eligiblePerDevice = new Map<string, number>();
    for (const voice of voices) if (voice.active && voice.frequencyHz > 0 && Number.isFinite(voice.confidence)) {
      const device = residentDevice(voice.streamId);
      eligiblePerDevice.set(device, (eligiblePerDevice.get(device) ?? 0) + 1);
    }
    const oscillators = allocation.allocated.map(({ key, slot, voice }) => {
      const pitch = mapEnvironmentalPitch(voice.frequencyHz, {
        baseMidiNote: this.settings.baseMidiNote,
        pitchSpanSemitones: this.settings.pitchSpanSemitones,
        mode: this.settings.pitchMode,
      });
      const confidence = Math.max(0.001, Math.min(1, voice.confidence));
      const sourceAmplitude = Math.max(0.015, Math.min(0.22, 0.18 * confidence))
        / Math.pow(eligiblePerDevice.get(residentDevice(voice.streamId)) ?? 1, 0.35);
      return {
        id: `electric-sea-${slot + 1}`,
        sourceVoiceKey: key,
        sourceAmplitude,
        playing: true,
        waveform: 'sine' as const,
        frequency: pitch.oscillatorFrequencyHz,
        levelDb: Math.max(-60, Math.min(-9, -9 + 20 * Math.log10(confidence))),
        cutoff: 4000,
        direction: 0,
        phase: 0,
        band: 'raw' as const,
      };
    });
    this.snapshot = {
      connection: this.router.status,
      streams,
      activeVoiceCount: allocation.activeVoiceCount,
      allocatedVoiceCount: allocation.allocated.length,
      oscillators,
    };
    this.listeners.forEach(listener => listener());
  }

  private clearSnapshots() {
    for (const stream of this.snapshots.values()) this.clearTimer(stream.staleTimer);
    this.snapshots.clear();
  }
}

function normalizeVoice(streamId: string, value: unknown): IncomingVoice | null {
  if (!value || typeof value !== 'object') return null;
  const voice = value as Record<string, unknown>;
  if (!Number.isFinite(voice.id) || !Number.isFinite(voice.frequencyHz)
    || Number(voice.frequencyHz) <= 0 || !Number.isFinite(voice.confidence)) return null;
  return {
    streamId,
    id: Number(voice.id),
    frequencyHz: Number(voice.frequencyHz),
    confidence: Number(voice.confidence),
    active: voice.active === true,
  };
}

function finite(value: number, fallback: number, minimum: number, maximum: number) {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.round(value))) : fallback;
}

function residentDevice(streamId: string) {
  return streamId.split('/')[1] || streamId;
}
