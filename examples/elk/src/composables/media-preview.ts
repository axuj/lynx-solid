import type { mastodon } from 'masto'
import { createSignal } from 'solid-js'

export const [mediaPreview, setMediaPreview] = createSignal<mastodon.v1.MediaAttachment | null>(null)

export function openMediaPreview(attachment: mastodon.v1.MediaAttachment) {
  setMediaPreview(attachment)
}

export function closeMediaPreview() {
  setMediaPreview(null)
}
