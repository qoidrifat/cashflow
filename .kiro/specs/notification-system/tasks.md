# Implementation Plan: Notification System

## Execution Update - 2026-06-20

Implemented in this repo:

- Supabase notification schema hardening migration: `supabase/migrations/20260619182050_notification_system_hardening.sql`
- Feature notification service/types/hook/components under `src/features/notifications/`
- Compatibility wrappers under `src/components/notifications/`
- Dedicated `/notifications` route
- Header bell integration
- Budget/Gmail/transaction notification triggers
- Zustand notification state with realtime status, initial fetch, granular realtime updates, and optimistic rollback
- Documentation: `docs/notification-database-schema.md` and root `task-list.md`

Pending manual/live checks:

- Apply migration to the target Supabase project.
- Verify Realtime and RLS with real authenticated users.
- Run browser visual pass for mobile and dark/light mode.

## Overview

This plan implements a persistent, real-time notification system for the CashFlow app. It covers: Supabase table creation with RLS, a service layer with deduplication/upsert logic, Zustand store enhancements, realtime subscriptions, notification trigger functions (budget/gmail/transaction), UI components (bell, dropdown, page with filters/pagination/swipe), accessibility, dark mode, and mobile responsiveness.

## Tasks

- [ ] 1. Database schema and types setup
  - [ ] 1.1 Create Supabase migration SQL for the `notifications` table
    - Create SQL migration file at `supabase/migrations/` or document in `sql/` with the full `CREATE TABLE`, indexes (`idx_notifications_user_created`, `idx_notifications_user_read`, `idx_notifications_dedupe`), RLS policies (SELECT/INSERT/UPDATE/DELETE), and the `cleanup_old_notifications` database function
    - Include CHECK constraints for `type`, `priority`, `title` length, `message` length
    - Include the unique partial index on `(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL`
    - _Requirements: 7.1, 7.2, 9.2, 20.1, 22.1, 22.2, 22.3_

  - [ ] 1.2 Update TypeScript types in `src/types/index.ts`
    - Add `NotificationPriority` type (`'low' | 'normal' | 'high'`)
    - Add `priority` optional field to `AppNotification` interface
    - Add `dedupeKey` optional field to `AppNotification` interface
    - Add `metadata` optional field to `AppNotification` interface
    - Add `CreateNotificationInput` interface
    - Ensure `NotificationType` includes all 8 types: `transaction`, `budget`, `gmail`, `system`, `success`, `warning`, `error`, `info`
    - _Requirements: 7.1, 14.1_

  - [ ] 1.3 Create notification mapper in `src/services/supabaseMappers.ts`
    - Add `mapNotification(row)` function that maps Supabase snake_case columns to camelCase `AppNotification`
    - Handle nullable fields (`action_label`, `action_href`, `dedupe_key`) mapping to `undefined`
    - Default `priority` to `'normal'` if missing
    - _Requirements: 7.1_

- [ ] 2. Notification service layer
  - [ ] 2.1 Implement `src/services/notificationService.ts` — core CRUD
    - Implement `fetchNotifications(userId, options)` with limit/offset/type/unreadOnly filtering, ordered by `created_at DESC`
    - Implement `createNotification(userId, data)` with input validation (non-empty title/message), upsert logic for non-null `dedupeKey` using `ON CONFLICT (user_id, dedupe_key)`, and plain insert for null dedupeKey
    - Implement `markNotificationRead(userId, notificationId)` — UPDATE `read = true`
    - Implement `markAllNotificationsRead(userId)` — batch UPDATE all unread
    - Implement `deleteNotification(userId, notificationId)` — DELETE by id
    - Implement `getUnreadCount(userId)` — SELECT count where `read = false`
    - Implement `enforceNotificationLimit(userId)` — call the DB cleanup function via RPC
    - Add request timeout handling (abort after 2s for fetch, 5s for delete)
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6, 9.1, 9.2, 9.4, 19.1, 19.5, 19.6, 22.1, 22.2, 22.3_

  - [ ]* 2.2 Write property tests for notification service validation and dedup
    - **Property 10: Input validation rejects empty title or message**
    - **Property 5: Dedupe upsert — same key updates existing**
    - **Property 6: Null dedupe key always creates new row**
    - **Validates: Requirements 7.5, 9.1, 9.4**

  - [ ] 2.3 Implement realtime subscription in `notificationService.ts`
    - Implement `subscribeToNotifications(userId, callbacks)` that creates a single Supabase Realtime channel on `notifications` table filtered by `user_id`
    - Handle INSERT, UPDATE, DELETE events mapping rows via `mapNotification`
    - Return unsubscribe function for cleanup
    - Handle connection errors via `onError` callback
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 19.4, 20.3_

