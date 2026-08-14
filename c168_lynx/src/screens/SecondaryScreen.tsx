import { useCallback, useMemo, useState } from '@lynx-js/react'

import { postForm } from '../api.js'
import { LOGIN_I18N, localizeAuthApiMessage, SECONDARY_I18N, type LoginLang } from '../i18n.js'
import {
  fetchCurrentUser,
  landingTab,
  logoutSession,
  type AppTab,
  type SecondaryVariant,
  type SessionUser,
} from '../session.js'

type InputEvent = { detail?: { value?: string }; value?: string }

function eventValue(e: InputEvent) {
  return String(e?.detail?.value ?? e?.value ?? '')
}

const VERIFY_API: Record<SecondaryVariant, string> = {
  owner: 'api/session/verify_owner_secondary_password_api.php',
  user: 'api/session/verify_user_secondary_password_api.php',
}

type Props = {
  lang: LoginLang
  variant: SecondaryVariant
  onAuthed: (user: SessionUser, tab: AppTab) => void
  onBackToLogin: () => void
}

export function SecondaryScreen({ lang, variant, onAuthed, onBackToLogin }: Props) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState('')

  const i18n = useMemo(() => SECONDARY_I18N[lang], [lang])
  const loginI18n = useMemo(() => LOGIN_I18N[lang], [lang])

  const onBack = useCallback(async () => {
    'background only'
    await logoutSession()
    onBackToLogin()
  }, [onBackToLogin])

  const onVerify = useCallback(async () => {
    'background only'
    if (submitting) return
    const value = password.trim()
    if (!/^\d{6}$/.test(value)) {
      setNotice(i18n.digitsSix)
      return
    }
    setSubmitting(true)
    setNotice('')
    try {
      const { res, data } = await postForm(VERIFY_API[variant], { secondary_password: value })
      if (res.ok && data.success === true) {
        const me = await fetchCurrentUser()
        if (me) {
          onAuthed(me, landingTab(me))
          return
        }
        onAuthed({ user_type: variant === 'owner' ? 'owner' : 'user' }, 'home')
        return
      }
      setNotice(localizeAuthApiMessage(String(data.message || ''), lang) || i18n.genericError)
    } catch {
      setNotice(i18n.genericError)
    } finally {
      setSubmitting(false)
    }
  }, [i18n.digitsSix, i18n.genericError, lang, onAuthed, password, submitting, variant])

  return (
    <view className="Page">
      <scroll-view scroll-orientation="vertical" className="Scroll">
        <view className="Hero">
          <text className="Brand">{loginI18n.title}</text>
          <text className="Hint">{i18n.lead}</text>
        </view>

        <view className="Card">
          <text className="DialogTitle">{i18n.title}</text>
          <view className="Field">
            <text className="Label">{i18n.placeholder}</text>
            <input
              className="Input"
              type="password"
              placeholder={i18n.placeholder}
              maxlength={6}
              bindinput={(e: InputEvent) => {
                'background only'
                setPassword(eventValue(e))
              }}
              bindconfirm={onVerify}
            />
          </view>

          <view className={submitting ? 'Submit Submit--off' : 'Submit'} bindtap={onVerify}>
            <text className="SubmitText">{submitting ? i18n.verifying : i18n.verify}</text>
          </view>

          <view className="Ghost" bindtap={onBack}>
            <text className="GhostText">{i18n.backToLogin}</text>
          </view>
        </view>
      </scroll-view>

      {notice ? (
        <view className="Mask">
          <view className="Dialog">
            <text className="DialogTitle">{loginI18n.notice}</text>
            <text className="DialogBody">{notice}</text>
            <view
              className="Submit"
              bindtap={() => {
                'background only'
                setNotice('')
              }}
            >
              <text className="SubmitText">{loginI18n.confirm}</text>
            </view>
          </view>
        </view>
      ) : null}
    </view>
  )
}
