import type { AnalysisQuality, ReconstructedAnalysisInput, SpectrumObservation } from './spectrum-analysis';

/**
 * Complex Morlet reference CWT.
 *
 * Mother wavelet: psi(eta) = pi^(-1/4) exp(i omega0 eta) exp(-eta^2 / 2).
 * Scale is expressed in seconds and a requested center frequency uses
 * scaleSeconds = omega0 / (2 pi frequencyHz), the peak of this Morlet's
 * Fourier-domain Gaussian. Kernels are sampled at the effective input rate,
 * truncated at +/- 4 scaleSeconds, conjugated for correlation, and normalized
 * to unit discrete L2 energy (which absorbs the mother's pi^(-1/4) constant).
 * Coefficients therefore scale linearly with input
 * amplitude and power is |coefficient|^2.
 *
 * A coefficient is valid only when the complete +/- 4-scale kernel fits in a
 * single reconstructed run. edgeAffected is separate from reconstruction
 * quality; disconnected runs are never joined or zero-filled as valid data.
 */

export interface CwtConfiguration {
  minimumFrequencyHz?: number;
  maximumFrequencyHz?: number;
  frequencyCount?: number;
  omega0?: number;
  supportScale?: number;
}

export interface CwtKernel {
  frequencyHz: number;
  scaleSeconds: number;
  halfWidthSamples: number;
  real: Float64Array;
  imaginary: Float64Array;
}

export interface CwtKernelSet {
  sampleRate: number;
  configurationKey: string;
  frequenciesHz: Float64Array;
  kernels: CwtKernel[];
  omega0: number;
  supportScale: number;
}

interface CwtPreparedRun {
  observations: SpectrumObservation[];
  centeredValues: Float64Array;
  quality: AnalysisQuality;
}

export interface PreparedCwtAnalysis extends CwtKernelSet {
  effectiveSampleRate: number;
  runs: CwtPreparedRun[];
}

export interface CwtColumn {
  status: 'ok';
  requestedTimeUs: number;
  analysisTimeUs: number;
  effectiveSampleRate: number;
  frequenciesHz: Float64Array;
  real: Float64Array;
  imaginary: Float64Array;
  power: Float64Array;
  valid: Uint8Array;
  edgeAffected: Uint8Array;
  quality: AnalysisQuality;
}

export interface CwtUnavailable {
  status: 'unsupported' | 'insufficient-data';
  reasonCode: 'unsupported-frequency-range' | 'no-runs' | 'timestamp-outside-runs';
  reason: string;
  requestedTimeUs: number;
  effectiveSampleRate: number;
}

export type CwtResult = CwtColumn | CwtUnavailable;

export interface CwtBatchAnalysis {
  results: CwtResult[];
  columns: CwtColumn[];
  attempted: number;
  successful: number;
  rejected: number;
  rejectionReasons: Record<string, number>;
}

const DEFAULT_MINIMUM_HZ = 0.5;
const DEFAULT_FREQUENCY_COUNT = 48;
const DEFAULT_OMEGA0 = 6;
const DEFAULT_SUPPORT_SCALE = 4;

function logarithmicFrequencies(minimum: number, maximum: number, count: number) {
  const result = new Float64Array(count);
  const span = Math.log(maximum / minimum);
  for (let index = 0; index < count; index++) result[index] = minimum * Math.exp(span * index / Math.max(1, count - 1));
  return result;
}

function resolvedConfiguration(sampleRate: number, configuration: CwtConfiguration) {
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) return null;
  const minimum = configuration.minimumFrequencyHz ?? DEFAULT_MINIMUM_HZ;
  const maximum = configuration.maximumFrequencyHz ?? Math.min(40, sampleRate * 0.4);
  const count = Math.floor(configuration.frequencyCount ?? DEFAULT_FREQUENCY_COUNT);
  const omega0 = configuration.omega0 ?? DEFAULT_OMEGA0;
  const supportScale = configuration.supportScale ?? DEFAULT_SUPPORT_SCALE;
  if (!(minimum > 0) || !(maximum >= minimum) || maximum >= sampleRate / 2 || count < 1 || !(omega0 > 0) || !(supportScale > 0)) return null;
  return { minimum, maximum, count, omega0, supportScale, key: `${minimum}/${maximum}/${count}/${omega0}/${supportScale}` };
}

