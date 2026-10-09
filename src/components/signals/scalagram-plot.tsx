'use client';

import { memo, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { Channel, NodeClock } from '@/lib/signals/router-client';
import {
  analyzeCwtAtTimestampsWithDiagnostics,
  cwtRefreshHorizonUs,
  prepareCwtAnalysis,
  type CwtColumn,
  type CwtKernelSet,
} from '@/lib/signals/cwt-analysis';
import { prepareReconstructedAnalysis } from '@/lib/signals/spectrum-analysis';

export const SCALAGRAM_HOP_US = 250_000;
const HISTORY_US = 65_000_000;
const INITIAL_HISTORY_US = 3_000_000;
const BACKFILL_CHUNK_US = 5_000_000;
const RASTER_TILE_COLUMNS = 16;
const POWER_RANGE_DB = 60;
const CALIBRATION_US = 30_000_000;
const CALIBRATION_HOP_US = 1_000_000;

export interface ScalagramTimeRun {
  columns: CwtColumn[];
  startTimeUs: number;
  endTimeUs: number;
}

export interface ScalagramRasterTile extends ScalagramTimeRun {
  rasterColumns: CwtColumn[];
  sourceX: number;
  sourceWidth: number;
}

export function mergeScalagramColumns(existing: CwtColumn[], incoming: CwtColumn[]) {
  const columns = new Map(existing.map((column) => [column.requestedTimeUs, column]));
  for (const column of incoming) columns.set(column.requestedTimeUs, column);
  return [...columns.values()].sort((left, right) => left.requestedTimeUs - right.requestedTimeUs);
}

export function scalagramTimeRuns(columns: CwtColumn[], hopUs = SCALAGRAM_HOP_US): ScalagramTimeRun[] {
  const runs: CwtColumn[][] = [];
  for (const column of columns) {
    const run = runs.at(-1);
    if (!run || column.requestedTimeUs - run.at(-1)!.requestedTimeUs > hopUs * 1.5) runs.push([column]);
    else run.push(column);
  }
  return runs.map((run) => ({
    columns: run,
    startTimeUs: run[0].requestedTimeUs - hopUs / 2,
    endTimeUs: run.at(-1)!.requestedTimeUs + hopUs / 2,
  }));
}

export function scalagramRasterTiles(columns: CwtColumn[], hopUs = SCALAGRAM_HOP_US) {
  const groups: CwtColumn[][] = [];
  for (const column of columns) {
    const tile = groups.at(-1);
    const previous = tile?.at(-1);
    const bucket = Math.floor(column.requestedTimeUs / (hopUs * RASTER_TILE_COLUMNS));
    const previousBucket = previous ? Math.floor(previous.requestedTimeUs / (hopUs * RASTER_TILE_COLUMNS)) : -1;
    if (!tile || !previous || column.requestedTimeUs - previous.requestedTimeUs > hopUs * 1.5 || bucket !== previousBucket) groups.push([column]);
    else tile.push(column);
  }
  return groups.map((tileColumns, index): ScalagramRasterTile => {
    const previous = groups[index - 1]?.at(-1);
    const next = groups[index + 1]?.[0];
    const hasPreviousGuard = Boolean(previous && tileColumns[0].requestedTimeUs - previous.requestedTimeUs <= hopUs * 1.5);
    const hasNextGuard = Boolean(next && next.requestedTimeUs - tileColumns.at(-1)!.requestedTimeUs <= hopUs * 1.5);
    return {
      columns: tileColumns,
      rasterColumns: [
        ...(hasPreviousGuard ? [previous!] : []),
        ...tileColumns,
        ...(hasNextGuard ? [next!] : []),
      ],
      sourceX: hasPreviousGuard ? 1 : 0,
      sourceWidth: tileColumns.length,
      startTimeUs: tileColumns[0].requestedTimeUs - hopUs / 2,
      endTimeUs: tileColumns.at(-1)!.requestedTimeUs + hopUs / 2,
    };
  });
}

export function visibleScalagramRuns(runs: ScalagramTimeRun[], startTimeUs: number, endTimeUs: number) {
  return runs.filter((run) => run.endTimeUs > startTimeUs && run.startTimeUs < endTimeUs);
}

export function scalagramFrequencyLabels(frequenciesHz: Float64Array) {
  const label = (value: number) => `${Number(value.toFixed(value < 10 ? 2 : 1))} Hz`;
  return { top: label(frequenciesHz.at(-1) ?? 0), bottom: label(frequenciesHz[0] ?? 0) };
}

export function scalagramQualityLabel(column?: CwtColumn) {
  if (!column) return 'waiting';
  return `run ${column.quality.status} · ${(column.quality.reconstructedFraction * 100).toFixed(1)}% interpolated`;
}

/** Historical-calibration mapping: the frozen 95th-percentile valid power is 0 dB; 60 dB below is black. */
export function scalagramPowerLevel(power: number, referencePower: number) {
  if (!(power > 0) || !(referencePower > 0)) return 0;
  return Math.max(0, Math.min(1, (10 * Math.log10(power / referencePower) + POWER_RANGE_DB) / POWER_RANGE_DB));
}

export function scalagramPowerReference(columns: CwtColumn[]) {
  const powers: number[] = [];
  for (const column of columns) {
    for (let band = 0; band < column.power.length; band++) {
      if (column.valid[band] && Number.isFinite(column.power[band]) && column.power[band] > 0) powers.push(column.power[band]);
    }
  }
  powers.sort((left, right) => left - right);
  return Math.max(powers[Math.floor((powers.length - 1) * 0.95)] ?? 0, 1e-24);
}

export function scalagramBandOpacity(valid: boolean, edgeAffected: boolean) {
  return valid ? 255 : edgeAffected ? 180 : 0;
}

export function pruneScalagramColumns(columns: CwtColumn[], endTimeUs: number) {
  return columns.filter((column) => column.requestedTimeUs >= endTimeUs - HISTORY_US);
}

export function scalagramMissingColumnCount(columns: CwtColumn[], hopUs = SCALAGRAM_HOP_US) {
  if (columns.length < 2) return 0;
  const expected = Math.floor((columns.at(-1)!.requestedTimeUs - columns[0].requestedTimeUs) / hopUs) + 1;
  return Math.max(0, expected - columns.length);
}

export function scalagramColumnRevision(column: CwtColumn) {
  let valid = 0;
  let edge = 0;
  let power = 0;
  for (let index = 0; index < column.power.length; index++) {
    valid += column.valid[index];
    edge += column.edgeAffected[index];
    power += column.power[index] * (index + 1);
  }
  return `${column.analysisTimeUs}:${valid}:${edge}:${power.toExponential(6)}`;
}

export function scalagramPresentationEdgeEnd(
  lastColumnTimeUs: number,
  hopUs: number,
  presentationEndUs: number,
  unavailable: boolean,
  toleranceUs = 50_000,
) {
  const cellEnd = lastColumnTimeUs + hopUs / 2;
  if (unavailable) return cellEnd;
  return Math.max(cellEnd, Math.min(presentationEndUs, lastColumnTimeUs + hopUs + toleranceUs));
}

export function scalagramTimeline(nodeClockTimeUs: number, delaySeconds: number, acquisitionEndUs: number) {
  return {
    nodeClockTimeUs,
    presentationEndUs: nodeClockTimeUs - delaySeconds * 1e6,
    acquisitionEndUs,
    analysisSupportEndUs: acquisitionEndUs,
  };
}

export function scalagramHasContinuousSupport(runs: Array<{ observations: Array<{ t: number }> }>, presentationEndUs: number, lastColumnTimeUs = presentationEndUs) {
  return runs.some((run) => {
    const first = run.observations[0]?.t;
    const last = run.observations.at(-1)?.t;
    return first !== undefined && last !== undefined && first <= lastColumnTimeUs && last >= presentationEndUs;
  });
}

function hslToRgb(hue: number, saturation: number, lightness: number) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const intermediate = chroma * (1 - Math.abs(section % 2 - 1));
  const [red, green, blue] = section < 1 ? [chroma, intermediate, 0]
    : section < 2 ? [intermediate, chroma, 0]
      : section < 3 ? [0, chroma, intermediate]
        : section < 4 ? [0, intermediate, chroma]
          : section < 5 ? [intermediate, 0, chroma]
            : [chroma, 0, intermediate];
  const match = lightness - chroma / 2;
  return [red + match, green + match, blue + match].map((value) => Math.round(value * 255));
}

