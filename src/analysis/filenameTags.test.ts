import { describe, expect, test } from 'bun:test'
import { tagFilename, tokenise } from './filenameTags'

/**
 * Most of these names are verbatim from a factory Rample Turbo card — the corpus this
 * dictionary was built against. They are the regression suite that matters: the tagger is
 * only worth shipping if it survives the naming conventions real sample packs use.
 */

describe('tokenising', () => {
  test('splits on any non-alphanumeric run', () => {
    expect(tokenise('1 WS-Mode808-29 LT.wav')).toContain('lt')
  })

  test('a numbered abbreviation also yields its letters', () => {
    // The whole reason the tokeniser is not just a split: libraries number variants by
    // gluing the index on, and `sn75` matches nothing.
    expect(tokenise('2 WS Botlo SN75.wav')).toContain('sn')
  })

  test('digits are dropped rather than kept as their own token', () => {
    // `mode` is noise but harmless; a bare `8` from `mode808` would be worse.
    const tokens = tokenise('1 WS-Mode808-29 LT.wav')
    expect(tokens).toContain('mode')
    expect(tokens).not.toContain('8')
  })

  test('a digits-then-letters token is left alone', () => {
    expect(tokenise('1. 175bpm Break one 8.wav')).toContain('175bpm')
  })
})

describe('drums, from the real card', () => {
  const cases: [string, string][] = [
    ['1 WS-BlaDub-02 BD.wav', 'kick'],
    ['1 KICK 01.wav', 'kick'],
    ['2 MM_KICK_808_067.wav', 'kick'],
    ['1 BD lg 6.wav', 'kick'],
    ['2 WS Perkkit SN24.wav', 'snare'],
    ['2 WS-OldVerb-04 SN.wav', 'snare'],
    ['2 WS Botlo SN75.wav', 'snare'],
    ['3 WS-GritYAMDD10-32 CP.wav', 'clap'],
    ['3 CP thndr 2.wav', 'clap'],
    ['1 RACK TOM 11.wav', 'tom'],
    ['1 WS-Mode808-29 LT layer3.wav', 'tom'],
    ['3 MM TOM.wav', 'tom'],
    ['3 RIDE LOW 03.wav', 'cymbal'],
    ['2 Shake take4.wav', 'perc'],
    ['3. FX 1.wav', 'fx'],
    ['1. Long FX 7.wav', 'fx'],
    ['4. Texture 6.wav', 'fx'],
  ]

  for (const [name, type] of cases) {
    test(`${name} → ${type}`, () => {
      expect(tagFilename(name).type).toBe(type as never)
    })
  }
})

describe('declining to guess', () => {
  const silent = [
    '4 JUPI.wav',
    '2 WS-Hardtronik-03 layer2.wav',
    '4 ClouDist take4_1.wav',
    '3_H_KR_els_02.wav',
    '2 smallpanB take2.wav',
    '4Dreamcast03.wav',
  ]

  for (const name of silent) {
    test(`${name} stays unknown`, () => {
      const tags = tagFilename(name)
      expect(tags.type).toBe('unknown')
      expect(tags.confidence).toBe(0)
      expect(tags.evidence).toBeNull()
    })
  }

  test('pack and vendor prefixes never match', () => {
    // ws/kr/az/px/mm/lm are the most common tokens on the card and mean nothing.
    for (const noise of ['ws', 'kr', 'az', 'px', 'mm', 'lm']) {
      expect(tagFilename(`1 ${noise} 04.wav`).type).toBe('unknown')
    }
  })
})

