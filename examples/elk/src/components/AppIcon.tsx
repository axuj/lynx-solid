import { createMemo } from 'solid-js'
import { iconSvg } from '../composables/icons'

export function AppIcon(props: { name: string, size?: number, color?: string }) {
  const content = createMemo(() => iconSvg(props.name, props.color ?? '#686868'))
  return (
    <svg
      content={content()}
      style={{ width: `${props.size ?? 20}px`, height: `${props.size ?? 20}px` }}
    />
  )
}
