/* Opt-in live diagnostic: node scripts/diagnose-spectrogram-continuity.cjs [seconds] */
const durationSeconds = Math.max(5, Math.min(300, Number(process.argv[2]) || 60));
const streams = new Map();
const unsignedDelta = (current, previous) => (current - previous) >>> 0;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function acceptSamples(name, param, incoming) {
  const id = `${name}/${param}`;
  let state = streams.get(id);
  if (!state) {
    state = { id, name, param, samples: [], rejected: 0 };
    streams.set(id, state);
  }
  for (const sample of incoming) {
    if (!Array.isArray(sample) || sample.length !== 3 || sample.some((value) => !Number.isFinite(value))) continue;
    const [seq, t, v] = sample;
    const previous = state.samples.at(-1);
    if (previous && (t < previous.t || seq <= previous.seq)) {
      state.rejected++;
      continue;
    }
    state.samples.push({ seq, t, v });
  }
}

function summarize(state) {
  const intervals = [];
  const blockMeans = [];
  let blockSum = 0;
  let blockCount = 0;
  for (let index = 1; index < state.samples.length; index++) {
    const previous = state.samples[index - 1];
    const current = state.samples[index];
    if (unsignedDelta(current.seq, previous.seq) !== 1) {
      blockSum = 0;
      blockCount = 0;
      continue;
    }
    const interval = current.t - previous.t;
    intervals.push(interval);
    blockSum += interval;
    blockCount++;
    if (blockCount === 64) {
      blockMeans.push(blockSum / blockCount);
      blockSum = 0;
      blockCount = 0;
    }
  }
  const expectedUs = blockMeans.length ? median(blockMeans) : intervals.length ? median(intervals) : 0;
  const toleranceUs = Math.max(30_000, expectedUs * 4);
  const breaks = [];
  const runLengths = [];
  let runLength = state.samples.length ? 1 : 0;
  let runStart = 0;
  let clockAnchor = 0;
  let clockLength = 1;
  let pendingBreak = null;
  const describeResultingRun = (event, start, end) => {
    if (!event || end < start) return;
    const count = end - start + 1;
    let fftLength = 1;
    while (fftLength * 2 <= count && fftLength * 2 <= 2048) fftLength *= 2;
    if (fftLength < 8) fftLength = 0;
    const first = state.samples[start];
    const last = state.samples[end];
    const effectiveSampleRate = count > 1 && last.t > first.t ? (count - 1) * 1e6 / (last.t - first.t) : 0;
    const welchSegments = fftLength
      ? Math.min(4, 1 + Math.floor((count - fftLength) / Math.max(1, fftLength / 2)))
      : 0;
    event.resultingRun = { length: count, fftLength, effectiveSampleRate, welchSegments };
  };
  for (let index = 1; index < state.samples.length; index++) {
    const previous = state.samples[index - 1];
    const current = state.samples[index];
    const sequenceDelta = unsignedDelta(current.seq, previous.seq);
    const elapsedUs = current.t - previous.t;
    const sequenceBreak = sequenceDelta !== 1;
    const expectedTimeUs = state.samples[clockAnchor].t + clockLength * expectedUs;
    const cumulativeDriftUs = current.t - expectedTimeUs;
    const timestampBreak = Math.abs(cumulativeDriftUs) > toleranceUs;
    if (sequenceBreak || timestampBreak) {
      runLengths.push(runLength);
      describeResultingRun(pendingBreak, runStart, index - 1);
      const event = {
        id: state.id,
        node: state.name,
        param: state.param,
        timeUs: current.t,
        previousSequence: previous.seq,
        currentSequence: current.seq,
        sequenceDelta,
        previousTimeUs: previous.t,
        currentTimeUs: current.t,
        elapsedUs,
        expectedTimeUs,
        cumulativeDriftUs,
        expectedUs,
        toleranceUs,
        reason: sequenceBreak && timestampBreak ? 'sequence+timestamp' : sequenceBreak ? 'sequence' : 'timestamp',
      };
      breaks.push(event);
      pendingBreak = event;
      runStart = index;
      clockAnchor = index;
      clockLength = 1;
      runLength = 1;
    } else {
      runLength++;
      clockLength++;
      if (clockLength * expectedUs >= 2_000_000) {
        clockAnchor = index;
        clockLength = 1;
      }
    }
  }
  if (runLength) runLengths.push(runLength);
  describeResultingRun(pendingBreak, runStart, state.samples.length - 1);
  const values = state.samples.map((sample) => sample.v);
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
  return {
    id: state.id,
    samples: state.samples.length,
    rejected: state.rejected,
    expectedUs,
    toleranceUs,
    breaks,
    breakCounts: breaks.reduce((counts, event) => {
      counts[event.reason] = (counts[event.reason] || 0) + 1;
      return counts;
    }, {}),
    missingSequences: breaks.reduce((total, event) => total + Math.max(0, event.sequenceDelta - 1), 0),
    runLengths,
    valueMean: mean,
    valueStddev: Math.sqrt(variance),
    valueMin: values.length ? Math.min(...values) : null,
    valueMax: values.length ? Math.max(...values) : null,
  };
}