- [ ] 3. Notification trigger functions
  - [ ] 3.1 Implement `src/services/notificationTriggers.ts` — budget triggers
    - Implement `triggerBudgetWarningNotification(userId, budget)` — creates notification when usage in [80%, 100%) with dedupeKey `budget-warning-{categoryId}-{month}-{year}`, checks that no overbudget notification exists first
    - Implement `triggerBudgetOverNotification(userId, budget)` — creates notification when usage > 100% with dedupeKey `budget-over-{categoryId}-{month}-{year}`, priority `high`
    - Include category name, usage percentage, remaining/overage amounts in messages
    - Set actionHref to `/budgets`, actionLabel to "Lihat Budget"
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ]* 3.2 Write property tests for budget trigger logic
    - **Property 7: Budget notification trigger logic**
    - **Validates: Requirements 10.1, 10.4, 11.1, 11.2, 11.5**

  - [ ] 3.3 Implement Gmail sync and transaction triggers in `notificationTriggers.ts`
    - Implement `triggerGmailSyncNotification(userId, pendingCount, failedCount)` — creates gmail notification if pendingCount > 0 (dedupeKey `gmail-review-{date}`), creates warning notification if failedCount > 0 (dedupeKey `gmail-failed-{date}`), no notification if both zero
    - Implement `triggerTransactionReviewNotification(userId, transaction)` — creates notification if confidence < 0.7, dedupeKey `tx-review-{transactionId}`, includes merchant/amount/category with "Tidak diketahui" fallback
    - Set appropriate actionHref values (`/gmail-sync`, `/transactions`)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 13.1, 13.2, 13.3, 13.4_

  - [ ]* 3.4 Write property tests for Gmail and transaction triggers
    - **Property 8: Gmail sync notification trigger logic**
    - **Property 9: Transaction review notification trigger**
    - **Validates: Requirements 12.1, 12.2, 12.3, 13.1, 13.2**

- [ ] 4. Zustand store enhancements
  - [ ] 4.1 Enhance notification state and actions in `useAppStore`
    - Add `notificationLoading: boolean` and `realtimeConnected: boolean` state
    - Add `setNotifications`, `prependNotification`, `updateNotification`, `setNotificationLoading`, `setRealtimeConnected` actions
    - Update existing `addNotification` to call `createNotification` service
    - Update `markNotificationRead` to use optimistic update pattern with rollback
    - Update `markAllNotificationsRead` to use optimistic update pattern with rollback
    - Update `removeNotification` to use optimistic update pattern with rollback
    - Enforce max 30 notifications in client store (evict oldest on prepend)
    - _Requirements: 7.3, 7.4, 8.2, 8.3, 8.4, 21.3, 21.4, 21.5, 22.4, 22.5_

  - [ ]* 4.2 Write property tests for store invariants
    - **Property 1: Unread count invariant**
    - **Property 11: Client store size invariant**
    - **Validates: Requirements 1.1, 4.3, 5.3, 6.5, 22.4, 22.5**

- [ ] 5. Checkpoint - Core service layer verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Notification Bell component
  - [ ] 6.1 Enhance `src/components/notifications/NotificationBell.tsx`
    - Display numeric unread count badge when count > 0, "9+" when > 9
    - Hide badge and show bell-off icon variant when count is 0
    - Add scale-in/scale-out spring animation for badge (framer-motion)
    - Show bell icon without badge during initial loading state
    - Add `aria-label` with state and count, `aria-expanded`, `aria-haspopup="menu"`
    - Add subtle connection status indicator when `realtimeConnected` is false
    - Use `aria-live="polite"` for the unread count badge
    - Ensure minimum touch target 44x44px on mobile, minimum badge diameter 16px
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 8.5, 16.6, 18.1, 18.2, 18.6_

  - [ ]* 6.2 Write unit tests for NotificationBell
    - Test badge renders correct count, "9+" threshold, hidden at 0
    - Test aria attributes update correctly
    - Test animation presence
    - _Requirements: 1.1, 1.2, 1.3, 18.1_

