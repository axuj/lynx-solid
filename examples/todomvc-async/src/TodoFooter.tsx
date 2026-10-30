import type { TodoFilter } from './TodoApp'

import { Show } from 'solid-js'

interface TodoFooterProps {
  activeCount: number
  completedCount: number
  currentFilter: TodoFilter
  onSetFilter: (filter: TodoFilter) => void
  onClearCompleted: () => void
}

export function TodoFooter(props: TodoFooterProps) {
  return (
    <view class="footer">
      <view class="todo-count">
        <text class="todo-count-strong">{props.activeCount}</text>
        <text class="todo-count-label">
          {' '}
          {props.activeCount === 1 ? 'item' : 'items'}
          {' '}
          left
        </text>
      </view>

      <view class="filters">
        <text
          class={props.currentFilter === 'all' ? 'filter-btn selected' : 'filter-btn'}
          bindtap={() => props.onSetFilter('all')}
        >
          All
        </text>
        <text
          class={props.currentFilter === 'active' ? 'filter-btn selected' : 'filter-btn'}
          bindtap={() => props.onSetFilter('active')}
        >
          Active
        </text>
        <text
          class={props.currentFilter === 'completed' ? 'filter-btn selected' : 'filter-btn'}
          bindtap={() => props.onSetFilter('completed')}
        >
          Completed
        </text>
      </view>

      <Show when={props.completedCount > 0}>
        <text
          class="clear-completed"
          bindtap={props.onClearCompleted}
        >
          Clear completed
        </text>
      </Show>
    </view>
  )
}
