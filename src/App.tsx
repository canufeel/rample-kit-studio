import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { pointerWithin, rectIntersection } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { useEffect, useMemo, useRef, useState } from 'react'
import { contextSampleRate } from '~/audio/context'
import { onVoiceActivity, triggerNow } from '~/audio/player'
import { isRunning, startTransport, stopTransport } from '~/audio/scheduler'
import { DEVICE_SAMPLE_RATE, MAX_LAYERS_PER_VOICE, VOICE_COUNT } from '~/domain/device'
import type { VoiceIndex } from '~/domain/device'
import { channelInSlot, channelsInSlotOrder, findVoice } from '~/domain/voice'
import { hasSavedSession } from '~/storage/sessionStore'
import { useActiveKit, useSession } from '~/store/useSession'
import { ExportDialog } from './components/ExportDialog'
import { AnalysisMeter } from './components/AnalysisMeter'
import { Library } from './components/Library'
import { Notices } from './components/Notices'
import { StorageMeter } from './components/StorageMeter'
import { Sequencer } from './components/Sequencer'
import { Toolbar } from './components/Toolbar'
import { Transport } from './components/Transport'
import { VoicePanel } from './components/VoicePanel'
import { Button } from './components/ui/Controls'
import styles from './App.module.css'

/** Payload dnd-kit attaches to a draggable, discriminated by `type`. */
type DragData =
  | { type: 'layer'; voice: VoiceIndex; index: number }
  | { type: 'voice-panel'; voice: VoiceIndex }
  | { type: 'voice-container'; voice: VoiceIndex }

