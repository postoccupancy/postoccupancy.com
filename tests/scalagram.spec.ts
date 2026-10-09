import { expect, test, type WebSocketRoute } from '@playwright/test';
import {
  mergeScalagramColumns,
  pruneScalagramColumns,
  scalagramBandOpacity,
  scalagramFrequencyLabels,
  scalagramPowerLevel,
  scalagramQualityLabel,
  scalagramRasterTiles,
  scalagramTimeRuns,
  SCALAGRAM_HOP_US,
} from '../src/components/signals/scalagram-plot';
import type { CwtColumn } from '../src/lib/signals/cwt-analysis';

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
  expect(scalagramTimeRuns(columns)).toHaveLength(2);
  expect(scalagramRasterTiles(columns)).toHaveLength(2);
  const inserted = mergeScalagramColumns([columns[0]], [columns[1], columns[0]]);
  expect(inserted).toHaveLength(2);
  expect(inserted.at(-1)?.requestedTimeUs).toBe(500_000);
  const retained = pruneScalagramColumns(Array.from({ length: 150 }, (_, index) => cwtColumn(index * SCALAGRAM_HOP_US)), 74_500_000);
  expect(retained).toHaveLength(131);
  expect(scalagramRasterTiles(retained).length).toBeLessThanOrEqual(10);
  expect(scalagramFrequencyLabels(columns[0].frequenciesHz)).toEqual({ top: '40 Hz', bottom: '0.5 Hz' });
});

test('scalagram uses stable logarithmic power and distinct boundary opacity', () => {
  expect(scalagramPowerLevel(1, 1)).toBe(1);
  expect(scalagramPowerLevel(1e-6, 1)).toBeCloseTo(0);
  expect(scalagramPowerLevel(1e-3, 1)).toBeCloseTo(0.5);
  expect(scalagramPowerLevel(1e-3, 1)).toBe(scalagramPowerLevel(1e-3, 1));
  expect(scalagramBandOpacity(true, false)).toBe(255);
  expect(scalagramBandOpacity(false, true)).toBe(90);
  expect(scalagramBandOpacity(false, false)).toBe(0);
  expect(scalagramQualityLabel(cwtColumn(0, { quality: 'reconstructed' }))).toBe('run reconstructed · 10.0% interpolated');
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
  await expect(plots.first()).toHaveAttribute('data-scalagram-hop-ms', '500');
  await expect(plots.first()).toHaveAttribute('data-scalagram-rate', '100');
  await expect(plots.first()).toHaveAttribute('data-scalagram-min-frequency', '0.5');
  expect(Number(await plots.first().getAttribute('data-scalagram-max-frequency'))).toBeCloseTo(40);
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
