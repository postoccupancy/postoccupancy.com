# Wave Interference exhibition setup

Install while the Windows exhibition PC has internet:

1. Node.js 22 LTS.
2. The current Behringer UMC1820 Windows driver and control panel from Behringer.
3. Google Chrome or Microsoft Edge.
4. Repository dependencies from the `postoccupancy.com` directory with `npm ci`.

Build while online:

```powershell
npm ci
npm run build
```

Start the offline exhibition server from PowerShell:

```powershell
npm start -- --hostname 127.0.0.1 --port 3001
```

Open `http://127.0.0.1:3001/instruments/wave-interference`. The controller and Presentation window must use that exact origin and port so their `BroadcastChannel` connection is shared. No runtime CDN or internet connection is used.

## UMC1820 input check

Connect the microphone to the UMC1820, choose the interface in **Device**, select its numbered input channel, and press **Start audio**. Speak or tap near the microphone and confirm the input meter moves. Try each channel if the driver exposes a multichannel device whose browser channel order is unclear. The page does not connect microphone audio to the output device.

## DJ2GO2 and Ableton coexistence check

This must be tested on the exhibition Windows PC because Web MIDI device sharing depends on its installed DJ2GO2 driver:

1. Close other MIDI utilities.
2. Open Ableton Live and enable the DJ2GO2 input.
3. Open the Wave Interference controller page, press **Enable MIDI input**, and select DJ2GO2.
4. Move each hardware control and confirm both Ableton's MIDI indicator and the page's raw-event monitor respond.
5. Reverse the launch order and repeat after a reboot.

If the second application cannot open or receive from the device, the installed Windows MIDI driver is exclusive. This implementation does not install a MIDI bridge or forward MIDI. Resolve device sharing before exhibition day or choose which application owns DJ2GO2.

Use **Learn** beside a visual control and move the desired controller. After learning a CC, choose **Absolute** for ordinary 0–127 controls or **Relative 1/127** for encoders that send `1` clockwise and `127` counterclockwise. Notes, CC numbers, and MIDI channels are stored as distinct mappings. The projector window never opens MIDI or microphone devices.
