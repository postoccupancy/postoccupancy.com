import { expect, test } from '@playwright/test';
import {
  analyzeCwtAtTimestamp,
  analyzeCwtAtTimestamps,
  analyzeCwtAtTimestampsWithDiagnostics,
  cwtRefreshHorizonUs,
  prepareCwtAnalysis,
  type CwtColumn,
  type CwtConfiguration,
  type PreparedCwtAnalysis,
} from '../src/lib/signals/cwt-analysis';
import type { Sample } from '../src/lib/signals/sample-ring';
import { prepareReconstructedAnalysis } from '../src/lib/signals/spectrum-analysis';

const TAU = 2 * Math.PI;

function signal(rate: number, seconds: number, value: (seconds: number) => number): Sample[] {
  return Array.from({ length: Math.floor(rate * seconds) + 1 }, (_, index) => ({
    seq: index,
    t: index * 1e6 / rate,
    v: value(index / rate),
  }));
}

function prepare(
  samples: Sample[],
  aggregationMs = 0,
  configuration: CwtConfiguration = {},
): PreparedCwtAnalysis {
  const reconstructed = prepareReconstructedAnalysis(samples, aggregationMs);
  expect(reconstructed).not.toBeNull();
  const result = prepareCwtAnalysis(reconstructed!, configuration);
  if ('status' in result) throw new Error(result.reason);
  return result;
}

function column(prepared: PreparedCwtAnalysis, seconds: number): CwtColumn {
  const result = analyzeCwtAtTimestamp(prepared, seconds * 1e6);
  expect(result.status).toBe('ok');
  return result as CwtColumn;
}

function nearest(values: Float64Array, target: number) {
  let selected = 0;
  for (let index = 1; index < values.length; index++) {
    if (Math.abs(values[index] - target) < Math.abs(values[selected] - target)) selected = index;
  }
  return selected;
}

function dominant(result: CwtColumn) {
  let selected = -1;
  for (let index = 0; index < result.power.length; index++) {
    if (result.valid[index] && (selected < 0 || result.power[index] > result.power[selected])) selected = index;
  }
  expect(selected).toBeGreaterThanOrEqual(0);
  return result.frequenciesHz[selected];
}

test('complex Morlet CWT locates pure 1 Hz and 10 Hz tones', () => {
  for (const frequency of [1, 10]) {
    const result = column(prepare(signal(100, 30, (time) => Math.sin(TAU * frequency * time))), 15);
    expect(dominant(result)).toBeCloseTo(frequency, frequency === 1 ? 1 : 0);
  }
});

test('distinguishes both components of a two-frequency signal', () => {
  const result = column(prepare(signal(100, 30, (time) => Math.sin(TAU * 2 * time) + Math.sin(TAU * 12 * time))), 15);
  const at2 = nearest(result.frequenciesHz, 2);
  const at12 = nearest(result.frequenciesHz, 12);
  const at6 = nearest(result.frequenciesHz, 6);
  expect(result.valid[at2]).toBe(1);
  expect(result.valid[at12]).toBe(1);
  expect(result.power[at2]).toBeGreaterThan(result.power[at6] * 10);
  expect(result.power[at12]).toBeGreaterThan(result.power[at6] * 10);
});

test('tracks a linear chirp at selected timestamps', () => {
  const duration = 20;
  const start = 2;
  const slope = (15 - start) / duration;
  const prepared = prepare(signal(100, duration, (time) => Math.sin(TAU * (start * time + slope * time * time / 2))));
  for (const time of [5, 15]) {
    const expected = start + slope * time;
    expect(dominant(column(prepared, time))).toBeCloseTo(expected, 0);
  }
});

test('localizes a transient in time', () => {
  const prepared = prepare(signal(100, 20, (time) => time >= 9 && time <= 11 ? Math.sin(TAU * 10 * time) : 0));
  const active = column(prepared, 10);
  const quiet = column(prepared, 5);
  const band = nearest(active.frequenciesHz, 10);
  expect(active.power[band]).toBeGreaterThan(quiet.power[band] * 1_000);
});