export function createMorletKernels(sampleRate: number, configuration: CwtConfiguration = {}) {
  const resolved = resolvedConfiguration(sampleRate, configuration);
  if (!resolved) return null;
  const { minimum, maximum, count, omega0, supportScale, key: configurationKey } = resolved;
  const frequenciesHz = logarithmicFrequencies(minimum, maximum, count);
  const kernels = Array.from(frequenciesHz, (frequencyHz): CwtKernel => {
    const scaleSeconds = omega0 / (2 * Math.PI * frequencyHz);
    const halfWidthSamples = Math.ceil(supportScale * scaleSeconds * sampleRate);
    const length = halfWidthSamples * 2 + 1;
    const real = new Float64Array(length);
    const imaginary = new Float64Array(length);
    let energy = 0;
    for (let index = -halfWidthSamples; index <= halfWidthSamples; index++) {
      const eta = index / sampleRate / scaleSeconds;
      const envelope = Math.exp(-eta * eta / 2);
      const at = index + halfWidthSamples;
      real[at] = envelope * Math.cos(omega0 * eta);
      imaginary[at] = -envelope * Math.sin(omega0 * eta);
      energy += envelope * envelope;
    }
    const normalization = Math.sqrt(energy);
    for (let index = 0; index < length; index++) {
      real[index] /= normalization;
      imaginary[index] /= normalization;
    }
    return { frequencyHz, scaleSeconds, halfWidthSamples, real, imaginary };
  });
  return { sampleRate, configurationKey, frequenciesHz, kernels, omega0, supportScale } satisfies CwtKernelSet;
}

export function prepareCwtAnalysis(
  input: ReconstructedAnalysisInput,
  configuration: CwtConfiguration = {},
  reusableKernels?: CwtKernelSet,
): PreparedCwtAnalysis | CwtUnavailable {
  const resolved = resolvedConfiguration(input.effectiveSampleRate, configuration);
  const created = resolved && reusableKernels?.sampleRate === input.effectiveSampleRate
    && reusableKernels.configurationKey === resolved.key
    ? reusableKernels
    : createMorletKernels(input.effectiveSampleRate, configuration);
  if (!created) {
    return {
      status: 'unsupported',
      reasonCode: 'unsupported-frequency-range',
      reason: 'The effective sample rate does not support the requested CWT frequency range.',
      requestedTimeUs: 0,
      effectiveSampleRate: input.effectiveSampleRate,
    };
  }
  const runs = input.runs.filter((run) => run.observations.length > 1).map((run): CwtPreparedRun => {
    const mean = run.observations.reduce((sum, observation) => sum + observation.v, 0) / run.observations.length;
    return {
      observations: run.observations,
      centeredValues: Float64Array.from(run.observations, (observation) => observation.v - mean),
      quality: run.quality,
    };
  });
  if (!runs.length) {
    return {
      status: 'insufficient-data',
      reasonCode: 'no-runs',
      reason: 'No reconstructed run contains enough samples for CWT analysis.',
      requestedTimeUs: 0,
      effectiveSampleRate: input.effectiveSampleRate,
    };
  }
  return { effectiveSampleRate: input.effectiveSampleRate, runs, ...created };
}

function nearestIndex(observations: SpectrumObservation[], timeUs: number, intervalUs: number) {
  let low = 0;
  let high = observations.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (observations[middle].t < timeUs) low = middle + 1;
    else high = middle;
  }
  const after = low < observations.length ? low : -1;
  const before = low > 0 ? low - 1 : -1;
  const index = before < 0 ? after : after < 0
    ? before
    : Math.abs(observations[before].t - timeUs) <= Math.abs(observations[after].t - timeUs) ? before : after;
  return index >= 0 && Math.abs(observations[index].t - timeUs) <= Math.max(1, intervalUs * 0.51) ? index : -1;
}

