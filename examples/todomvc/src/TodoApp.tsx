import { createMemo, createSignal, For, Show } from 'solid-js'

import { TodoFooter } from './TodoFooter'
import { TodoHeader } from './TodoHeader'
import { TodoItem } from './TodoItem'

export interface Todo {
  id: string
  title: string
  completed: boolean
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
  const [todos, setTodos] = createSignal<Todo[]>([])
  const [filter, setFilter] = createSignal<TodoFilter>('all')
  const [newTodo, setNewTodo] = createSignal('')
  const [editedTodoId, setEditedTodoId] = createSignal<string | null>(null)
  const [editText, setEditText] = createSignal('')

  // ── Derived ────────────────────────────────────────────────
  const activeTodos = createMemo(() => todos().filter(t => !t.completed))
  const completedTodos = createMemo(() => todos().filter(t => t.completed))
  const filteredTodos = createMemo(() => {
    if (filter() === 'active')
      return activeTodos()
    if (filter() === 'completed')
      return completedTodos()
    return todos()
  })

  const mainScrollHeight = createMemo(
    () => `${filteredTodos().length * TODO_ROW_HEIGHT}px`,
  )
  const mainScrollMaxHeight = `calc(100vh - ${VIEWPORT_RESERVED_HEIGHT}px)`

  const allCompleted = createMemo(
    () => todos().length > 0 && activeTodos().length === 0,
  )

  // ── Actions ────────────────────────────────────────────────
  function addTodo(title: string): void {
    if (!title.trim())
      return
    setTodos(prev => [...prev, { id: uuid(), title: title.trim(), completed: false }])
    setNewTodo('')
  }

  function toggleTodo(todo: Todo): void {
    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, completed: !t.completed } : t))
  }

  function deleteTodo(todo: Todo): void {
    setTodos(prev => prev.filter(t => t.id !== todo.id))
    if (editedTodoId() === todo.id) {
      setEditedTodoId(null)
      setEditText('')
    }
  }

  function startEdit(todo: Todo): void {
    setEditedTodoId(todo.id)
    setEditText(todo.title)
  }

  function doneEdit(todo: Todo, value?: string): void {
    if (editedTodoId() !== todo.id) {
      return
    }

    // Takes the pending text straight from the event rather than reading it
    // back out of the store — that read would land before the write settled.
    const title = (value ?? todo.title).trim()
    setEditedTodoId(null)
    setEditText('')

    if (!title) {
      deleteTodo(todo)
      return
    }

    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, title } : t))
  }

  function toggleAll(): void {
    const newVal = !allCompleted()
    setTodos(prev => prev.map(t => ({ ...t, completed: newVal })))
  }

  function clearCompleted(): void {
    setTodos(prev => prev.filter(t => !t.completed))
  }

  return (
    <view class="page">
      <view class="todoapp-shell">
        <view class="todoapp">
          <TodoHeader
            allCompleted={allCompleted()}
            hasTodos={todos().length > 0}
            newTodo={newTodo()}
            onUpdateNewTodo={setNewTodo}
            onAddTodo={addTodo}
            onToggleAll={toggleAll}
          />

          <Show when={todos().length > 0}>
            <scroll-view
              scroll-orientation="vertical"
              style={{ height: mainScrollHeight(), maxHeight: mainScrollMaxHeight }}
            >
              <view class="main">
                {/* Todo list */}
                <view class="todo-list">
                  <For each={filteredTodos()}>
                    {todo => (
                      <TodoItem
                        todo={todo}
                        editing={editedTodoId() === todo.id}
                        editText={editedTodoId() === todo.id ? editText() : todo.title}
                        onToggle={toggleTodo}
                        onDelete={deleteTodo}
                        onStartEdit={startEdit}
                        onUpdateEdit={setEditText}
                        onDoneEdit={doneEdit}
                      />
                    )}
                  </For>
                </view>
              </view>
            </scroll-view>
          </Show>

          <Show when={todos().length > 0}>
            <TodoFooter
              activeCount={activeTodos().length}
              completedCount={completedTodos().length}
              currentFilter={filter()}
              onSetFilter={setFilter}
              onClearCompleted={clearCompleted}
            />
          </Show>
        </view>
      </view>

      {/* Info */}
      <view class="info">
        <text class="info-text">Tap the todo text to edit</text>
        <text class="info-text">Built with Solid 2 × Lynx</text>
      </view>
    </view>
  )
}