const socket = new WebSocket('wss://rf.postoccupancy.com');
socket.addEventListener('message', (event) => {
  try {
    const message = JSON.parse(String(event.data));
    if (message.type !== 'sample_batch' || !Array.isArray(message.streams)) return;
    for (const stream of message.streams) {
      if (stream && typeof stream.name === 'string' && typeof stream.param === 'string' && Array.isArray(stream.samples)) {
        acceptSamples(stream.name, stream.param, stream.samples);
      }
    }
  } catch {}
});
socket.addEventListener('error', () => { console.error('WebSocket connection failed'); process.exitCode = 1; });
setTimeout(() => {
  socket.close();
  const summaries = [...streams.values()].map(summarize).sort((a, b) => a.id.localeCompare(b.id));
  const allBreaks = summaries.flatMap((summary) => summary.breaks);
  const clusters = [];
  for (const event of [...allBreaks].sort((a, b) => a.timeUs - b.timeUs)) {
    const cluster = clusters.at(-1);
    if (!cluster || event.timeUs - cluster.lastTimeUs > 100_000 || event.node !== cluster.node) {
      clusters.push({ node: event.node, firstTimeUs: event.timeUs, lastTimeUs: event.timeUs, events: [event] });
    } else {
      cluster.lastTimeUs = event.timeUs;
      cluster.events.push(event);
    }
  }
  console.log(JSON.stringify({
    durationSeconds,
    streams: summaries.map((summary) => ({
      id: summary.id,
      samples: summary.samples,
      rejected: summary.rejected,
      expectedUs: summary.expectedUs,
      toleranceUs: summary.toleranceUs,
      breakCount: summary.breaks.length,
      breakCounts: summary.breakCounts,
      missingSequences: summary.missingSequences,
      examples: summary.breaks.slice(0, 5),
      runLengths: {
        minimum: summary.runLengths.length ? Math.min(...summary.runLengths) : 0,
        median: summary.runLengths.length ? median(summary.runLengths) : 0,
        maximum: summary.runLengths.length ? Math.max(...summary.runLengths) : 0,
      },
      valueMean: summary.valueMean,
      valueStddev: summary.valueStddev,
      valueMin: summary.valueMin,
      valueMax: summary.valueMax,
    })),
    correlatedBreakClusters: clusters.filter((cluster) => cluster.events.length > 1).slice(0, 20).map((cluster) => ({
      node: cluster.node,
      firstTimeUs: cluster.firstTimeUs,
      lastTimeUs: cluster.lastTimeUs,
      eventCount: cluster.events.length,
      channels: [...new Set(cluster.events.map((event) => event.param))],
      reasonCounts: cluster.events.reduce((counts, event) => {
        counts[event.reason] = (counts[event.reason] || 0) + 1;
        return counts;
      }, {}),
    })),
  }, null, 2));
}, durationSeconds * 1000);
