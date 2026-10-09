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

interface CwtPreparedRun {
  observations: SpectrumObservation[];
  centeredValues: Float64Array;
  quality: AnalysisQuality;
}

export interface PreparedCwtAnalysis {
  effectiveSampleRate: number;
  frequenciesHz: Float64Array;
  kernels: CwtKernel[];
  runs: CwtPreparedRun[];
  omega0: number;
  supportScale: number;
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
  reason: string;
  requestedTimeUs: number;
  effectiveSampleRate: number;
}

export type CwtResult = CwtColumn | CwtUnavailable;

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

export function createMorletKernels(sampleRate: number, configuration: CwtConfiguration = {}) {
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) return null;
  const minimum = configuration.minimumFrequencyHz ?? DEFAULT_MINIMUM_HZ;
  const maximum = configuration.maximumFrequencyHz ?? Math.min(40, sampleRate * 0.4);
  const count = Math.floor(configuration.frequencyCount ?? DEFAULT_FREQUENCY_COUNT);
  const omega0 = configuration.omega0 ?? DEFAULT_OMEGA0;
  const supportScale = configuration.supportScale ?? DEFAULT_SUPPORT_SCALE;
  if (!(minimum > 0) || !(maximum >= minimum) || maximum >= sampleRate / 2 || count < 1 || !(omega0 > 0) || !(supportScale > 0)) return null;
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
  return { frequenciesHz, kernels, omega0, supportScale };
}

export function prepareCwtAnalysis(input: ReconstructedAnalysisInput, configuration: CwtConfiguration = {}): PreparedCwtAnalysis | CwtUnavailable {
  const created = createMorletKernels(input.effectiveSampleRate, configuration);
  if (!created) {
    return {
      status: 'unsupported',
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
      reason: 'No reconstructed run contains enough samples for CWT analysis.',
      requestedTimeUs: 0,
      effectiveSampleRate: input.effectiveSampleRate,
    };
  }
  return { effectiveSampleRate: input.effectiveSampleRate, runs, ...created };
}

function nearestIndex(observations: SpectrumObservation[], timeUs: number, intervalUs: number) {
  const index = Math.round((timeUs - observations[0].t) / intervalUs);
  if (index < 0 || index >= observations.length) return -1;
  return Math.abs(observations[index].t - timeUs) <= intervalUs * 0.51 ? index : -1;
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
