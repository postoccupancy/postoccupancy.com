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

export interface SpectrogramColumn extends SignalsSpectrum {
  timeUs: number;
}

interface SpectrogramRun {
  observations: SpectrumObservation[];
  prefixSum: Float64Array;
  prefixMin: Float64Array;
  prefixMax: Float64Array;
}

export interface PreparedSpectrogramTimeline {
  runs: SpectrogramRun[];
  expectedUs: number;
  aggregationMs: number;
}

export interface SpectrogramBackfillResult {
  columns: SpectrogramColumn[];
  preparationMs: number;
  analysisMs: number;
  attemptedColumns: number;
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

function spectrumRuns(samples: ReadonlyArray<Sample>, aggregationMs: number) {
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

  return { runs, expectedUs };
}

export function prepareSpectrogramTimeline(samples: ReadonlyArray<Sample>, aggregationMs: number): PreparedSpectrogramTimeline | null {
  const result = spectrumRuns(samples, aggregationMs);
  if (!result) return null;
  return {
    expectedUs: result.expectedUs,
    aggregationMs,
    runs: result.runs.map((observations) => {
      const prefixSum = new Float64Array(observations.length);
      const prefixMin = new Float64Array(observations.length);
      const prefixMax = new Float64Array(observations.length);
      let sum = 0;
      let minimum = Infinity;
      let maximum = -Infinity;
      for (let index = 0; index < observations.length; index++) {
        const value = observations[index].v;
        sum += value;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
        prefixSum[index] = sum;
        prefixMin[index] = minimum;
        prefixMax[index] = maximum;
      }
      return { observations, prefixSum, prefixMin, prefixMax };
    }),
  };
}

function prepareRun(selected: SpectrumObservation[] | undefined, aggregationMs: number, requestedFftSize: SpectralFftSize) {
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

export function prepareSpectrumSamples(samples: ReadonlyArray<Sample>, aggregationMs: number, requestedFftSize: SpectralFftSize = 'auto'): SpectrumPreparation | null {
  const result = spectrumRuns(samples, aggregationMs);
  if (!result) return null;
  return prepareRun([...result.runs].reverse().find((candidate) => candidate.length >= MIN_FFT_LENGTH), aggregationMs, requestedFftSize);
}

export function prepareSpectrumSamplesAt(samples: ReadonlyArray<Sample>, aggregationMs: number, timeUs: number, requestedFftSize: SpectralFftSize = 'auto'): SpectrumPreparation | null {
  const eligible = samples.filter((sample) => sample.t <= timeUs);
  const result = spectrumRuns(eligible, aggregationMs);
  if (!result?.runs.length) return null;
  const selected = result.runs[result.runs.length - 1];
  if (selected.length < MIN_FFT_LENGTH) return null;
  const latestAge = timeUs - selected[selected.length - 1].t;
  const toleranceUs = Math.max(1000, result.expectedUs * 1.5);
  if (latestAge < 0 || latestAge > toleranceUs) return null;
  return prepareRun(selected, aggregationMs, requestedFftSize);
}

function analyzePrepared(prepared: SpectrumPreparation, requestedWindowSeconds: number, settings: SpectralSettings, amplitudeReference?: number): SignalsSpectrum | null {
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
  const referenceAmplitude = amplitudeReference ?? (observedPeak ? observedPeak * 16 : 1);
  return {
    ...prepared,
    requestedWindowSeconds,
    welchSegmentCount: psd.segmentCount,
    resolution: psd.resolution,
    points,
    peakFrequency: peak?.frequency ?? 0,
    referencePsd: psd.fullScaleSinePsd * referenceAmplitude * referenceAmplitude,
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
  return analyzePrepared(prepared, requestedWindowSeconds, settings);
}

export function analyzeSpectrogramColumn(samples: ReadonlyArray<Sample>, timeUs: number, aggregationMs: number, settings: SpectralSettings = defaultSpectralSettings): SpectrogramColumn | null {
  const timeline = prepareSpectrogramTimeline(samples, aggregationMs);
  return timeline ? analyzePreparedSpectrogramColumn(timeline, timeUs, settings) : null;
}

function upperBoundTime(observations: SpectrumObservation[], timeUs: number) {
  let low = 0;
  let high = observations.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (observations[middle].t <= timeUs) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function analyzePreparedSpectrogramColumn(timeline: PreparedSpectrogramTimeline, timeUs: number, settings: SpectralSettings = defaultSpectralSettings): SpectrogramColumn | null {
  let run: SpectrogramRun | undefined;
  let observationCount = 0;
  for (const candidate of timeline.runs) {
    if (candidate.observations[0].t > timeUs) break;
    const count = upperBoundTime(candidate.observations, timeUs);
    if (count) {
      run = candidate;
      observationCount = count;
    }
  }
  if (!run || observationCount < MIN_FFT_LENGTH) return null;
  const latest = run.observations[observationCount - 1];
  const toleranceUs = Math.max(1000, timeline.expectedUs * 1.5);
  if (timeUs - latest.t > toleranceUs) return null;

  const fftMaximum = settings.fftSize === 'auto' ? AUTO_MAX_FFT_LENGTH : settings.fftSize;
  const fftLength = largestPowerOfTwo(observationCount, fftMaximum);
  if (fftLength < MIN_FFT_LENGTH) return null;
  const welchHop = Math.max(1, Math.round(fftLength * 0.5));
  const availableSegments = 1 + Math.floor((observationCount - fftLength) / welchHop);
  const usedSegments = Math.max(1, Math.min(settings.welchSegments, availableSegments));
  const usedObservationCount = fftLength + (usedSegments - 1) * welchHop;
  const analysisStart = observationCount - usedObservationCount;
  const observations = run.observations.slice(analysisStart, observationCount);
  const effectiveSampleRate = timeline.aggregationMs > 0
    ? 1000 / timeline.aggregationMs
    : (observationCount - 1) * 1e6 / (latest.t - run.observations[0].t);
  const prepared: SpectrumPreparation = {
    observations,
    effectiveSampleRate,
    contiguousDurationSeconds: (latest.t - run.observations[0].t) / 1e6,
    fftLength,
    requestedFftSize: settings.fftSize,
    fftDurationSeconds: fftLength / effectiveSampleRate,
  };
  const mean = run.prefixSum[observationCount - 1] / observationCount;
  const observedPeak = Math.max(
    Math.abs(run.prefixMin[observationCount - 1] - mean),
    Math.abs(run.prefixMax[observationCount - 1] - mean),
  );
  const amplitudeReference = observedPeak ? observedPeak * 16 : 1;
  const spectrum = analyzePrepared(prepared, prepared.fftDurationSeconds, settings, amplitudeReference);
  return spectrum ? { ...spectrum, timeUs } : null;
}

export function analyzeSpectrogramBackfill(
  samples: ReadonlyArray<Sample>,
  firstHopUs: number,
  finalHopUs: number,
  hopUs: number,
  aggregationMs: number,
  settings: SpectralSettings = defaultSpectralSettings,
): SpectrogramBackfillResult {
  const preparationStarted = performance.now();
  const timeline = prepareSpectrogramTimeline(samples, aggregationMs);
  const preparationMs = performance.now() - preparationStarted;
  const analysisStarted = performance.now();
  const columns: SpectrogramColumn[] = [];
  let attemptedColumns = 0;
  if (timeline) {
    for (let timeUs = firstHopUs; timeUs <= finalHopUs; timeUs += hopUs) {
      attemptedColumns++;
      const column = analyzePreparedSpectrogramColumn(timeline, timeUs, settings);
      if (column) columns.push(column);
    }
  }
  return { columns, preparationMs, analysisMs: performance.now() - analysisStarted, attemptedColumns };
}

export function spectrogramHopUs(aggregationMs: number) {
  return Math.max(100, aggregationMs) * 1000;
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
