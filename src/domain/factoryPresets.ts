import { VOICE_COUNT } from './device'
import { euclideanPattern } from './euclid'
import { clampBpm, createSequence } from './sequence'
import type { ChannelSequence, DivisionId, SavedPreset } from './types'

/**
 * The Factory preset bank: a read-only starting library of drum grooves.
 *
 * These are code, not storage — they ship with the app, cannot be edited, and are never
 * written to localStorage. Loading one copies it onto the live channels exactly like a
 * user preset, so the way to modify one is to load it, change it and save it to the User
 * bank.
 *
 * Two things the set is trying to do at once: cover the rhythmic skeletons that actually
 * recur across electronic music, and be *distinct* preset to preset. Because all four
 * channels of a four-on-the-floor genre share the same kick, the distinctness lives in the
 * other three channels, the tempo, and above all the time divisions — which is also where
 * the more interesting entries live. A handful deliberately mix divisions and prime
 * lengths so the four channels never line up, and the groove keeps evolving for minutes
 * without repeating. See `isPolymetric` for how the UI flags that.
 *
 * Patterns are transcriptions by ear and by convention, deliberately simplified to four
 * channels and to what the Rample can play. They are idiomatic starting points, not
 * facsimiles of any recording.
 */

/** `x` is a hit, every other character is a rest. The map's own length is the pattern length. */
function steps(map: string): boolean[] {
  return [...map].map((c) => c === 'x')
}

interface ChannelSpec {
  name: string
  sequence: ChannelSequence
}

/**
 * A hand-drawn pattern. Length comes from the map, so the two can never disagree.
 *
 * `triggers` is set to the map's hit count even though a user pattern ignores it, so that
 * flipping the channel to Euclid mode gives a pattern of comparable density rather than
 * whatever the default happened to be.
 */
function drawn(name: string, division: DivisionId, map: string): ChannelSpec {
  const on = steps(map)
  return {
    name,
    sequence: {
      ...createSequence('user'),
      division,
      length: on.length,
      steps: on,
      triggers: on.filter(Boolean).length,
      rotation: 0,
    },
  }
}

/**
 * A generated pattern: Bjorklund spreads `triggers` as evenly as it can across `length`.
 *
 * The step map is filled in with the generated pattern for the mirror-image reason —
 * flipping the channel to User mode hands over the same pattern to edit by hand.
 */
function euclid(
  name: string,
  division: DivisionId,
  length: number,
  triggers: number,
  rotation = 0,
): ChannelSpec {
  return {
    name,
    sequence: {
      ...createSequence('euclidean'),
      division,
      length,
      triggers,
      rotation,
      steps: euclideanPattern(length, triggers, rotation),
    },
  }
}

interface FactorySpec {
  id: string
  name: string
  /** One line on where the groove comes from or what it is for. Shown in the preview. */
  note: string
  bpm: number
  channels: [ChannelSpec, ChannelSpec, ChannelSpec, ChannelSpec]
}

// Common building blocks, named so the recurring skeletons are visible as such.
const FOUR_TO_FLOOR = 'x...x...x...x...'
const BACKBEAT = '....x.......x...'
const OFFBEAT_8TH = '..x...x...x...x.'
const EIGHTHS = 'x.x.x.x.x.x.x.x.'
const EIGHTHS_32 = 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.'
const SIXTEENTHS = 'xxxxxxxxxxxxxxxx'
const LAST_BEAT = '............x...'
const OFFBEAT_8TH_32 = '..x...x...x...x...x...x...x...x.'