function buildTileRaster(run: ScalagramRasterTile, height: number, referencePower: number) {
  const raster = document.createElement('canvas');
  raster.width = run.rasterColumns.length;
  raster.height = height;
  const context = raster.getContext('2d')!;
  const image = context.createImageData(raster.width, height);
  for (let x = 0; x < run.rasterColumns.length; x++) {
    const column = run.rasterColumns[x];
    const maximumBand = column.power.length - 1;
    for (let y = 0; y < height; y++) {
      const bandPosition = (1 - y / Math.max(1, height - 1)) * maximumBand;
      const low = Math.floor(bandPosition);
      const high = Math.min(maximumBand, low + 1);
      const mix = bandPosition - low;
      const power = column.power[low] * (1 - mix) + column.power[high] * mix;
      const valid = Boolean(column.valid[low] && column.valid[high]);
      const edgeAffected = Boolean(column.edgeAffected[low] || column.edgeAffected[high]);
      const level = scalagramPowerLevel(power, referencePower);
      const legacyValue = level * 255;
      const [red, green, blue] = hslToRgb(240 - legacyValue * 0.8, 0.9, legacyValue * 0.28 / 100);
      const offset = (y * raster.width + x) * 4;
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
      image.data[offset + 3] = scalagramBandOpacity(valid, edgeAffected);
    }
  }
  context.putImageData(image, 0, 0);
  return raster;
}

