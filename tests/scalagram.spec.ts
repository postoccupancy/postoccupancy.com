import { expect, test, type WebSocketRoute } from '@playwright/test';
import {
  mergeScalagramColumns,
  pruneScalagramColumns,
  scalagramBandOpacity,
  scalagramColumnRevision,
  scalagramFrequencyLabels,
  scalagramHasContinuousSupport,
  scalagramPowerLevel,
  scalagramPowerReference,
  scalagramPresentationEdgeEnd,
  scalagramQualityLabel,
  scalagramRasterTiles,
  scalagramTimeRuns,
  scalagramTimeline,
  SCALAGRAM_HOP_US,
} from '../src/components/signals/scalagram-plot';
import type { CwtColumn } from '../src/lib/signals/cwt-analysis';
import { analyzeCwtAtTimestampsWithDiagnostics, prepareCwtAnalysis } from '../src/lib/signals/cwt-analysis';
import { SampleRing } from '../src/lib/signals/sample-ring';
import { prepareReconstructedAnalysis } from '../src/lib/signals/spectrum-analysis';

function cwtColumn(timeUs: number, options: { valid?: boolean; quality?: 'fresh' | 'reconstructed' } = {}): CwtColumn {
  const valid = options.valid ?? true;
  return {
    status: 'ok', requestedTimeUs: timeUs, analysisTimeUs: timeUs, effectiveSampleRate: 100,
    frequenciesHz: Float64Array.from([0.5, 1, 2, 4, 8, 16, 40]),
    real: new Float64Array(7), imaginary: new Float64Array(7),
    power: Float64Array.from([1, 2, 3, 4, 3, 2, 1]),
    valid: Uint8Array.from({ length: 7 }, () => valid ? 1 : 0),
    edgeAffected: Uint8Array.from({ length: 7 }, () => valid ? 0 : 1),
    quality: {
      originalSampleCount: 90, interpolatedSampleCount: options.quality === 'reconstructed' ? 10 : 0,
      reconstructedFraction: options.quality === 'reconstructed' ? 0.1 : 0,
      largestInterpolatedGapUs: options.quality === 'reconstructed' ? 40_000 : 0,
      status: options.quality ?? 'fresh',
    },
  };
}

function periodicBatch(node: string, param: string, frequency = 5, start = 100_000_000) {
  const samples = Array.from({ length: 1201 }, (_, index) => [index, start + index * 10_000, Math.sin(2 * Math.PI * frequency * index / 100)]);
  return JSON.stringify({ type: 'sample_batch', sendTimeUs: start + 12_000_000, streams: [{ name: node, param, unit: 'percent', samples }] });
}

test('scalagram helpers preserve timestamp gaps, bounds, and bounded history', () => {
  const columns = [cwtColumn(0), cwtColumn(500_000), cwtColumn(2_000_000)];
  expect(scalagramTimeRuns(columns, 500_000)).toHaveLength(2);
  expect(scalagramRasterTiles(columns, 500_000)).toHaveLength(2);
  const inserted = mergeScalagramColumns([columns[0]], [columns[1], columns[0]]);
  expect(inserted).toHaveLength(2);
  expect(inserted.at(-1)?.requestedTimeUs).toBe(500_000);
  const retained = pruneScalagramColumns(Array.from({ length: 150 }, (_, index) => cwtColumn(index * SCALAGRAM_HOP_US)), 74_500_000);
  expect(retained).toHaveLength(112);
  expect(scalagramRasterTiles(retained).length).toBeLessThanOrEqual(9);
  expect(scalagramFrequencyLabels(columns[0].frequenciesHz)).toEqual({ top: '40 Hz', bottom: '0.5 Hz' });
});

test('scalagram uses stable logarithmic power and distinct boundary opacity', () => {
  expect(scalagramPowerLevel(1, 1)).toBe(1);
  expect(scalagramPowerLevel(1e-6, 1)).toBeCloseTo(0);
  expect(scalagramPowerLevel(1e-3, 1)).toBeCloseTo(0.5);
  expect(scalagramPowerLevel(1e-3, 1)).toBe(scalagramPowerLevel(1e-3, 1));
  expect(scalagramBandOpacity(true, false)).toBe(255);
  expect(scalagramBandOpacity(false, true)).toBe(180);
  expect(scalagramBandOpacity(false, false)).toBe(0);
  expect(scalagramQualityLabel(cwtColumn(0, { quality: 'reconstructed' }))).toBe('run reconstructed · 10.0% interpolated');
});

