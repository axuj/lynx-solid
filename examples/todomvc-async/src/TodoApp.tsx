import { action, createMemo, createOptimisticStore, createSignal, For, Loading, refresh, Show } from 'solid-js'

import * as api from './api'
import { TodoFooter } from './TodoFooter'
import { TodoHeader } from './TodoHeader'
import { TodoItem } from './TodoItem'

export interface Todo {
  id: string
  title: string
  completed: boolean
  /** Only ever set on the optimistic copy — the source never returns it. */
  pending?: boolean
}

export type TodoFilter = 'all' | 'active' | 'completed'

const TODO_ROW_HEIGHT = 58
const VIEWPORT_RESERVED_HEIGHT = 320

let nextId = 0
function uuid(): string {
  return `todo-${++nextId}`
}

export function TodoApp() {
  // ── State ──────────────────────────────────────────────────
  // The only difference from the synchronous example: reads come from
  // `api.list()` and every write runs inside an `action`. The mutations still
  // write exactly what they wrote before — that write *is* the prediction.
  const [todos, setTodos] = createOptimisticStore<Todo[]>(() => api.list(), [])
  const [filter, setFilter] = createSignal<TodoFilter>('all')
  const [newTodo, setNewTodo] = createSignal('')
  // Only which row is being edited. The draft text itself lives in the
  // optimistic layer (`updateTodoTitle` writes `todos`), so there is exactly
  // one copy of the text — no local mirror to fall out of sync, and a rejected
  // rename rewinds the draft like any other failed mutation.
  const [editingId, setEditingId] = createSignal<string | null>(null)

  /** Keystrokes go straight to the optimistic layer, like every other write. */
  function updateTodoTitle(todo: Todo, value: string): void {
    const id = todo?.id
    if (!id)
      return

    setTodos((s) => {
      const found = s.find(t => !!t && t.id === id)
      if (found)
        found.title = value
    })
  }

  // ── Derived ────────────────────────────────────────────────
  const activeTodos = createMemo(() => todos.filter(t => !!t && !t.completed))
  const completedTodos = createMemo(() => todos.filter(t => !!t && t.completed))
  const filteredTodos = createMemo(() => {
    if (filter() === 'active')
      return activeTodos()
    if (filter() === 'completed')
      return completedTodos()
    return todos
  })

  const mainScrollHeight = createMemo(
    () => `${filteredTodos().length * TODO_ROW_HEIGHT}px`,
  )
  const mainScrollMaxHeight = `calc(100vh - ${VIEWPORT_RESERVED_HEIGHT}px)`

  const allCompleted = createMemo(
    () => todos.length > 0 && activeTodos().length === 0,
  )

  // ── Actions ────────────────────────────────────────────────
  // Each one: write the expected value, `yield` the request, then `refresh`.
  // If the request throws, the optimistic layer is dropped and the list falls
  // back to whatever the source says — no snapshot, no manual rollback.
  const addTodo = action(function* (title: string) {
    if (!title.trim())
      return

    const todo: Todo = { id: uuid(), title: title.trim(), completed: false, pending: true }
    setTodos((s) => {
      s.push(todo)
    })
    setNewTodo('')
    yield api.add(todo)
    refresh(todos)
  })

  const toggleTodo = action(function* (todo: Todo) {
    const id = todo?.id
    if (!id)
      return

    const completed = !todo.completed
    setTodos((s) => {
      const found = s.find(t => !!t && t.id === id)
      if (found)
        found.completed = completed
    })
    yield api.toggle(id, completed)
    refresh(todos)
  })

  const deleteTodo = action(function* (todo: Todo) {
    const id = todo?.id
    if (!id)
      return

    setTodos((s) => {
      const i = s.findIndex(t => !!t && t.id === id)
      if (i >= 0)
        s.splice(i, 1)
    })
    if (editingId() === id) {
      setEditingId(null)
    }
    yield api.remove(id)
    refresh(todos)
  })

  function startEdit(todo: Todo): void {
    if (!todo)
      return

    setEditingId(todo.id)
  }

  const doneEdit = action(function* (todo: Todo, value?: string) {
    const id = todo?.id
    if (!id || editingId() !== id) {
      return
    }

    setEditingId(null)

    // Takes the pending text straight from the event rather than reading it
    // back out of the store — that read would land before the last write.
    const title = (value ?? todo.title).trim()

    if (!title) {
      setTodos((s) => {
        const i = s.findIndex(t => !!t && t.id === id)
        if (i >= 0)
          s.splice(i, 1)
      })
      yield api.remove(id)
      refresh(todos)
      return
    }

    setTodos((s) => {
      const found = s.find(t => !!t && t.id === id)
      if (found)
        found.title = title
    })
    yield api.rename(id, title)
    refresh(todos)
  })

  const toggleAll = action(function* () {
    const newVal = !allCompleted()
    setTodos((s) => {
      for (const t of s) {
        if (t)
          t.completed = newVal
      }
    })
    yield api.toggleAll(newVal)
    refresh(todos)
  })

  const clearCompleted = action(function* () {
    setTodos((s) => {
      for (let i = s.length - 1; i >= 0; i--) {
        if (s[i]?.completed)
          s.splice(i, 1)
      }
    })
    yield api.clearCompleted()
    refresh(todos)
  })

  return (
    <view class="page">
      <view class="todoapp-shell">
        <Loading fallback={<TodoSkeleton />}>
          <view class="todoapp">
            <TodoHeader
              allCompleted={allCompleted()}
              hasTodos={todos.length > 0}
              newTodo={newTodo()}
              onUpdateNewTodo={setNewTodo}
              onAddTodo={addTodo}
              onToggleAll={toggleAll}
            />

            <Show when={todos.length > 0}>
              <scroll-view
                scroll-orientation="vertical"
                style={{ height: mainScrollHeight(), maxHeight: mainScrollMaxHeight }}
              >
                <view class="main">
                  {/* Todo list */}
                  <view class="todo-list">
                    <For each={filteredTodos().filter(t => !!t)}>
                      {todo => (
                        <TodoItem
                          todo={todo}
                          editing={editingId() === todo.id}
                          onToggle={toggleTodo}
                          onDelete={deleteTodo}
                          onStartEdit={startEdit}
                          onUpdateEdit={updateTodoTitle}
                          onDoneEdit={doneEdit}
                        />
                      )}
                    </For>
                  </view>
                </view>
              </scroll-view>
            </Show>

            <Show when={todos.length > 0}>
              <TodoFooter
                activeCount={activeTodos().length}
                completedCount={completedTodos().length}
                currentFilter={filter()}
                onSetFilter={setFilter}
                onClearCompleted={clearCompleted}
              />
            </Show>
          </view>
        </Loading>
      </view>

      {/* Info */}
      <view class="info">
        <text class="info-text">Every write applies instantly, then reconciles</text>
        <text class="info-text">Add one containing "boom" to watch it roll back</text>
        <text class="info-text">Built with Solid 2 × Lynx</text>
      </view>
    </view>
  )
}

function TodoSkeleton() {
  return (
    <view class="todoapp">
      <view class="skeleton-row" />
      <view class="skeleton-row" />
      <view class="skeleton-row" />
    </view>
  )
}
