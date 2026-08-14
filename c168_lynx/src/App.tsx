import { useCallback, useEffect, useMemo, useState } from '@lynx-js/react'

import { LOGIN_I18N, type LoginLang } from './i18n.js'
import { LoginScreen } from './screens/LoginScreen.js'
import { SecondaryScreen } from './screens/SecondaryScreen.js'
import { Shell } from './screens/Shell.js'
import {
  fetchCurrentUser,
  landingTab,
  logoutSession,
  type AppTab,
  type SecondaryVariant,
  type SessionUser,
} from './session.js'
import './App.css'

type Route =
  | { id: 'boot' }
  | { id: 'login' }
  | { id: 'secondary'; variant: SecondaryVariant }
  | { id: 'app'; tab: AppTab }

export function App() {
  const [lang, setLang] = useState<LoginLang>('en')
  const [route, setRoute] = useState<Route>({ id: 'boot' })
  const [me, setMe] = useState<SessionUser | null>(null)

  const bootText = useMemo(() => LOGIN_I18N[lang].boot, [lang])

  const enterSession = useCallback((user: SessionUser, tab: AppTab) => {
    'background only'
    if (user.needs_owner_secondary) {
      setMe(user)
      setRoute({ id: 'secondary', variant: 'owner' })
      return
    }
    if (user.needs_user_secondary) {
      setMe(user)
      setRoute({ id: 'secondary', variant: 'user' })
      return
    }
    setMe(user)
    setRoute({ id: 'app', tab })
  }, [])

  const goLogin = useCallback(() => {
    'background only'
    setMe(null)
    setRoute({ id: 'login' })
  }, [])

  const onLogout = useCallback(async () => {
    'background only'
    await logoutSession()
    goLogin()
  }, [goLogin])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const user = await fetchCurrentUser()
        if (cancelled) return
        if (!user) {
          setRoute({ id: 'login' })
          return
        }
        enterSession(user, landingTab(user))
      } catch {
        if (!cancelled) setRoute({ id: 'login' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enterSession])

  if (route.id === 'boot') {
    return (
      <view className="Page">
        <view className="Boot">
          <text className="Brand">EAZYCOUNT</text>
          <text className="Hint">{bootText}</text>
        </view>
      </view>
    )
  }

  if (route.id === 'login') {
    return (
      <LoginScreen
        lang={lang}
        onLangChange={setLang}
        onAuthed={enterSession}
        onNeedSecondary={(variant) => {
          'background only'
          setRoute({ id: 'secondary', variant })
        }}
      />
    )
  }

  if (route.id === 'secondary') {
    return (
      <SecondaryScreen
        lang={lang}
        variant={route.variant}
        onAuthed={enterSession}
        onBackToLogin={goLogin}
      />
    )
  }

  return (
    <Shell
      lang={lang}
      me={me}
      tab={route.tab}
      onTabChange={(tab) => {
        'background only'
        setRoute({ id: 'app', tab })
      }}
      onLangChange={setLang}
      onLogout={onLogout}
    />
  )
}
