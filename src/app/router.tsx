import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import AuthGuard from '../features/auth/AuthGuard';
import ErrorBoundary from '../components/ErrorBoundary';

const LandingPage = lazy(() => import('../features/landing/LandingPage'));
const LoginPage = lazy(() => import('../features/auth/LoginPage'));
const AuthCallbackPage = lazy(() => import('../features/auth/AuthCallbackPage'));
const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const FraudPage = lazy(() => import('../features/fraud/FraudPage'));
const TransactionsPage = lazy(() => import('../features/transactions/TransactionsPage'));
const BudgetsPage = lazy(() => import('../features/budgets/BudgetsPage'));
const RecurringPage = lazy(() => import('../features/transactions/RecurringPage'));
const ReportsPage = lazy(() => import('../features/reports/ReportsPage'));
const AdvisorPage = lazy(() => import('../features/advisor/AdvisorPage'));
const AiHubPage = lazy(() => import('../features/ai-product/AiHubPage'));
const AiConversationPage = lazy(() => import('../features/ai-product/chat/AiConversationPage'));
const AiTimelinePage = lazy(() => import('../features/ai-product/timeline/AiTimelinePage'));
const ProfessionalSuitePage = lazy(() => import('../features/professional/ProfessionalSuitePage'));
const GmailSyncPage = lazy(() => import('../features/gmail/GmailSyncPage'));
const NotificationsPage = lazy(() => import('../features/notifications/NotificationsPage'));
const ProfilePage = lazy(() => import('../features/profile/ProfilePage'));
const CategoriesPage = lazy(() => import('../features/categories/CategoriesPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));
const PrivacyPage = lazy(() => import('../features/privacy/PrivacyPage'));
const ReconciliationPage = lazy(() => import('../features/reconciliation/ReconciliationPage'));
const AiSearchPage = lazy(() => import('../pages/AiSearchPage'));
const KnowledgeAssistantPage = lazy(() => import('../features/ai-knowledge/KnowledgeAssistantPage'));
const MonitoringPage = lazy(() => import('../pages/admin/MonitoringPage'));
const FeatureDetailPage = lazy(() => import('../pages/admin/FeatureDetailPage'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-4">
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
          <img
            src="/logo/cashflow-icon.webp"
            alt=""
            className="cashflow-loader-icon h-10 w-10 object-contain"
            draggable={false}
          />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Memuat halaman...
        </p>
      </div>
    </div>
  );
}

function withSuspense(element: ReactNode) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>{element}</Suspense>
    </ErrorBoundary>
  );
}

export const router = createBrowserRouter([
  {
    path: '/landing',
    element: withSuspense(<LandingPage />),
  },
  {
    path: '/login',
    element: withSuspense(<LoginPage />),
  },
  {
    path: '/auth/callback',
    element: withSuspense(<AuthCallbackPage />),
  },
  {
    // CRITICAL-V1 fix: root '/' diproteksi AuthGuard (bukan splash public).
    // User belum login → redirect ke /login. Login → /dashboard.
    path: '/',
    element: (
      <AuthGuard>
        <AppLayout />
      </AuthGuard>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: withSuspense(<DashboardPage />),
      },
      {
        path: 'fraud',
        element: withSuspense(<FraudPage />),
      },
      {
        path: 'transactions',
        element: withSuspense(<TransactionsPage />),
      },
      {
        path: 'budgets',
        element: withSuspense(<BudgetsPage />),
      },
      {
        path: 'recurring',
        element: withSuspense(<RecurringPage />),
      },
      {
        path: 'reports',
        element: withSuspense(<ReportsPage />),
      },
      {
        path: 'advisor',
        element: withSuspense(<AdvisorPage />),
      },
      {
        path: 'ai',
        element: withSuspense(<AiHubPage />),
      },
      {
        path: 'ai/chat',
        element: withSuspense(<AiConversationPage />),
      },
      {
        path: 'ai/timeline',
        element: withSuspense(<AiTimelinePage />),
      },
      {
        path: 'professional',
        element: withSuspense(<ProfessionalSuitePage />),
      },
      {
        path: 'suite/ai-search',
        element: withSuspense(<AiSearchPage />),
      },
      {
        path: 'suite/ai-knowledge',
        element: withSuspense(<KnowledgeAssistantPage />),
      },
      {
        path: 'admin/monitoring',
        element: withSuspense(<MonitoringPage />),
      },
      {
        path: 'admin/monitoring/:feature',
        element: withSuspense(<FeatureDetailPage />),
      },
      {
        path: 'gmail-sync',
        element: withSuspense(<GmailSyncPage />),
      },
      {
        path: 'notifications',
        element: withSuspense(<NotificationsPage />),
      },
      {
        path: 'categories',
        element: withSuspense(<CategoriesPage />),
      },
      {
        path: 'profile',
        element: withSuspense(<ProfilePage />),
      },
      {
        path: 'settings',
        element: withSuspense(<SettingsPage />),
      },
      {
        path: 'privacy',
        element: withSuspense(<PrivacyPage />),
      },
      {
        path: 'reconciliation',
        element: withSuspense(<ReconciliationPage />),
      },
    ],
  },
  {
    path: '*',
    element: withSuspense(<NotFoundPage />),
  },
]);
