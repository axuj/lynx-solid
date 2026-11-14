import type { Config } from 'tailwindcss'

import preset from '@lynx-js/tailwind-preset'

const config: Config = {
  content: ['./src/**/*.{tsx,ts,jsx,js}'],
  presets: [preset],
  theme: {
    extend: {
      colors: {
        // The translucent surfaces are tokens, not palette colors, so they stay
        // literal rgba() values: Lynx supports rgba, while Tailwind's `/opacity`
        // modifier would emit the newer `rgb(... / var(...))` syntax.
        accent: {
          DEFAULT: '#38bdf8',
          muted: '#7dd3fc',
          soft: 'rgba(56, 189, 248, 0.16)',
        },
        ink: '#0b1120',
        panel: {
          DEFAULT: 'rgba(148, 163, 184, 0.1)',
          border: 'rgba(148, 163, 184, 0.22)',
          strong: 'rgba(148, 163, 184, 0.35)',
        },
      },
    },
  },
}

export default config
