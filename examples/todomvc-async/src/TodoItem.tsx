import type { Todo } from './TodoApp'

import { Show } from 'solid-js'

import { runAction } from './run-action'

interface TodoItemProps {
  todo: Todo
  editing: boolean
  onToggle: (todo: Todo) => void
  onDelete: (todo: Todo) => void
  onStartEdit: (todo: Todo) => void
  onUpdateEdit: (todo: Todo, value: string) => void
  onDoneEdit: (todo: Todo, value?: string) => void
}

export function TodoItem(props: TodoItemProps) {
  function onEditInput(e: { detail?: { value?: string } }): void {
    props.onUpdateEdit(props.todo, e?.detail?.value ?? '')
  }

  function onDoneEdit(e?: { detail?: { value?: string } }): void {
    // The value travels with the event, the way the header's `onConfirm`
    // does. Reading it back out of the store would miss the last keystroke:
    // setters don't make writes visible until the next flush.
    runAction(props.onDoneEdit(props.todo, e?.detail?.value))
  }

  return (
    <view class={`todo-item${props.todo.completed ? ' completed' : ''}${props.editing ? ' editing' : ''}${props.todo.pending ? ' pending' : ''}`}>
      {/* Normal view */}
      <Show
        when={!props.editing}
        fallback={(
          <view class="edit-container">
            <input
              class="edit-input"
              type="text"
              value={props.todo.title}
              bindinput={onEditInput}
              bindconfirm={onDoneEdit}
              bindblur={onDoneEdit}
            />
          </view>
        )}
      >
        <view class="todo-view">
          <view class="todo-toggle" bindtap={() => runAction(props.onToggle(props.todo))}>
            <Show when={props.todo.completed}>
              <text class="todo-toggle-icon">✓</text>
            </Show>
          </view>
          <view class="todo-label-hitbox" bindtap={() => props.onStartEdit(props.todo)}>
            <text class="todo-label">{props.todo.title}</text>
          </view>
          <text class="destroy" bindtap={() => runAction(props.onDelete(props.todo))}>✕</text>

        </view>
      </Show>
    </view>
  )
}
