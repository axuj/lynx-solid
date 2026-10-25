/**
 * Main Thread ops executor: translates the BG thread's flat ops array into
 * Lynx PAPI calls. It knows nothing about Solid — just the ops dictionary
 * (internal/ops.ts), the PAPI dictionary (internal/papi.d.ts) and the appliers
 * (op-appliers.ts), which are shared with the MT-IFR direct sink.
 *
 * This module owns what is specific to a *wire batch*: the duplicate-batch
 * guard, the flat-array walk, the pass-scoped `fresh` set, per-op isolation
 * and the flush.
 */

import type { FreshIds } from './op-appliers'
import { errorMessage } from '../internal/error'
import { OP, OP_ARITY } from '../internal/ops'
import { elements, resetMainThreadState } from './element-registry'
import { flushListUpdates, resetListState } from './list-apply'
import {
  applyCreate,
  applyCreateText,
  applyInsert,
  applyInstantiate,
  applyRelease,
  applyRemove,
  applyRemoveEvent,
  applySetClass,
  applySetEvent,
  applySetId,
  applySetProp,
  applySetStyle,
  applySetText,
  applyWorkletEvent,

  resetOpAppliers,
} from './op-appliers'
import { resetSkeletonState } from './skeleton-registry'
import { applyInitMtRef, applySetMtRef, applyUnbindMtRef } from './worklet-apply'

/**
 * Apply one flat ops batch. `flush` presents the frame at the end; renderPage
 * reuses this path synchronously without flushing per batch.
 */
export function applyOps(ops: unknown[], flush = true): void {
  const len = ops.length
  if (len === 0)
    return

  // Duplicate-batch guard: a double-evaluated BG bundle resets ShadowElement
  // ids and replays the very same batch. If the first CREATE/CREATE_TEXT/
  // INSTANTIATE targets an id we already own, this is a replay — skip it.
  // The batch head changes from CREATE to INSTANTIATE when element templates
  // are enabled, so both heads are covered here.
  if (len >= 2) {
    const head = ops[0] as number
    let firstId: number | undefined
    if (head === OP.CREATE && len >= 3)
      firstId = ops[1] as number
    else if (head === OP.CREATE_TEXT)
      firstId = ops[1] as number
    else if (head === OP.INSTANTIATE && len >= 4)
      firstId = ops[3] as number
    if (firstId !== undefined && elements[firstId] !== undefined) {
      // Worth seeing: this is a safety net, not the designed path. If it fires
      // while IFR is on, the reconcile hook did NOT consume the batch.
      return
    }
  }

  // Ids created by THIS batch — see FreshIds.
  const fresh: FreshIds = new Set<number>()

  let cursor = 0
  while (cursor < len) {
    const code = ops[cursor] as number
    const arity = (OP_ARITY as Record<number, number>)[code]
    if (arity === undefined)
      break

    try {
      switch (code) {
        case OP.CREATE:
          applyCreate(
            ops[cursor + 1] as number,
            ops[cursor + 2] as string,
            fresh,
          )
          break

        case OP.CREATE_TEXT:
          applyCreateText(ops[cursor + 1] as number, fresh)
          break

        case OP.INSERT:
          applyInsert(
            ops[cursor + 1] as number,
            ops[cursor + 2] as number,
            ops[cursor + 3] as number,
          )
          break

        case OP.REMOVE:
          applyRemove(ops[cursor + 1] as number, ops[cursor + 2] as number)
          break

        case OP.SET_PROP:
          applySetProp(
            ops[cursor + 1] as number,
            ops[cursor + 2] as string,
            ops[cursor + 3],
            fresh,
          )
          break

        case OP.SET_TEXT:
          applySetText(ops[cursor + 1] as number, ops[cursor + 2] as string)
          break

        case OP.SET_EVENT:
          applySetEvent(
            ops[cursor + 1] as number,
            ops[cursor + 2] as string,
            ops[cursor + 3] as string,
            ops[cursor + 4] as string,
          )
          break

        case OP.REMOVE_EVENT:
          applyRemoveEvent(
            ops[cursor + 1] as number,
            ops[cursor + 2] as string,
            ops[cursor + 3] as string,
          )
          break

        case OP.MT_SET_EVENT:
          applyWorkletEvent(
            ops[cursor + 1] as number,
            ops[cursor + 2] as string,
            ops[cursor + 3] as string,
            ops[cursor + 4] as Record<string, unknown> | null,
          )
          break

        case OP.INIT_MT_REF:
          applyInitMtRef(ops[cursor + 1] as number, ops[cursor + 2])
          break

        case OP.SET_MT_REF: {
          const id = ops[cursor + 1] as number
          const wvid = ops[cursor + 2] as number
          if (wvid >= 0)
            applySetMtRef(id, wvid)
          else applyUnbindMtRef(id)
          break
        }

        case OP.RELEASE:
          applyRelease(ops[cursor + 1] as number, ops[cursor + 2] as number)
          break

        case OP.SET_STYLE:
          applySetStyle(
            ops[cursor + 1] as number,
            ops[cursor + 2] as string | Record<string, unknown> | null,
          )
          break

        case OP.SET_CLASS:
          applySetClass(ops[cursor + 1] as number, ops[cursor + 2] as string)
          break

        case OP.SET_ID:
          applySetId(ops[cursor + 1] as number, ops[cursor + 2] as string | null)
          break

        case OP.INSTANTIATE:
          applyInstantiate(
            ops[cursor + 1] as number,
            ops[cursor + 2] as unknown[],
            ops[cursor + 3] as number,
            fresh,
          )
          break

        default:
          // Unknown op — skip (future compatibility).
          break
      }
    }
    catch (e) {
      // Per-op isolation: one failing frame must not abort the batch — a
      // throw here used to drop every later binding/ref op of the same
      // frame (sheet touch bindings died behind a layoutchange error).
      const message = errorMessage(e)
      console.log('[lynx-solid] op', code, 'failed:', message)
    }
    cursor += 1 + arity
  }

  flushListUpdates()

  if (flush) {
    __FlushElementTree()
  }
}

/** Reset module state – for testing only. */
export function resetApplyOpsState(): void {
  resetSkeletonState()
  resetListState()
  resetMainThreadState()
  resetOpAppliers()
}
