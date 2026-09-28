// Read-only p5 renderer for the presentation window. The controller owns all
// controls and sends state snapshots through its session BroadcastChannel.
import p5 from 'p5';

export function mountPresentation(root, stateRef) {
  let sketch;
  sketch = new p5((p) => {
    let lastTime = performance.now(), smoothA = 0, smoothB = 0, offsetA = 0, offsetB = 0, phaseA = 0, phaseB = 0, rotationA = 0, rotationB = 0;
    const motion = (layer, dt, state) => {
      const { values, layers } = state, layerState = layers[layer], rate = values.maxRate * (state.rateSource === 'none' ? 0.1 : 0), direction = layerState.rev ? -1 : 1;
      if (layerState.mode === 'still') return 0;
      if (layerState.mode === 'osc') { if (layer === 'A') phaseA += rate * dt * Math.PI * 2 * direction; else phaseB += rate * dt * Math.PI * 2 * direction; return Math.sin(layer === 'A' ? phaseA : phaseB) * values.oscDepth; }
      if (layer === 'A') { rotationA += rate * dt * Math.PI * direction; return rotationA; }
      rotationB += rate * dt * Math.PI * direction;
      return rotationB;
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
    p.setup = () => { p.createCanvas(root.clientWidth, root.clientHeight).parent(root); p.colorMode(p.HSB, 360, 100, 100, 100); p.frameRate(60); };
    p.draw = () => {
      const state = stateRef.current, now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1); lastTime = now;
      const { values, colors, layers } = state, aMotion = motion('A', dt, state), bMotion = motion('B', dt, state), smoothing = values.smoothing * 4;
      const targetA = values.manualA * Math.PI / 180 + aMotion, targetB = values.manualB * Math.PI / 180 + bMotion;
      smoothA = layers.A.mode === 'rot' ? targetA : smoothA + (targetA - smoothA) * smoothing;
      smoothB = layers.B.mode === 'rot' ? targetB : smoothB + (targetB - smoothB) * smoothing;
      const size = Math.min(p.width, p.height);
      offsetA += ((values.manualA / 90) * size * 0.3 + aMotion * size * 0.3 - offsetA) * smoothing;
      offsetB += ((values.manualB / 90) * size * 0.3 + bMotion * size * 0.3 - offsetB) * smoothing;
      p.background(colors.bg.h, colors.bg.s, colors.bg.b);
      if (state.mode === 0) { lines(smoothA, values.spacing, values.thick, colors.layerA, false); lines(smoothB, values.spacing, values.thick, colors.layerB, false); }
      else if (state.mode === 1) { lines(smoothA, values.spacing, values.thick, colors.layerA, true); lines(smoothB, values.spacing, values.thick, colors.layerB, true); }
      else { rings(offsetA, values.spacing, values.thick, colors.layerA); rings(offsetB, values.spacing, values.thick, colors.layerB); }
      if (values.blur > 0) p.filter(p.BLUR, values.blur);
    };
  });
  const resize = new ResizeObserver(() => sketch.resizeCanvas(root.clientWidth, root.clientHeight));
  resize.observe(root);
  return () => { resize.disconnect(); sketch.remove(); };
}