describe('picking a winner', () => {
  test('a spelled-out word beats an abbreviation', () => {
    const tags = tagFilename('snare SN.wav')
    expect(tags.evidence).toBe('snare')
  })

  test('a specific instrument beats the category it sits inside', () => {
    // `3 PRC TM 8.wav` — PRC is the pack's category, TM is the actual drum.
    expect(tagFilename('3 PRC TM 8.wav').type).toBe('tom')
  })

  test('a tie goes to the later token, since names read pack-then-instrument', () => {
    expect(tagFilename('kick snare.wav').evidence).toBe('snare')
  })

  test('a competing family costs confidence', () => {
    // The winner is still the strongest token — "kick" outranks the abbreviation — but a
    // name naming two different instruments is less trustworthy than one naming a single
    // instrument, and the number says so.
    const clean = tagFilename('2 kick 01.wav')
    const mixed = tagFilename('2 kick SN.wav')
    expect(mixed.type).toBe('kick')
    expect(mixed.confidence).toBeLessThan(clean.confidence)
  })

  test('confidence never reaches zero when something did match', () => {
    // Zero is reserved for "nothing matched", so the UI can test it directly.
    expect(tagFilename('bar 303.wav').confidence).toBeGreaterThan(0)
  })
})

describe('modifiers', () => {
  test('open and closed are read for hats', () => {
    expect(tagFilename('2 OH 01.wav').openness).toBe('open')
    expect(tagFilename('closed hat 3.wav').openness).toBe('closed')
  })

  test('openness is dropped where it means nothing', () => {
    // An "open" pad is not a choked pad; reporting it would be noise.
    expect(tagFilename('open pad.wav').openness).toBeNull()
  })

  test('an abbreviation can imply its own register', () => {
    expect(tagFilename('1 WS-Mode808-29 LT.wav').register).toBe('low')
    expect(tagFilename('1 HT 02.wav').register).toBe('high')
  })

  test('an explicit register wins over the drum-kit position that precedes it', () => {
    expect(tagFilename('1 RACK TOM HI 02.wav').register).toBe('high')
  })
})

describe('tempo', () => {
  test('is read when spelled out', () => {
    expect(tagFilename('1. 175bpm Break one 8.wav').tempoBpm).toBe(175)
  })

  test('is read from a bare number in the musical range', () => {
    // How most libraries actually do it: `nn_drum_120_bay_kick.wav`.
    expect(tagFilename('nn_drum_120_bay_kick.wav').tempoBpm).toBe(120)
    expect(tagFilename('lft2_drum_loop_primedub_full_128.wav').tempoBpm).toBe(128)
  })

  test('drum machine names are not tempos', () => {
    // The reason a bare number is safe: every classic machine sits outside 60-200.
    for (const name of ['snare_one_shot_909.wav', 'kick 808 hard.wav', 'clap_626_mid.wav']) {
      expect(tagFilename(name).tempoBpm).toBeNull()
    }
    // And machines that would be inside it arrive glued to letters.
    expect(tagFilename('juno106 pad.wav').tempoBpm).toBeNull()
    expect(tagFilename('1 WS-Mode808-29 LT.wav').tempoBpm).toBeNull()
  })

  test('implausible tempos are rejected', () => {
    expect(tagFilename('kick 999bpm.wav').tempoBpm).toBeNull()
    expect(tagFilename('kick 10bpm.wav').tempoBpm).toBeNull()
  })
})

describe('form', () => {
  test('an explicit word decides it', () => {
    expect(tagFilename('lft2_drum_loop_backroom_hat_128.wav').form).toBe('loop')
    expect(tagFilename('MARS_VDM_kick_one_shot_909_drive.wav').form).toBe('oneShot')
    expect(tagFilename('1. 175bpm Break one 8.wav').form).toBe('loop')
  })

  test('a bare tempo implies a loop', () => {
    expect(tagFilename('nn_drum_120_water_full.wav').form).toBe('loop')
  })

  test('an explicit one-shot outranks a bare number', () => {
    // A pack that says one_shot and also carries a number is telling you the number is
    // not a tempo.
    expect(tagFilename('perc_one_shot_120_thing.wav').form).toBe('oneShot')
  })

  test('is null when the name says nothing either way', () => {
    expect(tagFilename('1 KICK 01.wav').form).toBeNull()
  })

  test('form is independent of type — a loop can also be a kick', () => {
    // The whole reason these are two axes: forced to pick one, the tagger answered "kick"
    // and scored as wrong against a loops/ folder.
    const tags = tagFilename('nn_drum_120_bay_kick.wav')
    expect(tags.type).toBe('kick')
    expect(tags.form).toBe('loop')
  })
})

