/** FB-style shimmer placeholders while scope pack is pending (Filter stays live). */
export function DashboardScopeSkeleton() {
  return (
    <div className="dashboard-scope-skeleton" aria-hidden="true">
      <div className="dashboard-kpi-grid dashboard-scope-skeleton__kpi">
        {[0, 1, 2].map((i) => (
          <div key={i} className="dashboard-scope-skeleton__kpi-card">
            <div className="dashboard-scope-skeleton__kpi-head">
              <span className="dashboard-skel-bar dashboard-skel-bar--icon" />
              <span className="dashboard-skel-bar dashboard-skel-bar--label" />
            </div>
            <span className="dashboard-skel-bar dashboard-skel-bar--value" />
            <span className="dashboard-skel-bar dashboard-skel-bar--foot" />
          </div>
        ))}
      </div>

      <div className="dashboard-panels-row dashboard-scope-skeleton__panels">
        <div className="dashboard-scope-skeleton__panel dashboard-scope-skeleton__panel--chart">
          <div className="dashboard-scope-skeleton__panel-head">
            <span className="dashboard-skel-bar dashboard-skel-bar--title" />
            <span className="dashboard-skel-bar dashboard-skel-bar--pill" />
          </div>
          <div className="dashboard-scope-skeleton__chart-body">
            <span className="dashboard-skel-bar dashboard-skel-bar--chart" />
          </div>
        </div>

        <div className="dashboard-scope-skeleton__panel dashboard-scope-skeleton__panel--summary">
          <div className="dashboard-scope-skeleton__panel-head">
            <span className="dashboard-skel-bar dashboard-skel-bar--title" />
          </div>
          <div className="dashboard-scope-skeleton__summary-hero">
            <span className="dashboard-skel-bar dashboard-skel-bar--hero-label" />
            <span className="dashboard-skel-bar dashboard-skel-bar--hero-value" />
          </div>
          <span className="dashboard-skel-bar dashboard-skel-bar--donut" />
          <div className="dashboard-scope-skeleton__rows">
            {[0, 1, 2].map((i) => (
              <span key={i} className="dashboard-skel-bar dashboard-skel-bar--row" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