/**
 * Three kinds of drop target overlap in this layout — sample rows, the whole-voice
 * container behind them, and the voice panels themselves — so plain `closestCenter`
 * misbehaves: the container's centre sits near the middle of its own list and wins
 * against the rows it contains, making reordering unreliable in exactly the middle of
 * a voice.
 *
 * Filtering candidates by what is being dragged fixes it. A layer prefers other layers
 * and only falls back to a container when it isn't over any row (which is how you drop
 * into an empty voice); a panel only ever considers other panels.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  const candidates = pointer.length > 0 ? pointer : rectIntersection(args)

  const typeOf = (id: string | number) =>
    (args.droppableContainers.find((c) => c.id === id)?.data.current as DragData | undefined)?.type

  const dragged = (args.active.data.current as DragData | undefined)?.type

  if (dragged === 'voice-panel') {
    return candidates.filter((c) => typeOf(c.id) === 'voice-panel')
  }

  const rows = candidates.filter((c) => typeOf(c.id) === 'layer')
  if (rows.length > 0) return rows
  return candidates.filter((c) => typeOf(c.id) === 'voice-container')
}

export default function App() {
  const kit = useActiveKit()
  const moveSample = useSession((s) => s.moveSample)
  const setVoiceOrder = useSession((s) => s.setVoiceOrder)
  const restore = useSession((s) => s.restore)
  const notify = useSession((s) => s.notify)

  const [exporting, setExporting] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [offerRestore, setOfferRestore] = useState(false)
  const [previewRate, setPreviewRate] = useState<number | null>(null)

  const slotOrder = useMemo(() => channelsInSlotOrder(kit), [kit])

  // The keyboard listener is registered once, so it reads the kit through a ref rather
  // than closing over a stale one.
  const kitRef = useRef(kit)
  kitRef.current = kit

  useEffect(() => {
    setOfferRestore(hasSavedSession())
  }, [])

  // The audio context only exists once something has been auditioned, so read its rate
  // when playback first happens rather than guessing at load.
  useEffect(() => onVoiceActivity(() => setPreviewRate(contextSampleRate())), [])

  // Keyboard triggering. Digits 1-4 map to SP1-SP4 and space runs the transport.
  //
  // The "press A" convention comes from a tool that auditions one voice at a time; with four
  // voices addressable at once, keys that match the voice numbers on the panels are less
  // ambiguous than one key whose target depends on focus.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // Never steal keys from the kit-code field, BPM box or step-length inputs.
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        if (isRunning()) stopTransport()
        else void startTransport()
        return
      }

      const slot = Number(event.key)
      if (slot >= 1 && slot <= VOICE_COUNT) {
        event.preventDefault()
        // Keyed by slot, not channel identity: the digits match the SP labels printed on
        // the panels, which stay put while channels move between them.
        const target = channelInSlot(kitRef.current, slot as VoiceIndex)
        if (target) void triggerNow(target.index)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sensors = useSensors(
    // A small threshold so clicking the play or convert button inside a draggable row
    // isn't swallowed as the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragStart(event: DragStartEvent) {
    setDragging(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null)
    const { active, over } = event
    if (!over) return

    const from = active.data.current as DragData | undefined
    const to = over.data.current as DragData | undefined
    if (!from) return

    if (from.type === 'voice-panel') {
      if (to?.type !== 'voice-panel' || from.voice === to.voice) return
      const oldIndex = kit.voiceOrder.indexOf(from.voice)
      const newIndex = kit.voiceOrder.indexOf(to.voice)
      if (oldIndex === -1 || newIndex === -1) return
      setVoiceOrder(arrayMove(kit.voiceOrder, oldIndex, newIndex))
      return
    }

    if (from.type !== 'layer' || !to) return

    if (to.type === 'layer') {
      if (from.voice === to.voice && from.index === to.index) return
      moveSample({ voice: from.voice, index: from.index }, { voice: to.voice, index: to.index })
      return
    }

    if (to.type === 'voice-container') {
      // Dropped on empty space in a voice — append. moveLayer clamps the index.
      const target = findVoice(kit, to.voice)
      moveSample(
        { voice: from.voice, index: from.index },
        { voice: to.voice, index: target?.layers.length ?? 0 },
      )
    }
  }

  // `dragging` is a *slot* id now, not a sample id — two slots can hold the same sample, so
  // the overlay has to go through the slot to find out what it is showing.
  const draggedSample = dragging
    ? kit.samples[
        kit.voices.flatMap((v) => v.layers).find((slot) => slot.id === dragging)?.sampleId ?? ''
      ]
    : undefined

  return (
    <div className={styles.app}>
      <Toolbar onExport={() => setExporting(true)} />

      <main className={styles.main}>
        {offerRestore && (
          <div className={styles.restoreBanner}>
            <span>A saved session is available in this browser.</span>
            <span className={styles.bannerSpacer} />
            <Button
              variant="accent"
              small
              onClick={() => {
                if (restore()) {
                  notify('success', 'Session restored.')
                } else {
                  notify('error', 'The saved session could not be read.')
                }
                setOfferRestore(false)
              }}
            >
              Restore
            </Button>
            <Button variant="ghost" small onClick={() => setOfferRestore(false)}>
              Dismiss
            </Button>
          </div>
        )}

        {/* Transport, sequencer and library sit above the channels: a channel panel grows
            with every sample added to it, and anything below four full panels ends up
            pushed off the bottom of the page. */}
        <div className={styles.previewStack}>
          <Transport />
          <Sequencer />
          <Library />
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <SortableContext
            items={kit.voiceOrder.map((index) => `voice-${index}`)}
            strategy={horizontalListSortingStrategy}
          >
            <div className={styles.voices}>
              {slotOrder.map((voice, position) => (
                <VoicePanel
                  key={voice.index}
                  kit={kit}
                  voice={voice}
                  slot={(position + 1) as VoiceIndex}
                />
              ))}
            </div>
          </SortableContext>

          <DragOverlay>
            {draggedSample && <div className={styles.dragPreview}>{draggedSample.name}</div>}
          </DragOverlay>
        </DndContext>
      </main>

      <footer className={styles.footer}>
        <span className={styles.footerNote}>
          Kit folder <strong>{kit.code}</strong> · {MAX_LAYERS_PER_VOICE} layers per voice ·{' '}
          {DEVICE_SAMPLE_RATE} Hz
          <span className={styles.dot} />
          <StorageMeter />
          <AnalysisMeter />
          {previewRate !== null && previewRate !== DEVICE_SAMPLE_RATE && (
            <>
              <span className={styles.dot} />
              <span title={`This browser would not run its audio engine at ${DEVICE_SAMPLE_RATE} Hz — preview runs at ${previewRate} Hz and is resampled. Exported files are unaffected.`}>
                preview resampled
              </span>
            </>
          )}
        </span>
        <span className={styles.footerNote}>
          Everything stays on your machine — no uploads
          <span className={styles.dot} />
          By Petr Kosikhin
          <span className={styles.dot} />
          Unofficial community project, not affiliated with Squarp Instruments
        </span>
      </footer>

      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      <Notices />
    </div>
  )
}
