export const VISUALIZER_WINDOWS_SECONDS = [.001, .002, .005, .01, .02, .043, .05, .1, .25, .5, 1, 2, 5, 10, 30, 60] as const;
export const VISUALIZER_AGGREGATION_MS = [0, 4, 10, 20, 50, 100, 250, 500, 1000] as const;

export function formatWindow(seconds: number) {
  return `${seconds} s`;
}

export function formatAggregation(ms: number) {
  return ms ? `${(1000 / ms).toFixed(1)} Hz` : 'native';
}

// The visualizer's existing rolling-average aggregation model. It smooths at
// the selected interval without replacing the original sample timestamps.
export function aggregateValues(values: ArrayLike<number>, rate: number, aggregationMs: number) {
  const count = Math.max(1, Math.round(rate * aggregationMs / 1000));
  if (count === 1) return Float64Array.from(values);
  const output = new Float64Array(values.length);
  let sum = 0;
  for (let index = 0; index < values.length; index++) {
    sum += values[index];
    if (index >= count) sum -= values[index - count];
    output[index] = sum / Math.min(count, index + 1);
  }
  return output;
}
