// Adapted from signal-router/moire/index.html. The drawing and MIDI mappings
// remain local to this page; router traffic uses the site's shared connection.
import p5 from 'p5';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** @param {HTMLElement} root @param {import('../signals/router-client').RouterClient} router @param {(status: string) => void} onStatus */
export function mountPatternParty(root, router, onStatus) {
  const canvas = root.querySelector('[data-pattern-party=canvas]');
  const params = { maxAngle: 45, maxRate: 0.2, smoothing: 0.05, oscDepth: 0.05, manualA: 0, manualB: 0, spacing: 12, thick: 5, blur: 0 };
  const colors = { bg: { h: 0, s: 0, b: 100, o: 100 }, layerA: { h: 0, s: 0, b: 0, o: 73 }, layerB: { h: 0, s: 0, b: 0, o: 55 } };
  const layers = { A: { mode: 'still', rev: false, phase: 0, rotation: 0 }, B: { mode: 'still', rev: false, phase: 0, rotation: 0 } };
  let mode = 0, angleSource = 'none', rateSource = 'none', angleValue = 0, rateValue = 0, clientIp = null, disposed = false, midi = null;
  const derived = { phase: 0, interference: 0, beating: 0, rate: 0, previousAngle: 0 };

  const signalKey = (data) => {
    if (data.type === 'json') return typeof data.device === 'string' ? data.device : null;
    if (data.type === 'osc') return typeof data.device === 'string' ? data.device : typeof data.name === 'string' && typeof data.param === 'string' ? `osc/${data.name}/${data.param}` : null;
    if (data.type !== 'midi' || typeof data.device !== 'string' || typeof data.channel !== 'number') return null;
    if (data.msgType === 'cc' && typeof data.cc === 'number') return `${data.device}/ch${data.channel}/cc${data.cc}`;
    if ((data.msgType === 'noteon' || data.msgType === 'noteoff') && typeof data.note === 'number') return `${data.device}/ch${data.channel}/n${data.note}`;
    return null;
  };
  const normalized = (data) => {
    const value = Number(data.rawValue ?? data.value);
    if (!Number.isFinite(value)) return null;
    if (data.type === 'midi') return clamp(value > 1 ? value / 127 : value, 0, 1);
    if (typeof data.min === 'number' && typeof data.max === 'number' && data.max > data.min) return clamp((value - data.min) / (data.max - data.min), 0, 1);
    return clamp(value, 0, 1);
  };
  const setParam = (key, value) => { if (key in params && Number.isFinite(value)) params[key] = value; };
  const setColor = (target, key, value) => { if (colors[target] && key in colors[target] && Number.isFinite(value)) colors[target][key] = value; };
  const route = (key, value) => {
    if (key === angleSource) angleValue += (value - angleValue) * params.smoothing;
    if (key === rateSource) rateValue += (value - rateValue) * params.smoothing;
  };
  const applyMidi = (channel, cc, value) => {
    const norm = clamp(value, 0, 1);
    if (channel === 1) {
      const changes = {
        1: () => setParam('thick', 0.5 + norm * 19.5), 2: () => setParam('spacing', 4 + norm * 36), 3: () => setParam('blur', norm * 10),
        4: () => setColor('layerA', 'h', norm * 360), 5: () => setColor('layerA', 'b', norm * 100), 6: () => setColor('layerA', 's', norm * 100), 7: () => setColor('layerA', 'o', norm * 100),
        8: () => setParam('manualA', (norm - 0.5) * 180), 9: () => setColor('layerB', 'h', norm * 360), 10: () => setColor('layerB', 'b', norm * 100),
        11: () => setColor('layerB', 's', norm * 100), 12: () => setColor('layerB', 'o', norm * 100), 13: () => setParam('manualB', (norm - 0.5) * 180),
        14: () => setColor('bg', 'h', norm * 360), 15: () => setColor('bg', 'b', norm * 100), 16: () => setColor('bg', 's', norm * 100)
      };
      changes[cc]?.();
    }
    if (channel === 2 || channel === 3) {
      const changes = { 1: () => setParam('maxAngle', norm * 90), 2: () => setParam('maxRate', 0.005 + norm * 0.995), 3: () => setParam('smoothing', 0.01 + norm * 0.49), 4: () => setParam('oscDepth', norm * Math.PI) };
      if (channel === 3) { changes[5] = () => setParam('manualA', (norm - 0.5) * 180); changes[6] = () => setParam('manualB', (norm - 0.5) * 180); }
      changes[cc]?.();
    }
  };
  const onMessage = (message) => {
    if (message instanceof ArrayBuffer || disposed) return;
    if (message.type === 'client_info' && typeof message.ip === 'string') clientIp = message.ip;
    const key = signalKey(message); const value = key ? normalized(message) : null;
    if (key && value !== null) route(key, value);
    if (message.type === 'midi' && message.msgType === 'cc' && typeof message.channel === 'number' && typeof message.cc === 'number' && value !== null && key !== angleSource && key !== rateSource) applyMidi(message.channel, message.cc, value);
  };
  const unsubscribe = router.subscribeMessages(onMessage, true);
  const publish = setInterval(() => {
    if (!clientIp || disposed) return;
    for (const [name, value] of Object.entries(derived)) if (name !== 'previousAngle') router.send({ type: 'json', device: `json/moire/${name}`, source: clientIp, value });
  }, 50);

  let sketch;
  sketch = new p5((p) => {
    let lastTime = performance.now(), smoothA = 0, smoothB = 0, offsetA = 0, offsetB = 0;
    const motion = (layer, dt) => {
      const state = layers[layer], rate = params.maxRate * (rateSource === 'none' ? 0.1 : rateValue), direction = state.rev ? -1 : 1;
      if (state.mode === 'still') return 0;
      if (state.mode === 'osc') { state.phase += rate * dt * Math.PI * 2 * direction; return Math.sin(state.phase) * params.oscDepth; }
      state.rotation += rate * dt * Math.PI * direction;
      return state.rotation;
    };
    const lines = (angle, spacing, thickness, color, grid) => {
      const diagonal = Math.hypot(p.width, p.height), count = Math.ceil(diagonal / spacing) + 2;
      p.noStroke(); p.fill(color.h, color.s, color.b, color.o); p.push(); p.translate(p.width / 2, p.height / 2); p.rotate(angle);
      for (let i = -count; i <= count; i++) { p.rect(i * spacing - thickness / 2, -diagonal, thickness, diagonal * 2); if (grid) p.rect(-diagonal, i * spacing - thickness / 2, diagonal * 2, thickness); }
      p.pop();
    };
    const rings = (offset, spacing, thickness, color) => {
      const diagonal = Math.hypot(p.width, p.height), count = Math.ceil(diagonal / spacing) + 1;
      p.noFill(); p.stroke(color.h, color.s, color.b, color.o); p.strokeWeight(thickness * 0.35);
      for (let i = 1; i <= count; i++) p.ellipse(p.width / 2 + offset, p.height / 2, i * spacing * 2, i * spacing * 2);
    };
    p.setup = () => { p.createCanvas(canvas.clientWidth, canvas.clientHeight).parent(canvas); p.colorMode(p.HSB, 360, 100, 100, 100); p.frameRate(60); };
    p.draw = () => {
      const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1); lastTime = now;
      const aMotion = motion('A', dt), bMotion = motion('B', dt), maxAngle = params.maxAngle * Math.PI / 180, signalAngle = angleSource === 'none' ? 0 : angleValue, smoothing = params.smoothing * 4;
      const targetA = params.manualA * Math.PI / 180 + signalAngle * maxAngle + aMotion, targetB = params.manualB * Math.PI / 180 - signalAngle * maxAngle + bMotion;
      smoothA = layers.A.mode === 'rot' ? targetA : smoothA + (targetA - smoothA) * smoothing;
      smoothB = layers.B.mode === 'rot' ? targetB : smoothB + (targetB - smoothB) * smoothing;
      const size = Math.min(p.width, p.height), maxOffset = size * params.maxAngle / 90 * 0.35;
      offsetA += ((params.manualA / 90) * size * 0.3 + signalAngle * maxOffset + aMotion * size * 0.3 - offsetA) * smoothing;
      offsetB += ((params.manualB / 90) * size * 0.3 - signalAngle * maxOffset + bMotion * size * 0.3 - offsetB) * smoothing;
      p.background(colors.bg.h, colors.bg.s, colors.bg.b);
      if (mode === 0) { lines(smoothA, params.spacing, params.thick, colors.layerA, false); lines(smoothB, params.spacing, params.thick, colors.layerB, false); }
      else if (mode === 1) { lines(smoothA, params.spacing, params.thick, colors.layerA, true); lines(smoothB, params.spacing, params.thick, colors.layerB, true); }
      else { rings(offsetA, params.spacing, params.thick, colors.layerA); rings(offsetB, params.spacing, params.thick, colors.layerB); }
      if (params.blur > 0) p.filter(p.BLUR, params.blur);
      derived.phase = (Math.sin(layers.A.phase) + 1) / 2; derived.interference = Math.abs(Math.cos((smoothA - smoothB) * 2)); derived.beating = (Math.sin(layers.A.phase) * Math.sin(layers.B.phase) + 1) / 2; derived.rate = Math.min(1, Math.abs(smoothA - derived.previousAngle) / Math.max(dt, 0.001) / 10); derived.previousAngle = smoothA;
    };
    p.windowResized = () => p.resizeCanvas(canvas.clientWidth, canvas.clientHeight);
  });
  const resize = new ResizeObserver(() => sketch.resizeCanvas(canvas.clientWidth, canvas.clientHeight)); resize.observe(canvas);
  return {
    setParam, setColor, setMode: (value) => { mode = value; }, setSource: (kind, value) => { if (kind === 'angle') angleSource = value; else rateSource = value; },
    setLayer: (layer, property, value) => { if (property === 'mode') { layers[layer].mode = value; layers[layer].phase = 0; layers[layer].rotation = 0; } else layers[layer].rev = value; },
    async enableMidi() {
      if (!navigator.requestMIDIAccess || midi) return;
      try { midi = await navigator.requestMIDIAccess(); const attach = () => midi.inputs.forEach((input) => { input.onmidimessage = (event) => { const [status, cc, amount] = event.data; if ((status & 0xf0) === 0xb0) applyMidi((status & 0x0f) + 1, cc, amount / 127); }; }); attach(); midi.onstatechange = attach; onStatus(`${midi.inputs.size} MIDI input${midi.inputs.size === 1 ? '' : 's'} connected`); } catch { onStatus('MIDI access was denied'); }
    },
    dispose() { disposed = true; clearInterval(publish); unsubscribe(); resize.disconnect(); if (midi) { midi.inputs.forEach((input) => { input.onmidimessage = null; }); midi.onstatechange = null; } sketch.remove(); }
  };
}
