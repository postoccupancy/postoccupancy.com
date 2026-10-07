'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type FrequencyScale = 'expanded' | 'log' | 'linear';
export type SpectrumMode = 'raw' | 'relative';
export type SpectralPalette = 'viridis' | 'plasma' | 'inferno' | 'magma' | 'cividis';
export interface SignalAnalysisSettings {
  fftPower: number;
  welchIndex: number;
  bands: boolean;
  smooth: boolean;
  centroid: boolean;
  frequencyScale: FrequencyScale;
  spectrumMode: SpectrumMode;
  palette: SpectralPalette;
}

interface SettingsContextValue {
  presentationDelay: number;
  setPresentationDelay: (delay: number) => void;
  signalAnalysis: SignalAnalysisSettings;
  updateSignalAnalysis: (change: Partial<SignalAnalysisSettings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [presentationDelay, setPresentationDelay] = useState(6);
  const [signalAnalysis, setSignalAnalysis] = useState<SignalAnalysisSettings>({
    fftPower: 11,
    welchIndex: 2,
    bands: true,
    smooth: true,
    centroid: false,
    frequencyScale: 'log',
    spectrumMode: 'raw',
    palette: 'viridis',
  });
  const value = useMemo(() => ({
    presentationDelay,
    setPresentationDelay,
    signalAnalysis,
    updateSignalAnalysis: (change: Partial<SignalAnalysisSettings>) => setSignalAnalysis((current) => ({ ...current, ...change })),
  }), [presentationDelay, signalAnalysis]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error('useSettings requires SettingsProvider');
  return settings;
}