- [ ] 7. Notification Dropdown component
  - [ ] 7.1 Enhance `src/components/notifications/NotificationDropdown.tsx`
    - Display up to 15 most recent notifications sorted by createdAt descending
    - Open/close on bell click, close on Escape (return focus to bell), close on outside click
    - Show each item with type icon, title, message preview (max 2 lines), relative timestamp (Indonesian: "baru saja", "X menit lalu", "X jam lalu", "kemarin", date), unread dot
    - Show empty state with bell-off icon and "Belum ada notifikasi" message
    - Show "Mark all as read" button when unread count > 0
    - Max height 360px with overflow scroll
    - Prepend new realtime notifications while open
    - Focus trap with Tab/Shift+Tab cycling and Arrow Up/Down navigation
    - `role="menu"` on dropdown, `role="menuitem"` on items with descriptive `aria-label`
    - Mobile: max-width `calc(100vw - 24px)` below 640px, positioned right with 12px margin
    - Use `bg-app-elevated` with `backdrop-blur`, semantic color tokens
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 16.1, 16.2, 16.7, 17.1, 18.3, 18.4, 18.5, 19.2_

  - [ ]* 7.2 Write property test for dropdown sort order
    - **Property 2: Dropdown shows top-N sorted by creation time**
    - **Validates: Requirements 2.1**

  - [ ]* 7.3 Write unit tests for NotificationDropdown
    - Test open/close behavior, escape key, outside click
    - Test empty state, mark-all button visibility
    - Test focus trap and keyboard navigation
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 18.3, 18.4_

- [ ] 8. Notification Item component
  - [ ] 8.1 Enhance `src/components/notifications/NotificationItem.tsx`
    - Display distinct icon and color per notification type (8 types with specific icons and colors as per design)
    - High priority: 3px left border accent with type color, larger unread dot (2.5 units)
    - Low priority: reduced text opacity (60%)
    - Read/unread visual distinction: reduced background emphasis, hidden unread dot for read items
    - High priority + read: retain left border, hide unread dot
    - Display actionLabel truncated to 30 chars with ellipsis, `text-app-muted` styling
    - On click: mark as read, navigate if actionHref present, close dropdown if open
    - Skip redundant Supabase update if already read
    - Use dark-mode-aware color classes (light/dark variants per type)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 14.1, 14.2, 14.3, 14.4, 15.1, 15.2, 15.3, 15.4, 17.2, 17.3_

  - [ ]* 8.2 Write property test for actionLabel truncation
    - **Property 13: ActionLabel truncation**
    - **Validates: Requirements 15.2**

  - [ ]* 8.3 Write unit tests for NotificationItem
    - Test icon/color mapping for all 8 types
    - Test priority styling (high border, low opacity)
    - Test read/unread visual states
    - Test click behavior with/without actionHref
    - _Requirements: 14.1, 14.2, 14.3, 4.1, 4.5_

- [ ] 9. Checkpoint - UI components verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Dedicated Notifications Page
  - [ ] 10.1 Create `src/features/notifications/NotificationsPage.tsx`
    - Route at `/notifications` within authenticated layout
    - Display notifications ordered by `created_at DESC`, initially load 20
    - Show skeleton loading state during fetch
    - Show "Mark all as read" button in header when unread exist
    - Show empty state with filter-aware message when no results
    - Page heading `h1`, `nav` landmark for filters, `main` for list
    - Single-column layout on viewports below 640px
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7, 3.8, 16.3, 18.7_

  - [ ] 10.2 Create `src/features/notifications/NotificationFilters.tsx`
    - Type filter chips for all 8 types + "All" option
    - Unread-only toggle (AND logic with type filter)
    - Visually indicate active selection
    - _Requirements: 3.3, 3.4, 14.5_

  - [ ]* 10.3 Write property test for combined filter logic
    - **Property 3: Combined filter logic**
    - **Validates: Requirements 3.3, 3.4, 14.5**

  - [ ] 10.4 Create `src/features/notifications/SwipeableNotification.tsx`
    - Mobile swipe-to-delete wrapper (80px threshold)
    - Colored background indicator during swipe
    - Animate back if released before threshold
    - Desktop: contextual menu button for delete
    - Confirmation prompt before deletion
    - On delete success: remove from list, decrement unread if applicable
    - On delete failure: restore item, show error toast (5s)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 16.4, 16.5_

  - [ ] 10.5 Add route for NotificationsPage in `src/app/router.tsx`
    - Add `{ path: 'notifications', element: withSuspense(<NotificationsPage />) }` inside AuthGuard children
    - _Requirements: 3.1_

  - [ ]* 10.6 Write unit tests for NotificationsPage
    - Test route rendering, skeleton loading, pagination, empty state, filter integration
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.8_

- [ ] 11. Mark all as read functionality
  - [ ] 11.1 Implement "Mark all as read" button behavior in dropdown and page
    - Disable button and show loading indicator during operation
    - On success: set unread count to zero, hide badge
    - On failure: show error toast (5s), re-enable button, revert unread count
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 12. Notification triggers integration
  - [ ] 12.1 Integrate budget triggers in `DashboardPage.tsx`
    - After budget data loads, iterate categories and call `triggerBudgetWarningNotification` / `triggerBudgetOverNotification` as appropriate
    - Ensure trigger errors are logged but don't block dashboard render
    - _Requirements: 10.1, 10.5, 11.1_

  - [ ] 12.2 Integrate Gmail sync triggers in `gmailService.ts`
    - After sync completes, call `triggerGmailSyncNotification` with pending/failed counts
    - _Requirements: 12.1, 12.2, 12.3_

  - [ ] 12.3 Integrate transaction review trigger in transaction persistence flow
    - After gmail-sourced transaction is persisted with confidence < 0.7, call `triggerTransactionReviewNotification`
    - _Requirements: 13.1_

