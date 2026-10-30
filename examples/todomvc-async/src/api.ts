import type { Todo } from './TodoApp'

// A stand-in for a real backend: rows held in memory plus a round-trip delay,
// so every mutation here is genuinely async without depending on a network.
// That keeps the demo honest — the optimism you see is the framework's, not
// a fast local cache pretending to be a server.

const READ_MS = 400
const WRITE_MS = 700

// Seeded so the first screen has something to reconcile against.
let db: Todo[] = [
  { id: 'seed-1', title: 'Tap the checkbox', completed: false },
  { id: 'seed-2', title: 'Add one containing "boom"', completed: false },
  { id: 'seed-3', title: 'Already done', completed: true },
]

function later<T>(value: T, ms: number): Promise<T> {
  // Arrow-wrapped on purpose: PrimJS host timers drop forwarded arguments.
  return new Promise(resolve => setTimeout(() => resolve(value), ms))
}

export function list(): Promise<Todo[]> {
  return later(db.map(t => ({ ...t })), READ_MS)
}

export async function add(todo: Todo): Promise<void> {
  await later(undefined, WRITE_MS)
  // Opt-in failure: lets you watch the optimistic layer roll back.
  if (todo.title.toLowerCase().includes('boom'))
    throw new Error('rejected by the mock server')

  db = [...db, { id: todo.id, title: todo.title, completed: todo.completed }]
}

export async function toggle(id: string, completed: boolean): Promise<void> {
  await later(undefined, WRITE_MS)
  db = db.map(t => (t.id === id ? { ...t, completed } : t))
}

export async function remove(id: string): Promise<void> {
  await later(undefined, WRITE_MS)
  db = db.filter(t => t.id !== id)
}

export async function rename(id: string, title: string): Promise<void> {
  await later(undefined, WRITE_MS)
  db = db.map(t => (t.id === id ? { ...t, title } : t))
}

export async function clearCompleted(): Promise<void> {
  await later(undefined, WRITE_MS)
  db = db.filter(t => !t.completed)
}

export async function toggleAll(completed: boolean): Promise<void> {
  await later(undefined, WRITE_MS)
  db = db.map(t => ({ ...t, completed }))
}
