export function frequencyPosition(frequency, firstFrequency, lastFrequency, mode) {
  const linear = (frequency - firstFrequency) / (lastFrequency - firstFrequency);
  if (mode === 'expanded') return Math.sqrt(Math.max(0, linear));
  if (mode === 'log') return Math.log(frequency / firstFrequency) / Math.log(lastFrequency / firstFrequency);
  return linear;
}
