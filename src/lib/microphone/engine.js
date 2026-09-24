// Adapted from signal-router/mic/index.html. Keep the original p5 views,
// frequency bands, log centroid, 0.25 smoothing, and 20 Hz JSON signal output.
import p5 from 'p5';

/**
 * @param {HTMLElement} root
 * @param {import('../signals/router-client').RouterClient} router
 * @param {(state: {running:boolean, pending:boolean, inputName:string, error:string}) => void} onState
 */
export function mountMicrophone(root, router, onState) {
  const container = root.querySelector('[data-mic=canvas]');
  const elements = Object.fromEntries([...root.querySelectorAll('[data-mic]')].map(el => [el.dataset.mic, el]));
  let view = 0,
    MY_IP = null,
    running = false,
    pending = false,
    disposed = false,
    generation = 0,
    inputName = '',
    error = '';
  let analyser = null,
    audioCtx = null,
    waveArray = null,
    specArray = null,
    stream = null,
    source = null,
    observer = null,
    spectroBuffer = null;
  const signals = {
    rms: 0,
    bass: 0,
    mid: 0,
    high: 0,
    centroid: 0
  };
  let peakHold = 0,
    lastAnalysis = 0;
  const notify = () => {
    if (!disposed) onState({
      running,
      pending,
      inputName,
      error
    });
  };
  function release() {
    generation++;
    running = false;
    pending = false;
    lastAnalysis = 0;
    const previous = stream;
    stream = null;
    for (const track of previous?.getTracks() || []) {
      track.onended = null;
      track.stop();
    }
    source?.disconnect();
    source = null;
    analyser?.disconnect();
    analyser = null;
    if (audioCtx) {
      const context = audioCtx;
      audioCtx = null;
      void context.close().catch(() => {});
    }
    for (const key of Object.keys(signals)) {
      signals[key] = 0;
      elements[key].textContent = '—';
    }
    peakHold = 0;
    elements.peak.textContent = '—';
    if (spectroBuffer) {
      spectroBuffer.remove();
      spectroBuffer = null;
    }
  }
  async function start() {
    if (disposed || running || pending) return;
    pending = true;
    error = '';
    notify();
    const token = ++generation;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires HTTPS or localhost in a supported browser.');
      // Start/resume the context from this explicit button gesture. No node is
      // connected to the audio destination, so this never plays the mic back.
      const context = new AudioContext();
      audioCtx = context;
      await context.resume();
      if (disposed || token !== generation) return;
      const media = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      if (disposed || token !== generation) {
        media.getTracks().forEach(track => track.stop());
        return;
      }
      stream = media;
      inputName = media.getAudioTracks()[0]?.label || 'Default microphone';
      source = context.createMediaStreamSource(media);
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = .8;
      source.connect(analyser);
      waveArray = new Float32Array(analyser.fftSize);
      specArray = new Uint8Array(analyser.frequencyBinCount);
      for (const track of media.getTracks()) track.onended = () => {
        release();
        error = 'Microphone disconnected. Enable it again to resume.';
        notify();
      };
      running = true;
      pending = false;
      notify();
    } catch (reason) {
      if (disposed || token !== generation) return;
      release();
      error = reason instanceof Error ? reason.message : 'Microphone could not start.';
      notify();
    }
  }
  function stop() {
    release();
    error = '';
    notify();
  }
  function setView(next) {
    view = next;
  }
  const unsubscribe = router.subscribeMessages(message => {
    if (!(message instanceof ArrayBuffer) && message.type === 'client_info' && typeof message.ip === 'string') MY_IP = message.ip;
  }, true);
  const unsubscribeStatus = router.subscribe(() => {
    if (router.status !== 'connected') MY_IP = null;
  });
  const timer = setInterval(() => {
    // Do not transmit frozen analyser values from a hidden/throttled tab.
    if (router.status !== 'connected' || !MY_IP || !running || document.visibilityState !== 'visible' || !lastAnalysis || performance.now() - lastAnalysis > 500) return;
    const base = `json/mic-${MY_IP}`;
    for (const [param, value] of Object.entries(signals)) router.send({
      type: 'json',
      device: `${base}/${param}`,
      source: MY_IP,
      value
    });
  }, 50);
  function bandEnergy(specData, minHz, maxHz) {
    if (!audioCtx) return 0;
    const nyquist = audioCtx.sampleRate / 2;
    const minI = Math.floor(minHz / nyquist * specData.length);
    const maxI = Math.ceil(maxHz / nyquist * specData.length);
    let sum = 0,
      count = 0;
    for (let i = minI; i <= maxI && i < specData.length; i++) {
      sum += specData[i];
      count++;
    }
    return count > 0 ? sum / count / 255 : 0;
  }
  function spectralCentroid(specData) {
    if (!audioCtx) return 0;
    const nyquist = audioCtx.sampleRate / 2;
    let weightedSum = 0,
      totalAmp = 0;
    for (let i = 1; i < specData.length; i++) {
      const freq = i / specData.length * nyquist;
      const amp = specData[i] / 255;
      weightedSum += freq * amp;
      totalAmp += amp;
    }
    if (totalAmp < 0.001) return 0; // silence — no centroid
    const centroidHz = weightedSum / totalAmp;
    // Normalize on log scale 20Hz–20kHz → 0–1
    return Math.max(0, Math.min(1, (Math.log10(Math.max(centroidHz, 20)) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))));
  }
  const sketch = new p5(p => {
    let spectroFrame = 0;
    p.setup = () => {
      const canvas = p.createCanvas(Math.max(1, container.clientWidth), Math.max(280, container.clientHeight));
      canvas.parent(container);
      canvas.elt.setAttribute('role', 'img');
      canvas.elt.setAttribute('aria-label', 'Local microphone visualization');
      p.colorMode(p.HSB, 360, 100, 100, 100);
      p.frameRate(30);
    };
    observer = new ResizeObserver(() => {
      if (disposed || !p.canvas) return;
      const width = Math.max(1, container.clientWidth),
        height = Math.max(280, container.clientHeight);
      if (p.width === width && p.height === height) return;
      p.resizeCanvas(width, height);
      if (spectroBuffer) {
        spectroBuffer.remove();
        spectroBuffer = null;
      }
    });
    observer.observe(container);
    function drawWaveform() {
      p.background(0);
      const cy = p.height / 2;
      const h = p.height * 0.45;
      p.noStroke();
      p.fill(140, 40, 30, 15);
      p.rect(0, cy - signals.rms * h * 3, p.width, signals.rms * h * 6);
      p.stroke(255, 0, 80, 12);
      p.strokeWeight(0.5);
      p.line(0, cy, p.width, cy);
      p.stroke(0, 0, 100, 25);
      p.strokeWeight(0.5);
      p.line(0, cy - peakHold * h * 3, p.width, cy - peakHold * h * 3);
      p.line(0, cy + peakHold * h * 3, p.width, cy + peakHold * h * 3);
      const hue = 140 - signals.rms * 300;
      p.stroke(Math.max(0, hue), 60, 90, 85);
      p.strokeWeight(1.2);
      p.noFill();
      p.beginShape();
      for (let i = 0; i < waveArray.length; i++) {
        p.vertex(p.map(i, 0, waveArray.length - 1, 0, p.width), cy + waveArray[i] * h);
      }
      p.endShape();
    }
    function drawSpectrum() {
      p.background(0);
      const bottom = p.height * 0.88;
      const h = bottom;
      const nyquist = audioCtx ? audioCtx.sampleRate / 2 : 24000;
      const logMin = Math.log10(20);
      const logMax = Math.log10(nyquist);
      [{
        min: 20,
        max: 200,
        hue: 210,
        label: 'BASS'
      }, {
        min: 200,
        max: 2000,
        hue: 140,
        label: 'MID'
      }, {
        min: 2000,
        max: nyquist,
        hue: 40,
        label: 'HIGH'
      }].forEach(({
        min,
        max,
        hue
      }) => {
        const x1 = p.map(Math.log10(min), logMin, logMax, 0, p.width);
        const x2 = p.map(Math.log10(Math.min(max, nyquist)), logMin, logMax, 0, p.width);
        p.noStroke();
        p.fill(hue, 40, 50, 8);
        p.rect(x1, 0, x2 - x1, bottom);
      });
      [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach(hz => {
        if (hz > nyquist) return;
        const x = p.map(Math.log10(hz), logMin, logMax, 0, p.width);
        p.stroke(255, 0, 50, 15);
        p.strokeWeight(0.5);
        p.line(x, 0, x, bottom);
        p.noStroke();
        p.fill(255, 0, 40, 25);
        p.textFont('Courier New');
        p.textSize(8);
        p.textAlign(p.CENTER);
        p.text(hz >= 1000 ? hz / 1000 + 'k' : hz, x, bottom + 12);
      });
      for (let i = 1; i < specArray.length; i++) {
        const freq = i / specArray.length * nyquist;
        if (freq < 20) continue;
        const x = p.map(Math.log10(freq), logMin, logMax, 0, p.width);
        const amp = specArray[i] / 255;
        const hue = p.map(Math.log10(freq), logMin, logMax, 210, 40);
        p.noStroke();
        p.fill(hue, 70, 85, 65);
        p.rect(x - 1, bottom - amp * h, 2, amp * h);
      }

      // Centroid marker
      const centroidX = p.map(signals.centroid, 0, 1, 0, p.width);
      p.stroke(40, 80, 90, 60);
      p.strokeWeight(1.5);
      p.line(centroidX, 0, centroidX, bottom);
      p.noStroke();
      p.fill(40, 80, 90, 70);
      p.textFont('Courier New');
      p.textSize(8);
      p.textAlign(p.CENTER);
      const centroidHz = Math.pow(10, signals.centroid * (Math.log10(20000) - Math.log10(20)) + Math.log10(20));
      p.text('▲ ' + Math.round(centroidHz) + 'Hz', centroidX, bottom + 24);
      p.textAlign(p.LEFT);
      p.textSize(9);
      [{
        label: 'RMS',
        val: signals.rms
      }, {
        label: 'BASS',
        val: signals.bass
      }, {
        label: 'MID',
        val: signals.mid
      }, {
        label: 'HIGH',
        val: signals.high
      }, {
        label: 'CENTROID',
        val: signals.centroid
      }].forEach(({
        label,
        val
      }, i) => {
        p.fill(255, 0, 45, 35);
        p.text(`${label}  ${val.toFixed(4)}`, 16, 28 + i * 14);
      });
    }
    function drawSpectrogram() {
      if (!spectroBuffer) {
        spectroBuffer = p.createGraphics(p.width, p.height);
        spectroBuffer.colorMode(p.HSB, 360, 100, 100, 100);
        spectroBuffer.background(0);
      }
      const nyquist = audioCtx ? audioCtx.sampleRate / 2 : 24000;
      const logMin = Math.log10(20);
      const logMax = Math.log10(Math.min(nyquist, 20000));
      const colW = 3;
      spectroBuffer.copy(spectroBuffer, colW, 0, p.width - colW, p.height, 0, 0, p.width - colW, p.height);

      // Clear the newly exposed column. Without this, old centroid dots at the
      // right edge are copied into every future frame as permanent lines.
      spectroBuffer.noStroke();
      spectroBuffer.fill(0, 0, 0, 100);
      spectroBuffer.rect(p.width - colW, 0, colW, p.height);
      for (let i = 1; i < specArray.length; i++) {
        const freq = i / specArray.length * nyquist;
        if (freq < 20 || freq > 20000) continue;
        const y = p.map(Math.log10(freq), logMin, logMax, p.height, 0);
        const amp = specArray[i] / 255;
        const hue = p.map(Math.log10(freq), logMin, logMax, 210, 40);
        spectroBuffer.noStroke();
        spectroBuffer.fill(hue, 80, amp * 100, 100);
        spectroBuffer.rect(p.width - colW, y, colW, 3);
      }

      // Spaced samples remain dots instead of overlapping into a solid band.
      if (spectroFrame++ % 3 === 0) {
        const centroidY = p.map(signals.centroid, 0, 1, p.height, 0);
        spectroBuffer.noStroke();
        spectroBuffer.fill(40, 80, 100, 100);
        spectroBuffer.ellipse(p.width - colW / 2, centroidY, 2, 2);
      }
      p.background(0);
      p.image(spectroBuffer, 0, 0);
      [50, 200, 500, 1000, 2000, 5000, 10000].forEach(hz => {
        const y = p.map(Math.log10(hz), logMin, logMax, p.height, 0);
        p.stroke(255, 0, 50, 15);
        p.strokeWeight(0.3);
        p.line(0, y, p.width, y);
        p.noStroke();
        p.fill(255, 0, 45, 30);
        p.textFont('Courier New');
        p.textSize(8);
        p.textAlign(p.RIGHT);
        p.text(hz >= 1000 ? hz / 1000 + 'k' : hz, p.width - 8, y + 3);
      });
    }
    p.draw = () => {
      if (!running || !analyser) {
        p.background(0);
        p.fill(255, 0, 40, 20);
        p.noStroke();
        p.textFont('Courier New');
        p.textSize(10);
        p.textAlign(p.CENTER);
        p.text('click enable microphone', p.width / 2, p.height / 2);
        return;
      }
      if (document.visibilityState !== 'visible') return;
      analyser.getFloatTimeDomainData(waveArray);
      analyser.getByteFrequencyData(specArray);

      // RMS
      let sum = 0;
      for (let i = 0; i < waveArray.length; i++) sum += waveArray[i] * waveArray[i];
      const rms = Math.sqrt(sum / waveArray.length);

      // Peak hold
      if (rms > peakHold) peakHold = rms;
      peakHold *= 0.997;

      // Smooth all signals
      const s = 0.25;
      signals.rms = signals.rms * (1 - s) + rms * s;
      signals.bass = signals.bass * (1 - s) + bandEnergy(specArray, 20, 200) * s;
      signals.mid = signals.mid * (1 - s) + bandEnergy(specArray, 200, 2000) * s;
      signals.high = signals.high * (1 - s) + bandEnergy(specArray, 2000, 20000) * s;
      signals.centroid = signals.centroid * (1 - s) + spectralCentroid(specArray) * s;
      lastAnalysis = performance.now();

      // HUD
      elements.rms.textContent = signals.rms.toFixed(4);
      elements.peak.textContent = peakHold.toFixed(4);
      elements.bass.textContent = signals.bass.toFixed(4);
      elements.mid.textContent = signals.mid.toFixed(4);
      elements.high.textContent = signals.high.toFixed(4);
      elements.centroid.textContent = signals.centroid.toFixed(4);
      switch (view) {
        case 0:
          drawWaveform();
          break;
        case 1:
          drawSpectrum();
          break;
        case 2:
          drawSpectrogram();
          break;
      }
    };
  });
  notify();
  return {
    start,
    stop,
    setView,
    dispose() {
      disposed = true;
      release();
      clearInterval(timer);
      unsubscribe();
      unsubscribeStatus();
      observer?.disconnect();
      sketch.remove();
    }
  };
}
