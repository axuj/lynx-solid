import { onSettled } from 'solid-js'

interface OpsLine {
  kind: string
  text: string
}

const CHANNEL = 'lynx-solid-ops'
const MAX_LINES = 200

export function OpsPanel() {
  let logBox: HTMLDivElement | undefined
  const lines: OpsLine[] = []
  let lineCount = 0

  const append = (kind: string, text: string) => {
    lines.push({ kind, text })
    if (lines.length > MAX_LINES)
      lines.shift()
    lineCount++
    if (!logBox)
      return
    const line = document.createElement('div')
    line.className = kind
    line.textContent = text
    logBox.appendChild(line)
    if (lineCount > MAX_LINES) {
      logBox.removeChild(logBox.firstChild!)
    }
    logBox.scrollTop = logBox.scrollHeight
  }

  onSettled(() => {
    const ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (e: MessageEvent) => {
      const msg = e.data ?? {}
      if (typeof msg.text === 'string') {
        // Batches arrive as one message with \n-separated frame lines.
        for (const line of msg.text.split('\n'))
          append(msg.kind === 'event' ? 'evt' : 'mt', line)
      }
    }
    return () => ch.close()
  })

  return (
    <div id="ops-panel">
      <div id="ops-head">
        ops · BG ↔ MT
        <button
          onClick={() => {
            if (logBox)
              logBox.textContent = ''
            lines.length = 0
            lineCount = 0
          }}
        >
          clear
        </button>
      </div>
      <div id="ops-log" ref={logBox} />
    </div>
  )
}
