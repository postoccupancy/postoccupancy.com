export const DEFAULT_SOURCE_FREQUENCY_MIN_HZ = 0.05;
export const DEFAULT_SOURCE_FREQUENCY_MAX_HZ = 1;

export type PitchMode = 'continuous' | 'quantized';

export interface PitchMappingOptions {
  baseMidiNote: number;
  pitchSpanSemitones: number;
  sourceFrequencyMinHz?: number;
  sourceFrequencyMaxHz?: number;
  mode?: PitchMode;
}

export interface PitchMapping {
  continuousMidi: number;
  quantizedMidi: number;
  oscillatorFrequencyHz: number;
}

/** Maps the source range logarithmically onto an audible MIDI range. */
export function mapEnvironmentalPitch(
  sourceFrequencyHz: number,
  {
    baseMidiNote,
    pitchSpanSemitones,
    sourceFrequencyMinHz = DEFAULT_SOURCE_FREQUENCY_MIN_HZ,
    sourceFrequencyMaxHz = DEFAULT_SOURCE_FREQUENCY_MAX_HZ,
    mode = 'continuous',
  }: PitchMappingOptions,
): PitchMapping {
  if (!(sourceFrequencyMinHz > 0) || !(sourceFrequencyMaxHz > sourceFrequencyMinHz)) {
    throw new RangeError('source frequency range must be positive and increasing');
  }
  const clampedSource = Math.max(
    sourceFrequencyMinHz,
    Math.min(sourceFrequencyMaxHz, sourceFrequencyHz),
  );
  const position = Math.log2(clampedSource / sourceFrequencyMinHz)
    / Math.log2(sourceFrequencyMaxHz / sourceFrequencyMinHz);
  const continuousMidi = Math.max(
    0,
    Math.min(127, baseMidiNote + position * pitchSpanSemitones),
  );
  const quantizedMidi = Math.round(continuousMidi);
  const outputMidi = mode === 'quantized' ? quantizedMidi : continuousMidi;
  return {
    continuousMidi,
    quantizedMidi,
    oscillatorFrequencyHz: 440 * Math.pow(2, (outputMidi - 69) / 12),
  };
}
