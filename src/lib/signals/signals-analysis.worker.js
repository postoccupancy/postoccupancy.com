import { analyzeSpectrum } from '../visualizer/analysis-core';
import { ModulationAnalysis } from '../visualizer/modulation-analysis';

const streams = new Map();
let order = [];
let cursor = 0;
let config = {
  view: 'waveform', windowSeconds: 10, aggregationMs: 0,
  fftPower: 11, welchIndex: 2, bands: true, smooth: true,
  centroid: false, frequencyScale: 'log', spectrumMode: 'relative', palette: 'viridis',
};
const welchSegments = [1, 2, 4, 8, 16];

function stateFor(id) {
  let state = streams.get(id);
  if (!state) {
    state = { id, times: [], values: [], rate: 0, lastSpectro: 0, modulation: null, modulationKey: '', amplitudeReference: 0 };
    streams.set(id, state);
    order = [...streams.keys()];
  }
  return state;
}

function trim(state) {
  if (!state.times.length) return;
  const cutoff = state.times[state.times.length - 1] - 120e6;
  let first = 0;
  while (first < state.times.length && state.times[first] < cutoff) first++;
  if (first) {
    state.times.splice(0, first);
    state.values.splice(0, first);
  }
  if (state.times.length > 2_000_000) {
    const excess = state.times.length - 2_000_000;
    state.times.splice(0, excess);
    state.values.splice(0, excess);
  }
}

function fullScale(state) {
  if (state.amplitudeReference > 0) return state.amplitudeReference;
  const wanted = Math.min(state.values.length, Math.max(16, Math.round(state.rate * 2)));
  if (wanted < 2) return 1;
  const values = state.values.slice(-wanted);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let peak = 0;
  for (const value of values) peak = Math.max(peak, Math.abs(value - mean));
  state.amplitudeReference = peak ? peak * 16 : 1;
  return state.amplitudeReference;
}

function samplesBefore(state, timestamp, windowSeconds = null) {
  let end = state.times.length;
  while (end && state.times[end - 1] > timestamp) end--;
  let start = 0;
  if (windowSeconds !== null) {
    const cutoff = timestamp - windowSeconds * 1e6;
    while (start < end && state.times[start] < cutoff) start++;
  } else {
    const selected = 2 ** config.fftPower;
    let n = 32;
    while (n * 2 <= selected && n * 2 <= state.values.length) n *= 2;
    const wanted = n + (welchSegments[config.welchIndex] - 1) * n / 2;
    start = Math.max(0, end - wanted);
  }
  return state.values.slice(start, end);
}

function spectrumAt(state, timestamp, windowSeconds = null) {
  const raw = samplesBefore(state, timestamp, windowSeconds);
  return analyzeSpectrum(raw, state.rate, {
    fftPower: config.fftPower,
    welchSegments: welchSegments[config.welchIndex],
    bands: config.bands,
    spectrumMode: config.spectrumMode,
    aggregationMs: config.aggregationMs,
    amplitudeReference: fullScale(state),
    sourceSampleCount: windowSeconds === null ? state.values.length : raw.length,
  });
}

function updateSpectrogram(state) {
  const latest = state.times.at(-1);
  if (!(latest > 0)) return;
  const intervalUs = 1e6 / 30;
  if (!state.lastSpectro || latest < state.lastSpectro) {
    state.lastSpectro = Math.max(state.times[0], latest - 60e6) - intervalUs;
  }
  let columns = Math.floor((latest - state.lastSpectro) / intervalUs);
  if (!columns) return;
  if (columns > 60) {
    state.lastSpectro = latest - 60 * intervalUs;
    columns = 60;
  }
  const results = [];
  for (let i = 0; i < columns; i++) {
    const timestamp = state.lastSpectro + intervalUs;
    state.lastSpectro = timestamp;
    const spectrum = spectrumAt(state, timestamp);
    if (spectrum?.points?.length) results.push({ timestamp, spectrum });
  }
  if (results.length) postMessage({ type: 'spectrogram', id: state.id, columns: results });
}

function updateSpectrum(state) {
  const timestamp = state.times.at(-1);
  const spectrum = timestamp ? spectrumAt(state, timestamp, config.windowSeconds) : null;
  if (spectrum) postMessage({ type: 'spectrum', id: state.id, timestamp, spectrum });
}

function updateModulation(state) {
  const latest = state.times.at(-1);
  if (!(latest > 0)) return;
  const frameRate = Math.min(25, Math.max(2, state.rate / 4));
  const historySize = Math.max(16, Math.ceil(frameRate * config.windowSeconds));
  const key = `${historySize}/${config.fftPower}/${config.welchIndex}/${config.bands}/${config.spectrumMode}/${config.aggregationMs}`;
  if (!state.modulation || state.modulationKey !== key) {
    state.modulation = new ModulationAnalysis({ historySize });
    state.modulationKey = key;
    state.modulation.lastTimestampUs = Math.max(0, latest - config.windowSeconds * 1e6);
  }
  const intervalUs = 1e6 / frameRate;
  let frames = Math.floor((latest - state.modulation.lastTimestampUs) / intervalUs);
  if (frames > 60) {
    state.modulation.lastTimestampUs = latest - 60 * intervalUs;
    frames = 60;
  }
  for (let i = 0; i < frames; i++) {
    const timestamp = state.modulation.lastTimestampUs + intervalUs;
    const spectrum = spectrumAt(state, timestamp, config.windowSeconds);
    if (spectrum) state.modulation.ingest(spectrum, timestamp, frameRate, config.spectrumMode === 'relative' ? 'filtered' : 'raw');
    else state.modulation.lastTimestampUs = timestamp;
  }
  const metadata = state.modulation.metadata();
  if (metadata.maxFrequency > metadata.minFrequency) {
    postMessage({ type: 'modulation', id: state.id, timestamp: latest, metadata,
      display: state.modulation.display.map(row => Float32Array.from(row)),
      frequencyBins: state.modulation.frequencyBins, modulationBins: state.modulation.modulationBins });
  }
}

onmessage = event => {
  const message = event.data;
  if (message.type === 'config') {
    const changed = JSON.stringify(config) !== JSON.stringify(message.config);
    config = message.config;
    if (changed) for (const state of streams.values()) { state.modulation = null; state.modulationKey = ''; }
  } else if (message.type === 'samples') {
    const state = stateFor(message.id);
    if (message.reset) {
      state.times = [];
      state.values = [];
      state.lastSpectro = 0;
      state.modulation = null;
    }
    state.rate = message.rate || state.rate;
    for (let i = 0; i < message.times.length; i++) {
      const timestamp = message.times[i];
      if (!state.times.length || timestamp > state.times[state.times.length - 1]) {
        state.times.push(timestamp);
        state.values.push(message.values[i]);
      }
    }
    trim(state);
  } else if (message.type === 'remove') {
    streams.delete(message.id);
    order = [...streams.keys()];
  }
};

setInterval(() => {
  if (!order.length) return;
  const state = streams.get(order[cursor++ % order.length]);
  if (!state || state.values.length < 32) return;
  updateSpectrogram(state);
  if (config.view === 'spectrum') updateSpectrum(state);
  else if (config.view === 'modulation') updateModulation(state);
}, 25);
