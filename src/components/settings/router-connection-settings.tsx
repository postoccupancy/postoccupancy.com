'use client';

import { Box, Button, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useRouterInterface } from '@/components/signals/router-provider';

const routerOrigin = () => (process.env.NEXT_PUBLIC_SIGNAL_ROUTER_URL || 'wss://rf.postoccupancy.com').replace(/^ws/, 'http');

function Toggle({ enabled, label, onClick }: { enabled: boolean; label: string; onClick: () => void }) {
  return <Button size="small" variant={enabled ? 'outlined' : 'text'} aria-label={label} aria-pressed={enabled} onClick={onClick} sx={{ minWidth: 44 }}>{enabled ? 'On' : 'Off'}</Button>;
}

function Heading({ children }: { children: React.ReactNode }) {
  return <Typography component="h3" variant="subtitle1" sx={{ mt: 3, mb: 1.5, fontWeight: 600 }}>{children}</Typography>;
}

export function RouterConnectionSettings() {
  const model = useRouterInterface();
  const { server, client } = model;
  const ports = new Map<string, { input?: MIDIInput; output?: MIDIOutput }>();
  for (const input of model.midi?.inputs.values() || []) { const name = input.name || input.id; ports.set(name, { ...ports.get(name), input }); }
  for (const output of model.midi?.outputs.values() || []) { const name = output.name || output.id; ports.set(name, { ...ports.get(name), output }); }
  const osc = client?.oscUdpAvailable === true;

  return (
    <Box sx={{ '& th': { whiteSpace: 'nowrap' }, '& td': { fontVariantNumeric: 'tabular-nums' } }}>
      <Heading>OSC UDP</Heading>
      <TableContainer tabIndex={0}>
        <Table aria-label="OSC ports" size="small" sx={{ minWidth: 600 }}><TableHead><TableRow>{['Direction', 'Endpoint', 'Enabled', 'Purpose'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
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
      <TableContainer tabIndex={0}>
        <Table aria-label="Local MIDI ports" size="small" sx={{ minWidth: 550 }}><TableHead><TableRow>{['Port', 'Send to port', 'Receive from port', 'Status'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
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
    </Box>
  );
}
