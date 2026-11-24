import type { Config } from 'tailwindcss'

import preset from '@lynx-js/tailwind-preset'

// The same palette the hand-written styles used, as named tokens. A desktop
// demo that reads `bg-panel` / `text-muted` is what people actually write, and
// it keeps the two native apps in this directory on one styling story.
const config: Config = {
  content: ['./src/**/*.{tsx,ts}'],
  presets: [preset],
  theme: {
    extend: {
      colors: {
        surface: '#0b0d12',
        panel: '#151922',
        line: '#262b36',
        fg: '#e8ecf3',
        body: '#c3cad8',
        muted: '#8b93a7',
        dim: '#5d6474',
        accent: '#3f6cf5',
      },
    },
  },
}

export default config