test('removes DC and preserves linear coefficient and quadratic power scaling', () => {
  const constant = column(prepare(signal(100, 20, () => 12)), 10);
  expect(Math.max(...constant.power)).toBeLessThan(1e-20);

  const first = column(prepare(signal(100, 20, (time) => Math.sin(TAU * 5 * time))), 10);
  const triple = column(prepare(signal(100, 20, (time) => 3 * Math.sin(TAU * 5 * time))), 10);
  const band = nearest(first.frequenciesHz, 5);
  expect(Math.hypot(triple.real[band], triple.imaginary[band]) / Math.hypot(first.real[band], first.imaginary[band])).toBeCloseTo(3, 8);
  expect(triple.power[band] / first.power[band]).toBeCloseTo(9, 8);
});

test('works at native rates of 100, 250, and 500 Hz', () => {
  for (const rate of [100, 250, 500]) {
    const result = column(prepare(signal(rate, 20, (time) => Math.sin(TAU * 10 * time))), 10);
    expect(result.effectiveSampleRate).toBeCloseTo(rate, 6);
    expect(dominant(result)).toBeCloseTo(10, 0);
  }
});

test('uses aggregation rate and rejects a frequency range above its support', () => {
  const samples = signal(100, 30, (time) => Math.sin(TAU * time));
  const aggregated = prepare(samples, 100, { minimumFrequencyHz: 0.5, maximumFrequencyHz: 4 });
  expect(aggregated.effectiveSampleRate).toBe(10);
  expect(dominant(column(aggregated, 15))).toBeCloseTo(1, 1);

  const oneHertz = prepareReconstructedAnalysis(samples, 1_000)!;
  const unsupported = prepareCwtAnalysis(oneHertz);
  expect(unsupported).toMatchObject({ status: 'unsupported', effectiveSampleRate: 1 });
});

test('reconstructs short gaps but never convolves across disconnected long gaps', () => {
  const source = signal(100, 20, (time) => Math.sin(TAU * 10 * time));
  const shortGap = source.filter((sample) => sample.seq < 996 || sample.seq > 1004);
  const shortInput = prepareReconstructedAnalysis(shortGap, 0)!;
  expect(shortInput.runs).toHaveLength(1);
  expect(shortInput.runs[0].quality).toMatchObject({ interpolatedSampleCount: 9, status: 'reconstructed' });
  expect(column(prepareCwtAnalysis(shortInput) as PreparedCwtAnalysis, 10).quality.status).toBe('reconstructed');

  const longGap = source.filter((sample) => sample.seq < 990 || sample.seq > 1010);
  const longInput = prepareReconstructedAnalysis(longGap, 0)!;
  expect(longInput.runs).toHaveLength(2);
  const prepared = prepareCwtAnalysis(longInput) as PreparedCwtAnalysis;
  expect(analyzeCwtAtTimestamp(prepared, 10e6).status).toBe('insufficient-data');
  expect(column(prepared, 9.85).edgeAffected[nearest(prepared.frequenciesHz, 10)]).toBe(1);
});

test('marks scale-specific finite-boundary influence separately from reconstruction', () => {
  const result = column(prepare(signal(100, 20, (time) => Math.sin(TAU * 10 * time))), 1);
  const low = nearest(result.frequenciesHz, 1);
  const high = nearest(result.frequenciesHz, 10);
  expect(result.valid[low]).toBe(0);
  expect(result.edgeAffected[low]).toBe(1);
  expect(result.valid[high]).toBe(1);
  expect(result.edgeAffected[high]).toBe(0);
  expect(result.quality.status).toBe('fresh');
});

test('selected-timestamp analysis is deterministic and finite', () => {
  const prepared = prepare(signal(250, 20, (time) => Math.sin(TAU * 7 * time)));
  const [first, second] = analyzeCwtAtTimestamps(prepared, [10e6, 10e6]) as CwtColumn[];
  expect(Array.from(second.real)).toEqual(Array.from(first.real));
  expect(Array.from(second.imaginary)).toEqual(Array.from(first.imaginary));
  expect(Array.from(second.power)).toEqual(Array.from(first.power));
  expect([...first.real, ...first.imaginary, ...first.power].every(Number.isFinite)).toBe(true);
});