export function analyzeCwtAtTimestamp(prepared: PreparedCwtAnalysis, requestedTimeUs: number): CwtResult {
  const intervalUs = 1e6 / prepared.effectiveSampleRate;
  let run: CwtPreparedRun | undefined;
  let center = -1;
  for (const candidate of prepared.runs) {
    const index = nearestIndex(candidate.observations, requestedTimeUs, intervalUs);
    if (index >= 0) { run = candidate; center = index; break; }
  }
  if (!run) {
    return {
      status: 'insufficient-data',
      reasonCode: 'timestamp-outside-runs',
      reason: 'The requested timestamp is outside every reconstructed sample run.',
      requestedTimeUs,
      effectiveSampleRate: prepared.effectiveSampleRate,
    };
  }
  const count = prepared.kernels.length;
  const real = new Float64Array(count);
  const imaginary = new Float64Array(count);
  const power = new Float64Array(count);
  const valid = new Uint8Array(count);
  const edgeAffected = new Uint8Array(count);
  for (let band = 0; band < count; band++) {
    const kernel = prepared.kernels[band];
    const first = center - kernel.halfWidthSamples;
    const last = center + kernel.halfWidthSamples;
    const availableFirst = Math.max(0, first);
    const availableLast = Math.min(run.centeredValues.length - 1, last);
    if (first >= 0 && last < run.centeredValues.length) valid[band] = 1;
    else edgeAffected[band] = 1;
    let realSum = 0;
    let imaginarySum = 0;
    for (let sample = availableFirst; sample <= availableLast; sample++) {
      const kernelIndex = sample - first;
      const value = run.centeredValues[sample];
      realSum += value * kernel.real[kernelIndex];
      imaginarySum += value * kernel.imaginary[kernelIndex];
    }
    real[band] = realSum;
    imaginary[band] = imaginarySum;
    power[band] = realSum * realSum + imaginarySum * imaginarySum;
  }
  return {
    status: 'ok',
    requestedTimeUs,
    analysisTimeUs: run.observations[center].t,
    effectiveSampleRate: prepared.effectiveSampleRate,
    frequenciesHz: prepared.frequenciesHz,
    real,
    imaginary,
    power,
    valid,
    edgeAffected,
    quality: run.quality,
  };
}

export function analyzeCwtAtTimestamps(prepared: PreparedCwtAnalysis, requestedTimesUs: ReadonlyArray<number>) {
  return requestedTimesUs.map((timeUs) => analyzeCwtAtTimestamp(prepared, timeUs));
}

export function analyzeCwtAtTimestampsWithDiagnostics(
  prepared: PreparedCwtAnalysis,
  requestedTimesUs: ReadonlyArray<number>,
): CwtBatchAnalysis {
  const results = analyzeCwtAtTimestamps(prepared, requestedTimesUs);
  const columns = results.filter((result): result is CwtColumn => result.status === 'ok');
  const rejectionReasons: Record<string, number> = {};
  for (const result of results) {
    if (result.status === 'ok') continue;
    rejectionReasons[result.reasonCode] = (rejectionReasons[result.reasonCode] ?? 0) + 1;
  }
  return {
    results,
    columns,
    attempted: results.length,
    successful: columns.length,
    rejected: results.length - columns.length,
    rejectionReasons,
  };
}

export function cwtRefreshHorizonUs(prepared: PreparedCwtAnalysis) {
  const maximumHalfWidth = prepared.kernels.reduce((maximum, kernel) => Math.max(maximum, kernel.halfWidthSamples), 0);
  return maximumHalfWidth / prepared.effectiveSampleRate * 1e6;
}