function hopTimes(first: number, last: number, hopUs = SCALAGRAM_HOP_US) {
  if (last < first) return [];
  return Array.from({ length: Math.floor((last - first) / hopUs) + 1 }, (_, index) => first + index * hopUs);
}

interface ScalagramDiagnostics {
  attempted: number;
  successful: number;
  rejected: number;
  timestampLookupFailures: number;
  reanalyzed: number;
  runLengths: number[];
  rawSampleCount: number;
  rawFirstTimeUs: number;
  rawLastTimeUs: number;
  presentationEndUs: number;
  nodeClockTimeUs: number;
  acquisitionEndUs: number;
  samplesBeforePresentation: number;
  samplesAfterPresentation: number;
  continuousAtPresentation: boolean;
  requestedFirstTimeUs: number;
  requestedLastTimeUs: number;
}

const emptyDiagnostics = (): ScalagramDiagnostics => ({ attempted: 0, successful: 0, rejected: 0, timestampLookupFailures: 0, reanalyzed: 0, runLengths: [], rawSampleCount: 0, rawFirstTimeUs: 0, rawLastTimeUs: 0, presentationEndUs: 0, nodeClockTimeUs: 0, acquisitionEndUs: 0, samplesBeforePresentation: 0, samplesAfterPresentation: 0, continuousAtPresentation: false, requestedFirstTimeUs: 0, requestedLastTimeUs: 0 });

function recordRawWindow(diagnostics: ScalagramDiagnostics, samples: Array<{ t: number }>, nodeClockTimeUs: number, presentationEndUs: number, acquisitionEndUs: number) {
  diagnostics.rawSampleCount = samples.length;
  diagnostics.rawFirstTimeUs = samples[0]?.t ?? 0;
  diagnostics.rawLastTimeUs = samples.at(-1)?.t ?? 0;
  diagnostics.presentationEndUs = presentationEndUs;
  diagnostics.nodeClockTimeUs = nodeClockTimeUs;
  diagnostics.acquisitionEndUs = acquisitionEndUs;
  diagnostics.samplesBeforePresentation = samples.filter((sample) => sample.t <= presentationEndUs).length;
  diagnostics.samplesAfterPresentation = samples.length - diagnostics.samplesBeforePresentation;
}

