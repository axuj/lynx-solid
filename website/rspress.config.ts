import path from 'node:path'
import { pluginSass } from '@rsbuild/plugin-sass'
import { defineConfig } from '@rspress/core'
import { pluginLlms } from '@rspress/plugin-llms'

// Project Pages serves the site from a subpath (`https://<user>.github.io/<repo>/`),
// so every asset and link has to be rooted there; local dev wants `/`. Taking it
// from the environment keeps the repo name out of this file — the workflow derives
// it from `github.event.repository.name` and passes it as DOCS_BASE.
const base = process.env.DOCS_BASE ?? '/'

export default defineConfig({
  root: 'docs',
  base,
  title: 'Lynx Solid',
  description: 'Solid 2 framework for building Lynx apps',
  icon: '/favicon.svg',
  logo: '/logo.svg',
  logoText: 'Lynx Solid',
  lang: 'en',
  locales: [
    {
      lang: 'en',
      label: 'English',
      title: 'Lynx Solid',
      description: 'Solid 2 framework for building Lynx apps',
    },
    {
      lang: 'zh',
      label: '简体中文',
      title: 'Lynx Solid',
      description: '使用 Solid 2 构建 Lynx 应用的框架',
    },
  ],
  plugins: [pluginLlms()],
  markdown: {
    globalComponents: [
      path.join(__dirname, 'src/components/go/Go.tsx'),
    ],
  },
  route: {
    cleanUrls: true,
  },
  themeConfig: {
    socialLinks: [
      { icon: 'github', mode: 'link', content: 'https://github.com/axuj/lynx-solid' },
    ],
    footer: {
      message: `© ${new Date().getFullYear()} Lynx Solid contributors.`,
    },
    sidebar: {
      '/guide/': [
        { text: 'Quick Start', link: '/guide/quick-start' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Learn Lynx Solid' },
        { text: 'What is Lynx Solid?', link: '/guide/introduction' },
        { text: 'Solid Compatibility', link: '/guide/solid-compatibility' },
        { text: 'Main Thread Script', link: '/guide/main-thread-script' },
        { text: 'Tutorial: Counter', link: '/guide/tutorial-counter' },
        { text: 'Playground: Touch FX', link: '/guide/touch-fx' },
        { text: 'scroll-view vs list', link: '/guide/scroll-view-vs-list' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Ecosystem' },
        { text: 'Routing (TanStack)', link: '/guide/routing' },
        { text: 'Data Fetching', link: '/guide/data-fetching' },
        { text: 'Tailwind CSS', link: '/guide/tailwindcss' },
        { text: 'TypeScript', link: '/guide/typescript' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Showcase' },
        { text: 'TodoMVC', link: '/guide/todomvc' },
        { text: '7 GUIs', link: '/guide/7guis' },
        { text: 'HackerNews', link: '/guide/hackernews' },
        { text: 'Elk (Mastodon Client)', link: '/guide/elk' },
        { text: 'Motion', link: '/guide/motion' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'Performance' },
        { text: 'Benchmark', link: '/guide/benchmark-framework' },
        { text: 'MT-IFR', link: '/guide/mt-ifr' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'API Reference' },
        { text: 'API Overview', link: '/guide/api' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'About' },
        { text: 'Sources & Attribution', link: '/guide/sources' },
      ],
      '/zh/guide/': [
        { text: '快速开始', link: '/zh/guide/quick-start' },
        { dividerType: 'solid' },
        { sectionHeaderText: '学习 Lynx Solid' },
        { text: '什么是 Lynx Solid？', link: '/zh/guide/introduction' },
        { text: 'Solid 兼容性', link: '/zh/guide/solid-compatibility' },
        { text: '主线程脚本', link: '/zh/guide/main-thread-script' },
        { text: '教程：计数器', link: '/zh/guide/tutorial-counter' },
        { text: '玩一玩：触摸特效', link: '/zh/guide/touch-fx' },
        { text: 'scroll-view 与 list', link: '/zh/guide/scroll-view-vs-list' },
        { dividerType: 'solid' },
        { sectionHeaderText: '生态系统' },
        { text: '路由（TanStack）', link: '/zh/guide/routing' },
        { text: '数据请求', link: '/zh/guide/data-fetching' },
        { text: 'Tailwind CSS', link: '/zh/guide/tailwindcss' },
        { text: 'TypeScript', link: '/zh/guide/typescript' },
        { dividerType: 'solid' },
        { sectionHeaderText: '案例' },
        { text: 'TodoMVC', link: '/zh/guide/todomvc' },
        { text: '7 GUIs', link: '/zh/guide/7guis' },
        { text: 'HackerNews', link: '/zh/guide/hackernews' },
        { text: 'Elk（Mastodon 客户端）', link: '/zh/guide/elk' },
        { text: 'Motion', link: '/zh/guide/motion' },
        { dividerType: 'solid' },
        { sectionHeaderText: '性能' },
        { text: '基准测试', link: '/zh/guide/benchmark-framework' },
        { text: 'MT-IFR：主线程自绘首屏', link: '/zh/guide/mt-ifr' },
        { dividerType: 'solid' },
        { sectionHeaderText: 'API 参考' },
        { text: 'API 总览', link: '/zh/guide/api' },
        { dividerType: 'solid' },
        { sectionHeaderText: '关于' },
        { text: '来源与致谢', link: '/zh/guide/sources' },
      ],
    },
    nav: [
      {
        text: 'Guide',
        link: '/guide/quick-start',
        activeMatch: '/guide/',
      },
      {
        text: 'API',
        link: '/guide/api',
        activeMatch: '/guide/api',
      },
    ],
    locales: [
      {
        lang: 'en',
        label: 'English',
        nav: [
          {
            text: 'Guide',
            link: '/guide/quick-start',
            activeMatch: '/guide/',
          },
          {
            text: 'API',
            link: '/guide/api',
            activeMatch: '/guide/api',
          },
        ],
      },
      {
        lang: 'zh',
        label: '简体中文',
        nav: [
          {
            text: '指南',
            link: '/zh/guide/quick-start',
            activeMatch: '/zh/guide/',
          },
          {
            text: 'API',
            link: '/zh/guide/api',
            activeMatch: '/zh/guide/api',
          },
        ],
      },
    ],
  },
  builderConfig: {
    plugins: [pluginSass()],
  },
})
