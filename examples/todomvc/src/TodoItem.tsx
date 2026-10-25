import type { Todo } from './TodoApp'

import { Show } from 'solid-js'

interface TodoItemProps {
  todo: Todo
  editing: boolean
  editText: string
  onToggle: (todo: Todo) => void
  onDelete: (todo: Todo) => void
  onStartEdit: (todo: Todo) => void
  onUpdateEdit: (value: string) => void
  onDoneEdit: (todo: Todo) => void
}

export function TodoItem(props: TodoItemProps) {
  function onEditInput(e: { detail?: { value?: string } }): void {
    props.onUpdateEdit(e?.detail?.value ?? '')
  }

  function onDoneEdit(e?: { detail?: { value?: string } }): void {
    if (e) {
      props.onUpdateEdit(e?.detail?.value ?? '')
    }
    props.onDoneEdit(props.todo)
  }

  return (
    <view class={`todo-item${props.todo.completed ? ' completed' : ''}${props.editing ? ' editing' : ''}`}>
      {/* Normal view */}
      <Show
        when={!props.editing}
        fallback={(
          <view class="edit-container">
            <input
              class="edit-input"
              type="text"
              value={props.editText}
              bindinput={onEditInput}
              bindconfirm={onDoneEdit}
              bindblur={onDoneEdit}
            />
          </view>
        )}
      >
        <view class="todo-view">
          <view class="todo-toggle" bindtap={() => props.onToggle(props.todo)}>
            <Show when={props.todo.completed}>
              <text class="todo-toggle-icon">✓</text>
            </Show>
          </view>
          <view class="todo-label-hitbox" bindtap={() => props.onStartEdit(props.todo)}>
            <text class="todo-label">{props.todo.title}</text>
          </view>
          <text class="destroy" bindtap={() => props.onDelete(props.todo)}>✕</text>
        </view>
      </Show>
    </view>
  )
}
