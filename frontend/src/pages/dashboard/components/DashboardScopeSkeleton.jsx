/** Quiet ambient placeholder while scope pack is genuinely still loading (Filter stays live).
 *  Only mounted past useDeferredReveal's grace period — an already-cached scope never sees this. */
export function DashboardScopeSkeleton() {
  return (
    <div className="dashboard-scope-skeleton" aria-hidden="true">
      <div className="dashboard-kpi-grid dashboard-scope-skeleton__kpi">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="dashboard-scope-skeleton__kpi-card dashboard-quiet-placeholder"
          />
        ))}
      </div>

      <div className="dashboard-panels-row dashboard-scope-skeleton__panels">
        <div className="dashboard-scope-skeleton__panel dashboard-scope-skeleton__panel--chart dashboard-quiet-placeholder" />
        <div className="dashboard-scope-skeleton__panel dashboard-scope-skeleton__panel--summary dashboard-quiet-placeholder" />
      </div>
    </div>
  );
}
