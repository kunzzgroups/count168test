import { useMemo } from '@lynx-js/react'

import { MemberScreen } from './MemberScreen.js'
import { SHELL_I18N, tabLabel, type LoginLang } from '../i18n.js'
import {
  companyLabel,
  displayName,
  navTabs,
  type AppTab,
  type SessionUser,
} from '../session.js'

type Props = {
  lang: LoginLang
  me: SessionUser | null
  tab: AppTab
  onTabChange: (tab: AppTab) => void
  onLangChange: (lang: LoginLang) => void
  onLogout: () => void
}

function StubBody({ title, body }: { title: string; body: string }) {
  return (
    <view className="Stub">
      <text className="StubTitle">{title}</text>
      <text className="StubBody">{body}</text>
    </view>
  )
}

export function Shell({ lang, me, tab, onTabChange, onLangChange, onLogout }: Props) {
  const i18n = useMemo(() => SHELL_I18N[lang], [lang])
  const tabs = useMemo(() => navTabs(me), [me])
  const company = companyLabel(me)
  const name = displayName(me)

  return (
    <view className="Shell">
      <view className="TopBar">
        <view className="TopBarMain">
          <text className="TopBrand">EAZYCOUNT</text>
          <text className="TopMeta">{company || name || '—'}</text>
        </view>
        <view
          className="TopLogout"
          bindtap={() => {
            'background only'
            onLogout()
          }}
        >
          <text className="TopLogoutText">{i18n.logout}</text>
        </view>
      </view>

      <scroll-view scroll-orientation="vertical" className="ShellScroll">
        {tab === 'member' ? (
          <MemberScreen lang={lang} />
        ) : tab === 'more' ? (
          <view className="MoreCard">
            <text className="StubTitle">{i18n.moreSubtitle}</text>
            <text className="MoreLine">
              {i18n.signedInAs}: {name || '—'}
            </text>
            {company ? <text className="MoreLine">{company}</text> : null}

            <view className="Lang Lang--shell">
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

            <text className="StubBody">{i18n.comingBody}</text>
          </view>
        ) : (
          <StubBody title={tabLabel(tab, lang)} body={i18n.comingBody} />
        )}
      </scroll-view>

      <view className="TabBar">
        {tabs.map((item) => {
          const on = item === tab
          return (
            <view
              key={item}
              className={on ? 'TabItem TabItem--on' : 'TabItem'}
              bindtap={() => {
                'background only'
                onTabChange(item)
              }}
            >
              <text className={on ? 'TabItemText TabItemText--on' : 'TabItemText'}>{tabLabel(item, lang)}</text>
            </view>
          )
        })}
      </view>
    </view>
  )
}
