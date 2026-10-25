import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { createEffect, onCleanup, onSettled } from 'solid-js'

export function SourceEditor(props: {
  value: () => string
  onChange: (v: string) => void
  onCompile: () => void
  readOnly?: () => boolean
}) {
  let host: HTMLDivElement | undefined
  let view: EditorView | undefined
  const readOnlyCompartment = new Compartment()
  const editableCompartment = new Compartment()

  onSettled(() => {
    view = new EditorView({
      state: EditorState.create({
        doc: props.value(),
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([
            {
              key: 'Ctrl-Enter',
              run: () => {
                props.onCompile()
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          javascript({ jsx: true, typescript: true }),
          oneDark,
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          // eslint-disable-next-line solid/reactivity
          EditorView.updateListener.of((u) => {
            if (u.docChanged)
              props.onChange(u.state.doc.toString())
          }),
          readOnlyCompartment.of(EditorState.readOnly.of(!!props.readOnly?.())),
          editableCompartment.of(EditorView.editable.of(!props.readOnly?.())),
          EditorView.theme({
            '&': {
              height: '100%',
              fontSize: '13px',
              color: 'var(--fg)',
            },
            '.cm-content': {
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              padding: '12px 0',
              caretColor: 'var(--fg)',
            },
            '.cm-gutters': {
              backgroundColor: 'transparent',
              border: 'none',
              color: 'var(--dim)',
            },
            '&.cm-focused': { outline: 'none' },
            '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
            },
          }),
        ],
      }),
      parent: host!,
    });
    (host as HTMLDivElement & { _editorView: EditorView })._editorView = view
  })

  createEffect(
    () => props.value(),
    (v) => {
      if (view && view.state.doc.toString() !== v) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
      }
    },
  )

  createEffect(
    () => props.readOnly?.() ?? false,
    (ro) => {
      view?.dispatch({
        effects: [
          readOnlyCompartment.reconfigure(EditorState.readOnly.of(ro)),
          editableCompartment.reconfigure(EditorView.editable.of(!ro)),
        ],
      })
    },
  )

  onCleanup(() => view?.destroy())

  return <div ref={host} class="editor-host" />
}
