import type { PreviewMode, SampleId } from './types'

/**
 * Which layer a trigger plays.
 *
 * On the device a trigger picks one of a voice's up-to-12 layers, and the mode decides
 * how. Reproducing the same choice here is what makes preview representative rather than
 * merely audible — a kit that relies on random layer variation sounds completely
 * different if preview always plays layer 1.
 */

export interface LayerChoice {
  id: SampleId
  index: number
  /** Cursor to carry into the next trigger on this voice. */
  nextCursor: number
}

export type Rng = () => number

export function selectLayer(
  layers: readonly SampleId[],
  mode: PreviewMode,
  cursor: number,
  rng: Rng = Math.random,
): LayerChoice | null {
  if (layers.length === 0) return null

  switch (mode) {
    case 'random': {
      // Genuinely uniform, including the chance of repeating the previous layer. The
      // device's random mode can repeat, and suppressing that would make preview sound
      // more varied than the hardware actually is.
      const index = Math.min(layers.length - 1, Math.floor(rng() * layers.length))
      return { id: layers[index]!, index, nextCursor: cursor }
    }

    case 'cyclic': {
      const index = ((cursor % layers.length) + layers.length) % layers.length
      return { id: layers[index]!, index, nextCursor: index + 1 }
    }

    case 'manual': {
      // Holds position: manual means "this layer", so repeated triggers repeat it.
      const index = Math.max(0, Math.min(cursor, layers.length - 1))
      return { id: layers[index]!, index, nextCursor: index }
    }
  }
}