test('reuses compatible Morlet kernels across incremental preparations', () => {
  const input = prepareReconstructedAnalysis(signal(100, 20, (time) => Math.sin(TAU * 7 * time)), 0)!;
  const first = prepareCwtAnalysis(input);
  if ('status' in first) throw new Error(first.reason);
  const second = prepareCwtAnalysis(input, {}, first);
  if ('status' in second) throw new Error(second.reason);
  expect(second.kernels).toBe(first.kernels);
  expect(second.frequenciesHz).toBe(first.frequenciesHz);
});

test('finds actual nearby observations under realistic cumulative timestamp drift', () => {
  const observations = Array.from({ length: 1_000 }, (_, index) => ({ key: index, t: index * 10_020, v: Math.sin(TAU * index / 100) }));
  const input = {
    runs: [{ observations, quality: { originalSampleCount: observations.length, interpolatedSampleCount: 0, reconstructedFraction: 0, largestInterpolatedGapUs: 0, status: 'fresh' as const } }],
    effectiveSampleRate: 1e6 / 10_020,
    expectedUs: 10_020,
    aggregationMs: 0,
  };
  const prepared = prepareCwtAnalysis(input);
  if ('status' in prepared) throw new Error(prepared.reason);
  const result = analyzeCwtAtTimestamp(prepared, 5_000_000);
  expect(result.status).toBe('ok');
  if (result.status === 'ok') expect(Math.abs(result.analysisTimeUs - 5_000_000)).toBeLessThan(100);
  const diagnostics = analyzeCwtAtTimestampsWithDiagnostics(prepared, [5_000_000, 20_000_000]);
  expect(diagnostics).toMatchObject({ attempted: 2, successful: 1, rejected: 1, rejectionReasons: { 'timestamp-outside-runs': 1 } });
});

test('recent edge coefficients mature when their derived support becomes available', () => {
  const source = signal(100, 20, (time) => Math.sin(TAU * time));
  const early = prepare(source.filter((sample) => sample.t <= 11e6));
  const mature = prepare(source.filter((sample) => sample.t <= 15e6));
  const earlyColumn = column(early, 10);
  const matureColumn = column(mature, 10);
  const band = nearest(earlyColumn.frequenciesHz, 1);
  expect(cwtRefreshHorizonUs(early)).toBeGreaterThan(3_800_000);
  expect(earlyColumn.edgeAffected[band]).toBe(1);
  expect(earlyColumn.valid[band]).toBe(0);
  expect(matureColumn.edgeAffected[band]).toBe(0);
  expect(matureColumn.valid[band]).toBe(1);
  expect(matureColumn.power[band]).not.toBe(earlyColumn.power[band]);
});

test('accepts Indoor Sky-like 100 Hz timing at absolute 250 ms analysis hops', () => {
  let timeUs = 131_279_072_714;
  const intervals = [10_000, 9_999, 10_001, 10_130, 9_999, 10_000];
  const samples = Array.from({ length: 1_200 }, (_, index) => {
    if (index) timeUs += intervals[index % intervals.length];
    return { seq: 13_127_783 + index, t: timeUs, v: Math.sin(TAU * 5 * index / 100) };
  });
  const input = prepareReconstructedAnalysis(samples, 0)!;
  expect(input.runs).toHaveLength(1);
  const prepared = prepareCwtAnalysis(input);
  if ('status' in prepared) throw new Error(prepared.reason);
  const first = Math.ceil(samples[0].t / 250_000) * 250_000;
  const last = Math.floor(samples.at(-1)!.t / 250_000) * 250_000;
  const times = Array.from({ length: Math.floor((last - first) / 250_000) + 1 }, (_, index) => first + index * 250_000);
  const result = analyzeCwtAtTimestampsWithDiagnostics(prepared, times);
  expect(result.successful).toBe(times.length);
  expect(result.rejected).toBe(0);
  expect(result.rejectionReasons).toEqual({});
});
