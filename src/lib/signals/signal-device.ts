import type { RouterInfo } from './router-client';

// Use the router table's per-controller/note identity for MIDI device links.
export function signalDevice(message: RouterInfo): string | null {
  if (typeof message.device !== 'string') return null;
  if (message.type !== 'midi') return message.device;
  if (message.msgType === 'cc') return `${message.device}/ch${message.channel}/cc${message.cc}`;
  if (message.msgType === 'noteon' || message.msgType === 'noteoff') return `${message.device}/ch${message.channel}/n${message.note}`;
  if (message.msgType === 'pitchbend') return `${message.device}/ch${message.channel}/pb`;
  return message.device;
}

export function signalValue(message: RouterInfo): number | null {
  const value = message.type === 'midi' && message.msgType === 'noteoff' ? 0
    : message.type === 'midi' && message.msgType === 'noteon' ? message.velocity : message.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
