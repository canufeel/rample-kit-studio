# Rample Kit Studio

A fully client-side tool to assemble, convert, audition and export sample kits for the
[Squarp Rample / Rample Turbo](https://squarp.net/rample/).

Your samples never leave your machine — there is no backend, no account, and no upload.
Everything decodes, converts and encodes in the browser.

> Unofficial community project. Not affiliated with, endorsed by, or supported by
> Squarp Instruments.

By Petr Kosikhin.

## Status

Working and usable. You can build a kit, hear it playing as a kit — four channels
triggered together, at tempo — and write it to an SD card.

**Not yet verified on hardware.** Every rule the exporter enforces is quoted from the
official manual and checked by tests, but no exported kit has been loaded onto a real
Rample. Treat the export as careful rather than proven, and please open an issue if a kit
misbehaves on the device.

Tested in Chrome only. Firefox and Edge are expected to work and are untested; Safari is
likely to need work.

## Running it

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev        # dev server
bun run build      # static build into dist/
bun test           # unit tests
bun run typecheck
```

The build is plain static files with no backend, deployable to GitHub Pages, Cloudflare
Pages, Netlify or Vercel.

## What it does

### Building a kit

- **Multi-kit tabs.** Each tab's label *is* the folder name written to the SD card, and is
  validated against the device's `[A-Z][0-99]` scheme.
- **Four channels in four fixed SP slots.** `SP1`–`SP4` are positions and they never move;
  the channels that occupy them are draggable and renameable. Whichever channel sits in
  SP1 exports as the Rample's voice 1, so reordering channels reassigns the hardware
  voices.
- **Instant metadata.** WAV headers are parsed directly, so sample rate, bit depth,
  channels and length appear the moment a file lands — no decode wait.
- **Validation against the real device contract**, with the offending field marked in red
  on the row. Includes cases a decoder cannot see, such as 32-bit float or 24-bit WAVs,
  which decode perfectly in a browser and will not play on the hardware.
- **Conversion** to 44.1 kHz, 16- or 8-bit, mono or stereo, per channel — individually, in
  bulk, or automatically on import.
- **Up to 12 layer slots per channel**, with an automatic queue for the overflow.

### Hearing it

- **Preview mixer.** Per-channel level and a master, each channel monophonic with
  voice-stealing exactly as the hardware behaves.
- **Layer modes** — random, cyclic or manual — so you hear the same variation the device
  will produce rather than always layer 1.
- **Mute and solo** per channel. Solo is additive: solo several and all of them sound.
  Both govern the sequencer only, so you can still audition a row on a muted channel.
- **Sequencer.** One clock, four independent channels. Euclidean patterns with length,
  triggers and rotation, or hand-drawn step grids. Thirteen time divisions including
  dotted and triplet values. Because each channel keeps its own length against one tempo,
  channels of differing length phase against each other — polymeter, flagged in the UI so
  it doesn't look like a bug.
- **Density randomisation.** Roll a channel to *mezzanine*, *bar* or *disco* — sparse,
  medium or busy. Length is never randomised, only how full the pattern is and where the
  hits land. While the transport runs, a roll lands on the channel's next loop boundary
  rather than jumping mid-bar.
- The sequencer, mixer, mutes and layer modes are **preview-only**. The Rample has no
  sequencer; none of this reaches the card.

### Weighting and sequencing layers

The Rample has no per-layer probability and no per-layer ordering. Both can be had anyway,
by putting the same file on the card more than once — which costs layer slots and nothing
else. The app exposes that directly:

- **Random mode — probability.** A stepper per sample. Raising it adds a slot, so the
  sample's share of the draw rises. Steps are whole slots because that is the only
  resolution the card can express; a channel with all twelve spent cannot be reweighted.
- **Cyclic mode — sequencing.** A duplicate button per row. Cyclic walks the slots in
  order, so repeating a sample *is* the sequence, and drag-and-drop arranges it.
- **Per-sample mute in Random mode** takes a sample out of the draw and hands its odds to
  the others. Preview-only: it keeps its slot and is still written to the card.

Both are mode-scoped — changing a channel's playback mode collapses every sample back to
one slot, since duplicates mean a weighting in one mode and an order in the other.

### Library

- **Patterns** — save any one channel's pattern and recall it onto any channel.
- **Presets** — a whole four-channel scene plus tempo and channel names, in two banks:
  **Factory**, 61 read-only presets shipped with the app, and **User**, everything you
  save. Saving always targets User, so a shipped groove can never be overwritten.
- Both preview before loading: parameters plus a step-grid thumbnail per channel.
- The Presets header shows which scene the channels currently are, and whether you have
  edited it since.

Most Factory presets deliberately have **no kick** — a Rample is often the percussion
voice beside a kick coming from somewhere else — and the bank covers pitched material
(bass, pads, leads, bells, vocal chops) as well as drums.

### Getting kits in and out

- **Export** as a ZIP or, on Chromium, written straight into a folder you pick — point it
  at the SD card root. The dialog lists every file that will be written, and every sample
  that will not be, before anything happens.
- **Import kits from a card.** Point it at a card root to read every kit folder, or at a
  single kit folder. Kit codes, voice assignment and layer order are reconstructed from
  the folder and file names; anything else on the card is skipped and reported.
- **Save** the session to your browser, so work survives a reload.
- **Download / Open a project** — a portable `.zip` holding the whole project *including
  its audio*, so a session can move between machines.

Audio is imported from anything the browser can decode — WAV, MP3, FLAC, OGG, M4A — and
always exported as PCM WAV, the only format the device reads.

## Keyboard

| Key     | Action                                                 |
| ------- | ------------------------------------------------------ |
| `Space` | Play / stop the transport                              |
| `1`–`4` | Trigger the channel in SP1–SP4 using its playback mode |

## The device contract

Every rule the exporter enforces comes from the
[official manual](https://squarp.net/rample/manual/) and lives in one file,
[`src/domain/device.ts`](src/domain/device.ts), quoted next to the constant it produces:

- A kit is one folder at the **root** of the SD card, named `[A-Z][0-99]` (`A0`…`Z99`,
  2600 kits, no zero-padding).
- Samples are `.wav`, **44100 Hz**, **16- or 8-bit**, at least **50 ms**, no maximum.
- A filename's **first character is the voice digit**, 1–4. Layers sort numerically then
  alphabetically, which sets their order on the device.
- Up to **12 layers per voice**, 48 per kit.
- A stereo sample **occupies two adjacent voices**, and all layers in a voice must be the
  same type.
- A kit **must** contain a valid voice-1 sample or the device refuses to open it.

Rample Turbo runs identical firmware; its improvements are a better DAC and a faster SD
card, so the format rules are the same for both.

Exported files are named `{voice}-{layer}_{name}.wav` — e.g. `1-01_Kick_Deep.wav`. The
leading digit satisfies the device's rule, the zero-padded index pins layer order, and
source names are slugified to characters that are safe on a FAT-formatted card. A sample
occupying several slots is written once per slot, which is what makes probability and
cyclic order survive onto the hardware.

## Architecture

```
src/
  domain/     Pure logic — device contract, validation, kit codes, filenames,
              patterns, the library model, the factory preset bank
  audio/      Decode, WAV parsing/encoding, conversion, engine, scheduler
  storage/    IndexedDB (audio bytes) + localStorage (session and library structure)
  export/     Export planning, ZIP and File System Access writers
  store/      Zustand stores — session and library
  components/ React UI
  styles/     tokens.css — the entire skin layer
```

`domain/` has no browser dependencies and holds everything that can be reasoned about
without one, which is why most of the test suite lives against it.

Six decisions worth knowing about:

**Decoding happens at 44.1 kHz.** `decodeAudioData` resamples to the *context's* rate, so
decoding through the live AudioContext on a 48 kHz machine would resample an
already-correct 44.1 kHz file up and then back down again. Conversion decodes through an
`OfflineAudioContext` pinned to 44100 instead, so correct files pass through untouched.

**Bytes go to IndexedDB, structure to localStorage.** localStorage caps around 5 MB and
holds strings; a single three-second stereo sample is ~500 KB, so one channel would exceed
the quota. Sample metadata is small and stays in localStorage.

**Sequencer timing never touches a JS timer.** A worker-backed timer wakes every 25 ms and
asks what falls due in the next 100 ms, then hands those events to the audio thread at
exact `AudioContext.currentTime` offsets. The coarse clock decides *what* to schedule; the
audio clock decides *when* it sounds, so timer jitter cannot move a hit. The timer lives in
a worker because main-thread `setInterval` is throttled to roughly 1 Hz in a background
tab, which would stall a 100 ms lookahead the moment you switched tabs.

**Playheads and layer cursors stay out of React state.** A cyclic channel advances up to
sixteen times a second per channel; routing that through the store would re-render the UI
at audio rate. Both publish through small subscriptions instead, coalesced to one animation
frame.

**A channel's identity, its SP slot and its name are three separate things.** Identity
keys its pattern, its audio strip and its level — which is why dragging a channel carries
all three along with no code to move them. Its slot is what the device sees. Its name is
cosmetic and never exported.

**A channel's layers are slots, and a slot may repeat a sample.** That one fact expresses
random probability, cyclic ordering, and the duplication the hardware needs, without any of
them being a special case. It also means the twelve-layer budget is spent in *slots*: a
channel holding three samples at four slots each is as full as one holding twelve samples.

## Theming

Near-black, flat panels, one mint accent (`#70be96`). Every colour, radius and control
dimension resolves through a custom property in
[`src/styles/tokens.css`](src/styles/tokens.css); no component stylesheet contains a
literal colour. Swapping in a different skin is a matter of redefining that one file.

## License

[MIT](LICENSE), © 2026 Petr Kosikhin. Contributions are accepted under the same terms.

Every bundled dependency is permissively licensed and compatible: React, React-DOM,
Zustand, dnd-kit and Vite are MIT; TypeScript is Apache-2.0 and build-time only; JSZip is
dual-licensed MIT or GPL-3.0-or-later, and is used here under the MIT option.

No Squarp trademarks, artwork or sample content are included in this repository. The
factory preset bank ships rhythm parameters only — numbers, not audio.