describe('note', () => {
  test('is read when an octave is attached', () => {
    expect(tagFilename('Bass C2.wav').note).toBe('C2')
    expect(tagFilename('pad F#3 long.wav').note).toBe('F#3')
  })

  test('a bare letter is never a note', () => {
    // `4 PHa_D take1.wav` has a stray D that means nothing.
    expect(tagFilename('4 PHa_D take1.wav').note).toBeNull()
  })

  test('an accidental stands in for an octave', () => {
    // Real packs write `SO_PAWKO_PERC_ONE_SHOT_Knitting_Needle_D#.wav` with no octave.
    // Safe because nothing else in a filename looks like a letter followed by a sharp.
    expect(tagFilename('SO_PAWKO_PERC_ONE_SHOT_Moroccan_Tom_High_F#.wav').note).toBe('F#')
    expect(tagFilename('Knitting_Needle_D#.wav').note).toBe('D#')
  })

  test('a bare flat is not a note, since it is usually the tail of a word', () => {
    expect(tagFilename('perc_web_hit.wav').note).toBeNull()
  })

  test('a numbered variant is not a note', () => {
    // `Lanem_B07` would read as B0 without the boundary requirement.
    expect(tagFilename('2 WS Lanem_B07.wav').note).toBeNull()
  })
})

describe('variants', () => {
  test('takes and layers are distinguished', () => {
    expect(tagFilename('2 Shake take4.wav').variant).toEqual({ kind: 'take', n: 4 })
    expect(tagFilename('1 WS-Mode808-29 LT layer3.wav').variant).toEqual({
      kind: 'layer',
      n: 3,
    })
  })

  test('absent when the name has none', () => {
    expect(tagFilename('1 KICK 01.wav').variant).toBeNull()
  })
})

describe('naming conventions from a second library', () => {
  // These are verbatim from a user library the dictionary was not built against.
  const cases: [string, string][] = [
    ['MARS_VDM_closed_hat_one_shot_909_vari_squeak.wav', 'hat'],
    ['nn_ophat_tree.wav', 'hat'],
    ['PMRW_Open_Hat_Noisey.wav', 'hat'],
    ['MARS_VDM_rim_one_shot_CR78_metal.wav', 'rim'],
    ['004_Hi_Hat_-_NEON80S_Zenhiser.wav', 'hat'],
    ['SO_MP_djembe_hard_hit.wav', 'perc'],
    ['SO_MP_dun_dun_boom_ping_short_thwack.wav', 'perc'],
    ['SO_PAWKO_PERC_ONE_SHOT_Frame_Snare_01.wav', 'snare'],
    ['MARS_VDM_TOM_one_shot_CR78_bass.wav', 'tom'],
    ['nn_snare_spray.wav', 'snare'],
    ['ff_mt2_kick_one_shot_synthetic_saturated.wav', 'kick'],
  ]
  for (const [name, type] of cases) {
    test(`${name} → ${type}`, () => {
      expect(tagFilename(name).type).toBe(type as never)
    })
  }
})

describe('robustness', () => {
  test('an empty or extensionless name does not throw', () => {
    expect(tagFilename('').type).toBe('unknown')
    expect(tagFilename('kick').type).toBe('kick')
  })

  test('case and separators do not matter', () => {
    const expected = tagFilename('kick.wav').type
    for (const name of ['KICK.WAV', 'Kick.wav', 'my_KICK-01.wav', 'my.kick.wav']) {
      expect(tagFilename(name).type).toBe(expected)
    }
  })

  test('a non-latin name is unknown rather than an error', () => {
    expect(tagFilename('🥁.wav').type).toBe('unknown')
  })
})
