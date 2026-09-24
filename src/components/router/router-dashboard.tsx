'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import NextLink from 'next/link';
import { Box, Button, Link, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useSignalRouter } from '@/components/signals/router-provider';
import { RouterInterface, connectionType, normalized, type Assignment, type SignalRow } from '@/lib/router/router-interface';

const routerOrigin = () => (process.env.NEXT_PUBLIC_SIGNAL_ROUTER_URL || 'wss://rf.postoccupancy.com').replace(/^ws/, 'http');
function external(path: string) { return new URL(path, routerOrigin()).href; }
function nodeLink(name: string) {
  return name === 'electric-sky' || name === 'indoor-sky' ? `/nodes/${name}` : undefined;
}
function rawValue({ signal }: SignalRow) {
  if (signal.type === 'audio') return signal.available ? `Live · ${signal.sampleRate || 0} Hz` : 'Idle';
  if (signal.type === 'midi') {
    if (signal.msgType === 'noteon') return `v${signal.velocity}`;
    if (signal.msgType === 'noteoff') return 'off';
    if (signal.msgType === 'cc') return ((signal.value || 0) / 127).toFixed(4);
    return String(signal.value ?? '—');
  }
  return signal.value?.toFixed(4) ?? '—';
}
function AssignmentInput({ row, field, model }: { row: SignalRow; field: keyof Assignment; model: RouterInterface }) {
  const fallback = field === 'min' ? row.signal.min ?? 0 : field === 'max' ? row.signal.max ?? (row.signal.type === 'midi' ? 127 : 1) : '';
  const value = row.assignment[field] ?? fallback;
  return <Box component="input" type="number" aria-label={`${row.key} ${field}`} disabled={row.signal.type === 'audio'}
    // Commit on blur so incoming data cannot interrupt a partially typed number.
    key={String(value)} defaultValue={row.signal.type === 'audio' ? '' : value}
    min={field === 'channel' ? 1 : field === 'cc' ? 0 : undefined}
    max={field === 'channel' ? 16 : field === 'cc' ? 127 : undefined}
    step={field === 'channel' || field === 'cc' ? 1 : 'any'} placeholder="—"
    onBlur={(event) => {
      if (event.currentTarget.validity.valid) model.setAssignment(row.key, field, event.currentTarget.value);
      else event.currentTarget.value = String(value);
    }}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    sx={{ width: field === 'min' || field === 'max' ? 80 : 64, p: 0.75, border: 1, borderColor: 'divider', borderRadius: 0.5, bgcolor: 'background.paper', color: 'text.primary', font: 'inherit', '&:disabled': { opacity: 0.3 } }} />;
}
function Toggle({ enabled, label, onClick, disabled = false }: { enabled: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return <Button size="small" variant={enabled ? 'outlined' : 'text'} aria-label={label} aria-pressed={enabled} disabled={disabled} onClick={onClick} sx={{ minWidth: 44 }}>{enabled ? 'On' : 'Off'}</Button>;
}
function Heading({ children }: { children: React.ReactNode }) {
  return <Typography component="h2" variant="h6" sx={{ mt: 4, mb: 1.5 }}>{children}</Typography>;
}

export function RouterDashboard() {
  const router = useSignalRouter();
  const [model] = useState(() => new RouterInterface(router));
  useSyncExternalStore(model.subscribe, model.getSnapshot, model.getServerSnapshot);
  useEffect(() => model.start(), [model]);
  const { server, client, clients } = model;
  const connected = router.status === 'connected';
  const groups = new Map<string, SignalRow[]>();
  for (const row of model.rows.values()) {
    const rows = groups.get(row.signal.source) || [];
    rows.push(row); groups.set(row.signal.source, rows);
  }
  const ports = new Map<string, { input?: MIDIInput; output?: MIDIOutput }>();
  for (const input of model.midi?.inputs.values() || []) { const name = input.name || input.id; ports.set(name, { ...ports.get(name), input }); }
  for (const output of model.midi?.outputs.values() || []) { const name = output.name || output.id; ports.set(name, { ...ports.get(name), output }); }
  const osc = client?.oscUdpAvailable === true;
  const tableStyle = { '& th': { whiteSpace: 'nowrap' }, '& td': { fontVariantNumeric: 'tabular-nums' } };

  return <Box sx={tableStyle}>
    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 3 }}>
      <Typography role="status" aria-label="Router connection" variant="body2" color={connected ? 'primary' : 'text.secondary'}>Router {router.status}</Typography>
      <Link component={NextLink} href="/instruments/resident-frequency" variant="body2">Resident Frequency</Link>
      <Link href={external('/modulation-spectrum/')} target="_blank" rel="noreferrer" variant="body2">Modulation spectrum ↗</Link>
      <Link href="http://127.0.0.1:3010/" target="_blank" rel="noreferrer" variant="body2">Local recorder ↗</Link>
    </Stack>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
      <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, overflowWrap: 'anywhere' }}>
        <Typography variant="overline">This client</Typography>
        <Typography>{String(client?.ip || 'Waiting for connection…')}</Typography>
        <Typography variant="body2" color="text.secondary">{client && connectionType(client)}{client ? ` · ${clients?.tabCount ?? client.tabCount ?? 1} tab(s)` : ''}</Typography>
      </Box>
      <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, overflowWrap: 'anywhere' }}>
        <Typography variant="overline">Router server</Typography>
        <Typography>{server ? `${server.hostname} (${server.platform})` : 'Waiting for server…'}</Typography>
        <Typography variant="body2" color="text.secondary">{server ? `${server.networkMode === 'ap' ? 'AP' : 'WiFi'}: ${server.networkSsid || 'unknown'}` : ''}{clients ? ` · ${clients.count} client(s)` : ''}</Typography>
      </Box>
    </Box>

    <Heading>OSC UDP</Heading>
    <TableContainer tabIndex={0} aria-label="OSC ports">
      <Table size="small" sx={{ minWidth: 600 }}><TableHead><TableRow>{['Direction', 'Endpoint', 'Enabled', 'Purpose'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          <TableRow><TableCell>Into router</TableCell><TableCell>{server ? String(server.hostname) : new URL(routerOrigin()).hostname}:{String(client?.oscInPort || 5005)}</TableCell><TableCell>{client ? osc ? 'Always on' : 'LAN / VPN only' : 'Checking'}</TableCell><TableCell>OSC senders → router</TableCell></TableRow>
          <TableRow><TableCell>Out to this machine</TableCell><TableCell>{String(client?.ip || 'This client')}:{String(client?.oscOutPort || 9000)}</TableCell><TableCell>{client ? osc ? 'Always on' : 'Disabled' : 'Checking'}</TableCell><TableCell>{String(client?.oscUdpReason || 'Waiting for router connection details')}</TableCell></TableRow>
        </TableBody>
      </Table>
    </TableContainer>

    <Heading>Local MIDI ports</Heading>
    <Stack direction="row" spacing={2} sx={{ mb: 1, alignItems: 'center' }}>
      {!model.midi && <Button variant="outlined" size="small" onClick={() => void model.enableMidi()} disabled={model.midiStatus === 'Requesting MIDI access…'}>Enable MIDI</Button>}
      <Typography role="status" aria-label="MIDI status" variant="body2">{model.midiStatus}</Typography>
    </Stack>
    <TableContainer tabIndex={0} aria-label="Local MIDI ports">
      <Table size="small" sx={{ minWidth: 550 }}><TableHead><TableRow>{['Port', 'Send to port', 'Receive from port', 'Status'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
        <TableBody>{[...ports].map(([name, { input, output }]) => {
          const state = model.portState[name] || {};
          return <TableRow key={name}><TableCell>{name}</TableCell>
            <TableCell>{output ? <Toggle label={`Send to ${name}`} enabled={!!state.receive} onClick={() => model.setPort(name, 'receive', !state.receive)} /> : '—'}</TableCell>
            <TableCell>{input ? <Toggle label={`Receive from ${name}`} enabled={!!state.send} onClick={() => model.setPort(name, 'send', !state.send)} /> : '—'}</TableCell>
            <TableCell>{state.receive ? 'Router sending to port' : state.send ? 'Router receiving from port' : 'Off'}</TableCell>
          </TableRow>;
        })}{!ports.size && <TableRow><TableCell colSpan={4}>{model.midi ? 'No MIDI ports found. See setup help below.' : 'Enable MIDI to access ports on this computer.'}</TableCell></TableRow>}</TableBody>
      </Table>
    </TableContainer>

    <Heading>Client routes on server</Heading>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>CH / CC and range assignments control this browser’s MIDI output. Audio Out switches the source on the router.</Typography>
    {!groups.size && <Typography color="text.secondary">{connected ? 'Waiting for live signals…' : 'Waiting for router connection…'}</Typography>}
    {[...groups].map(([source, rows]) => {
      const info = model.sources.get(source);
      const name = String(info?.name || source);
      const href = nodeLink(name);
      const peers = Array.isArray(clients?.allClients) ? clients.allClients : [];
      const peer = peers.find((item) => item?.ip === source);
      return <Box component="section" aria-label={`Signals from ${name}`} key={source} sx={{ mb: 3 }}>
        <Typography component="h3" variant="subtitle2" sx={{ mb: 1 }}>
          {href ? <Link component={NextLink} href={href}>{name}</Link> : name}
          {info ? ` · ${source}` : ''}{peer?.os ? ` (${peer.os})` : ''}{peer?.connType ? ` · ${peer.connType}` : ''}{peer?.tabCount > 1 ? ` · ${peer.tabCount} tabs` : ''}{peer?.oscReceive ? ' · OSC :9000' : ''}{source === client?.ip ? ' · this client' : ''}
        </Typography>
        <TableContainer tabIndex={0} aria-label={`${name} signals`}>
          <Table size="small" sx={{ minWidth: 900 }}><TableHead><TableRow>{['Signal', 'Raw', 'MIDI', 'CH', 'CC', 'Min', 'Max', 'Out', 'View'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
            <TableBody>{rows.map((row) => {
              const scalar = row.signal.type === 'osc' || row.signal.type === 'json' || row.signal.msgType === 'cc';
              const stale = !connected || model.now - row.receivedAt > 5000;
              return <TableRow key={row.key}>
                <TableCell component="th" scope="row" sx={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.key}>{row.key}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', color: stale ? 'text.secondary' : 'text.primary' }}>{rawValue(row)}{stale && row.signal.type !== 'audio' ? ' · stale' : ''}</TableCell>
                <TableCell>{scalar ? Math.round(normalized(row) * 127) : '—'}</TableCell>
                {(['channel', 'cc', 'min', 'max'] as const).map((field) => <TableCell key={field}><AssignmentInput row={row} field={field} model={model} /></TableCell>)}
                <TableCell><Toggle label={`${row.key} output`} enabled={row.signal.type === 'audio' ? !!row.signal.enabled : row.out} disabled={row.signal.type === 'audio' && !connected} onClick={() => model.toggleOut(row)} /></TableCell>
                <TableCell><Link component={NextLink} href={`/interfaces/spectral-visualizer?device=${encodeURIComponent(row.key)}`} aria-label={`View ${row.key}`}>{row.signal.type === 'audio' ? 'Audio' : 'Open'}</Link></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </TableContainer>
      </Box>;
    })}
    <Box component="details" sx={{ mt: 4, '& p': { mb: 1 }, '& summary': { cursor: 'pointer', mb: 2 } }}>
      <Typography component="summary" sx={{ fontWeight: 600 }}>Setup help</Typography>
      <Typography variant="body2">Use a browser with WebMIDI support, such as Chrome. Choose Enable MIDI and allow access when asked. MIDI runs while Electric Sea is open; leaving this page releases its ports.</Typography>
      <Typography variant="body2"><strong>Mac:</strong> Open Audio MIDI Setup → MIDI Studio → IAC Driver. Enable “Device is online” and add a bus. In your music application, enable that bus as a MIDI input.</Typography>
      <Typography variant="body2"><strong>Windows:</strong> Create a virtual port with loopMIDI, then select it in your music application.</Typography>
      <Typography variant="body2">“Send to port” sends router signals to a local MIDI output; “Receive from port” sends local MIDI input to the router. Only one direction is enabled per named port to prevent feedback.</Typography>
      <Typography variant="body2">CH / CC assignments, ranges, scalar output switches, and port directions are saved in this site’s local storage. Settings from the Pi site are separate. Scalar values are normalized to 0–127 with the original 0.3 smoothing; non-CC MIDI messages pass through.</Typography>
      <Typography variant="body2">OSC uses UDP ports 5005 into the Pi and 9000 back to directly connected clients. Cloudflare carries WebSocket data, but cannot deliver UDP to your computer. Audio Out affects the shared source; it does not start audio playback in this page.</Typography>
      <Typography variant="body2">View links open Spectral Visualizer with the selected signal. <Link href={external('/voices/')} target="_blank" rel="noreferrer">The existing voices application ↗</Link> remains available there until it is integrated into Resident Frequency.</Typography>
    </Box>
  </Box>;
}
