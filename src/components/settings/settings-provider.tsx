'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { defaultSpectralSettings, type SpectralFrequencyScale, type SpectralFftSize, type SpectralMode, type SpectralWelchSegments } from '@/lib/signals/spectral-settings';

interface SettingsContextValue {
  presentationDelay: number;
  setPresentationDelay: (delay: number) => void;
  spectralFftSize: SpectralFftSize;
  setSpectralFftSize: (size: SpectralFftSize) => void;
  spectralWelchSegments: SpectralWelchSegments;
  setSpectralWelchSegments: (segments: SpectralWelchSegments) => void;
  spectralBandAverage: boolean;
  setSpectralBandAverage: (enabled: boolean) => void;
  spectralMode: SpectralMode;
  setSpectralMode: (mode: SpectralMode) => void;
  spectralFrequencyScale: SpectralFrequencyScale;
  setSpectralFrequencyScale: (scale: SpectralFrequencyScale) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [presentationDelay, setPresentationDelay] = useState(6);
  const [spectralFftSize, setSpectralFftSize] = useState<SpectralFftSize>(defaultSpectralSettings.fftSize);
  const [spectralWelchSegments, setSpectralWelchSegments] = useState<SpectralWelchSegments>(defaultSpectralSettings.welchSegments);
  const [spectralBandAverage, setSpectralBandAverage] = useState(defaultSpectralSettings.bandAverage);
  const [spectralMode, setSpectralMode] = useState<SpectralMode>(defaultSpectralSettings.mode);
  const [spectralFrequencyScale, setSpectralFrequencyScale] = useState<SpectralFrequencyScale>(defaultSpectralSettings.frequencyScale);
  const value = useMemo(() => ({
    presentationDelay, setPresentationDelay,
    spectralFftSize, setSpectralFftSize,
    spectralWelchSegments, setSpectralWelchSegments,
    spectralBandAverage, setSpectralBandAverage,
    spectralMode, setSpectralMode,
    spectralFrequencyScale, setSpectralFrequencyScale,
  }), [presentationDelay, spectralFftSize, spectralWelchSegments, spectralBandAverage, spectralMode, spectralFrequencyScale]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error('useSettings requires SettingsProvider');
  return settings;
}
