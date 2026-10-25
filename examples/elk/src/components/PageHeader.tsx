import { createSignal } from 'solid-js'
import { currentUser } from '../composables/users'
import { back as goBack, push } from '../router'
import { AppIcon } from './AppIcon'

export function PageHeader(props: {
  title: string
  icon?: string
  back?: boolean
  children?: unknown
}) {
  const [signInPressed, setSignInPressed] = createSignal(false)

  function goSignIn() {
    push('/settings')
  }

  return (
    <view class="page-header">
      {props.back && (
        <view class="page-header-back" bindtap={goBack}>
          <AppIcon name="arrow-left-line" size={20} color="#232323" />
        </view>
      )}
      {props.icon && <AppIcon name={props.icon} size={22} color="#cc7d24" />}
      <text
        class={props.icon ? 'page-header-title page-header-title-primary' : 'page-header-title'}
        text-maxline="1"
      >
        {props.title}
      </text>
      <view class="page-header-spacer" />
      {props.children}
      {!currentUser() && (
        <view
          class={signInPressed() ? 'page-header-sign-in page-header-sign-in-pressed' : 'page-header-sign-in'}
          bindtouchstart={() => setSignInPressed(true)}
          bindtouchend={() => setSignInPressed(false)}
          bindtouchcancel={() => setSignInPressed(false)}
          bindtap={goSignIn}
        >
          <AppIcon name="login-circle-line" size={17} color="#ffffff" />
          <text class="page-header-sign-in-text">Sign in</text>
        </view>
      )}
    </view>
  )
}