- [ ] 13. Realtime subscription initialization
  - [ ] 13.1 Initialize subscription on auth and cleanup on logout
    - On successful authentication: fetch initial 30 notifications, call `subscribeToNotifications` with store callbacks (`prependNotification`, `updateNotification`, remove on DELETE)
    - Maintain subscription across route navigations (subscribe at app level, not page level)
    - On logout: unsubscribe, clear notifications state
    - On auth token expiry: close channel, clear state
    - Implement polling fallback on connection loss (refetch on window focus)
    - Show/hide connection status indicator via `setRealtimeConnected`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 20.5, 21.1, 21.2, 21.6, 21.7_

- [ ] 14. Dark mode and theme support
  - [ ] 14.1 Ensure all notification components use semantic color tokens
    - Use `bg-app-elevated`, `text-app-text`, `text-app-muted`, `text-app-subtle`, `bg-app-hover`
    - Use dark-mode-aware classes (`dark:` variants) for type icon backgrounds/colors
    - Ensure minimum 4.5:1 contrast ratio for text
    - Verify theme switching applies within 300ms (CSS-driven, no JS delay)
    - Ensure unread indicator remains distinguishable in dark mode
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

- [ ] 15. Checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Dedupe key builder and cleanup wiring
  - [ ] 16.1 Create dedupe key builder utility functions
    - Implement deterministic key builders: `buildBudgetWarningKey(categoryId, month, year)`, `buildBudgetOverKey(categoryId, month, year)`, `buildGmailReviewKey(date)`, `buildGmailFailedKey(date)`, `buildTxReviewKey(transactionId)`
    - Place in `src/services/notificationTriggers.ts` or a shared utility
    - _Requirements: 9.3, 10.2, 11.3, 12.4, 12.6, 13.3_

  - [ ]* 16.2 Write property test for dedupe key determinism
    - **Property 4: Dedupe key determinism**
    - **Validates: Requirements 9.3, 10.2, 11.3, 12.4, 12.6, 13.3**

  - [ ]* 16.3 Write property test for database cleanup algorithm
    - **Property 12: Database cleanup algorithm**
    - **Validates: Requirements 22.1, 22.2, 22.3**

- [ ] 17. Accessibility final pass
  - [ ] 17.1 Verify and finalize all ARIA attributes and keyboard interactions
    - Ensure all interactive elements are keyboard-operable
    - Verify focus management (trap in dropdown, return to bell on close)
    - Verify `aria-live="polite"` on badge announces count changes
    - Verify `h1`, `nav`, `main` landmarks on NotificationsPage
    - Ensure 44x44px minimum touch targets on mobile
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8_

- [ ] 18. Security validation
  - [ ] 18.1 Verify client-side security checks in notification service
    - Add user_id match validation before processing operations
    - Ensure no notification data exposed in URL params or localStorage in plain text
    - Verify realtime subscription filter includes `user_id=eq.{userId}`
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

- [ ] 19. Final checkpoint - Complete system verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using `fast-check`
- Unit tests validate specific examples and edge cases using Vitest
- The project uses TypeScript, React 18, Zustand 5, Supabase, Tailwind CSS, Framer Motion, and Lucide React icons
- All notification messages use Indonesian language (Bahasa Indonesia) as per existing app patterns
- Existing notification component files (`NotificationBell.tsx`, `NotificationDropdown.tsx`, `NotificationItem.tsx`) are enhanced rather than replaced

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "16.1"] },
    { "id": 2, "tasks": ["2.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "4.2", "16.2"] },
    { "id": 4, "tasks": ["3.1", "3.3"] },
    { "id": 5, "tasks": ["3.2", "3.4", "16.3"] },
    { "id": 6, "tasks": ["6.1", "8.1"] },
    { "id": 7, "tasks": ["6.2", "7.1", "8.2", "8.3"] },
    { "id": 8, "tasks": ["7.2", "7.3", "10.1", "10.2"] },
    { "id": 9, "tasks": ["10.3", "10.4", "10.5", "11.1"] },
    { "id": 10, "tasks": ["10.6", "12.1", "12.2", "12.3"] },
    { "id": 11, "tasks": ["13.1", "14.1"] },
    { "id": 12, "tasks": ["17.1", "18.1"] }
  ]
}
```
