import { useCallback, useState } from "react";
import MobileShell from "../../components/layout/MobileShell.jsx";
import MobileSubpageHeader from "../../components/layout/MobileSubpageHeader.jsx";
import { useIncrementalList } from "../../hooks/useIncrementalList.js";
import { useMobileAnnouncements } from "../../hooks/useMobileAnnouncements.js";
import { toSafeRenderHtml } from "../../utils/content/richTextSanitizer.js";
import { AnnouncementConfirmSheet, AnnouncementFormSheet } from "./AnnouncementSheets.jsx";
import "../account/account.css";
import "./announcement.css";

function AnnouncementCard({ item, t, onEdit, onDelete }) {
  return (
    <article className="m-ann-admin-card">
      <div className="m-ann-admin-card-head">
        <h2 className="m-ann-admin-title">{item.title || "—"}</h2>
        <div className="m-ann-admin-actions">
          <button type="button" className="m-ann-admin-btn m-ann-admin-btn--edit tap-scale" onClick={() => onEdit(item)}>
            {t("edit")}
          </button>
          <button
            type="button"
            className="m-ann-admin-btn m-ann-admin-btn--delete tap-scale"
            onClick={() => onDelete(item)}
          >
            {t("delete")}
          </button>
        </div>
      </div>
      <div
        className="m-ann-admin-body"
        dangerouslySetInnerHTML={{ __html: toSafeRenderHtml(item.content) }}
      />
      <div className="m-ann-admin-meta">
        <span>{t("createdBy", { name: item.created_by || "—" })}</span>
        <span>{t("createdAt", { time: item.created_at || "—" })}</span>
      </div>
    </article>
  );
}

export default function AnnouncementPage() {
  const api = useMobileAnnouncements();
  const { i18n, t } = api;
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const { visible, hasMore, sentinelRef } = useIncrementalList(api.announcements, 40);

  const openCreate = useCallback(() => {
    setEditing(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback(
    (item) => {
      setEditing(api.toEditForm(item));
      setFormOpen(true);
    },
    [api],
  );

  const openDelete = useCallback(
    (item) => {
      setConfirm({
        message: t("confirmDeleteAnnouncement", { title: item.title || "" }),
        onConfirm: () => {
          void api.remove(item);
        },
      });
    },
    [api, t],
  );

  const handleSubmit = useCallback(
    async (payload) => {
      if (payload?.id) return api.update(payload);
      return api.publish(payload);
    },
    [api],
  );

  const overlayOpen = formOpen || Boolean(confirm);

  const stickyBar = (
    <div className="m-ann-sticky">
      <MobileSubpageHeader
        backTo="/more"
        backAriaLabel={t("backToMore")}
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />
    </div>
  );

  if (api.blocked) return null;

  return (
    <MobileShell
      i18n={i18n}
      me={api.me}
      companyCode={api.companyCode}
      groupId={api.groupId}
      onLogout={api.logout}
      onRefresh={api.refresh}
      refreshing={api.refreshing}
      stickyBar={stickyBar}
      lang={api.lang}
      onLangChange={api.setLang}
      overlayOpen={overlayOpen}
      floatingAction={
        <button
          type="button"
          className="m-account-fab tap-scale"
          onClick={openCreate}
          aria-label={t("createNewAnnouncement")}
        >
          <i className="fas fa-plus" aria-hidden="true" />
        </button>
      }
      overlay={
        <>
          <AnnouncementFormSheet
            open={formOpen}
            onClose={() => setFormOpen(false)}
            t={t}
            initial={editing}
            onSubmit={handleSubmit}
          />
          <AnnouncementConfirmSheet
            open={Boolean(confirm)}
            onClose={() => setConfirm(null)}
            message={confirm?.message || ""}
            onConfirm={confirm?.onConfirm}
            t={t}
          />
        </>
      }
    >
      <div className="m-ann-admin-page">
        {api.toast ? (
          <div className={`m-account-toast ${api.toast.tone}`}>{api.toast.message}</div>
        ) : null}
        {api.error ? <div className="m-account-error">{api.error}</div> : null}

        <h2 className="m-ann-admin-section">{t("publishedAnnouncements")}</h2>

        {api.loading ? (
          <div className="m-account-loading">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <span>{t("loading")}</span>
          </div>
        ) : visible.length ? (
          <div className="m-ann-admin-list">
            {visible.map((item) => (
              <AnnouncementCard
                key={item.id}
                item={item}
                t={t}
                onEdit={openEdit}
                onDelete={openDelete}
              />
            ))}
            {hasMore ? <div ref={sentinelRef} className="m-admin-sentinel" aria-hidden="true" /> : null}
          </div>
        ) : (
          <div className="m-account-empty">
            <i className="fas fa-bullhorn" aria-hidden="true" />
            <p>{t("noAnnouncements")}</p>
          </div>
        )}
      </div>
    </MobileShell>
  );
}
