import { Show } from 'solid-js'
import { fetchUser } from '../api'
import { Spinner } from '../components/Spinner'
import { useHnQuery } from '../composables/use-hn-query'
import { back } from '../router'
import { stripHtml } from '../utils'

interface UserPageProps {
  userId: string
}

export function UserPage(props: UserPageProps) {
  const { data: user, isLoading, isError } = useHnQuery(
    () => `user#${props.userId}`,
    key => fetchUser(key.split('#')[1]),
  )

  function goBack() {
    back()
  }

  return (
    <scroll-view class="flex-1" scroll-orientation="vertical">
      <Show when={isLoading()}>
        <view class="items-center" style={{ padding: '40px' }}>
          <Spinner show />
        </view>
      </Show>

      <Show when={!isLoading() && isError()}>
        <view class="items-center flex flex-col" style={{ padding: '2em 3em', gap: '8px' }}>
          <text style={{ fontSize: '1.5em', fontWeight: 'bold', color: '#2e495e' }}>
            User not found.
          </text>
          <text style={{ color: '#3eaf7c', fontSize: '15px' }} bindtap={goBack}>
            ‹ Back
          </text>
        </view>
      </Show>

      <Show when={user()}>
        <view class="bg-hn-card flex flex-col" style={{ padding: '2em 3em' }}>
          {/* Back link */}
          <text
            style={{ color: '#3eaf7c', fontSize: '13px', marginBottom: '12px' }}
            bindtap={goBack}
          >
            ‹ Back
          </text>

          {/* User ID: h1 equivalent */}
          <text style={{ fontSize: '1.5em', fontWeight: 'bold', color: '#2e495e' }}>
            User :
            {' '}
            {user()?.id}
          </text>

          {/* Meta */}
          <view class="flex flex-col" style={{ marginTop: '12px', gap: '4px' }}>
            <view class="flex flex-row">
              <text style={{ color: '#595959', fontSize: '15px', width: '4em' }}>
                Created:
              </text>
              <text style={{ color: '#2e495e', fontSize: '15px' }}>{user()?.created}</text>
            </view>
            <view class="flex flex-row">
              <text style={{ color: '#595959', fontSize: '15px', width: '4em' }}>
                Karma:
              </text>
              <text style={{ color: '#2e495e', fontSize: '15px' }}>{user()?.karma}</text>
            </view>
          </view>

          {/* About */}
          <Show when={user()?.about}>
            <view class="border-t border-hn-border" style={{ marginTop: '1em', paddingTop: '1em' }}>
              <text
                style={{ color: '#2e495e', fontSize: '15px', lineHeight: '1.5em' }}
              >
                {stripHtml(user()?.about ?? '')}
              </text>
            </view>
          </Show>

          {/* Links */}
          <view class="flex flex-row" style={{ marginTop: '1em', gap: '6px' }}>
            <text
              style={{ color: '#2e495e', fontSize: '15px', textDecorationLine: 'underline' }}
            >
              submissions
            </text>
            <text style={{ color: '#2e495e', fontSize: '15px' }}>|</text>
            <text
              style={{ color: '#2e495e', fontSize: '15px', textDecorationLine: 'underline' }}
            >
              comments
            </text>
          </view>
        </view>
      </Show>
    </scroll-view>
  )
}
