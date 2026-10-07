// Frozen Electric Sea spectral pipeline shared by the standalone visualizer and
// the Signals analysis worker. Keep the operation order aligned with the
// deployed reference: choose FFT size from source samples, aggregate, Welch,
// then band/background processing.
import { aggregateValues } from './controls';
import * as SpectralAnalysis from './spectral-analysis';

export function analyzeSpectrum(raw, rate, {
  fftPower = 11,
  welchSegments = 4,
  bands = true,
  spectrumMode = 'raw',
  aggregationMs = 0,
  amplitudeReference = 1,
  sourceSampleCount = raw.length,
} = {}) {
  if (!(rate > 0) || sourceSampleCount < 32) return null;
  const selected = 2 ** Number(fftPower);
  let n = 32;
  while (n * 2 <= selected && n * 2 <= sourceSampleCount) n *= 2;
  if (raw.length < n) return null;
  const values = aggregateValues(raw, rate, aggregationMs);
  const psd = SpectralAnalysis.welchPsd(values, rate, n, welchSegments);
  if (!psd) return null;
  const referencePsd = psd.fullScaleSinePsd * amplitudeReference * amplitudeReference;
  const rawPoints = bands ? SpectralAnalysis.logBandAverage(psd) : SpectralAnalysis.spectrumPoints(psd);
  const points = spectrumMode === 'relative' || spectrumMode === 'filtered'
    ? SpectralAnalysis.filterBackground(rawPoints)
    : rawPoints;
  return {
    ...psd,
    points,
    rawPoints,
    slope: SpectralAnalysis.estimateSpectralSlope(psd),
    rate,
    n,
    selected,
    amplitudeReference,
    referencePsd,
  };
}