const SPECS: readonly FactorySpec[] = [
  // ── Four-on-the-floor ─────────────────────────────────────────────────────────
  {
    id: 'factory:house-909',
    name: 'House 909',
    note: 'The Chicago skeleton — kick on every beat, clap on 2 and 4, open hat pushing the offbeat.',
    bpm: 124,
    channels: [
      drawn('Kick', '1/16', FOUR_TO_FLOOR),
      drawn('Clap', '1/16', BACKBEAT),
      drawn('ClosedHat', '1/16', EIGHTHS),
      drawn('OpenHat', '1/16', OFFBEAT_8TH),
    ],
  },
  {
    id: 'factory:disco-tom',
    name: 'Disco Tom',
    note: 'Driving 16th hats and a tom fill rolling into the turnaround.',
    bpm: 118,
    channels: [
      drawn('Kick', '1/16', FOUR_TO_FLOOR),
      drawn('Snare', '1/16', BACKBEAT),
      drawn('Hats', '1/16', 'xxxxxxxxxxxxxxxx'),
      drawn('Tom', '1/16', '..........x.x.x.'),
    ],
  },
  {
    id: 'factory:techno-peak',
    name: 'Techno Peak Time',
    note: 'Stripped for the floor: one clap on the last beat, everything else in the rumble.',
    bpm: 138,
    channels: [
      drawn('Kick', '1/16', FOUR_TO_FLOOR),
      drawn('Clap', '1/16', '............x...'),
      drawn('OpenHat', '1/16', OFFBEAT_8TH),
      euclid('Rumble', '1/16', 16, 7, 2),
    ],
  },
  {
    id: 'factory:trance-roll',
    name: 'Trance Roll',
    note: 'Offbeat open hat, a rolling 16th arp, and a snare roll lifting into the next bar.',
    bpm: 140,
    channels: [
      drawn('Kick', '1/16', FOUR_TO_FLOOR),
      drawn('OpenHat', '1/16', OFFBEAT_8TH),
      drawn('SnareRoll', '1/16', '............xxxx'),
      euclid('Arp', '1/16', 16, 13),
    ],
  },
  {
    id: 'factory:gabber-stomp',
    name: 'Gabber Stomp',
    note: 'Rotterdam hardcore — the kick moves to straight 8ths and never lets up.',
    bpm: 190,
    channels: [
      drawn('Kick', '1/16', EIGHTHS),
      drawn('Clap', '1/16', BACKBEAT),
      drawn('Screech', '1/16', OFFBEAT_8TH),
      euclid('Hoover', '1/8', 8, 3, 1),
    ],
  },

  // ── Swung and triplet-based ───────────────────────────────────────────────────
  {
    id: 'factory:deep-house-shuffle',
    name: 'Deep House Shuffle',
    note: 'A triplet shaker over a straight kick — the swing comes from two grids disagreeing.',
    bpm: 121,
    channels: [
      drawn('Kick', '1/16', FOUR_TO_FLOOR),
      drawn('Clap', '1/16', BACKBEAT),
      drawn('Shaker', '1/8T', 'x.xx.xx.xx.x'),
      drawn('Chord', '1/8', '.x.x.x.x'),
    ],
  },
  {
    id: 'factory:afro-tribal',
    name: 'Afro Tribal',
    note: 'Congas in triplets against a four-four floor, with a five-in-sixteen clave on top.',
    bpm: 126,
    channels: [
      drawn('Kick', '1/16', FOUR_TO_FLOOR),
      drawn('Conga', '1/8T', 'xx.x.xx.x.x.'),
      drawn('Shaker', '1/16', EIGHTHS),
      euclid('Clave', '1/16', 16, 5),
    ],
  },
  {
    id: 'factory:footwork-juke',
    name: 'Footwork Juke',
    note: 'Chicago juke at 160 — clustered kicks, a sub underneath, triplet claps across the top.',
    bpm: 160,
    channels: [
      drawn('Kick', '1/16', 'x..x..x...x..x..'),
      drawn('Sub', '1/16', 'x.......x.......'),
      drawn('Clap', '1/8T', 'x..x..x..x..'),
      euclid('Vox', '1/16', 16, 6, 3),
    ],
  },

  // ── Syncopated and electro ────────────────────────────────────────────────────
  {
    id: 'factory:detroit-strings',
    name: 'Detroit Strings',
    note: 'The kick leaves the grid on the last beat; stabs answer in the gaps.',
    bpm: 130,
    channels: [
      drawn('Kick', '1/16', 'x...x...x..x....'),
      drawn('Clap', '1/16', BACKBEAT),
      drawn('Hat', '1/16', EIGHTHS),
      drawn('Stab', '1/16', '..x..x....x.....'),
    ],
  },
  {
    id: 'factory:electro-808',
    name: 'Electro 808',
    note: 'Planet Rock territory — syncopated 808 kick, cowbell on 8ths, clave in three-three-two.',
    bpm: 116,
    channels: [
      drawn('Kick808', '1/16', 'x.....x.x.....x.'),
      drawn('Snare', '1/16', BACKBEAT),
      drawn('Cowbell', '1/16', EIGHTHS),
      drawn('Clave', '1/16', 'x..x..x...x.x...'),
    ],
  },
  {
    id: 'factory:miami-bass',
    name: 'Miami Bass',
    note: 'Long 808 sub notes with the kit left deliberately thin around them.',
    bpm: 128,
    channels: [
      drawn('Sub808', '1/16', 'x.....x...x.....'),
      drawn('Snare', '1/16', BACKBEAT),
      drawn('Hat', '1/16', EIGHTHS),
      drawn('Crash', '1/1', 'x'),
    ],
  },
  {
    id: 'factory:dembow',
    name: 'Dembow Tresillo',
    note: 'The three-three-two that underpins dancehall and reggaeton.',
    bpm: 96,
    channels: [
      drawn('Kick', '1/16', 'x..x..x.x..x..x.'),
      drawn('Snare', '1/16', BACKBEAT),
      drawn('Hat', '1/16', EIGHTHS),
      euclid('Perc', '1/16', 16, 5, 2),
    ],
  },

  // ── Breaks ────────────────────────────────────────────────────────────────────
  {
    id: 'factory:amen-break',
    name: 'Amen Break',
    note: 'The two-bar shape every jungle record is cut from, simplified to four channels.',
    bpm: 170,
    channels: [
      drawn('Kick', '1/16', 'x.......x...............x.......'),
      drawn('Snare', '1/16', '....x.....x...x.....x.....x..x..'),
      drawn('Hat', '1/16', EIGHTHS_32),
      drawn('Ride', '1/16', '................x...............'),
    ],
  },
  {
    id: 'factory:funky-drummer',
    name: 'Funky Drummer',
    note: 'Ghost notes are the whole point — the snare pattern is busier than the backbeat.',
    bpm: 100,
    channels: [
      drawn('Kick', '1/16', 'x.......x.x.....x.......x.x.....'),
      drawn('Snare', '1/16', '....x..x.x..x.x.....x..x.x..x.x.'),
      drawn('Hat', '1/16', EIGHTHS_32),
      euclid('Ride', '1/16', 32, 9, 4),
    ],
  },
  {
    id: 'factory:big-beat',
    name: 'Big Beat',
    note: 'Late-90s block-rocking weight: kick on 1 and the back of 3, crash on the downbeat.',
    bpm: 128,
    channels: [
      drawn('Kick', '1/16', 'x.......x.x.....'),
      drawn('Snare', '1/16', BACKBEAT),
      drawn('Hat', '1/16', OFFBEAT_8TH),
      drawn('Crash', '1/16', 'x...............'),
    ],
  },
  {
    id: 'factory:dnb-two-step',
    name: 'DnB Two-Step',
    note: 'The default drum and bass frame — kick, snare on 3, kick pushed late in bar two.',
    bpm: 174,
    channels: [
      drawn('Kick', '1/16', 'x...............x.........x.....'),
      drawn('Snare', '1/16', '........x...............x.......'),
      drawn('Hat', '1/16', EIGHTHS_32),
      euclid('Shaker', '1/16', 32, 11, 3),
    ],
  },
  {
    id: 'factory:jungle-chop',
    name: 'Jungle Chop',
    note: 'Chopped rather than looped: kicks scattered, ghost snares filling every gap.',
    bpm: 172,
    channels: [
      drawn('Kick', '1/16', 'x.....x.........x...x..........x'),
      drawn('Snare', '1/16', '....x.....x...x.....x.....x...x.'),
      drawn('Hat', '1/16', EIGHTHS_32),
      euclid('Ride', '1/16', 32, 13, 5),
    ],
  },
  {
    id: 'factory:neurofunk',
    name: 'Neurofunk Tight',
    note: 'Almost nothing in the drums; the 32nd rim figure carries the movement.',
    bpm: 174,
    channels: [
      drawn('Kick', '1/16', 'x...............x...............'),
      drawn('Snare', '1/16', '........x...............x.......'),
      drawn('Hat', '1/16', '..x...x...x...x...x...x...x...x.'),
      euclid('Rim', '1/32', 32, 7, 11),
    ],
  },
  {
    id: 'factory:uk-garage',
    name: 'UK Garage 2-Step',
    note: 'Skippy hats, and a shaker on a dotted-16th grid so it never lands where you expect.',
    bpm: 132,
    channels: [
      drawn('Kick', '1/16', 'x.....x.x.......'),
      drawn('Snare', '1/16', BACKBEAT),
      drawn('Hat', '1/16', '..x.x.x...x.x.x.'),
      euclid('Shaker', '1/16.', 12, 7),
    ],
  },

  // ── Slow and half-time ────────────────────────────────────────────────────────
  {
    id: 'factory:trip-hop',
    name: 'Trip Hop',
    note: 'Bristol tempo — heavy and unhurried, with a triplet hat dragging behind the beat.',
    bpm: 88,
    channels: [
      drawn('Kick', '1/16', 'x.......x.......'),
      drawn('Snare', '1/16', BACKBEAT),
      drawn('Hat', '1/8T', 'x.xx.xx.xx.x'),
      euclid('Vinyl', '1/32', 24, 5, 7),
    ],
  },
  {
    id: 'factory:dub-halftime',
    name: 'Dub Halftime',
    note: 'Snare on 3 only, and an offbeat skank on quarter notes. Fast tempo, slow feel.',
    bpm: 140,
    channels: [
      drawn('Kick', '1/16', 'x.........x.....'),
      drawn('Snare', '1/16', '........x.......'),
      drawn('Hat', '1/16', OFFBEAT_8TH),
      drawn('Skank', '1/4', '.x.x'),
    ],
  },
  {
    id: 'factory:ambient-pulse',
    name: 'Ambient Pulse',
    note: 'Barely a rhythm. Three prime lengths on slow divisions drift for minutes before repeating.',
    bpm: 70,
    channels: [
      drawn('Pulse', '1/4', 'x...'),
      euclid('Bell', '1/2', 7, 3),
      euclid('Pad', '1/1', 5, 2),
      euclid('Click', '1/16', 13, 3, 6),
    ],
  },

  // ── Polymetric and IDM ────────────────────────────────────────────────────────
  {
    id: 'factory:idm-glitch',
    name: 'IDM Glitch',
    note: 'Four prime lengths and a dotted grid: nothing repeats until every cycle realigns.',
    bpm: 140,
    channels: [
      euclid('Kick', '1/16', 13, 5),
      euclid('Snare', '1/16', 11, 4, 3),
      euclid('Click', '1/32', 23, 9, 5),
      euclid('Noise', '1/16.', 7, 3, 1),
    ],
  },
  {
    id: 'factory:polymeter-5-7-11',
    name: 'Polymeter 5·7·11',
    note: 'One grid, four coprime lengths. The full cycle is 5×7×11×13 steps long.',
    bpm: 128,
    channels: [
      euclid('Kick', '1/16', 5, 2),
      euclid('Snare', '1/16', 7, 3),
      euclid('Hat', '1/16', 11, 5),
      euclid('Perc', '1/16', 13, 4),
    ],
  },
  {
    id: 'factory:drift',
    name: 'Drift',
    note: 'Every channel on a different division — straight, triplet, dotted and 32nd at once.',
    bpm: 118,
    channels: [
      euclid('Kick', '1/16', 16, 5),
      euclid('Rim', '1/8T', 9, 4, 2),
      euclid('Hat', '1/16.', 13, 6, 4),
      euclid('Blip', '1/32', 19, 7, 9),
    ],
  },
  {
    id: 'factory:braindance',
    name: 'Braindance',
    note: 'A stubborn kick under 32nd-note machinery that refuses to line up with it.',
    bpm: 150,
    channels: [
      drawn('Kick', '1/16', 'x..x....x..x....'),
      euclid('Snare', '1/32', 29, 11, 7),
      euclid('Hat', '1/32', 16, 11),
      euclid('Zap', '1/4T', 5, 2, 1),
    ],
  },
  {
    id: 'factory:odd-meter-78',
    name: 'Odd Meter 7/8',
    note: 'Fourteen sixteenths to the bar, with a seven-step perc cycling inside it.',
    bpm: 130,
    channels: [
      drawn('Kick', '1/16', 'x...x.....x...'),
      drawn('Snare', '1/16', '......x.......'),
      drawn('Hat', '1/16', 'x.x.x.x.x.x.x.'),
      euclid('Perc', '1/16', 7, 3),
    ],
  },
  // ── Percussion only ───────────────────────────────────────────────────────────
  //
  // No kick anywhere in this group, on purpose. A Rample is very often the percussion
  // voice next to a kick coming from somewhere else entirely, and a library where every
  // preset opens with a four-on-the-floor is useless for that. These are tops.
  {
    id: 'factory:perc-tops-909',
    name: 'Perc Tops 909',
    note: 'The house skeleton with the kick left out, for when it comes from another module.',
    bpm: 124,
    channels: [
      drawn('Rim', '1/16', '..x.....x.......'),
      drawn('Clap', '1/16', BACKBEAT),
      drawn('ClosedHat', '1/16', EIGHTHS),
      drawn('OpenHat', '1/16', OFFBEAT_8TH),
    ],
  },
  {
    id: 'factory:hat-engine',
    name: 'Hat Engine',
    note: 'Hats doing all the work: straight 16ths, offbeat opens, and a 32nd shaker across them.',
    bpm: 128,
    channels: [
      drawn('ClosedHat', '1/16', SIXTEENTHS),
      drawn('OpenHat', '1/16', OFFBEAT_8TH),
      euclid('Shaker', '1/32', 32, 11, 5),
      drawn('Tamb', '1/16', BACKBEAT),
    ],
  },
  {
    id: 'factory:tom-circle',
    name: 'Tom Circle',
    note: 'Rack and floor toms on different cycles, with congas in triplets across them.',
    bpm: 120,
    channels: [
      euclid('RackTom', '1/16', 16, 5),
      euclid('FloorTom', '1/16', 12, 3, 2),
      euclid('Conga', '1/8T', 9, 4),
      drawn('Shaker', '1/16', EIGHTHS),
    ],
  },
  {
    id: 'factory:shaker-web',
    name: 'Shaker Web',
    note: 'Four shakers on coprime cycles. No downbeat, no repeat — pure texture.',
    bpm: 122,
    channels: [
      euclid('ShakerA', '1/16', 7, 4),
      euclid('ShakerB', '1/16', 11, 6),
      euclid('Tamb', '1/16', 13, 5),
      euclid('Cabasa', '1/32', 17, 9),
    ],
  },
  {
    id: 'factory:ride-pattern',
    name: 'Ride Pattern',
    note: 'A ride carrying the pulse with the rim answering off it.',
    bpm: 130,
    channels: [
      drawn('Ride', '1/16', EIGHTHS),
      drawn('Rim', '1/16', OFFBEAT_8TH),
      drawn('Clap', '1/16', LAST_BEAT),
      euclid('Shaker', '1/16', 16, 6, 3),
    ],
  },
  {
    id: 'factory:clap-ladder',
    name: 'Clap Ladder',
    note: 'Four hand sounds offset against each other, so the backbeat arrives in layers.',
    bpm: 126,
    channels: [
      drawn('Clap', '1/16', BACKBEAT),
      drawn('Snap', '1/16', '.....x.......x..'),
      drawn('Rim', '1/16', '..x.......x.....'),
      euclid('Tamb', '1/16', 16, 7, 1),
    ],
  },
  {
    id: 'factory:metal-bowls',
    name: 'Metal & Bowls',
    note: 'Struck metal — bowls, glass, chimes — on divisions that refuse to line up.',
    bpm: 118,
    channels: [
      euclid('Bowl', '1/8', 8, 3),
      euclid('Glass', '1/16', 11, 4, 3),
      euclid('Chime', '1/8T', 12, 5),
      euclid('Rim', '1/16', 16, 6),
    ],
  },
  {
    id: 'factory:cowbell-drive',
    name: 'Cowbell Drive',
    note: 'Cowbell on eighths under a clave, the way an 808 latin pattern is built.',
    bpm: 132,
    channels: [
      drawn('Cowbell', '1/16', EIGHTHS),
      drawn('Clave', '1/16', 'x..x..x...x.x...'),
      drawn('Woodblock', '1/16', '..x..x....x..x..'),
      drawn('Shaker', '1/16', SIXTEENTHS),
    ],
  },
  {
    id: 'factory:conga-roll',
    name: 'Conga Roll',
    note: 'Two congas in 16th triplets with a swung shaker over them.',
    bpm: 126,
    channels: [
      drawn('CongaHi', '1/16T', 'x..x..x..x..x..x..x..x..'),
      drawn('CongaLo', '1/16T', '...x.....x.....x.....x..'),
      drawn('Shaker', '1/8T', 'x.xx.xx.xx.x'),
      euclid('Rim', '1/16', 16, 5, 2),
    ],
  },
  {
    id: 'factory:ghost-snares',
    name: 'Ghost Snares',
    note: 'Drum and bass tops: the snare work only, for layering under an external kick.',
    bpm: 172,
    channels: [
      drawn('Snare', '1/16', '....x..x..x...x.....x..x..x...x.'),
      euclid('Ghost', '1/32', 32, 13, 7),
      drawn('Hat', '1/16', EIGHTHS_32),
      euclid('Ride', '1/16', 32, 9, 4),
    ],
  },
  {
    id: 'factory:rim-and-click',
    name: 'Rim & Click',
    note: 'Almost nothing, spread over four cycle lengths. A minimal top that keeps moving.',
    bpm: 140,
    channels: [
      euclid('Rim', '1/16', 16, 3, 5),
      euclid('Click', '1/32', 29, 7, 11),
      euclid('Tick', '1/16', 7, 2),
      euclid('Noise', '1/4', 5, 2),
    ],
  },
  {
    id: 'factory:tamb-swing',
    name: 'Tambourine Swing',
    note: 'A triplet tambourine against straight rim and shaker — swing from disagreement.',
    bpm: 121,
    channels: [
      drawn('Tamb', '1/8T', 'x.xx.xx.xx.x'),
      drawn('Rim', '1/16', BACKBEAT),
      drawn('Shaker', '1/16', EIGHTHS),
      drawn('Clap', '1/16', LAST_BEAT),
    ],
  },

  // ── Melodic, bass and chordal ─────────────────────────────────────────────────
  //
  // The factory card carries bass, pads, leads, kalimba, bells and glass as well as drums,
  // and none of it wants a drum pattern. These are for pitched material: sparser, slower
  // divisions, and in several cases no percussion at all.
  {
    id: 'factory:bass-pulse',
    name: 'Bass Pulse',
    note: 'A sub on the halves with the bass answering offbeat — a bassline, not a drum part.',
    bpm: 124,
    channels: [
      drawn('Sub', '1/4', 'x.x.'),
      drawn('Bass', '1/8', '.x.x.x.x'),
      drawn('Stab', '1/16', '..x..x....x.....'),
      euclid('Rim', '1/16', 16, 5, 3),
    ],
  },
  {
    id: 'factory:kalimba-loop',
    name: 'Kalimba Loop',
    note: 'Plucked melodic layers on prime cycles, so the phrase reshuffles every pass.',
    bpm: 100,
    channels: [
      euclid('Kalimba', '1/16', 13, 7),
      euclid('Bass', '1/8', 7, 3),
      euclid('Shaker', '1/16', 16, 9),
      euclid('Bell', '1/4', 5, 2),
    ],
  },
  {
    id: 'factory:chord-stab',
    name: 'Chord Stab',
    note: 'Offbeat chords with a stab drifting late — the house middle, with no kick under it.',
    bpm: 122,
    channels: [
      drawn('Chord', '1/8', '.x.x.x.x'),
      drawn('Stab', '1/16', '..x.....x.....x.'),
      drawn('Rim', '1/16', EIGHTHS),
      drawn('Clap', '1/16', BACKBEAT),
    ],
  },
  {
    id: 'factory:arp-ladder',
    name: 'Arp Ladder',
    note: 'A dense 16th arp over a walking bass, for pitched multisamples across a voice.',
    bpm: 138,
    channels: [
      euclid('Arp', '1/16', 16, 11),
      drawn('Bass', '1/8', 'x.x.x.x.'),
      euclid('Perc', '1/16', 13, 5, 4),
      drawn('Clap', '1/16', BACKBEAT),
    ],
  },
  {
    id: 'factory:pad-drift',
    name: 'Pad Drift',
    note: 'One pad per bar, a bell every few, and a click far underneath. Barely a rhythm.',
    bpm: 92,
    channels: [
      drawn('Pad', '1/1', 'x'),
      euclid('Bell', '1/2', 5, 2),
      euclid('Texture', '1/4', 7, 3),
      euclid('Click', '1/16', 11, 4, 6),
    ],
  },
  {
    id: 'factory:bell-cascade',
    name: 'Bell Cascade',
    note: 'Bells and glass on dotted and straight grids at once, falling through each other.',
    bpm: 110,
    channels: [
      euclid('Bell', '1/16.', 11, 5),
      euclid('Glass', '1/8', 7, 3, 2),
      euclid('Chime', '1/16', 13, 6, 4),
      euclid('Shaker', '1/32', 19, 8),
    ],
  },
  {
    id: 'factory:lead-riff',
    name: 'Lead Riff',
    note: 'A hand-written lead figure with the bass on the downbeats only.',
    bpm: 130,
    channels: [
      drawn('Lead', '1/16', 'x..x.x..x...x.x.'),
      drawn('Bass', '1/16', 'x.......x.......'),
      drawn('Hat', '1/16', OFFBEAT_8TH),
      euclid('Perc', '1/16', 16, 6, 5),
    ],
  },
  {
    id: 'factory:sub-dub',
    name: 'Sub Dub',
    note: 'Half-time dub weight: a late sub, an offbeat skank, and noise drifting behind.',
    bpm: 140,
    channels: [
      drawn('Sub', '1/16', 'x.........x.....'),
      drawn('Skank', '1/4', '.x.x'),
      drawn('Rim', '1/16', '........x.......'),
      euclid('Noise', '1/32', 24, 5, 9),
    ],
  },

  // ── Vocal chops ───────────────────────────────────────────────────────────────
  {
    id: 'factory:vox-chop',
    name: 'Vox Chop',
    note: 'A voice spread across a whole layer stack, chopped at 16ths in random order.',
    bpm: 128,
    channels: [
      euclid('Vox', '1/16', 16, 9, 2),
      drawn('Sub', '1/16', 'x.......x.......'),
      drawn('Clap', '1/16', BACKBEAT),
      euclid('Perc', '1/16', 13, 5),
    ],
  },
  {
    id: 'factory:vox-stutter',
    name: 'Vox Stutter',
    note: '32nd vocal bursts against triplet claps, in footwork territory.',
    bpm: 160,
    channels: [
      euclid('Vox', '1/32', 24, 13),
      euclid('Chop', '1/32', 17, 7, 5),
      drawn('Clap', '1/8T', 'x..x..x..x..'),
      drawn('Sub', '1/16', 'x.....x...x.....'),
    ],
  },
  {
    id: 'factory:garage-vox',
    name: 'Garage Vox',
    note: 'Chopped vocal over skippy two-step hats, the UK garage way.',
    bpm: 132,
    channels: [
      drawn('Vox', '1/16', '..x.x.....x.x...'),
      drawn('Hat', '1/16', '..x.x.x...x.x.x.'),
      drawn('Rim', '1/16', BACKBEAT),
      drawn('Sub', '1/16', 'x.....x.x.......'),
    ],
  },

  // ── Breaks and glitch, tops only ──────────────────────────────────────────────
  {
    id: 'factory:amen-tops',
    name: 'Amen Tops',
    note: 'The Amen shape with its kick removed, so it can sit over one of your own.',
    bpm: 170,
    channels: [
      drawn('Snare', '1/16', '....x.....x...x.....x.....x..x..'),
      drawn('Hat', '1/16', EIGHTHS_32),
      drawn('Ride', '1/16', '................x...............'),
      euclid('Ghost', '1/32', 32, 9, 3),
    ],
  },
  {
    id: 'factory:jungle-tops',
    name: 'Jungle Tops',
    note: 'Jungle snare and ride work on its own, for layering under an external kick.',
    bpm: 172,
    channels: [
      drawn('Snare', '1/16', '....x.....x...x.....x.....x...x.'),
      drawn('Hat', '1/16', EIGHTHS_32),
      euclid('Ride', '1/16', 32, 13, 5),
      euclid('Shaker', '1/32', 32, 17, 11),
    ],
  },
  {
    id: 'factory:break-chop',
    name: 'Break Chop',
    note: 'A chopped two-bar break with the kick left out and the rim carrying 32nds.',
    bpm: 174,
    channels: [
      drawn('Snare', '1/16', '....x..x....x.x.....x..x....x.x.'),
      drawn('Hat', '1/16', OFFBEAT_8TH_32),
      euclid('Ride', '1/16', 32, 11, 6),
      euclid('Rim', '1/32', 32, 15, 9),
    ],
  },
  {
    id: 'factory:glitch-rim',
    name: 'Glitch Rim',
    note: '64th rim bursts under prime-length clicks. Machine detail rather than a groove.',
    bpm: 150,
    channels: [
      euclid('Rim', '1/64', 32, 11, 5),
      euclid('Click', '1/32', 23, 9),
      euclid('Snare', '1/16', 11, 3, 4),
      euclid('Noise', '1/16.', 9, 4, 2),
    ],
  },
  {
    id: 'factory:stutter-edit',
    name: 'Stutter Edit',
    note: 'Very short cycles at very fast divisions — everything realigns every few beats.',
    bpm: 145,
    channels: [
      euclid('Chop', '1/32', 5, 3),
      euclid('Click', '1/64', 7, 4),
      euclid('Rim', '1/16', 3, 1),
      euclid('Zap', '1/8T', 5, 2, 1),
    ],
  },
  {
    id: 'factory:laser-fx',
    name: 'Laser FX',
    note: 'For a voice full of one-shot effects: sparse, wide apart, never the same twice.',
    bpm: 136,
    channels: [
      euclid('Laser', '1/16', 13, 4, 7),
      euclid('Zap', '1/32', 19, 6),
      euclid('Sweep', '1/2', 5, 2),
      euclid('Noise', '1/8.', 11, 5, 3),
    ],
  },

  // ── More evolving grids ───────────────────────────────────────────────────────
  {
    id: 'factory:prime-drift',
    name: 'Prime Drift 7·11·13',
    note: 'Four primes on one grid. Nothing repeats until every cycle realigns at once.',
    bpm: 124,
    channels: [
      euclid('PercA', '1/16', 7, 3),
      euclid('PercB', '1/16', 11, 4),
      euclid('PercC', '1/16', 13, 5),
      euclid('PercD', '1/16', 17, 6),
    ],
  },
  {
    id: 'factory:triplet-grid',
    name: 'Triplet Grid',
    note: 'Every channel on a triplet division, each on a different cycle length.',
    bpm: 130,
    channels: [
      euclid('Conga', '1/4T', 6, 2),
      euclid('Shaker', '1/8T', 9, 4),
      euclid('Rim', '1/16T', 13, 6),
      euclid('Bell', '1/8T', 7, 3, 2),
    ],
  },
  {
    id: 'factory:dotted-web',
    name: 'Dotted Web',
    note: 'All four on dotted grids, which puts every channel permanently off the others.',
    bpm: 118,
    channels: [
      euclid('Rim', '1/4.', 5, 2),
      euclid('Shaker', '1/8.', 9, 4),
      euclid('Click', '1/16.', 13, 6),
      euclid('Bell', '1/16.', 7, 3, 1),
    ],
  },
  {
    id: 'factory:slow-phase',
    name: 'Slow Phase',
    note: 'Whole notes to triplet eighths on prime cycles. Minutes before it comes round.',
    bpm: 80,
    channels: [
      euclid('Pad', '1/1', 3, 1),
      euclid('Bell', '1/2', 5, 2),
      euclid('Rim', '1/4.', 7, 3),
      euclid('Click', '1/8T', 11, 5),
    ],
  },
  {
    id: 'factory:techno-rumble',
    name: 'Techno Rumble',
    note: 'Peak-time techno with the kick taken out, leaving the rumble and the hats.',
    bpm: 138,
    channels: [
      euclid('Rumble', '1/16', 16, 7, 2),
      drawn('OpenHat', '1/16', OFFBEAT_8TH),
      drawn('Clap', '1/16', LAST_BEAT),
      euclid('Perc', '1/16', 11, 5, 3),
    ],
  },
]

/**
 * Factory entries are `SavedPreset`s like any other, so every code path that loads,
 * previews or compares a preset treats both banks identically.
 *
 * `savedAt` is fixed rather than "now": these were not saved by the user at any point, and
 * a moving timestamp would make them look freshly edited on every reload.
 */
const FACTORY_SAVED_AT = '2026-01-01T00:00:00.000Z'

export const FACTORY_PRESETS: readonly SavedPreset[] = SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  note: spec.note,
  savedAt: FACTORY_SAVED_AT,
  bpm: clampBpm(spec.bpm),
  channels: Array.from({ length: VOICE_COUNT }, (_, i) => spec.channels[i]!.sequence),
  channelNames: Array.from({ length: VOICE_COUNT }, (_, i) => spec.channels[i]!.name),
}))

export function findFactoryPreset(id: string): SavedPreset | undefined {
  return FACTORY_PRESETS.find((p) => p.id === id)
}