test('historical calibration is deterministic and column maturation invalidates its raster key', () => {
  const quiet = cwtColumn(0);
  quiet.power.fill(0);
  const normal = cwtColumn(500_000);
  const louder = cwtColumn(1_000_000);
  louder.power = Float64Array.from(louder.power, (power) => power * 4);
  const ordered = [quiet, normal, louder];
  expect(scalagramPowerReference(ordered)).toBe(scalagramPowerReference([...ordered].reverse()));
  expect(scalagramPowerReference([quiet])).toBe(1e-24);
  const edge = cwtColumn(2_000_000, { valid: false });
  const revision = scalagramColumnRevision(edge);
  edge.valid.fill(1); edge.edgeAffected.fill(0); edge.power[0] *= 2;
  expect(scalagramColumnRevision(edge)).not.toBe(revision);
});

test('right-edge extension is bounded and never covers stale or missing analysis', () => {
  expect(scalagramPresentationEdgeEnd(1_000_000, 250_000, 1_200_000, false)).toBe(1_200_000);
  expect(scalagramPresentationEdgeEnd(1_000_000, 250_000, 1_400_000, false)).toBe(1_125_000);
  expect(scalagramPresentationEdgeEnd(1_000_000, 250_000, 1_200_000, true)).toBe(1_125_000);
});

test('six-second delayed live timeline uses acquired support and recovers from an empty growing ring', () => {
  const ring = new SampleRing();
  const origin = 100_000_000;
  let sequence = 0;
  let firstVisibleStep = -1;
  let priorLastColumn = 0;
  for (let second = 0; second <= 14; second++) {
    if (second > 0) {
      for (let sample = 0; sample < 100; sample++) {
        const jitterUs = sample % 2 ? 35 : -35;
        const t = origin + (second - 1) * 1_000_000 + sample * 10_000 + jitterUs;
        ring.push({ seq: sequence++, t, v: Math.sin(2 * Math.PI * 4 * sequence / 100) });
      }
    }
    const acquisitionEndUs = ring.latest()?.t ?? 0;
    const timeline = scalagramTimeline(origin + second * 1_000_000, 6, acquisitionEndUs);
    expect(timeline.analysisSupportEndUs).toBe(acquisitionEndUs);
    if (!acquisitionEndUs || timeline.presentationEndUs < origin) continue;
    const samples: Array<{ seq: number; t: number; v: number }> = [];
    ring.visitRange(acquisitionEndUs - 70_000_000, acquisitionEndUs, (value) => samples.push(value));
    const reconstructed = prepareReconstructedAnalysis(samples, 0);
    const preparedResult = reconstructed && prepareCwtAnalysis(reconstructed);
    expect(preparedResult).toBeTruthy();
    expect(preparedResult && !('status' in preparedResult)).toBe(true);
    if (!preparedResult || 'status' in preparedResult) continue;
    expect(scalagramHasContinuousSupport(preparedResult.runs, timeline.presentationEndUs)).toBe(true);
    const requested = Math.floor(timeline.presentationEndUs / SCALAGRAM_HOP_US) * SCALAGRAM_HOP_US;
    const result = analyzeCwtAtTimestampsWithDiagnostics(preparedResult, [requested]);
    expect(result.successful).toBe(1);
    if (firstVisibleStep < 0) firstVisibleStep = second;
    expect(requested).toBeGreaterThan(priorLastColumn);
    priorLastColumn = requested;
  }
  expect(firstVisibleStep).toBe(6);
});

test('continuous-support detection preserves a real acquisition gap and edge extension stays sub-hop', () => {
  const runs = [
    { observations: [{ t: 1_000_000 }, { t: 2_000_000 }] },
    { observations: [{ t: 2_200_000 }, { t: 3_000_000 }] },
  ];
  expect(scalagramHasContinuousSupport(runs, 2_100_000)).toBe(false);
  expect(scalagramHasContinuousSupport(runs, 2_500_000)).toBe(true);
  expect(scalagramHasContinuousSupport(runs, 2_500_000, 2_000_000)).toBe(false);
  for (const elapsed of [10_000, 80_000, 200_000, 299_000]) {
    expect(scalagramPresentationEdgeEnd(2_500_000, 250_000, 2_500_000 + elapsed, false))
      .toBe(Math.max(2_625_000, 2_500_000 + elapsed));
  }
  expect(scalagramPresentationEdgeEnd(2_500_000, 250_000, 2_801_000, false)).toBe(2_625_000);
  expect(scalagramPresentationEdgeEnd(2_500_000, 250_000, 2_600_000, true)).toBe(2_625_000);
});

