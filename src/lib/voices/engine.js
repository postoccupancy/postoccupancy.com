// Adapted from signal-router/router/resident-live.js (embedded page) and
// resident-live-controls.js. Analysis stays on the Pi; this is the output UI.
/**
 * @param {HTMLElement} root
 * @param {import('../signals/router-client').RouterClient} router
 */
export function mountVoices(root, router) {
  let disposed = false,
    animationFrame = 0,
    midiGeneration = 0,
    lastResidentAt = performance.now();
  const get = id => root.querySelector(`[data-voices="${id}"]`) || root.querySelector(`[id="${id}"]`);
  const messages = new Map(),
    groups = new Map(),
    streamSettingsMap = new Map(),
    beatStates = new Map();
  const status = get('status'),
    groupsRoot = get('groups');
  let audioContext = null,
    limiter = null,
    midiAccess = null,
    midiOutput = null,
    midiEnabled = false,
    lastBeatTick = performance.now();
  const synthVoices = new Map(),
    midiVoices = new Map();
  const MIDI_HYSTERESIS = .6,
    LEGATO_OVERLAP_MS = 35,
    BEAT_CC_INTERVAL_MS = 25;
  const midiEnable = get('midi-enable'),
    midiOutputSelect = get('midi-output'),
    midiTransition = get('midi-transition'),
    midiPanic = get('midi-panic'),
    midiStatus = get('midi-status');
  const globalBeat = {
    enabled: false,
    channel: 15,
    cc: 1,
    value: null,
    lastSent: null
  };
  const globalBeatEnabled = get('global-beat-enabled'),
    globalBeatChannel = get('global-beat-channel'),
    globalBeatCc = get('global-beat-cc'),
    globalBeatValue = get('global-beat-value'),
    globalBeatCount = get('global-beat-count');
  function number(v, d = 3) {
    return Number.isFinite(v) ? v.toFixed(d) : '—';
  }
  function deviceName(streamId) {
    const p = String(streamId || '').split('/').filter(Boolean);
    return p.find(x => x === 'indoor-sky' || x === 'electric-sky') || p[1] || p[0] || 'other';
  }
  function streamLabel(streamId) {
    const p = String(streamId || '').split('/').filter(Boolean);
    return p[p.length - 1] || streamId;
  }
  function voiceKey(streamId, id) {
    return streamId + '::' + id;
  }
  function midiNoteName(note) {
    const n = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
      r = Math.round(note);
    return n[(r % 12 + 12) % 12] + (Math.floor(r / 12) - 1);
  }
  function channelOptions(selected) {
    let h = '';
    for (let i = 0; i < 16; i++) h += '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + (i + 1) + '</option>';
    return h;
  }
  function ccOptions(selected) {
    let h = '';
    for (let i = 0; i < 128; i++) h += '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + i + '</option>';
    return h;
  }
  function firstUnusedChannel() {
    const used = new Set([...streamSettingsMap.values()].map(s => s.noteChannel));
    for (let i = 0; i < 16; i++) if (!used.has(i)) return i;
    return 0;
  }
  function streamSettings(id) {
    let s = streamSettingsMap.get(id);
    if (!s) {
      const ch = firstUnusedChannel();
      s = {
        noteEnabled: true,
        noteChannel: ch,
        beatEnabled: false,
        beatChannel: ch,
        beatCc: 20 + streamSettingsMap.size % 80,
        beatValue: null,
        lastBeatSent: null
      };
      streamSettingsMap.set(id, s);
    }
    return s;
  }
  function midiVelocity(c) {
    return Math.max(20, Math.min(127, Math.round(20 + Math.max(0, Math.min(1, Number(c) || 0)) * 107)));
  }
  function ensureAudio() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 12;
    limiter.ratio.value = 8;
    limiter.attack.value = .003;
    limiter.release.value = .25;
    limiter.connect(audioContext.destination);
  }
  function mappedMidiValues(hz, g) {
    const lo = .05,
      hi = 1,
      c = Math.max(lo, Math.min(hi, hz)),
      pos = Math.log2(c / lo) / Math.log2(hi / lo),
      low = (Number(g.baseOctave.value) + 1) * 12,
      continuousMidi = Math.max(0, Math.min(127, low + pos * (Number(g.span.value) * 12)));
    return {
      continuousMidi,
      quantizedMidi: Math.round(continuousMidi)
    };
  }
  function mappedAudioFrequency(hz, g) {
    const m = mappedMidiValues(hz, g),
      out = g.pitchMode.value === 'midi' ? m.quantizedMidi : m.continuousMidi;
    return 440 * Math.pow(2, (out - 69) / 12);
  }
  function activeVoicesForDevice(name) {
    const r = [];
    for (const [id, m] of messages) {
      if (deviceName(id) !== name) continue;
      for (const v of m.voices || []) if (v.active) r.push({
        streamId: id,
        ...v
      });
    }
    return r;
  }
  function activeVoicesForStream(id) {
    const m = messages.get(id);
    return (m?.ready && m.voices || []).filter(v => v.active).map(v => ({
      streamId: id,
      ...v
    }));
  }
  function allActiveVoices() {
    const r = [];
    for (const g of groups.values()) r.push(...activeVoicesForDevice(g.name));
    return r;
  }
  function createSynthVoice(key, g, f) {
    const o = audioContext.createOscillator(),
      gain = audioContext.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    gain.gain.value = 0;
    o.connect(gain).connect(g.bus);
    o.start();
    const s = {
      oscillator: o,
      gain,
      groupName: g.name
    };
    synthVoices.set(key, s);
    return s;
  }
  function syncAudio() {
    if (!audioContext || !limiter || disposed) return;
    const now = audioContext.currentTime,
      active = new Set();
    for (const g of groups.values()) {
      if (!g.bus) {
        g.bus = audioContext.createGain();
        g.bus.gain.value = 0;
        g.bus.connect(limiter);
      }
      const voices = activeVoicesForDevice(g.name),
        norm = voices.length ? 1 / Math.pow(voices.length, .35) : 1;
      for (const v of voices) {
        if (!g.enabled || active.size >= 128) continue;
        const key = voiceKey(v.streamId, v.id),
          f = mappedAudioFrequency(v.frequencyHz, g);
        active.add(key);
        let s = synthVoices.get(key);
        if (!s) s = createSynthVoice(key, g, f);
        if (s.releaseTimer) {
          clearTimeout(s.releaseTimer);
          s.releaseTimer = null;
        }
        s.oscillator.frequency.setTargetAtTime(f, now, .18);
        s.gain.gain.setTargetAtTime(Math.max(.015, Math.min(.22, .18 * v.confidence)) * norm, now, .35);
      }
      g.bus.gain.setTargetAtTime(g.enabled ? Number(g.volume.value) : 0, now, .12);
      g.audioStatus.textContent = g.enabled ? voices.length + ' active voices' : 'audio off';
    }
    for (const [key, s] of synthVoices) {
      if (active.has(key) || s.releaseTimer) continue;
      s.gain.gain.setTargetAtTime(0, now, .25);
      s.releaseTimer = setTimeout(() => {
        stopSynth(s);
        if (synthVoices.get(key) === s) synthVoices.delete(key);
      }, 1200);
    }
  }
  function stopSynth(s) {
    clearTimeout(s.releaseTimer);
    try {
      s.oscillator.stop();
    } catch {}
    s.oscillator.disconnect();
    s.gain.disconnect();
  }
  function midiSend(bytes, delay = 0) {
    if (!midiOutput || disposed) return;
    if (!bytes.every(v => Number.isInteger(v) && v >= 0 && v <= 255) || bytes[1] > 127 || bytes[2] > 127) return;
    try {
      midiOutput.send(bytes, delay ? performance.now() + delay : undefined);
    } catch {
      updateMidiStatus('MIDI output disconnected');
    }
  }
  function sendNoteOn(ch, n, v) {
    midiSend([0x90 | ch, n, v]);
  }
  function sendNoteOff(ch, n, delay = 0) {
    midiSend([0x80 | ch, n, 0], delay);
  }
  function sendCc(ch, cc, v) {
    const mapping = ensureRow(ch, cc);
    midiSend([0xB0 | ch, cc, clamp(Math.round(mapping.center + (v - 64) * mapping.amount), 0, 127)]);
  }
  function panicMidi() {
    if (midiOutput) {
      try {
        midiOutput.clear?.();
      } catch {}
      for (const s of midiVoices.values()) sendNoteOff(s.channel, s.note);
      for (let ch = 0; ch < 16; ch++) midiSend([0xB0 | ch, 123, 0]);
    }
    midiVoices.clear();
    updateMidiStatus();
  }
  function hystereticNote(x, current) {
    if (!Number.isFinite(current)) return Math.round(x);
    if (x > current + MIDI_HYSTERESIS || x < current - MIDI_HYSTERESIS) return Math.round(x);
    return current;
  }
  function transitionNote(old, ch, n, v) {
    if (midiTransition.value === 'legato' && old.channel === ch) {
      sendNoteOn(ch, n, v);
      sendNoteOff(old.channel, old.note, LEGATO_OVERLAP_MS);
    } else {
      sendNoteOff(old.channel, old.note);
      sendNoteOn(ch, n, v);
    }
  }
  function syncMidi(force = false) {
    if (!midiEnabled || !midiOutput) return;
    const active = new Set();
    for (const g of groups.values()) for (const v of activeVoicesForDevice(g.name)) {
      const s = streamSettings(v.streamId);
      if (!s.noteEnabled) continue;
      const key = voiceKey(v.streamId, v.id),
        m = mappedMidiValues(v.frequencyHz, g),
        old = midiVoices.get(key),
        note = force ? m.quantizedMidi : hystereticNote(m.continuousMidi, old && old.note),
        vel = midiVelocity(v.confidence);
      active.add(key);
      if (!old) {
        sendNoteOn(s.noteChannel, note, vel);
        midiVoices.set(key, {
          channel: s.noteChannel,
          note,
          velocity: vel
        });
      } else if (old.note !== note || old.channel !== s.noteChannel) {
        transitionNote(old, s.noteChannel, note, vel);
        midiVoices.set(key, {
          channel: s.noteChannel,
          note,
          velocity: vel
        });
      }
    }
    for (const [key, s] of midiVoices) if (!active.has(key)) {
      sendNoteOff(s.channel, s.note);
      midiVoices.delete(key);
    }
    updateMidiStatus();
  }
  function beatState(key) {
    let s = beatStates.get(key);
    if (!s) {
      s = {
        phases: new Map(),
        smoothed: 0,
        lastTime: performance.now()
      };
      beatStates.set(key, s);
    }
    return s;
  }
  function beatValueFor(key, voices, now) {
    voices = voices.slice(0, 128);
    const state = beatState(key),
      dt = Math.min(.1, Math.max(0, (now - state.lastTime) / 1000));
    state.lastTime = now;
    const pairs = new Set();
    let sum = 0,
      wSum = 0;
    for (let i = 0; i < voices.length; i++) for (let j = i + 1; j < voices.length; j++) {
      const a = voices[i],
        b = voices[j],
        pair = [voiceKey(a.streamId, a.id), voiceKey(b.streamId, b.id)].sort().join('|'),
        gA = groups.get(deviceName(a.streamId)),
        gB = groups.get(deviceName(b.streamId));
      if (!gA || !gB) continue;
      const fA = mappedAudioFrequency(a.frequencyHz, gA),
        fB = mappedAudioFrequency(b.frequencyHz, gB),
        df = Math.abs(fA - fB),
        w = Math.max(.01, (Number(a.confidence) || 0) * (Number(b.confidence) || 0));
      let phase = state.phases.get(pair) || 0;
      phase = (phase + 2 * Math.PI * df * dt) % (2 * Math.PI);
      state.phases.set(pair, phase);
      pairs.add(pair);
      sum += w * Math.cos(phase);
      wSum += w;
    }
    for (const pair of state.phases.keys()) if (!pairs.has(pair)) state.phases.delete(pair);
    const raw = wSum ? sum / wSum : 0;
    state.smoothed += .12 * (raw - state.smoothed);
    return Math.max(0, Math.min(127, Math.round((state.smoothed + 1) * 63.5)));
  }
  function maybeSendBeat(config, value) {
    if (!(config.enabled ?? config.beatEnabled) || !midiEnabled || !midiOutput) return;
    if (config.lastBeatSent === value) return;
    sendCc(config.channel ?? config.beatChannel, config.cc ?? config.beatCc, value);
    config.lastBeatSent = value;
  }
  function beatTick(now) {
    if (disposed) return;
    if (now - lastBeatTick >= BEAT_CC_INTERVAL_MS) {
      lastBeatTick = now;
      for (const [id, s] of streamSettingsMap) {
        const voices = activeVoicesForStream(id),
          value = beatValueFor('stream:' + id, voices, now);
        s.beatValue = value;
        maybeSendBeat(s, value);
        const row = groups.get(deviceName(id))?.rows.get(id);
        if (row) row.querySelector('.stream-beat-value').textContent = value;
      }
      for (const g of groups.values()) {
        const voices = activeVoicesForDevice(g.name),
          value = beatValueFor('device:' + g.name, voices, now);
        g.deviceBeat.value = value;
        maybeSendBeat(g.deviceBeat, value);
        g.deviceBeatValue.textContent = value;
        g.deviceBeatCount.textContent = voices.length + ' voice' + (voices.length === 1 ? '' : 's');
      }
      const all = allActiveVoices(),
        value = beatValueFor('global', all, now);
      globalBeat.value = value;
      maybeSendBeat(globalBeat, value);
      globalBeatValue.textContent = value;
      globalBeatCount.textContent = all.length + ' voice' + (all.length === 1 ? '' : 's');
    }
    animationFrame = requestAnimationFrame(beatTick);
  }
  function setDeviceNotes(g, on) {
    for (const id of g.rows.keys()) streamSettings(id).noteEnabled = on;
    syncMidi();
    renderAll();
  }
  function setDeviceSensorBeats(g, on) {
    for (const id of g.rows.keys()) streamSettings(id).beatEnabled = on;
    renderAll();
  }
  function createGroup(name) {
    const section = document.createElement('section');
    section.className = 'device-group';
    section.innerHTML = '<div class="device-heading"><div><div class="device-title"><h2></h2><span class="device-id"></span></div><div class="bulk-controls"><span class="bulk-label">notes</span><button class="notes-off" type="button">all off</button><button class="notes-on" type="button">all on</button><span class="bulk-label">sensor beat CC</span><button class="beats-off" type="button">all off</button><button class="beats-on" type="button">all on</button></div></div><div class="controls"><button class="audio-toggle" type="button">start audio</button><label>pitch mode <select class="pitch-mode"><option value="continuous" selected>continuous</option><option value="midi">MIDI notes</option></select></label><label>base octave <select class="base-octave"><option>1</option><option>2</option><option selected>3</option><option>4</option><option>5</option></select></label><label>pitch span <input class="span" type="range" min="1" max="6" step="1" value="3"><span class="span-value">3</span> oct</label><label>volume <input class="volume" type="range" min="0" max="2.5" step=".01" value=".8"><span class="volume-value">0.80</span></label><span class="audio-status">audio off</span></div></div><div class="beat-strip"><div class="beat-controls"><span class="global-title">device beat</span><label><input class="device-beat-enabled" type="checkbox">send</label><label>ch <select class="device-beat-channel"></select></label><label>CC <select class="device-beat-cc"></select></label><span>value <span class="beat-value device-beat-value">—</span></span><span class="muted device-beat-count">0 voices</span></div></div><div class="table-scroll" tabindex="0"><table><thead><tr><th style="width:15%">SENSOR</th><th style="width:9%">NOTES</th><th style="width:7%">CH</th><th style="width:9%">BEAT CC</th><th style="width:7%">CH</th><th style="width:7%">CC</th><th style="width:9%">STATUS</th><th style="width:7%">COV</th><th>VOICES</th></tr></thead><tbody></tbody></table></div>';
    const q = x => section.querySelector(x),
      heading = q('h2'),
      deviceId = q('.device-id'),
      button = q('.audio-toggle'),
      pitchMode = q('.pitch-mode'),
      baseOctave = q('.base-octave'),
      span = q('.span'),
      spanValue = q('.span-value'),
      volume = q('.volume'),
      volumeValue = q('.volume-value'),
      audioStatus = q('.audio-status'),
      body = q('tbody'),
      deviceBeatEnabled = q('.device-beat-enabled'),
      deviceBeatChannel = q('.device-beat-channel'),
      deviceBeatCc = q('.device-beat-cc'),
      deviceBeatValue = q('.device-beat-value'),
      deviceBeatCount = q('.device-beat-count');
    section.setAttribute('aria-label', name + ' voices');
    button.setAttribute('aria-label', name + ' audio');
    heading.textContent = name;
    deviceId.textContent = 'device: ' + name;
    const deviceBeat = {
      enabled: false,
      channel: name === 'indoor-sky' ? 14 : 13,
      cc: name === 'indoor-sky' ? 10 : 11,
      value: null,
      lastBeatSent: null
    };
    deviceBeatChannel.innerHTML = channelOptions(deviceBeat.channel);
    deviceBeatCc.innerHTML = ccOptions(deviceBeat.cc);
    const g = {
      name,
      section,
      body,
      rows: new Map(),
      enabled: false,
      bus: null,
      button,
      pitchMode,
      baseOctave,
      span,
      spanValue,
      volume,
      volumeValue,
      audioStatus,
      deviceBeat,
      deviceBeatValue,
      deviceBeatCount
    };
    groups.set(name, g);
    groupsRoot.appendChild(section);
    button.addEventListener('click', async () => {
      try {
        ensureAudio();
        if (audioContext.state === 'suspended') await audioContext.resume();
        if (disposed) return;
        if (!g.bus) {
          g.bus = audioContext.createGain();
          g.bus.gain.value = 0;
          g.bus.connect(limiter);
        }
        g.enabled = !g.enabled;
        button.textContent = g.enabled ? 'stop audio' : 'start audio';
        button.classList.toggle('playing', g.enabled);
        button.setAttribute('aria-pressed', String(g.enabled));
        syncAudio();
      } catch {
        g.audioStatus.textContent = 'Audio could not start';
      }
    });
    pitchMode.addEventListener('change', () => {
      renderAll();
      syncAudio();
      syncMidi();
    });
    baseOctave.addEventListener('change', () => {
      renderAll();
      syncAudio();
      syncMidi(true);
    });
    span.addEventListener('input', () => {
      spanValue.textContent = span.value;
      renderAll();
      syncAudio();
      syncMidi(true);
    });
    volume.addEventListener('input', () => {
      volumeValue.textContent = Number(volume.value).toFixed(2);
      syncAudio();
    });
    q('.notes-off').onclick = () => setDeviceNotes(g, false);
    q('.notes-on').onclick = () => setDeviceNotes(g, true);
    q('.beats-off').onclick = () => setDeviceSensorBeats(g, false);
    q('.beats-on').onclick = () => setDeviceSensorBeats(g, true);
    deviceBeatEnabled.onchange = () => deviceBeat.enabled = deviceBeatEnabled.checked;
    deviceBeatChannel.onchange = () => deviceBeat.channel = Number(deviceBeatChannel.value);
    deviceBeatCc.onchange = () => deviceBeat.cc = Number(deviceBeatCc.value);
    return g;
  }
  function renderVoice(v, g) {
    const m = mappedMidiValues(v.frequencyHz, g),
      state = midiVoices.get(voiceKey(v.streamId, v.id)),
      live = state ? ' · OUT ch ' + (state.channel + 1) + ' ' + state.note : '';
    return '<span class="voice ' + (v.active ? '' : 'inactive') + '">#' + v.id + ' ' + number(v.frequencyHz, 4) + ' Hz · ' + number(v.periodSeconds, 2) + ' s · MIDI ' + number(m.continuousMidi, 2) + ' → ' + m.quantizedMidi + ' (' + midiNoteName(m.quantizedMidi) + ')' + live + ' · conf ' + number(v.confidence, 2) + '</span>';
  }
  function render(message) {
    messages.set(message.device, message);
    const name = deviceName(message.device),
      g = groups.get(name) || createGroup(name),
      s = streamSettings(message.device);
    let row = g.rows.get(message.device);
    if (!row) {
      row = document.createElement('tr');
      row.innerHTML = '<td class="device"></td><td><label class="stream-controls"><input class="note-enabled" type="checkbox">send</label></td><td><select class="note-channel"></select></td><td><label class="stream-controls"><input class="beat-enabled" type="checkbox">send</label></td><td><select class="beat-channel"></select></td><td><select class="beat-cc"></select><div class="muted">value <span class="stream-beat-value">—</span></div></td><td></td><td></td><td class="voices-cell"><div class="voices-scroll"></div></td>';
      g.body.appendChild(row);
      g.rows.set(message.device, row);
      const ne = row.querySelector('.note-enabled'),
        nc = row.querySelector('.note-channel'),
        be = row.querySelector('.beat-enabled'),
        bc = row.querySelector('.beat-channel'),
        cc = row.querySelector('.beat-cc');
      nc.innerHTML = channelOptions(s.noteChannel);
      bc.innerHTML = channelOptions(s.beatChannel);
      cc.innerHTML = ccOptions(s.beatCc);
      ne.onchange = () => {
        s.noteEnabled = ne.checked;
        syncMidi();
        renderAll();
      };
      nc.onchange = () => {
        s.noteChannel = Number(nc.value);
        syncMidi(true);
        renderAll();
      };
      be.onchange = () => s.beatEnabled = be.checked;
      bc.onchange = () => s.beatChannel = Number(bc.value);
      cc.onchange = () => s.beatCc = Number(cc.value);
    }
    for (const [selector, label] of [['.note-enabled', 'notes'], ['.note-channel', 'note channel'], ['.beat-enabled', 'beat'], ['.beat-channel', 'beat channel'], ['.beat-cc', 'beat CC']]) row.querySelector(selector).setAttribute('aria-label', message.device + ' ' + label);
    const c = row.children;
    c[0].textContent = streamLabel(message.device);
    c[0].title = message.device;
    row.querySelector('.note-enabled').checked = s.noteEnabled;
    row.querySelector('.beat-enabled').checked = s.beatEnabled;
    c[6].textContent = message.ready ? 'ready' : message.reason || 'waiting';
    c[6].className = message.ready ? '' : 'waiting';
    c[7].textContent = number(message.coverage, 2);
    const all = [...(message.voices || [])].sort((a, b) => a.id - b.id),
      active = all.filter(v => v.active),
      shown = active.length ? active : all.slice(0, 3);
    row.querySelector('.voices-scroll').innerHTML = shown.length ? shown.map(v => renderVoice({
      ...v,
      streamId: message.device
    }, g)).join('') : '<span class="waiting">none</span>';
    syncAudio();
    syncMidi();
  }
  function renderAll() {
    for (const m of messages.values()) render(m);
  }
  function updateMidiStatus(text) {
    if (text) {
      midiStatus.textContent = text;
      return;
    }
    midiStatus.textContent = midiEnabled && midiOutput ? 'MIDI on · ' + midiVoices.size + ' active note' + (midiVoices.size === 1 ? '' : 's') : midiAccess ? 'MIDI off' : 'MIDI unavailable until enabled';
  }
  function populateMidiOutputs() {
    const previous = midiOutput?.id;
    midiOutputSelect.replaceChildren(new Option('none', ''));
    for (const output of midiAccess?.outputs.values() || []) {
      if (output.state !== 'disconnected') midiOutputSelect.appendChild(new Option(output.name || output.id, output.id));
    }
    if (previous && midiAccess.outputs.get(previous)?.state !== 'disconnected' && midiAccess.outputs.has(previous)) midiOutputSelect.value = previous;else if (midiOutput) {
      panicMidi();
      void midiOutput.close().catch(() => {});
      midiOutput = null;
      midiEnabled = false;
    }
    midiOutputSelect.disabled = !midiAccess;
    midiPanic.disabled = !midiOutput;
    midiEnable.textContent = midiEnabled ? 'disable MIDI' : 'enable MIDI';
    updateMidiStatus();
  }
  async function selectOutput() {
    const token = ++midiGeneration;
    panicMidi();
    const old = midiOutput;
    midiOutput = null;
    if (old) void old.close().catch(() => {});
    const output = midiAccess?.outputs.get(midiOutputSelect.value);
    midiEnabled = false;
    if (output) try {
      await output.open();
      if (disposed || token !== midiGeneration) {
        void output.close().catch(() => {});
        return;
      }
      midiOutput = output;
      midiEnabled = true;
      syncMidi();
    } catch {
      updateMidiStatus('Could not open MIDI output');
    }
    if (!disposed) {
      midiPanic.disabled = !midiOutput;
      midiEnable.textContent = midiEnabled ? 'disable MIDI' : 'enable MIDI';
      midiEnable.classList.toggle('enabled', midiEnabled);
      updateMidiStatus();
    }
  }
  async function enableMidi() {
    if (!navigator.requestMIDIAccess) {
      updateMidiStatus('Web MIDI is not supported in this browser');
      return;
    }
    midiEnable.disabled = true;
    const token = ++midiGeneration;
    try {
      const access = await navigator.requestMIDIAccess();
      if (disposed || token !== midiGeneration) return;
      midiAccess = access;
      access.onstatechange = populateMidiOutputs;
      populateMidiOutputs();
      updateMidiStatus('Select a MIDI output');
    } catch {
      if (!disposed) updateMidiStatus('MIDI permission denied');
    } finally {
      if (!disposed) updateOutputAvailability();
    }
  }
  midiEnable.onclick = async () => {
    if (!midiAccess) {
      await enableMidi();
      return;
    }
    if (midiEnabled) {
      panicMidi();
      midiEnabled = false;
    } else midiEnabled = Boolean(midiOutput);
    midiEnable.textContent = midiEnabled ? 'disable MIDI' : 'enable MIDI';
    midiEnable.classList.toggle('enabled', midiEnabled);
    if (midiEnabled) syncMidi();else updateMidiStatus();
  };
  midiOutputSelect.onchange = selectOutput;
  midiTransition.onchange = () => {
    panicMidi();
    if (midiEnabled) syncMidi();
  };
  midiPanic.onclick = () => {
    panicMidi();
    midiEnabled = false;
    midiEnable.textContent = 'enable MIDI';
    midiEnable.classList.remove('enabled');
    updateMidiStatus();
  };
  globalBeatChannel.innerHTML = channelOptions(globalBeat.channel);
  globalBeatCc.innerHTML = ccOptions(globalBeat.cc);
  globalBeatEnabled.onchange = () => globalBeat.enabled = globalBeatEnabled.checked;
  globalBeatChannel.onchange = () => globalBeat.channel = Number(globalBeatChannel.value);
  globalBeatCc.onchange = () => globalBeat.cc = Number(globalBeatCc.value);
  const mappings = new Map();
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function keyFor(channel, cc) {
    return channel + ':' + cc;
  }
  function ensurePanel() {
    let panel = get('resident-beat-range-panel');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'resident-beat-range-panel';
    panel.className = 'panel global-output-panel';
    panel.style.margin = '12px 0';
    panel.style.padding = '12px';
    panel.style.border = '1px solid rgba(127,127,127,.35)';
    panel.style.borderRadius = '8px';
    panel.style.background = 'rgba(127,127,127,.08)';
    panel.innerHTML = '<div id="resident-global-output-controls"></div>' + '<div id="resident-beat-range-rows"></div>';
    const controls = panel.querySelector('#resident-global-output-controls');
    const midiPanel = root.querySelector('.midi-panel');
    const globalBeatPanel = root.querySelector(':scope > .beat-strip');
    if (midiPanel) {
      midiPanel.classList.remove('panel');
      controls.appendChild(midiPanel);
    }
    if (globalBeatPanel) {
      globalBeatPanel.classList.remove('panel');
      controls.appendChild(globalBeatPanel);
    }
    const mount = groupsRoot;
    if (mount.firstChild) mount.insertBefore(panel, mount.firstChild);else mount.appendChild(panel);
    return panel;
  }
  function ensureRow(channel, cc) {
    const key = keyFor(channel, cc);
    let row = root.querySelector('[data-beat-range-key="' + key + '"]');
    if (row) return mappings.get(key);
    const panel = ensurePanel();
    const rows = panel.querySelector('#resident-beat-range-rows');
    row = document.createElement('div');
    row.dataset.beatRangeKey = key;
    row.style.display = 'grid';
    row.style.gridTemplateColumns = 'repeat(auto-fit,minmax(min(100%,220px),1fr))';
    row.style.gap = '12px';
    row.style.alignItems = 'center';
    row.style.padding = '7px 0';
    row.style.borderTop = rows.children.length ? '1px solid rgba(127,127,127,.2)' : '0';
    const route = document.createElement('div');
    route.textContent = 'Ch ' + (channel + 1) + ' · CC ' + cc;
    route.style.fontWeight = '600';
    const widthLabel = document.createElement('label');
    widthLabel.style.display = 'grid';
    widthLabel.style.gridTemplateColumns = '52px 1fr 52px';
    widthLabel.style.gap = '8px';
    widthLabel.style.alignItems = 'center';
    const widthText = document.createElement('span');
    widthText.textContent = 'Width';
    const width = document.createElement('input');
    width.type = 'range';
    width.min = '0';
    width.max = '800';
    width.step = '5';
    width.value = '100';
    const widthValue = document.createElement('span');
    widthValue.textContent = '100%';
    widthLabel.append(widthText, width, widthValue);
    const centerLabel = document.createElement('label');
    centerLabel.style.display = 'grid';
    centerLabel.style.gridTemplateColumns = '52px 1fr 32px';
    centerLabel.style.gap = '8px';
    centerLabel.style.alignItems = 'center';
    const centerText = document.createElement('span');
    centerText.textContent = 'Center';
    const center = document.createElement('input');
    center.type = 'range';
    center.min = '0';
    center.max = '127';
    center.step = '1';
    center.value = '64';
    const centerValue = document.createElement('span');
    centerValue.textContent = '64';
    centerLabel.append(centerText, center, centerValue);
    row.append(route, widthLabel, centerLabel);
    rows.appendChild(row);
    const mapping = {
      amount: 1,
      center: 64
    };
    mappings.set(key, mapping);
    width.addEventListener('input', () => {
      mapping.amount = Number(width.value) / 100;
      widthValue.textContent = width.value + '%';
    });
    center.addEventListener('input', () => {
      mapping.center = Number(center.value);
      centerValue.textContent = center.value;
    });
    return mapping;
  }
  const unfilteredActiveVoicesForDevice = activeVoicesForDevice;
  activeVoicesForDevice = name => unfilteredActiveVoicesForDevice(name).filter(voice => messages.get(voice.streamId)?.ready === true);
  const readyActiveVoicesForDevice = activeVoicesForDevice;
  const unfilteredSyncAudio = syncAudio;
  syncAudio = function syncReadyAudio() {
    const previous = activeVoicesForDevice;
    activeVoicesForDevice = name => readyActiveVoicesForDevice(name).filter(voice => streamSettings(voice.streamId).noteEnabled);
    try {
      return unfilteredSyncAudio();
    } finally {
      activeVoicesForDevice = previous;
    }
  };
  function updateOutputAvailability() {
    const allMessages = [...messages.values()];
    const readyCount = allMessages.filter(message => message.ready === true).length;
    const anyReady = readyCount > 0;
    let readiness = get('resident-readiness');
    if (!readiness) {
      readiness = document.createElement('div');
      readiness.id = 'resident-readiness';
      readiness.className = 'status';
      const status = get('status');
      if (status) status.insertAdjacentElement('afterend', readiness);else (root.querySelector('main, #app') || root).prepend(readiness);
    }
    readiness.textContent = readyCount + ' of ' + allMessages.length + ' streams ready';
    midiEnable.disabled = !anyReady;
    midiEnable.closest('.midi-panel')?.classList.toggle('availability-disabled', !anyReady);
    globalBeatEnabled.disabled = !anyReady;
    globalBeatChannel.disabled = !anyReady;
    globalBeatCc.disabled = !anyReady;
    globalBeatEnabled.closest('.beat-strip')?.classList.toggle('availability-disabled', !anyReady);
    if (!anyReady && midiEnabled) {
      panicMidi();
      midiEnabled = false;
      midiEnable.textContent = 'enable MIDI';
      midiEnable.classList.remove('enabled');
      updateMidiStatus();
    }
    for (const group of groups.values()) {
      const deviceReady = [...messages.entries()].some(([id, message]) => deviceName(id) === group.name && message.ready === true);
      group.button.disabled = !deviceReady;
      if (!deviceReady && group.enabled) {
        group.enabled = false;
        group.button.textContent = 'start audio';
        group.button.classList.remove('playing');
        syncAudio();
      }
      const deviceBeatControls = group.section.querySelectorAll('.device-beat-enabled,.device-beat-channel,.device-beat-cc');
      deviceBeatControls.forEach(control => {
        control.disabled = !deviceReady;
      });
      group.section.querySelector('.beat-strip')?.classList.toggle('availability-disabled', !deviceReady);
      for (const [id, row] of group.rows) {
        const ready = messages.get(id)?.ready === true;
        row.classList.toggle('availability-disabled', !ready);
        row.querySelectorAll('input,select').forEach(control => {
          control.disabled = !ready;
        });
      }
    }
  }
  function updateResidentValues(updates) {
    for (const update of updates || []) {
      const message = messages.get(update.device);
      if (message) message.value = update.value;
      const group = groups.get(deviceName(update.device));
      const value = group?.rows.get(update.device)?.querySelector('.resident-stream-value');
      const incoming = Number(update.value);
      if (value && Number.isFinite(incoming)) {
        value.textContent = Math.abs(incoming) >= 100 ? incoming.toFixed(2) : incoming.toFixed(4);
      }
    }
  }
  ;
  const unfilteredRender = render;
  render = function renderWithAvailability(message) {
    unfilteredRender(message);
    const group = groups.get(deviceName(message.device));
    const row = group?.rows.get(message.device);
    if (row) {
      const cells = row.children;
      const title = cells[0];
      let value = title.querySelector('.resident-stream-value');
      if (!value) {
        value = document.createElement('span');
        value.className = 'resident-stream-value';
        title.appendChild(value);
      }
      const incoming = Number(message.value);
      value.textContent = Number.isFinite(incoming) ? Math.abs(incoming) >= 100 ? incoming.toFixed(2) : incoming.toFixed(4) : '—';
      if (cells[6] && !message.ready && message.reason === 'coverage') {
        cells[6].textContent = 'reading';
      }
      if (cells[7]) {
        const coverage = Number(message.coverage);
        cells[7].textContent = Number.isFinite(coverage) ? (coverage * 100).toFixed(0) + '%' : '—';
      }
    }
    updateOutputAvailability();
  };
  const pairwiseBeatValueFor = beatValueFor;
  beatValueFor = function phaseAwareBeatValue(key, voices, now) {
    if (!voices.length) return '—';
    if (voices.length > 1) return pairwiseBeatValueFor(key, voices, now);
    const voice = voices[0];
    const state = beatState(key);
    const dt = Math.min(0.1, Math.max(0, (now - state.lastTime) / 1000));
    state.lastTime = now;
    const phaseKey = 'single:' + voiceKey(voice.streamId, voice.id);
    let phase = state.phases.get(phaseKey);
    if (!Number.isFinite(phase)) phase = Number.isFinite(voice.phase) ? voice.phase : 0;
    phase = (phase + 2 * Math.PI * Math.max(0, Number(voice.frequencyHz) || 0) * dt) % (2 * Math.PI);
    state.phases.clear();
    state.phases.set(phaseKey, phase);
    const raw = Math.cos(phase);
    state.smoothed += 0.12 * (raw - state.smoothed);
    return Math.max(0, Math.min(127, Math.round((state.smoothed + 1) * 63.5)));
  };
  const sendFiniteBeat = maybeSendBeat;
  maybeSendBeat = function maybeSendFiniteBeat(config, value) {
    if (!Number.isFinite(value)) return;
    return sendFiniteBeat(config, value);
  };
  ensurePanel();
  updateOutputAvailability();
  function silence() {
    panicMidi();
    midiEnabled = false;
    for (const s of synthVoices.values()) stopSynth(s);
    synthVoices.clear();
    for (const g of groups.values()) {
      g.enabled = false;
      g.button.textContent = 'start audio';
      g.button.classList.remove('playing');
      g.bus?.gain.setValueAtTime(0, audioContext.currentTime);
    }
    for (const m of messages.values()) {
      m.ready = false;
      m.reason = 'disconnected';
      m.voices = [];
    }
    renderAll();
    updateOutputAvailability();
  }
  const unsubscribe = router.subscribeMessages(data => {
    if (data instanceof ArrayBuffer) return;
    if (data.type === 'resident_voices' && typeof data.device === 'string') {
      if (!messages.has(data.device) && messages.size >= 128) return;
      const voices = Array.isArray(data.voices) ? data.voices.filter(v => v && Number.isFinite(v.id) && Number.isFinite(v.frequencyHz) && v.frequencyHz > 0 && Number.isFinite(v.confidence)).slice(0, 32) : [];
      lastResidentAt = performance.now();
      render({
        ...data,
        ready: data.ready === true,
        voices
      });
      status.textContent = 'Live analysis';
    } else if (data.type === 'resident_values' && Array.isArray(data.updates)) {
      lastResidentAt = performance.now();
      updateResidentValues(data.updates.filter(v => v && typeof v.device === 'string' && Number.isFinite(v.value)));
    }
  });
  let connectionStatus = '';
  const syncConnection = () => {
    if (connectionStatus === router.status) return;
    connectionStatus = router.status;
    silence();
    lastResidentAt = performance.now();
    status.textContent = router.status === 'connected' ? 'Connected · waiting for analysis' : 'Router ' + router.status;
    if (router.status === 'connected') router.send({
      type: 'resident_subscribe',
      enabled: true
    });
  };
  const unsubscribeStatus = router.subscribe(syncConnection);
  syncConnection();
  window.addEventListener('pagehide', silence);
  const staleTimer = setInterval(() => {
    if (router.status === 'connected' && performance.now() - lastResidentAt > 30000) {
      silence();
      status.textContent = 'No recent analysis · waiting for the Pi';
      lastResidentAt = performance.now();
    }
  }, 1000);
  animationFrame = requestAnimationFrame(beatTick);
  return () => {
    unsubscribe();
    unsubscribeStatus();
    window.removeEventListener('pagehide', silence);
    router.send({
      type: 'resident_subscribe',
      enabled: false
    });
    panicMidi();
    disposed = true;
    midiGeneration++;
    clearInterval(staleTimer);
    cancelAnimationFrame(animationFrame);
    if (midiAccess) midiAccess.onstatechange = null;
    if (midiOutput) void midiOutput.close().catch(() => {});
    for (const s of synthVoices.values()) stopSynth(s);
    synthVoices.clear();
    if (audioContext) void audioContext.close().catch(() => {});
    root.replaceChildren();
  };
}
