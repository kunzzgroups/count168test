import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import DashboardPage from "./pages/dashboard/DashboardPage.jsx";
import LoginPage from "./pages/login/LoginPage.jsx";
import SecondaryPasswordPage from "./pages/login/SecondaryPasswordPage.jsx";
import StubPage from "./pages/StubPage.jsx";
import { clearMobileTxListSnapshot } from "./lib/mobileTxListSnapshot.js";
import TransactionLayout from "./pages/transaction/TransactionLayout.jsx";
import TransactionPage from "./pages/transaction/TransactionPage.jsx";
import TransactionHistoryPage from "./pages/transaction/TransactionHistoryPage.jsx";
import AccountPage from "./pages/account/AccountPage.jsx";
import MorePage from "./pages/more/MorePage.jsx";
import AdminUsersPage from "./pages/admin/AdminUsersPage.jsx";
import MaintenanceHubPage from "./pages/maintenance/MaintenanceHubPage.jsx";
import MaintenanceTransactionPage from "./pages/maintenance/MaintenanceTransactionPage.jsx";
import MaintenancePaymentPage from "./pages/maintenance/MaintenancePaymentPage.jsx";
import MaintenanceBankprocessPage from "./pages/maintenance/MaintenanceBankprocessPage.jsx";
import BankProcessListPage from "./pages/bankprocess/BankProcessListPage.jsx";
import ReportHubPage from "./pages/report/ReportHubPage.jsx";
import DomainReportPage from "./pages/report/DomainReportPage.jsx";
import CustomerReportPage from "./pages/report/CustomerReportPage.jsx";
import MobileBottomNavHost from "./components/layout/MobileBottomNavHost.jsx";

/** Drop list snapshot when leaving Transaction so bottom-nav re-entry stays default. */
function ClearTxListSnapshotOutsideTransaction() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!pathname.startsWith("/transaction")) {
      clearMobileTxListSnapshot();
    }
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ClearTxListSnapshotOutsideTransaction />
      <MobileBottomNavHost />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/home" element={<Navigate to="/dashboard" replace />} />
        <Route path="/member" element={<StubPage title="会员 Win/Loss" backTo="/login" />} />
        <Route path="/report" element={<ReportHubPage />} />
        <Route path="/report/domain" element={<DomainReportPage />} />
        <Route path="/report/customer" element={<CustomerReportPage />} />
        <Route path="/transaction" element={<TransactionLayout />}>
          <Route index element={<TransactionPage />} />
          <Route path="history" element={<TransactionHistoryPage />} />
        </Route>
        <Route path="/account" element={<AccountPage />} />
        <Route path="/maintenance" element={<MaintenanceHubPage />} />
        <Route path="/maintenance/transaction" element={<MaintenanceTransactionPage />} />
        <Route path="/maintenance/payment" element={<MaintenancePaymentPage />} />
        <Route path="/maintenance/bankprocess" element={<MaintenanceBankprocessPage />} />
        <Route path="/maintenance/bank-process" element={<BankProcessListPage />} />
        <Route path="/more" element={<MorePage />} />
        <Route path="/more/users" element={<AdminUsersPage />} />
        <Route path="/reset-password" element={<StubPage title="重置密码" />} />
        <Route
          path="/owner-secondary-password"
          element={<SecondaryPasswordPage variant="owner" />}
        />
        <Route
          path="/user-secondary-password"
          element={<SecondaryPasswordPage variant="user" />}
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}
