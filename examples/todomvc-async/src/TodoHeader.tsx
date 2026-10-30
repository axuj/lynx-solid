import { Show } from 'solid-js'

import { runAction } from './run-action'

interface TodoHeaderProps {
  allCompleted: boolean
  hasTodos: boolean
  newTodo: string
  onUpdateNewTodo: (value: string) => void
  onAddTodo: (title: string) => void
  onToggleAll: () => void
}

export function TodoHeader(props: TodoHeaderProps) {
  function onInput(e: { detail?: { value?: string } }): void {
    props.onUpdateNewTodo(e?.detail?.value ?? '')
  }

  function onConfirm(e: { detail?: { value?: string } }): void {
    const value = e?.detail?.value ?? ''
    props.onUpdateNewTodo(value)

    if (value.trim()) {
      // Takes the text from the event rather than reading it back out of the
      // store — that read would land before the write settled.
      runAction(props.onAddTodo(value))
    }
  }

  return (
    <view class="header">
      <text class="title">todos</text>
      <view class="new-todo-row">
        <Show
          when={props.hasTodos}
          fallback={<view class="header-toggle-all header-toggle-all-placeholder" />}
        >
          <view
            class="header-toggle-all"
            bindtap={() => runAction(props.onToggleAll())}
          >
            <text class={props.allCompleted ? 'header-toggle-all-icon checked' : 'header-toggle-all-icon'}>✓</text>
          </view>
        </Show>

        <input
          class="new-todo with-toggle"
          type="text"
          value={props.newTodo}
          placeholder="What needs to be done?"
          confirm-type="done"
          bindinput={onInput}
          bindconfirm={onConfirm}
        />
      </view>
    </view>
  )
}
