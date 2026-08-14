import { useCallback, useMemo, useState } from '@lynx-js/react'

import { postForm } from '../api.js'
import { LOGIN_I18N, localizeAuthApiMessage, type LoginLang, type LoginRole } from '../i18n.js'
import {
  fetchCurrentUser,
  landingTab,
  secondaryFromRedirect,
  type AppTab,
  type SecondaryVariant,
  type SessionUser,
} from '../session.js'

type InputEvent = { detail?: { value?: string }; value?: string }

function eventValue(e: InputEvent) {
  return String(e?.detail?.value ?? e?.value ?? '')
}

type Props = {
  lang: LoginLang
  onLangChange: (lang: LoginLang) => void
  onAuthed: (user: SessionUser, tab: AppTab) => void
  onNeedSecondary: (variant: SecondaryVariant) => void
}

export function LoginScreen({ lang, onLangChange, onAuthed, onNeedSecondary }: Props) {
  const [role, setRole] = useState<LoginRole>('admin')
  const [companyId, setCompanyId] = useState('')
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState('')

  const i18n = useMemo(() => LOGIN_I18N[lang], [lang])
  const userPlaceholder = role === 'member' ? i18n.accountPlaceholder : i18n.usernamePlaceholder

  const onLogin = useCallback(async () => {
    'background only'
    if (submitting) return
    setSubmitting(true)
    setNotice('')
    try {
      const fields: Record<string, string> = {
        action: 'login',
        company_id: companyId.trim().toUpperCase(),
        password,
        login_role: role,
      }
      if (role === 'member') {
        fields.account_id = userId.trim().toUpperCase()
      } else {
        fields.login_id = userId.trim().toUpperCase()
        if (rememberMe) fields.remember_me = '1'
      }

      const { data } = await postForm('api/session/login_api.php', fields)
      if (data.status === 'success') {
        const secondary = secondaryFromRedirect(String(data.redirect || ''))
        if (secondary) {
          onNeedSecondary(secondary)
          return
        }
        const me = await fetchCurrentUser()
        if (me) {
          onAuthed(me, landingTab(me))
          return
        }
        const fallback: SessionUser = { user_type: String(data.user_type || role) }
        onAuthed(fallback, landingTab(fallback))
        return
      }
      setNotice(localizeAuthApiMessage(String(data.message || ''), lang) || i18n.loginFailed)
    } catch {
      setNotice(i18n.loginBackendOffline)
    } finally {
      setSubmitting(false)
    }
  }, [
    companyId,
    i18n.loginBackendOffline,
    i18n.loginFailed,
    lang,
    onAuthed,
    onNeedSecondary,
    password,
    rememberMe,
    role,
    submitting,
    userId,
  ])

  return (
    <view className="Page">
      <scroll-view scroll-orientation="vertical" className="Scroll">
        <view className="Hero">
          <text className="Brand">{i18n.title}</text>
          <text className="Hint">{i18n.hint}</text>
        </view>

        <view className="Card">
          <view className="Tabs">
            <view
              className={role === 'admin' ? 'Tab Tab--on' : 'Tab'}
              bindtap={() => {
                'background only'
                setRole('admin')
              }}
            >
              <text className={role === 'admin' ? 'TabText TabText--on' : 'TabText'}>{i18n.admin}</text>
            </view>
            <view
              className={role === 'member' ? 'Tab Tab--on' : 'Tab'}
              bindtap={() => {
                'background only'
                setRole('member')
              }}
            >
              <text className={role === 'member' ? 'TabText TabText--on' : 'TabText'}>{i18n.member}</text>
            </view>
          </view>

          <view className="Field">
            <text className="Label">{i18n.companyPlaceholder}</text>
            <input
              className="Input"
              placeholder={i18n.companyPlaceholder}
              maxlength={40}
              bindinput={(e: InputEvent) => {
                'background only'
                setCompanyId(eventValue(e).toUpperCase())
              }}
            />
          </view>

          <view className="Field">
            <text className="Label">{userPlaceholder}</text>
            <input
              className="Input"
              placeholder={userPlaceholder}
              maxlength={40}
              bindinput={(e: InputEvent) => {
                'background only'
                setUserId(eventValue(e).toUpperCase())
              }}
            />
          </view>

          <view className="Field">
            <text className="Label">{i18n.passwordPlaceholder}</text>
            <input
              className="Input"
              type="password"
              placeholder={i18n.passwordPlaceholder}
              maxlength={80}
              bindinput={(e: InputEvent) => {
                'background only'
                setPassword(eventValue(e))
              }}
              bindconfirm={onLogin}
            />
          </view>

          {role === 'admin' ? (
            <view
              className="Remember"
              bindtap={() => {
                'background only'
                setRememberMe((v) => !v)
              }}
            >
              <view className={rememberMe ? 'Check Check--on' : 'Check'} />
              <text className="RememberText">{i18n.rememberMe}</text>
            </view>
          ) : null}

          <view className={submitting ? 'Submit Submit--off' : 'Submit'} bindtap={onLogin}>
            <text className="SubmitText">{submitting ? i18n.loggingIn : i18n.login}</text>
          </view>

          <view className="Lang">
            <view
              className={lang === 'en' ? 'LangBtn LangBtn--on' : 'LangBtn'}
              bindtap={() => {
                'background only'
                onLangChange('en')
              }}
            >
              <text className={lang === 'en' ? 'LangText LangText--on' : 'LangText'}>EN</text>
            </view>
            <view
              className={lang === 'zh' ? 'LangBtn LangBtn--on' : 'LangBtn'}
              bindtap={() => {
                'background only'
                onLangChange('zh')
              }}
            >
              <text className={lang === 'zh' ? 'LangText LangText--on' : 'LangText'}>中文</text>
            </view>
          </view>
        </view>
      </scroll-view>

      {notice ? (
        <view className="Mask">
          <view className="Dialog">
            <text className="DialogTitle">{i18n.notice}</text>
            <text className="DialogBody">{notice}</text>
            <view
              className="Submit"
              bindtap={() => {
                'background only'
                setNotice('')
              }}
            >
              <text className="SubmitText">{i18n.confirm}</text>
            </view>
          </view>
        </view>
      ) : null}
    </view>
  )
}
