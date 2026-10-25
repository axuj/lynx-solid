import { Errored } from 'solid-js'
import { formatError, formatErrorOneLine } from '../composables/format-error'

function ErrorBody(props: { text: string, onRetry: () => void }) {
  return (
    <view class="timeline-loading">
      <text class="timeline-error-text">{props.text}</text>
      <view
        class="timeline-retry"
        bindtap={() => props.onRetry()}
      >
        <text class="timeline-retry-text">Retry</text>
      </view>
    </view>
  )
}

/**
 * Error boundary for non-list containers: a whole view.
 * The error is frozen when fallback fires; err() evaluates once here and
 * renders with the downstream plain value.
 */
export function ErrorRetry(props: {
  /** Log locator, e.g. page name */
  label?: string
  /** Extra data-layer reset (e.g. page.retry()); the boundary's own reset always runs */
  onRetry?: () => void
  children: any
}) {
  return (
    <Errored
      fallback={(err, retry) => {
        const e = formatError(err())
        console.error(`[elk:error] ${props.label ?? '(unlabeled)'}\n${e}`)
        return (
          <ErrorBody
            text={formatErrorOneLine(e)}
            onRetry={() => {
              props.onRetry?.()
              retry()
            }}
          />
        )
      }}
    >
      {props.children}
    </Errored>
  )
}

/** Error boundary for use inside lists: auto-wraps list-item */
export function ErrorRetryItem(props: {
  label?: string
  /** Extra data-layer reset (e.g. page.retry()); the boundary's own reset always runs */
  onRetry?: () => void
  estimatedMainAxisSizePx?: number
  children: any
}) {
  return (
    <Errored
      fallback={(err, retry) => {
        const e = formatError(err())
        console.error(`[elk:error] ${props.label ?? '(unlabeled)'}\n${e}`)
        return (
          <list-item item-key="__load_error" estimated-main-axis-size-px={props.estimatedMainAxisSizePx ?? 60}>
            <ErrorBody
              text={formatErrorOneLine(e)}
              onRetry={() => {
                props.onRetry?.()
                retry()
              }}
            />
          </list-item>
        )
      }}
    >
      {props.children}
    </Errored>
  )
}
