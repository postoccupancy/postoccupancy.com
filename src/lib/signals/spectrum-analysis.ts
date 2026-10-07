import { aggregateWaveformSamples } from '@/components/signals/scope-plot';
import type { Sample, SampleRing } from './sample-ring';
import { filterBackground, logBandAverage, spectrumPoints, welchPsd } from '@/lib/visualizer/spectral-analysis';
import { defaultSpectralSettings, type SpectralFftSize, type SpectralSettings } from './spectral-settings';

const MIN_FFT_LENGTH = 8;
const AUTO_MAX_FFT_LENGTH = 2048;

export interface SpectrumObservation { key: number; t: number; v: number }
export interface SpectrumPreparation {
  observations: SpectrumObservation[];
  effectiveSampleRate: number;
  contiguousDurationSeconds: number;
  fftLength: number;
  requestedFftSize: SpectralFftSize;
  fftDurationSeconds: number;
}
export interface SignalsSpectrum extends SpectrumPreparation {
  requestedWindowSeconds: number;
  welchSegmentCount: number;
  resolution: number;
  points: Array<{ frequency: number; power: number; binCount: number }>;
  peakFrequency: number;
  referencePsd: number;
}

function nativeInterval(samples: ReadonlyArray<Sample>) {
  const intervals: number[] = [];
  for (let index = 1; index < samples.length; index++) {
    if (((samples[index].seq - samples[index - 1].seq) >>> 0) === 1) intervals.push(samples[index].t - samples[index - 1].t);
  }
  intervals.sort((a, b) => a - b);
  if (!intervals.length) return 0;
  const middle = Math.floor(intervals.length / 2);
  return intervals.length % 2 ? intervals[middle] : (intervals[middle - 1] + intervals[middle]) / 2;
}

function largestPowerOfTwo(value: number, maximum: number) {
  let result = 1;
  while (result * 2 <= value && result * 2 <= maximum) result *= 2;
  return result;
}

export function prepareSpectrumSamples(samples: ReadonlyArray<Sample>, aggregationMs: number, requestedFftSize: SpectralFftSize = 'auto'): SpectrumPreparation | null {
  if (!samples.length) return null;
  let observations: SpectrumObservation[];
  let expectedUs: number;
  let continuous: (previous: SpectrumObservation, next: SpectrumObservation) => boolean;

  if (aggregationMs > 0) {
    expectedUs = aggregationMs * 1000;
    observations = aggregateWaveformSamples(samples, expectedUs).map((sample) => ({ key: sample.bucket, t: sample.t, v: sample.v }));
    continuous = (previous, next) => next.key - previous.key === 1;
  } else {
    expectedUs = nativeInterval(samples);
    if (!(expectedUs > 0)) return null;
    observations = samples.map((sample) => ({ key: sample.seq, t: sample.t, v: sample.v }));
    const toleranceUs = Math.max(1000, expectedUs * 0.5);
    continuous = (previous, next) =>
      ((next.key - previous.key) >>> 0) === 1 && Math.abs(next.t - previous.t - expectedUs) <= toleranceUs;
  }

  const runs: SpectrumObservation[][] = [];
  let run: SpectrumObservation[] = [];
  for (const observation of observations) {
    if (run.length && !continuous(run[run.length - 1], observation)) {
      runs.push(run);
      run = [];
    }
    run.push(observation);
  }
  if (run.length) runs.push(run);

  const selected = runs.reverse().find((candidate) => candidate.length >= MIN_FFT_LENGTH);
  if (!selected) return null;
  const fftLength = largestPowerOfTwo(selected.length, requestedFftSize === 'auto' ? AUTO_MAX_FFT_LENGTH : requestedFftSize);
  if (fftLength < MIN_FFT_LENGTH) return null;
  const effectiveSampleRate = aggregationMs > 0
    ? 1000 / aggregationMs
    : (selected.length - 1) * 1e6 / (selected[selected.length - 1].t - selected[0].t);
  return {
    observations: selected,
    effectiveSampleRate,
    contiguousDurationSeconds: (selected[selected.length - 1].t - selected[0].t) / 1e6,
    fftLength,
    requestedFftSize,
    fftDurationSeconds: fftLength / effectiveSampleRate,
  };
}

export function analyzeSpectrumSamples(
  samples: ReadonlyArray<Sample>,
  aggregationMs: number,
  requestedWindowSeconds: number,
  settings: SpectralSettings = defaultSpectralSettings,
  rangeStart = -Infinity,
  rangeEnd = Infinity,
): SignalsSpectrum | null {
  let selectedSamples = samples;
  if (aggregationMs > 0 && (Number.isFinite(rangeStart) || Number.isFinite(rangeEnd))) {
    const bucketUs = aggregationMs * 1000;
    const includedBuckets = new Set(aggregateWaveformSamples(samples, bucketUs)
      .filter((sample) => sample.t >= rangeStart && sample.t <= rangeEnd)
      .map((sample) => sample.bucket));
    selectedSamples = samples.filter((sample) => includedBuckets.has(Math.floor(sample.t / bucketUs)));
  }
  const prepared = prepareSpectrumSamples(selectedSamples, aggregationMs, settings.fftSize);
  if (!prepared) return null;
  const values = Float64Array.from(prepared.observations, (sample) => sample.v);
  const psd = welchPsd(values, prepared.effectiveSampleRate, prepared.fftLength, settings.welchSegments, 0.5);
  if (!psd) return null;
  const fftPoints = spectrumPoints(psd);
  const banded = settings.bandAverage ? logBandAverage(psd) : fftPoints;
  const rawPoints = banded.length >= 2 ? banded : fftPoints;
  const points = settings.mode === 'relative' ? filterBackground(rawPoints) : rawPoints;
  const peak = fftPoints.reduce((best, point) => !best || point.power > best.power ? point : best, null as null | { frequency: number; power: number });
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let observedPeak = 0;
  for (const value of values) observedPeak = Math.max(observedPeak, Math.abs(value - mean));
  const amplitudeReference = observedPeak ? observedPeak * 16 : 1;
  return {
    ...prepared,
    requestedWindowSeconds,
    welchSegmentCount: psd.segmentCount,
    resolution: psd.resolution,
    points,
    peakFrequency: peak?.frequency ?? 0,
    referencePsd: psd.fullScaleSinePsd * amplitudeReference * amplitudeReference,
  };
}

export function analyzeSpectrumRing(
  ring: SampleRing,
  start: number,
  end: number,
  aggregationMs: number,
  requestedWindowSeconds: number,
  settings: SpectralSettings = defaultSpectralSettings,
) {
  const samples: Sample[] = [];
  const aggregationUs = aggregationMs * 1000;
  const collectionStart = aggregationUs ? Math.floor(start / aggregationUs) * aggregationUs : start;
  ring.visitRange(collectionStart, end, (sample) => samples.push(sample));
  return analyzeSpectrumSamples(samples, aggregationMs, requestedWindowSeconds, settings, start, end);
}
