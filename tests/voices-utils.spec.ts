import { expect, test } from '@playwright/test';
import { mapEnvironmentalPitch } from '../src/lib/voices/pitch-mapping';
import { VoiceAllocator } from '../src/lib/voices/voice-allocator';

const voice = (streamId: string, id: number, confidence = 0.8, active = true) => ({
  streamId, id, confidence, active, frequencyHz: 0.25,
});

test.describe('environmental pitch mapping', () => {
  test('matches the former logarithmic mapping and clamps its source range', () => {
    const options = { baseMidiNote: 48, pitchSpanSemitones: 36 };
    for (const hz of [0.01, 0.05, 0.1, 0.5, 1, 2]) {
      const clamped = Math.max(0.05, Math.min(1, hz));
      const expected = Math.max(0, Math.min(127,
        48 + Math.log2(clamped / 0.05) / Math.log2(1 / 0.05) * 36));
      const mapped = mapEnvironmentalPitch(hz, options);
      expect(mapped.continuousMidi).toBeCloseTo(expected, 12);
      expect(mapped.quantizedMidi).toBe(Math.round(expected));
    }
  });

  test('supports continuous, quantized, base-note, span, and custom-range changes', () => {
    const continuous = mapEnvironmentalPitch(0.2, {
      baseMidiNote: 36, pitchSpanSemitones: 24, mode: 'continuous',
    });
    const quantized = mapEnvironmentalPitch(0.2, {
      baseMidiNote: 36, pitchSpanSemitones: 24, mode: 'quantized',
    });
    expect(continuous.oscillatorFrequencyHz).not.toBe(quantized.oscillatorFrequencyHz);
    expect(quantized.oscillatorFrequencyHz).toBeCloseTo(
      440 * 2 ** ((quantized.quantizedMidi - 69) / 12), 12,
    );
    expect(mapEnvironmentalPitch(5, {
      baseMidiNote: 60, pitchSpanSemitones: 12,
      sourceFrequencyMinHz: 1, sourceFrequencyMaxHz: 10,
    }).continuousMidi).toBeCloseTo(60 + Math.log2(5) / Math.log2(10) * 12, 12);
  });
});

test.describe('voice allocator', () => {
  test('keeps slots stable across reordering and uses composite identities', () => {
    const allocator = new VoiceAllocator();
    const first = allocator.update([voice('a', 1), voice('b', 1), voice('a', 2)], 3);
    const slots = new Map(first.allocated.map(item => [item.key, item.slot]));
    const reordered = allocator.update([voice('a', 2), voice('a', 1), voice('b', 1)], 3);
    expect(reordered.allocated.map(item => [item.key, item.slot])).toEqual(
      reordered.allocated.map(item => [item.key, slots.get(item.key)]),
    );
    expect(new Set(reordered.allocated.map(item => item.key)).size).toBe(3);
  });

  test('releases inactive, missing, invalid, and empty updates without stale growth', () => {
    const allocator = new VoiceAllocator();
    allocator.update([voice('a', 1), voice('a', 2)], 2);
    const changed = allocator.update([
      voice('a', 1, 0.8, false),
      { ...voice('a', 3), frequencyHz: Number.NaN },
      voice('a', 2),
    ], 2);
    expect(changed.allocated.map(item => item.key)).toEqual(['a::2']);
    expect(changed.released.map(item => item.key)).toEqual(['a::1']);
    const empty = allocator.update([], 2);
    expect(empty.allocated).toEqual([]);
    expect(empty.released.map(item => item.key)).toEqual(['a::2']);
  });

  test('enforces polyphony deterministically and fills released slots on reappearance', () => {
    const allocator = new VoiceAllocator();
    const first = allocator.update([
      voice('z', 1, 0.5), voice('b', 1, 0.9), voice('a', 1, 0.9),
    ], 2);
    expect(first.allocated.map(item => item.key)).toEqual(['a::1', 'b::1']);
    expect(first.activeVoiceCount).toBe(3);
    const released = allocator.update([voice('b', 1), voice('z', 1)], 2);
    expect(released.released.map(item => item.key)).toEqual(['a::1']);
    expect(released.allocated.map(item => [item.key, item.slot])).toEqual([
      ['z::1', 0], ['b::1', 1],
    ]);
    const reappeared = allocator.update([voice('a', 1, 1), voice('b', 1), voice('z', 1)], 3);
    expect(reappeared.allocated.find(item => item.key === 'a::1')?.slot).toBe(2);
  });

  test('changes maximum slots without reassigning retained lower slots', () => {
    const allocator = new VoiceAllocator();
    allocator.update([voice('a', 1), voice('b', 1), voice('c', 1)], 3);
    const shrunk = allocator.update([voice('c', 1), voice('b', 1), voice('a', 1)], 2);
    expect(shrunk.allocated.map(item => [item.key, item.slot])).toEqual([
      ['a::1', 0], ['b::1', 1],
    ]);
    expect(shrunk.released.map(item => item.key)).toEqual(['c::1']);
    const grown = allocator.update([voice('c', 1), voice('b', 1), voice('a', 1)], 3);
    expect(grown.allocated.map(item => [item.key, item.slot])).toEqual([
      ['a::1', 0], ['b::1', 1], ['c::1', 2],
    ]);
  });
});