test('renders ten progressive scalagrams and cancels obsolete aggregation work', async ({ page }) => {
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket('wss://rf.postoccupancy.com', (socket) => {
    sockets.push(socket);
    for (const node of ['electric-sky', 'indoor-sky']) {
      for (const [index, param] of ['temperature', 'humidity', 'pressure', 'rms', 'power'].entries()) {
        socket.send(periodicBatch(node, param, index + 1));
      }
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Scalagram', exact: true }).click();
  await expect(page.getByRole('img', { name: /Scalagram/ })).toHaveCount(10);
  const plots = page.locator('canvas[data-scalagram-columns]');
  await expect(plots).toHaveCount(10);
  await expect.poll(async () => Number(await plots.first().getAttribute('data-scalagram-columns'))).toBeGreaterThan(6);
  await expect(plots.first()).toHaveAttribute('data-scalagram-hop-ms', '250');
  await expect(plots.first()).toHaveAttribute('data-scalagram-rate', '100');
  await expect(plots.first()).toHaveAttribute('data-scalagram-min-frequency', '0.5');
  expect(Number(await plots.first().getAttribute('data-scalagram-max-frequency'))).toBeCloseTo(40);
  await expect(plots.first()).toHaveAttribute('data-scalagram-run-count', '1');
  await expect(plots.first()).toHaveAttribute('data-scalagram-rejected', '0');
  await expect(plots.first()).toHaveAttribute('data-scalagram-timestamp-lookup-failures', '0');
  await expect(plots.first()).toHaveAttribute('data-scalagram-missing-columns', '0');
  await expect(page.locator('[data-scalagram-quality-label]')).toHaveCount(10);
  await expect(page.locator('[data-analysis-sample-rate]')).toHaveCount(10);

  const initialColumns = Number(await plots.first().getAttribute('data-scalagram-initial-columns'));
  await expect.poll(async () => Number(await plots.first().getAttribute('data-scalagram-columns'))).toBeGreaterThan(initialColumns);
  expect(Number(await plots.first().getAttribute('data-scalagram-backfill-ms'))).toBeGreaterThan(0);

  const aggregation = page.getByRole('slider', { name: 'Aggregation', exact: true });
  await aggregation.focus(); await aggregation.press('End');
  await expect(plots.first()).toHaveAttribute('data-scalagram-unavailable', /does not support/);
  await expect(plots.first()).toHaveAttribute('data-scalagram-analysis-key', /\/1000$/);
  await aggregation.press('Home');
  await expect.poll(async () => Number(await plots.first().getAttribute('data-scalagram-columns'))).toBeGreaterThan(0);
  expect(sockets).toHaveLength(1);
});

test('preserves the view through an initial preparation failure and recovers with valid data', async ({ page }) => {
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket('wss://rf.postoccupancy.com', (route) => {
    socket = route;
    route.send(JSON.stringify({
      type: 'sample_batch', sendTimeUs: 200_000_000,
      streams: [{ name: 'indoor-sky', param: 'humidity', unit: 'percent', samples: [[0, 100_000_000, 0]] }],
    }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Scalagram', exact: true }).click();
  const plot = page.locator('canvas[data-scalagram-columns]');
  await expect(plot).toHaveAttribute('data-scalagram-unavailable', /Insufficient reconstructed data/);
  socket!.send(JSON.stringify({
    type: 'sample_batch', sendTimeUs: 112_000_000,
    streams: [{
      name: 'indoor-sky', param: 'humidity', unit: 'percent',
      samples: Array.from({ length: 1_200 }, (_, offset) => {
        const sequence = offset + 1;
        return [sequence, 100_000_000 + sequence * 10_000, Math.sin(2 * Math.PI * 5 * sequence / 100)];
      }),
    }],
  }));
  await expect.poll(async () => Number(await plot.getAttribute('data-scalagram-columns'))).toBeGreaterThan(0);
  await expect(plot).not.toHaveAttribute('data-scalagram-unavailable', /.+/);
});
