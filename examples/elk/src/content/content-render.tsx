import type { mastodon } from 'masto'
import type { Node } from 'ultrahtml'
import type { ContentParseOptions } from './content-parse'
import { ELEMENT_NODE, TEXT_NODE } from 'ultrahtml'
import { currentServer } from '../composables/users'
import { push } from '../router'
import {

  parseMastodonHTML,
  recursiveTreeToText,
  TagLinkRE,
  UserLinkRE,
} from './content-parse'
import { decode } from './html-entities'

export interface RenderContext {
  fontSize?: number
}

const SERVER_DOMAIN_REGEX = /(.+\.)(.+\..+)/

const BLOCK_TAGS = new Set(['p', 'pre', 'blockquote', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'mention-group'])

export function contentToJSX(
  content: string,
  options?: ContentParseOptions,
  ctx: RenderContext = {},
): (string | JSX.Element)[] {
  const tree = parseMastodonHTML(content, options)
  return renderBlocks((tree.children ?? []) as Node[], ctx)
}

function renderBlocks(nodes: Node[], ctx: RenderContext): (string | JSX.Element)[] {
  const blocks: (string | JSX.Element)[] = []
  let inlineRun: Node[] = []

  const flushInline = () => {
    if (!inlineRun.length)
      return
    const children = inlineRun.flatMap(n => renderInline(n, ctx))
    if (children.length)
      blocks.push(<text class="content-p">{children}</text>)
    inlineRun = []
  }

  for (const node of nodes) {
    if (node.type === ELEMENT_NODE && BLOCK_TAGS.has(node.name)) {
      flushInline()
      const block = renderBlock(node, ctx)
      if (block)
        blocks.push(block)
    }
    else if (node.type === TEXT_NODE && !node.value.trim()) {
      // whitespace between blocks
    }
    else {
      inlineRun.push(node)
    }
  }
  flushInline()
  return blocks
}

function renderBlock(node: Node, ctx: RenderContext): JSX.Element | null {
  switch (node.name) {
    case 'p': {
      const children = (node.children as Node[]).flatMap(n => renderInline(n, ctx))
      if (!children.length)
        return <view class="content-p-gap" />
      return <text class="content-p">{children}</text>
    }
    case 'pre':
      return renderCodeBlock(node)
    case 'blockquote':
      return <view class="content-blockquote">{renderBlocks(node.children as Node[], ctx)}</view>
    case 'ul':
    case 'ol':
      return (
        <view class="content-list">
          {/* eslint-disable-next-line solid/prefer-for -- static parse-tree walk, not a signal list */}
          {(node.children as Node[])
            .filter(c => c.type === ELEMENT_NODE && c.name === 'li')
            .map((li, i) => (
              <view class="content-li">
                <text class="content-li-marker">{node.name === 'ol' ? `${i + 1}.` : '•'}</text>
                <text class="content-p content-li-body">{(li.children as Node[]).flatMap(n => renderInline(n, ctx))}</text>
              </view>
            ))}
        </view>
      )
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5': {
      const children = (node.children as Node[]).flatMap(n => renderInline(n, ctx))
      return <text class={`content-heading content-${node.name}`}>{children}</text>
    }
    case 'mention-group':
      return (
        <view class="content-mention-group">
          <text class="content-p">{(node.children as Node[]).flatMap(n => renderInline(n, ctx))}</text>
        </view>
      )
    default:
      return null
  }
}

function renderCodeBlock(node: Node): JSX.Element {
  const codeEl = (node.children as Node[])[0]
  const code = codeEl?.name === 'code' ? recursiveTreeToText(codeEl) : recursiveTreeToText(node)
  return (
    <view class="content-pre">
      <text class="content-pre-text">{code.trim()}</text>
    </view>
  )
}

function renderInline(node: Node, ctx: RenderContext, inheritedClass = ''): (string | JSX.Element)[] {
  if (!node)
    return []

  if (node.type === TEXT_NODE)
    return [inheritedClass ? <text class={inheritedClass}>{decode(node.value)}</text> : <>{decode(node.value)}</>]

  if (node.type !== ELEMENT_NODE)
    return []

  const children = (node.children ?? []) as Node[]
  const renderChildren = (cls: string) => children.flatMap(c => renderInline(c, ctx, cls))

  switch (node.name) {
    case 'br':
      return ['\n']
    case 'a':
      return [renderLink(node, ctx)]
    case 'b':
    case 'strong':
      return renderChildren(`${inheritedClass} content-bold`.trim())
    case 'i':
    case 'em':
      return renderChildren(`${inheritedClass} content-italic`.trim())
    case 'del':
      return renderChildren(`${inheritedClass} content-del`.trim())
    case 'u':
      return renderChildren(`${inheritedClass} content-underline`.trim())
    case 'code':
      return [<text class="content-code-inline">{recursiveTreeToText(node)}</text>]
    case 'sub':
    case 'sup':
      return renderChildren(`${inheritedClass} content-small`.trim())
    case 'abbr':
    case 'ruby':
      return renderChildren(inheritedClass)
    case 'rp':
    case 'rt':
      return []
    case 'img': {
      if (node.attributes?.class?.includes('custom-emoji')) {
        return [<image class="content-emoji" src={node.attributes.src} />]
      }
      return []
    }
    case 'span': {
      const cls = node.attributes?.class ?? ''
      if (cls.includes('invisible'))
        return []
      if (cls.includes('ellipsis')) {
        const runs = renderChildren(inheritedClass)
        runs.push('…')
        return runs
      }
      return renderChildren(inheritedClass)
    }
    default:
      return renderChildren(inheritedClass)
  }
}

function renderLink(node: Node, ctx: RenderContext): JSX.Element {
  const href = node.attributes?.href
  const cls = node.attributes?.class ?? ''
  const children = (node.children ?? []) as Node[]

  let onTap: (() => void) | undefined
  let linkClass = 'content-link'

  if (href && cls.includes('mention')) {
    const matchUser = href.match(UserLinkRE)
    if (matchUser) {
      const [, server, username] = matchUser
      const handle = `${username}@${server.replace(SERVER_DOMAIN_REGEX, '$2')}`
      linkClass = 'content-mention'
      onTap = () => push(`/${currentServer()}/@${handle}`)
    }
  }
  if (!onTap && href) {
    const matchTag = href.match(TagLinkRE)
    if (matchTag || cls.includes('hashtag')) {
      const tagName = matchTag
        ? matchTag[2]
        : textOf(node).replace(/^#/, '')
      linkClass = 'content-mention'
      onTap = () => push(`/${currentServer()}/tags/${tagName}`)
    }
  }
  if (!onTap && href?.startsWith('/')) {
    onTap = () => push(href)
  }
  if (!onTap) {
    onTap = () => {}
  }

  return (
    <text class={linkClass} bindtap={onTap}>
      {children.flatMap(c => renderInline(c, ctx))}
    </text>
  )
}

function textOf(node: Node): string {
  if (node.type === TEXT_NODE)
    return node.value
  return ((node.children ?? []) as Node[]).map(textOf).join('')
}

export function nameToJSX(
  account: mastodon.v1.Account,
  ctx: RenderContext = {},
): (string | JSX.Element)[] {
  const name = account.displayName || account.username
  const emojis = Object.fromEntries((account.emojis ?? []).map(e => [e.shortcode, e]))
  const tree = parseMastodonHTML(name, { emojis, markdown: false })
  return ((tree.children ?? []) as Node[]).flatMap(n => renderInline(n, ctx))
}
