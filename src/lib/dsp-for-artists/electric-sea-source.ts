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

export class ElectricSeaSource {
  private snapshots = new Map<string, IncomingVoice[]>();
  private allocator = new VoiceAllocator();
  private listeners = new Set<() => void>();
  private settings = defaultElectricSeaSettings;
  private snapshot: ElectricSeaSnapshot;
  private pending = false;
  private unsubscribeMessages: (() => void) | null = null;
  private unsubscribeStatus: (() => void) | null = null;
  private lastConnection: RouterClient['status'];

  constructor(private router: RouterClient, private schedule: Schedule = callback => requestAnimationFrame(callback)) {
    this.lastConnection = router.status;
    this.snapshot = { connection: router.status, streams: [], activeVoiceCount: 0, oscillators: [] };
  }

  start() {
    if (this.unsubscribeMessages) return () => this.stop();
    this.unsubscribeMessages = this.router.subscribeMessages(this.receive);
    this.unsubscribeStatus = this.router.subscribe(this.syncConnection);
    if (this.router.status === 'connected') this.router.send({ type: 'resident_subscribe', enabled: true });
    this.publishNow();
    return () => this.stop();
  }

  stop() {
    this.unsubscribeMessages?.();
    this.unsubscribeStatus?.();
    this.unsubscribeMessages = this.unsubscribeStatus = null;
    this.router.send({ type: 'resident_subscribe', enabled: false });
    this.snapshots.clear();
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
    this.snapshots.set(message.device, voices);
    this.queuePublish();
  };

  private syncConnection = () => {
    if (this.router.status === this.lastConnection) return;
    this.lastConnection = this.router.status;
    if (this.router.status !== 'connected') {
      this.snapshots.clear();
      this.allocator.reset();
    } else {
      this.router.send({ type: 'resident_subscribe', enabled: true });
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
      .flatMap(([, streamVoices]) => streamVoices);
    const allocation = this.allocator.update(voices, this.settings.maximumVoices);
    const oscillators = allocation.allocated.map(({ slot, voice }) => {
      const pitch = mapEnvironmentalPitch(voice.frequencyHz, {
        baseMidiNote: this.settings.baseMidiNote,
        pitchSpanSemitones: this.settings.pitchSpanSemitones,
        mode: this.settings.pitchMode,
      });
      const confidence = Math.max(0.001, Math.min(1, voice.confidence));
      return {
        id: `electric-sea-${slot + 1}`,
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
      activeVoiceCount: allocation.allocated.length,
      oscillators,
    };
    this.listeners.forEach(listener => listener());
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