export const ScalagramPlot = memo(function ScalagramPlot({ channel, clock, delay, windowSeconds, aggregationMs, refreshKey, label, onAnalysisRate }: {
  channel: Channel;
  clock?: NodeClock;
  delay: number;
  windowSeconds: number;
  aggregationMs: number;
  refreshKey: number;
  label: string;
  onAnalysisRate?: (channelId: string, aggregationMs: number, rate: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<CwtColumn[]>([]);
  const lastHopRef = useRef<number | null>(null);
  const analysisKeyRef = useRef('');
  const rasterCacheRef = useRef(new Map<string, HTMLCanvasElement>());
  const kernelsRef = useRef<CwtKernelSet | undefined>(undefined);
  const referencePowerRef = useRef(1e-24);
  const preparationMsRef = useRef(0);
  const initialDisplayMsRef = useRef(0);
  const initialColumnsRef = useRef(0);
  const backfillMsRef = useRef(0);
  const incrementalMsRef = useRef(0);
  const diagnosticsRef = useRef<ScalagramDiagnostics>(emptyDiagnostics());
  const [revision, setRevision] = useState(0);
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const [unavailable, setUnavailable] = useState('');
  const analysisKey = `${channel.id}/${clock?.generation ?? -1}/${delay}/${aggregationMs}`;
  const inputRef = useRef({ channel, clock, delay, aggregationMs });
  inputRef.current = { channel, clock, delay, aggregationMs };

  useEffect(() => {
    const input = inputRef.current;
    if (!input.clock) return;
    let cancelled = false;
    let timer = 0;
    const started = performance.now();
    const acquisitionEndUs = input.channel.ring.latest()?.t ?? 0;
    const timeline = scalagramTimeline(input.clock.timeUs + (performance.now() - input.clock.atMs) * 1000, input.delay, acquisitionEndUs);
    const { nodeClockTimeUs, presentationEndUs: end } = timeline;
    const samples: Array<{ seq: number; t: number; v: number }> = [];
    input.channel.ring.visitRange(acquisitionEndUs - 70_000_000, acquisitionEndUs, (sample) => samples.push(sample));
    analysisKeyRef.current = analysisKey;
    historyRef.current = [];
    lastHopRef.current = null;
    rasterCacheRef.current.clear();
    referencePowerRef.current = 1e-24;
    kernelsRef.current = undefined;
    preparationMsRef.current = 0;
    initialDisplayMsRef.current = 0;
    initialColumnsRef.current = 0;
    backfillMsRef.current = 0;
    incrementalMsRef.current = 0;
    diagnosticsRef.current = emptyDiagnostics();
    recordRawWindow(diagnosticsRef.current, samples, nodeClockTimeUs, end, acquisitionEndUs);
    setUnavailable('');
    if (!samples.length) {
      setUnavailable(acquisitionEndUs > end
        ? 'Waiting for presentation buffer.'
        : 'Insufficient reconstructed data.');
      setRevision((value) => value + 1);
      return;
    }

    const preparationStarted = performance.now();
    const reconstructed = prepareReconstructedAnalysis(samples, input.aggregationMs);
    const preparedResult = reconstructed ? prepareCwtAnalysis(reconstructed) : null;
    preparationMsRef.current = performance.now() - preparationStarted;
    if (!preparedResult || 'status' in preparedResult) {
      setUnavailable(preparedResult && 'status' in preparedResult ? preparedResult.reason : 'Insufficient reconstructed data.');
      setRevision((value) => value + 1);
      return;
    }
    const prepared = preparedResult;
    kernelsRef.current = prepared;
    diagnosticsRef.current.runLengths = prepared.runs.map((run) => run.observations.length);
    const firstObservation = prepared.runs[0]?.observations[0];
    if (!firstObservation) return;
    const firstHop = Math.ceil(Math.max(firstObservation.t, end - HISTORY_US) / SCALAGRAM_HOP_US) * SCALAGRAM_HOP_US;
    const finalHop = Math.floor(end / SCALAGRAM_HOP_US) * SCALAGRAM_HOP_US;
    if (finalHop < firstHop) {
      lastHopRef.current = firstHop - SCALAGRAM_HOP_US;
      onAnalysisRate?.(channel.id, aggregationMs, prepared.effectiveSampleRate);
      setUnavailable('Waiting for presentation buffer.');
      setRevision((value) => value + 1);
      return;
    }
    const recentFirstHop = Math.max(firstHop, Math.ceil((finalHop - INITIAL_HISTORY_US) / SCALAGRAM_HOP_US) * SCALAGRAM_HOP_US);
    const latestObservation = prepared.runs.at(-1)?.observations.at(-1);
    const calibrationEnd = Math.min(finalHop, Math.floor((latestObservation?.t ?? finalHop) / CALIBRATION_HOP_US) * CALIBRATION_HOP_US);
    const calibrationFirst = Math.ceil(Math.max(firstObservation.t, calibrationEnd - CALIBRATION_US) / CALIBRATION_HOP_US) * CALIBRATION_HOP_US;
    const calibration = analyzeCwtAtTimestampsWithDiagnostics(prepared, hopTimes(calibrationFirst, calibrationEnd, CALIBRATION_HOP_US));
    referencePowerRef.current = scalagramPowerReference(calibration.columns);
    const recentResult = analyzeCwtAtTimestampsWithDiagnostics(prepared, hopTimes(recentFirstHop, finalHop));
    diagnosticsRef.current.requestedFirstTimeUs = recentFirstHop;
    diagnosticsRef.current.requestedLastTimeUs = finalHop;
    const recent = recentResult.columns;
    diagnosticsRef.current.attempted += recentResult.attempted;
    diagnosticsRef.current.successful += recentResult.successful;
    diagnosticsRef.current.rejected += recentResult.rejected;
    diagnosticsRef.current.timestampLookupFailures += recentResult.rejectionReasons['timestamp-outside-runs'] ?? 0;
    historyRef.current = recent;
    diagnosticsRef.current.continuousAtPresentation = Boolean(recent.at(-1)
      && scalagramHasContinuousSupport(prepared.runs, end, recent.at(-1)!.requestedTimeUs));
    if (!recent.length) setUnavailable('Waiting for presentation buffer.');
    initialColumnsRef.current = recent.length;
    lastHopRef.current = finalHop;
    initialDisplayMsRef.current = performance.now() - started;
    onAnalysisRate?.(channel.id, aggregationMs, prepared.effectiveSampleRate);
    setRevision((value) => value + 1);

    let cursor = firstHop;
    const processOlderChunk = () => {
      if (cancelled || cursor >= recentFirstHop) {
        backfillMsRef.current = performance.now() - started;
        if (!cancelled) setRevision((value) => value + 1);
        return;
      }
      const chunkFinal = Math.min(recentFirstHop - SCALAGRAM_HOP_US, cursor + BACKFILL_CHUNK_US - SCALAGRAM_HOP_US);
      const result = analyzeCwtAtTimestampsWithDiagnostics(prepared, hopTimes(cursor, chunkFinal));
      diagnosticsRef.current.attempted += result.attempted;
      diagnosticsRef.current.successful += result.successful;
      diagnosticsRef.current.rejected += result.rejected;
      diagnosticsRef.current.timestampLookupFailures += result.rejectionReasons['timestamp-outside-runs'] ?? 0;
      historyRef.current = mergeScalagramColumns(historyRef.current, result.columns);
      cursor = chunkFinal + SCALAGRAM_HOP_US;
      setRevision((value) => value + 1);
      timer = window.setTimeout(processOlderChunk, 0);
    };
    if (cursor < recentFirstHop) timer = window.setTimeout(processOlderChunk, 0);
    else backfillMsRef.current = performance.now() - started;
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [aggregationMs, analysisKey, bootstrapRevision, channel.id, onAnalysisRate]);

  useEffect(() => {
    void refreshKey;
    if (!clock || analysisKeyRef.current !== analysisKey) return;
    if (lastHopRef.current === null) {
      setBootstrapRevision((value) => value + 1);
      return;
    }
    const acquisitionEndUs = channel.ring.latest()?.t ?? 0;
    const timeline = scalagramTimeline(clock.timeUs + (performance.now() - clock.atMs) * 1000, delay, acquisitionEndUs);
    const { nodeClockTimeUs, presentationEndUs: end } = timeline;
    const firstHop = lastHopRef.current + SCALAGRAM_HOP_US;
    const finalHop = Math.floor(end / SCALAGRAM_HOP_US) * SCALAGRAM_HOP_US;
    if (firstHop > finalHop) return;
    const started = performance.now();
    const samples: Array<{ seq: number; t: number; v: number }> = [];
    channel.ring.visitRange(acquisitionEndUs - 70_000_000, acquisitionEndUs, (sample) => samples.push(sample));
    recordRawWindow(diagnosticsRef.current, samples, nodeClockTimeUs, end, acquisitionEndUs);
    const reconstructed = prepareReconstructedAnalysis(samples, aggregationMs);
    const prepared = reconstructed ? prepareCwtAnalysis(reconstructed, {}, kernelsRef.current) : null;
    if (!prepared || 'status' in prepared) {
      setUnavailable(prepared && 'status' in prepared ? prepared.reason : 'Insufficient reconstructed data.');
      setRevision((value) => value + 1);
      return;
    }
    kernelsRef.current = prepared;
    diagnosticsRef.current.runLengths = prepared.runs.map((run) => run.observations.length);
    const maturityFirst = Math.ceil((finalHop - cwtRefreshHorizonUs(prepared)) / SCALAGRAM_HOP_US) * SCALAGRAM_HOP_US;
    const analysisFirst = Math.min(firstHop, maturityFirst);
    const times = hopTimes(analysisFirst, finalHop);
    diagnosticsRef.current.requestedFirstTimeUs = firstHop;
    diagnosticsRef.current.requestedLastTimeUs = finalHop;
    const result = analyzeCwtAtTimestampsWithDiagnostics(prepared, times);
    diagnosticsRef.current.attempted += result.attempted;
    diagnosticsRef.current.successful += result.successful;
    diagnosticsRef.current.rejected += result.rejected;
    diagnosticsRef.current.timestampLookupFailures += result.rejectionReasons['timestamp-outside-runs'] ?? 0;
    diagnosticsRef.current.reanalyzed += times.filter((timeUs) => timeUs <= lastHopRef.current!).length;
    historyRef.current = pruneScalagramColumns(mergeScalagramColumns(historyRef.current, result.columns), end);
    const latestColumn = historyRef.current.at(-1);
    diagnosticsRef.current.continuousAtPresentation = Boolean(latestColumn
      && scalagramHasContinuousSupport(prepared.runs, end, latestColumn.requestedTimeUs));
    lastHopRef.current = finalHop;
    incrementalMsRef.current = performance.now() - started;
    setUnavailable(historyRef.current.length ? '' : 'Waiting for presentation buffer.');
    onAnalysisRate?.(channel.id, aggregationMs, prepared.effectiveSampleRate);
    setRevision((value) => value + 1);
  }, [aggregationMs, analysisKey, channel, clock, delay, onAnalysisRate, refreshKey]);

  useEffect(() => {
    void revision;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !clock) return;
    let frame = 0;
    const columns = historyRef.current;
    const tiles = scalagramRasterTiles(columns);
    const labels = columns[0] ? scalagramFrequencyLabels(columns[0].frequenciesHz) : null;
    let rasterHeight = 0;
    let rasters: Array<{ run: ScalagramRasterTile; canvas: HTMLCanvasElement }> = [];
    const ensureRasters = (height: number) => {
      if (height === rasterHeight) return;
      rasterHeight = height;
      const activeKeys = new Set<string>();
      rasters = tiles.map((run) => {
        const key = `${run.columns[0].requestedTimeUs}/${run.columns.at(-1)!.requestedTimeUs}/${run.columns.length}/${run.rasterColumns.map(scalagramColumnRevision).join(',')}/${height}/${referencePowerRef.current}`;
        activeKeys.add(key);
        let raster = rasterCacheRef.current.get(key);
        if (!raster) {
          raster = buildTileRaster(run, height, referencePowerRef.current);
          rasterCacheRef.current.set(key, raster);
        }
        return { run, canvas: raster };
      });
      for (const key of rasterCacheRef.current.keys()) if (!activeKeys.has(key)) rasterCacheRef.current.delete(key);
    };
    const draw = (now: number) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * ratio));
      const height = Math.max(1, Math.floor(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; rasterHeight = 0; }
      context.clearRect(0, 0, width, height);
      const end = clock.timeUs + (now - clock.atMs) * 1000 - delay * 1e6;
      const windowUs = windowSeconds * 1e6;
      const start = end - windowUs;
      const visible = visibleScalagramRuns(tiles, start, end);
      if (visible.length && labels) {
        ensureRasters(height);
        context.save();
        context.beginPath(); context.rect(0, 0, width, height); context.clip();
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        for (const { run, canvas: raster } of rasters) {
          if (!visible.includes(run)) continue;
          const left = (run.startTimeUs - start) / windowUs * width;
          const right = (run.endTimeUs - start) / windowUs * width;
          context.drawImage(raster, run.sourceX, 0, run.sourceWidth, raster.height, left, 0, right - left, height);
          if (run === tiles.at(-1) && !unavailable && diagnosticsRef.current.continuousAtPresentation) {
            const lastColumn = run.columns.at(-1)!;
            const extendedEnd = scalagramPresentationEdgeEnd(lastColumn.requestedTimeUs, SCALAGRAM_HOP_US, end, false);
            if (extendedEnd > run.endTimeUs) {
              const extendedRight = (extendedEnd - start) / windowUs * width;
              const finalSourceX = run.sourceX + run.sourceWidth - 1;
              context.drawImage(raster, finalSourceX, 0, 1, raster.height, right, 0, extendedRight - right, height);
            }
          }
        }
        context.restore();
        context.fillStyle = '#d8e2e8'; context.font = `${10 * ratio}px monospace`; context.textAlign = 'left';
        context.textBaseline = 'top'; context.fillText(labels.top, 5 * ratio, 4 * ratio);
        context.textBaseline = 'bottom'; context.fillText(labels.bottom, 5 * ratio, height - 4 * ratio);
      } else {
        context.fillStyle = '#8ba0af'; context.font = `${12 * ratio}px monospace`; context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillText(unavailable || 'Insufficient reconstructed data', width / 2, height / 2);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [clock, delay, revision, unavailable, windowSeconds]);

  const latest = historyRef.current.at(-1);
  const state = latest
    ? `${label}. Scalagram. ${historyRef.current.length} timestamped columns. ${latest.frequenciesHz[0].toFixed(2)} to ${latest.frequenciesHz.at(-1)!.toFixed(2)} Hz.${unavailable ? ` Analysis stale: ${unavailable}` : ''}`
    : `${label}. Scalagram. ${unavailable || 'Insufficient reconstructed data'}`;
  return <Box sx={{ position: 'relative', width: '100%', height: 170 }}>
    <Box component="canvas" ref={canvasRef} role="img" aria-label={state}
      data-scalagram-columns={historyRef.current.length} data-scalagram-hop-ms={SCALAGRAM_HOP_US / 1000}
      data-scalagram-rate={latest?.effectiveSampleRate} data-scalagram-min-frequency={latest?.frequenciesHz[0]}
      data-scalagram-max-frequency={latest?.frequenciesHz.at(-1)} data-scalagram-quality={latest?.quality.status}
      data-scalagram-reconstructed-fraction={latest?.quality.reconstructedFraction}
      data-scalagram-first-time={historyRef.current[0]?.requestedTimeUs} data-scalagram-last-time={latest?.requestedTimeUs}
      data-scalagram-valid-bands={latest ? Array.from(latest.valid).reduce((sum, value) => sum + value, 0) : undefined}
      data-scalagram-edge-bands={latest ? Array.from(latest.edgeAffected).reduce((sum, value) => sum + value, 0) : undefined}
      data-scalagram-raster-cache={rasterCacheRef.current.size} data-scalagram-reference-power={referencePowerRef.current}
      data-scalagram-initial-display-ms={initialDisplayMsRef.current.toFixed(1)}
      data-scalagram-initial-columns={initialColumnsRef.current}
      data-scalagram-backfill-ms={backfillMsRef.current.toFixed(1)}
      data-scalagram-preparation-ms={preparationMsRef.current.toFixed(1)}
      data-scalagram-incremental-ms={incrementalMsRef.current.toFixed(1)}
      data-scalagram-run-count={diagnosticsRef.current.runLengths.length}
      data-scalagram-run-lengths={diagnosticsRef.current.runLengths.join(',')}
      data-scalagram-attempted={diagnosticsRef.current.attempted}
      data-scalagram-successful={diagnosticsRef.current.successful}
      data-scalagram-rejected={diagnosticsRef.current.rejected}
      data-scalagram-timestamp-lookup-failures={diagnosticsRef.current.timestampLookupFailures}
      data-scalagram-missing-columns={scalagramMissingColumnCount(historyRef.current)}
      data-scalagram-reanalyzed={diagnosticsRef.current.reanalyzed}
      data-scalagram-raw-samples={diagnosticsRef.current.rawSampleCount}
      data-scalagram-raw-first-time={diagnosticsRef.current.rawFirstTimeUs || undefined}
      data-scalagram-raw-last-time={diagnosticsRef.current.rawLastTimeUs || undefined}
      data-scalagram-presentation-end={diagnosticsRef.current.presentationEndUs || undefined}
      data-scalagram-node-clock-time={diagnosticsRef.current.nodeClockTimeUs || undefined}
      data-scalagram-acquisition-end={diagnosticsRef.current.acquisitionEndUs || undefined}
      data-scalagram-analysis-support-end={diagnosticsRef.current.acquisitionEndUs || undefined}
      data-scalagram-samples-before-presentation={diagnosticsRef.current.samplesBeforePresentation}
      data-scalagram-samples-after-presentation={diagnosticsRef.current.samplesAfterPresentation}
      data-scalagram-continuous-at-presentation={diagnosticsRef.current.continuousAtPresentation}
      data-scalagram-requested-first-time={diagnosticsRef.current.requestedFirstTimeUs || undefined}
      data-scalagram-requested-last-time={diagnosticsRef.current.requestedLastTimeUs || undefined}
      data-scalagram-channel={channel.id}
      data-scalagram-clock-generation={clock?.generation}
      data-scalagram-bootstrap-revision={bootstrapRevision}
      data-scalagram-live-cursor={lastHopRef.current ?? undefined}
      data-scalagram-analysis-key={analysisKeyRef.current} data-scalagram-unavailable={unavailable || undefined}
      sx={{ display: 'block', width: '100%', height: 170, bgcolor: '#071017' }} />
    <Box component="span" data-scalagram-quality-label="true" sx={{ position: 'absolute', top: 4, right: 5, px: 0.5, py: 0.25, color: '#d8e2e8', fontFamily: 'monospace', fontSize: 10, lineHeight: 1.2, pointerEvents: 'none' }}>
      {scalagramQualityLabel(latest)}{unavailable && latest ? ' · analysis stale' : ''}
    </Box>
  </Box>;
});
