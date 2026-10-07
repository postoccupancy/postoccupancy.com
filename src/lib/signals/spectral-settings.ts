export const spectralFftSizes = ['auto', 128, 256, 512, 1024, 2048, 4096, 8192, 16384] as const;
export type SpectralFftSize = typeof spectralFftSizes[number];
export const spectralWelchChoices = [1, 2, 4, 8, 16] as const;
export type SpectralWelchSegments = typeof spectralWelchChoices[number];
export type SpectralMode = 'relative' | 'raw';
export type SpectralFrequencyScale = 'log' | 'linear' | 'expanded';

export interface SpectralSettings {
  fftSize: SpectralFftSize;
  welchSegments: SpectralWelchSegments;
  bandAverage: boolean;
  mode: SpectralMode;
  frequencyScale: SpectralFrequencyScale;
}

export const defaultSpectralSettings: SpectralSettings = {
  fftSize: 'auto',
  welchSegments: 4,
  bandAverage: true,
  mode: 'relative',
  frequencyScale: 'log',
};
