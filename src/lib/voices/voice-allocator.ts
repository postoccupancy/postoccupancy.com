export const DEFAULT_MAXIMUM_VOICES = 8;

export interface IncomingVoice {
  streamId: string;
  id: string | number;
  frequencyHz: number;
  confidence: number;
  active: boolean;
  [key: string]: unknown;
}

export interface AllocatedVoice<T extends IncomingVoice = IncomingVoice> {
  key: string;
  slot: number;
  voice: T;
}

export interface VoiceAllocation<T extends IncomingVoice = IncomingVoice> {
  maximumSlots: number;
  activeVoiceCount: number;
  allocated: AllocatedVoice<T>[];
  released: AllocatedVoice<T>[];
}

export function voiceIdentity(voice: Pick<IncomingVoice, 'streamId' | 'id'>): string {
  return `${voice.streamId}::${String(voice.id)}`;
}

/**
 * Retains continuing voices in their slots, then fills free slots by descending
 * confidence with composite identity as the deterministic tie-breaker.
 * Every update is authoritative, so absent, inactive, and invalid voices release.
 */
export class VoiceAllocator<T extends IncomingVoice = IncomingVoice> {
  private assignments = new Map<string, AllocatedVoice<T>>();

  update(voices: readonly T[], maximumSlots = DEFAULT_MAXIMUM_VOICES): VoiceAllocation<T> {
    const limit = Number.isFinite(maximumSlots)
      ? Math.max(0, Math.floor(maximumSlots))
      : DEFAULT_MAXIMUM_VOICES;
    const candidates = new Map<string, T>();
    for (const voice of voices) {
      if (!isUsableVoice(voice)) continue;
      const key = voiceIdentity(voice);
      const previous = candidates.get(key);
      if (!previous || voice.confidence > previous.confidence) candidates.set(key, voice);
    }

    const released: AllocatedVoice<T>[] = [];
    for (const [key, assignment] of this.assignments) {
      const voice = candidates.get(key);
      if (!voice || assignment.slot >= limit) {
        released.push(assignment);
        this.assignments.delete(key);
      } else {
        assignment.voice = voice;
      }
    }

    const usedSlots = new Set([...this.assignments.values()].map(({ slot }) => slot));
    const availableSlots = Array.from({ length: limit }, (_, slot) => slot)
      .filter(slot => !usedSlots.has(slot));
    const waiting = [...candidates.entries()]
      .filter(([key]) => !this.assignments.has(key))
      .sort(([keyA, a], [keyB, b]) => b.confidence - a.confidence || keyA.localeCompare(keyB));
    for (let index = 0; index < availableSlots.length && index < waiting.length; index++) {
      const [key, voice] = waiting[index];
      this.assignments.set(key, { key, slot: availableSlots[index], voice });
    }

    const allocated = [...this.assignments.values()].sort((a, b) => a.slot - b.slot);
    released.sort((a, b) => a.slot - b.slot);
    return {
      maximumSlots: limit,
      activeVoiceCount: candidates.size,
      allocated,
      released,
    };
  }

  reset(): VoiceAllocation<T> {
    return this.update([], 0);
  }
}

function isUsableVoice(voice: IncomingVoice): boolean {
  return Boolean(
    voice
    && voice.active === true
    && typeof voice.streamId === 'string'
    && voice.streamId.length > 0
    && (typeof voice.id === 'string' || Number.isFinite(voice.id))
    && Number.isFinite(voice.frequencyHz)
    && voice.frequencyHz > 0
    && Number.isFinite(voice.confidence),
  );
}
