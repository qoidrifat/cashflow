# Requirements Document

## Introduction

This document defines the requirements for a professional notification system in the CashFlow app. The system provides real-time, in-app notifications for budget alerts, Gmail sync results, transaction events, and system messages. It integrates with the existing Supabase backend, Zustand state management, and the React/TypeScript/Tailwind UI layer. The notification system replaces the current in-memory-only notification placeholder with a persistent, real-time, Supabase-backed solution that supports deduplication, read/unread state, action links, and mobile-responsive UI.

## Glossary

- **Notification_System**: The complete feature encompassing the bell icon, dropdown, dedicated page, service layer, Supabase table, and realtime subscription for delivering in-app notifications to users.
- **Notification_Bell**: The bell icon component rendered in the Header that displays the unread notification count badge and toggles the Notification_Dropdown.
- **Notification_Dropdown**: The floating panel that appears below the Notification_Bell showing the most recent notifications with actions to mark as read.
- **Notification_Page**: A dedicated full-page view accessible via route `/notifications` that shows all notifications with filtering, pagination, and bulk actions.
- **Notification_Service**: The data access layer responsible for CRUD operations on the `notifications` Supabase table and managing realtime subscriptions.
- **Notification_Item**: A single notification entry containing type, title, message, read state, action link, dedupe key, priority, and timestamps.
- **Dedupe_Key**: A unique string composed of contextual identifiers (e.g., `budget-warning-{categoryId}-{month}-{year}`) used to prevent duplicate notifications for the same event.
- **Notification_Type**: The classification of a notification: `transaction`, `budget`, `gmail`, `system`, `success`, `warning`, `error`, or `info`.
- **Notification_Priority**: The urgency level of a notification: `low`, `normal`, or `high`.
- **Unread_Count**: The integer count of notifications where `read` equals `false` for the authenticated user.
- **Realtime_Subscription**: A Supabase Realtime channel listening to `postgres_changes` on the `notifications` table filtered by `user_id`.
- **Budget_Status**: The computed state of a budget category: `safe`, `warning` (usage >= 80%), or `over` (usage > 100%).
- **RLS**: Row Level Security — Supabase PostgreSQL policies that restrict data access to the owning user.

## Requirements

### Requirement 1: Notification Bell Display

**User Story:** As a user, I want to see an unread notification count badge on the bell icon in the header, so that I am aware of new notifications without opening the dropdown.

#### Acceptance Criteria

1. WHILE Unread_Count is greater than zero, THE Notification_Bell SHALL display the numeric Unread_Count value as a badge overlay on the bell icon.
2. WHILE Unread_Count exceeds 9, THE Notification_Bell SHALL display "9+" as the badge text instead of the numeric value.
3. IF Unread_Count equals zero, THEN THE Notification_Bell SHALL hide the badge and display the bell-off icon variant.
4. WHEN a new notification is inserted into the notifications table, THE Notification_Bell SHALL update the Unread_Count within 2 seconds via Realtime_Subscription.
5. THE Notification_Bell SHALL animate the badge appearance with a scale-in spring animation and disappearance with a scale-out spring animation, transitioning between visible and hidden states without instant jumps.
6. WHILE the initial notification fetch has not yet completed, THE Notification_Bell SHALL render the bell icon without a badge until the Unread_Count is determined.

### Requirement 2: Notification Dropdown

**User Story:** As a user, I want to open a dropdown from the bell icon to quickly view my recent notifications, so that I can stay informed without navigating away from my current page.

#### Acceptance Criteria

1. WHEN the user clicks the Notification_Bell while the dropdown is closed, THE Notification_Dropdown SHALL open displaying up to 15 most recent notifications ordered by creation time descending.
2. WHEN the user clicks the Notification_Bell while the dropdown is open, THE Notification_Dropdown SHALL close.
3. WHEN the Notification_Dropdown is open and the user presses the Escape key, THE Notification_Dropdown SHALL close and return focus to the Notification_Bell button.
4. WHEN the Notification_Dropdown is open and the user clicks outside the dropdown area, THE Notification_Dropdown SHALL close.
5. THE Notification_Dropdown SHALL display each Notification_Item with its type icon, title, message preview (max 2 lines truncated with ellipsis), relative timestamp (e.g., "baru saja" for < 1 minute, "5 menit lalu" for minutes, "2 jam lalu" for hours, "kemarin" for yesterday, date for older), and unread indicator dot.
6. WHEN there are zero notifications, THE Notification_Dropdown SHALL display an empty state with a bell-off illustrative icon and the message "Belum ada notifikasi".
7. THE Notification_Dropdown SHALL render a "Mark all as read" button when Unread_Count is greater than zero.
8. THE Notification_Dropdown SHALL have a maximum height of 360px with vertical scrolling for overflow content.
9. WHEN a new notification arrives via Realtime_Subscription while the dropdown is open, THE Notification_Dropdown SHALL prepend the new notification to the list.

### Requirement 3: Dedicated Notification Page

**User Story:** As a user, I want a dedicated page to view all my notifications with filtering options, so that I can review my full notification history.

#### Acceptance Criteria

1. THE Notification_Page SHALL be accessible at the route `/notifications` within the authenticated layout.
2. THE Notification_Page SHALL display notifications for the authenticated user ordered by creation time descending, initially loading the 20 most recent items.
3. THE Notification_Page SHALL provide filter controls allowing the user to select one Notification_Type at a time (from the 8 defined types) or "All" to show all types.
4. THE Notification_Page SHALL provide a toggle filter to show only unread notifications, applied in combination (AND logic) with the active type filter.
5. THE Notification_Page SHALL paginate notifications in batches of 20 items using a "Load more" button displayed below the list when additional notifications exist beyond the currently loaded set.
6. WHEN no notifications match the active filter combination, THE Notification_Page SHALL display an empty state message that references the active filter (e.g., indicating no results for the selected type or read status).
7. WHILE unread notifications exist for the authenticated user, THE Notification_Page SHALL display a "Mark all as read" action button in the page header that marks all of the user's unread notifications as read regardless of the active filter.
8. WHILE the Notification_Page is fetching notifications from Supabase, THE Notification_Page SHALL display a skeleton loading state in place of the notification list.

### Requirement 4: Mark Notification as Read

**User Story:** As a user, I want to mark individual notifications as read by clicking on them, so that I can track which notifications I have already reviewed.

#### Acceptance Criteria

1. WHEN the user clicks a Notification_Item in the Notification_Dropdown or Notification_Page, THE Notification_Service SHALL update the notification `read` field to `true` in the Supabase notifications table.
2. WHEN a Notification_Item has an actionHref, THE Notification_System SHALL close the Notification_Dropdown (if open), mark the notification as read, and navigate the user to the specified route.
3. WHEN a previously unread notification is marked as read, THE Notification_Bell SHALL decrement the Unread_Count by one.
4. IF a notification is already read and the user clicks it, THEN THE Notification_System SHALL not send a redundant update to Supabase but SHALL still navigate if actionHref is present.
5. THE Notification_Item SHALL visually distinguish read notifications from unread notifications using reduced background emphasis and hidden unread dot.

### Requirement 5: Mark All Notifications as Read

**User Story:** As a user, I want to mark all notifications as read with a single action, so that I can quickly clear my notification backlog.

#### Acceptance Criteria

1. WHEN the user clicks the "Mark all as read" button, THE Notification_Service SHALL update all unread notifications for the authenticated user to `read = true` in a single batch operation that completes within 2 seconds.
2. WHEN the user clicks the "Mark all as read" button, THE Notification_System SHALL disable the button and display a loading indicator until the operation completes or fails.
3. WHEN all notifications are successfully marked as read, THE Notification_Bell SHALL set the Unread_Count to zero and hide the badge.
4. IF the mark-all operation fails, THEN THE Notification_System SHALL display an error toast for 5 seconds, re-enable the "Mark all as read" button, and revert the Unread_Count to its previous value.

### Requirement 6: Delete Notification

**User Story:** As a user, I want to delete individual notifications, so that I can remove irrelevant items from my notification list.

#### Acceptance Criteria

1. THE Notification_Page SHALL provide a delete action on each Notification_Item accessible via a swipe gesture on mobile or a contextual menu button on desktop.
2. WHEN the user activates the delete action on a Notification_Item, THE Notification_System SHALL present a confirmation prompt before proceeding with deletion.
3. WHEN the user confirms deletion, THE Notification_Service SHALL remove the notification row from the Supabase notifications table within 5 seconds.
4. WHEN deletion succeeds, THE Notification_System SHALL remove the Notification_Item from the displayed list without a full page reload.
5. WHEN deletion succeeds and the deleted notification had `read` equal to `false`, THE Notification_Bell SHALL decrement the Unread_Count by one.
6. IF the deletion request fails or times out after 5 seconds, THEN THE Notification_System SHALL restore the notification to the list, display an error toast for 5 seconds, and retain the previous read state.

### Requirement 7: Notification Creation and Persistence

**User Story:** As a user, I want my notifications to persist across sessions, so that I do not lose important alerts when I close the app.

#### Acceptance Criteria

1. THE Notification_Service SHALL store all notifications in a Supabase `notifications` table with columns: `id` (uuid), `user_id` (uuid, FK to auth.users), `type` (text, constrained to valid Notification_Type values), `title` (text, max 200 characters), `message` (text, max 1000 characters), `read` (boolean, default false), `action_label` (text, nullable), `action_href` (text, nullable), `dedupe_key` (text, nullable), `priority` (text, default 'normal', constrained to valid Notification_Priority values), `metadata` (jsonb, default '{}'), `created_at` (timestamptz, default now()).
2. THE Notification_Service SHALL enforce RLS policies so that each user can only read, update, and delete notifications where `user_id` matches the authenticated user ID.
3. THE Notification_Service SHALL create notifications by inserting rows into the Supabase table rather than storing them only in client-side state.
4. WHEN the app initializes for an authenticated user, THE Notification_Service SHALL fetch the 30 most recent notifications from Supabase and populate the Zustand store.
5. THE Notification_Service SHALL validate that `title` is non-empty and `message` is non-empty before attempting to insert a notification.
6. IF a notification creation fails (network error, constraint violation, or server error), THEN THE Notification_Service SHALL log the error and not surface the failure to the user unless the creation was user-initiated.

### Requirement 8: Realtime Notification Updates

**User Story:** As a user, I want to receive notifications in real-time without refreshing the page, so that I am immediately informed of important events.

#### Acceptance Criteria

1. WHEN the user successfully authenticates, THE Notification_Service SHALL establish a Realtime_Subscription on the `notifications` table filtered by the user's ID, and the subscription SHALL remain active across in-app route navigations until the user logs out or the browser tab is closed.
2. WHEN a new row is inserted into the notifications table matching the user's ID, THE Notification_System SHALL prepend the notification to the Zustand store and update the Unread_Count within 2 seconds.
3. WHEN a notification row is updated via Realtime_Subscription (e.g., `read` field changed from another device), THE Notification_System SHALL update the corresponding Notification_Item's displayed state and Unread_Count in the UI within 2 seconds.
4. WHEN a notification row is deleted via Realtime_Subscription, THE Notification_System SHALL remove the corresponding Notification_Item from the UI list and update the Unread_Count within 2 seconds.
5. WHEN the realtime connection is lost, THE Notification_System SHALL attempt reconnection using Supabase's built-in reconnection strategy and display a subtle visual indicator in the Notification_Bell to signal the disconnected state.
6. WHEN the user logs out, THE Notification_Service SHALL unsubscribe from the Realtime_Subscription and clear the notifications state from the Zustand store.

### Requirement 9: Deduplication Logic

**User Story:** As a user, I want the system to prevent duplicate notifications for the same event, so that my notification list remains clean and spam-free.

#### Acceptance Criteria

1. WHEN a notification with a Dedupe_Key is created and a notification with the same Dedupe_Key already exists for the user, THE Notification_Service SHALL update the existing notification's `title`, `message`, `created_at`, `priority`, `action_label`, `action_href`, and `metadata` fields with the new values and set `read` to false, instead of creating a duplicate.
2. THE Notification_Service SHALL enforce dedupe logic at the database level using a unique constraint or upsert operation on `(user_id, dedupe_key)` where dedupe_key is not null.
3. THE Notification_System SHALL construct Dedupe_Keys using deterministic, contextual identifiers (e.g., `budget-warning-{categoryId}-{month}-{year}` for budget warnings).
4. WHEN a notification is created without a Dedupe_Key (dedupe_key is null), THE Notification_Service SHALL insert it as a new notification without performing any deduplication check.

### Requirement 10: Budget Warning Notifications

**User Story:** As a user, I want to receive a notification when my spending in a budget category reaches 80% of the limit, so that I can adjust my spending before exceeding the budget.

#### Acceptance Criteria

1. WHEN the dashboard loads and a budget category has Budget_Status equal to `warning` (usage >= 80% and < 100%), THE Notification_System SHALL create a budget warning notification with type `budget`, priority `normal`, title containing the category name (e.g., "Budget [categoryName] Hampir Penuh"), and a message including the current usage percentage (rounded to the nearest integer) and remaining amount formatted as currency.
2. THE budget warning notification SHALL use a Dedupe_Key of `budget-warning-{categoryId}-{month}-{year}` to ensure only one warning notification exists per category per month.
3. THE budget warning notification SHALL include an actionHref pointing to `/budgets` and an actionLabel of "Lihat Budget".
4. WHEN a budget category already has an overbudget notification (Dedupe_Key `budget-over-{categoryId}-{month}-{year}`) for the same month, THE Notification_System SHALL NOT create a warning notification for that category.
5. IF the budget warning notification creation fails, THEN THE Notification_System SHALL log the error and continue loading the dashboard without blocking the user interface.

### Requirement 11: Budget Overbudget Notifications

**User Story:** As a user, I want to receive a notification when my spending exceeds the budget limit in a category, so that I am immediately aware of overspending.

#### Acceptance Criteria

1. WHEN the dashboard loads and a budget category has Budget_Status equal to `over` (usage > 100%), THE Notification_System SHALL create an overbudget notification with type `budget` and priority `high`.
2. THE overbudget notification SHALL include a title containing the category name, and a message containing the category name, the overage amount (total spending minus budget limit), and total spending.
3. THE overbudget notification SHALL use a Dedupe_Key of `budget-over-{categoryId}-{month}-{year}` to ensure only one overbudget notification exists per category per month.
4. THE overbudget notification SHALL include an actionHref pointing to `/budgets`.
5. IF a category already has an overbudget notification (matching Dedupe_Key) in the same month, THEN THE Notification_System SHALL not create a warning notification for that category.
6. WHEN the dashboard loads and a budget category previously had Budget_Status `over` but now has Budget_Status `safe` or `warning`, THE Notification_System SHALL retain the existing overbudget notification without deletion or modification.

### Requirement 12: Gmail Sync Result Notifications

**User Story:** As a user, I want to receive a notification summarizing the results of a Gmail sync operation, so that I know how many transactions were found and need my review.

#### Acceptance Criteria

1. WHEN a Gmail sync operation completes with at least one pending review transaction, THE Notification_System SHALL create a notification with type `gmail`, priority `normal`, containing the count of transactions awaiting review in the message.
2. WHEN a Gmail sync operation completes with at least one failed extraction, THE Notification_System SHALL create a notification with type `warning`, priority `normal`, containing the count of failed emails in the message, and an actionHref pointing to `/gmail-sync`.
3. IF a Gmail sync operation completes with zero pending review transactions and zero failed extractions, THEN THE Notification_System SHALL not create any Gmail sync notification.
4. THE Gmail sync notification SHALL use a Dedupe_Key of `gmail-review-{date}` where `{date}` is the current ISO date (YYYY-MM-DD), limiting to one pending-review notification per calendar day regardless of how many sync operations are performed.
5. THE Gmail sync notification SHALL include an actionHref pointing to `/gmail-sync`.
6. THE Gmail failed notification SHALL use a Dedupe_Key of `gmail-failed-{date}` where `{date}` is the current ISO date (YYYY-MM-DD), limiting to one failure notification per calendar day.

### Requirement 13: Transaction-Related Notifications

**User Story:** As a user, I want to receive notifications about important transaction events such as large transactions or recurring payment reminders, so that I stay informed about my financial activity.

#### Acceptance Criteria

1. WHEN a transaction with source `gmail` is persisted with a confidence score below 0.7, THE Notification_System SHALL create a notification with type `transaction`, priority `normal`, and a title of "Transaksi Perlu Ditinjau" indicating that the transaction requires manual review.
2. THE transaction review notification message SHALL include the merchant name, amount (formatted in the user's currency), and category name. IF merchant or category is unavailable, THEN THE Notification_System SHALL display "Tidak diketahui" as the fallback value for the missing field.
3. THE transaction review notification SHALL use a Dedupe_Key of `tx-review-{transactionId}` to prevent duplicates for the same transaction.
4. THE transaction review notification SHALL include an actionHref pointing to `/transactions` and an actionLabel of "Lihat Transaksi".

### Requirement 14: Notification Type and Priority System

**User Story:** As a user, I want notifications to be visually categorized by type and urgency, so that I can quickly identify important alerts.

#### Acceptance Criteria

1. THE Notification_Item SHALL display a distinct icon and color scheme for each Notification_Type: transaction (receipt icon, primary color), budget (pie chart icon, amber color), gmail (mail icon, mint color), system (settings icon, slate color), success (check icon, mint color), warning (triangle icon, amber color), error (alert icon, red color), info (info icon, blue color).
2. IF a notification has priority `high`, THEN THE Notification_Item SHALL display a 3px left border accent using the Notification_Type color and a larger unread indicator dot (width and height of 2.5 units instead of 1.5 units) to visually distinguish it from `normal` and `low` priority notifications.
3. IF a notification has priority `low`, THEN THE Notification_Item SHALL display with reduced text opacity (60%) compared to `normal` priority notifications.
4. IF a notification has priority `high` and `read` equals true, THEN THE Notification_Item SHALL retain the left border accent but hide the unread indicator dot.
5. THE Notification_System SHALL support filtering notifications by Notification_Type on the Notification_Page, displaying selectable filter chips for each type that visually indicate the active selection.

### Requirement 15: Notification Action Links

**User Story:** As a user, I want to click on a notification to navigate directly to the relevant page, so that I can quickly act on the notification's content.

#### Acceptance Criteria

1. WHEN the user clicks a Notification_Item that has an actionHref value, THE Notification_System SHALL close the Notification_Dropdown (if open), mark the notification as read, and navigate the user to the specified route using client-side routing without a full page reload.
2. IF a Notification_Item has an actionLabel value, THEN THE Notification_Item SHALL display the label as a call-to-action text, truncated to a maximum of 30 characters with an ellipsis if exceeded, using `text-app-muted` styling at a smaller font size than the notification message.
3. IF a Notification_Item does not have an actionHref value, THEN THE Notification_System SHALL only mark the notification as read upon clicking without performing any navigation.
4. IF the user clicks a Notification_Item whose actionHref does not match any defined application route, THEN THE Notification_System SHALL mark the notification as read, close the Notification_Dropdown, and navigate to the route (allowing the application's existing not-found handling to apply).

### Requirement 16: Mobile Responsive UI

**User Story:** As a user on a mobile device, I want the notification UI to be fully functional and visually appropriate for small screens, so that I can manage notifications on any device.

#### Acceptance Criteria

1. THE Notification_Dropdown SHALL have a maximum width of `calc(100vw - 24px)` on viewports below 640px to prevent horizontal overflow.
2. THE Notification_Dropdown SHALL be positioned to the right edge of the viewport on viewports below 640px with a minimum margin of 12px from any viewport edge.
3. THE Notification_Page SHALL use a single-column layout on viewports below 640px with notification items spanning the full content width.
4. WHEN the user swipes a Notification_Item horizontally by at least 80px on a touch-enabled device, THE Notification_System SHALL reveal a delete action and execute deletion upon swipe completion, displaying a colored background indicator during the swipe to signal the pending action.
5. IF the user releases a swipe gesture before reaching the 80px threshold, THEN THE Notification_Item SHALL animate back to its original position without triggering deletion.
6. THE Notification_Bell badge SHALL remain visible at all supported viewport sizes (320px and above) with a minimum diameter of 16px and a minimum font size of 9px.
7. THE Notification_Dropdown and Notification_Page interactive elements SHALL have a minimum touch target size of 44x44px on viewports below 640px.

### Requirement 17: Dark Mode and Light Mode Support

**User Story:** As a user, I want the notification UI to respect my theme preference, so that notifications are readable in both light and dark modes.

#### Acceptance Criteria

1. THE Notification_Dropdown SHALL use the `bg-app-elevated` background token with `backdrop-blur` so that the dropdown background adapts to both light and dark themes without hardcoded color values.
2. THE Notification_Item SHALL use semantic color tokens (`text-app-text`, `text-app-muted`, `text-app-subtle`, `bg-app-hover`) for all text and background elements, ensuring a minimum contrast ratio of 4.5:1 between text and its background in both themes.
3. THE Notification_Item type icons SHALL use dark-mode-aware color classes (light variant and `dark:` variant) for each notification type, providing distinct background and text colors per type in both themes.
4. WHEN the user switches theme via the application setting, THE Notification_System SHALL apply the new theme colors to all visible notification elements within 300 milliseconds without requiring a page reload.
5. WHEN the operating system theme preference changes, IF the user's theme setting is "system", THEN THE Notification_System SHALL apply the updated resolved theme to all notification elements within 300 milliseconds without requiring a page reload.
6. WHILE the dark theme is active, THE Notification_Item unread indicator background SHALL remain visually distinguishable from the default item background, using a contrast difference sufficient to identify unread items without relying on color alone (unread dot indicator present).

### Requirement 18: Accessibility

**User Story:** As a user relying on assistive technology, I want the notification system to be fully accessible, so that I can perceive and interact with all notification features.

#### Acceptance Criteria

1. THE Notification_Bell button SHALL include an `aria-label` that reflects the current state (indicating open or close action and the current Unread_Count) and `aria-expanded` set to `true` when the dropdown is open or `false` when closed.
2. THE Notification_Bell button SHALL include `aria-haspopup="menu"` to communicate the dropdown behavior.
3. THE Notification_Dropdown SHALL use `role="menu"` and individual notification items SHALL use `role="menuitem"` with an `aria-label` containing the notification title, type, and read/unread state.
4. WHILE the Notification_Dropdown is open, THE Notification_Dropdown SHALL trap focus so that Tab and Shift+Tab cycle only through focusable elements within the dropdown, and Arrow Down/Arrow Up keys move focus between menu items.
5. WHEN the Notification_Dropdown is closed (via Escape key, outside click, or item selection), THE Notification_System SHALL return focus to the Notification_Bell button.
6. THE Unread_Count badge SHALL use `aria-live="polite"` with a text content that announces the numeric count so screen readers announce changes without interrupting current speech.
7. THE Notification_Page SHALL use a single `h1` heading for the page title, `nav` landmark for filter controls, and `main` landmark for the notification list to support screen reader navigation.
8. THE Notification_System SHALL ensure all interactive elements (bell button, notification items, action buttons) are reachable and operable via keyboard alone without requiring a pointing device.

### Requirement 19: Performance

**User Story:** As a user, I want the notification system to load quickly and not degrade the app's performance, so that my experience remains smooth.

#### Acceptance Criteria

1. THE Notification_Service SHALL fetch at most 30 notifications on initial load to limit payload size.
2. THE Notification_Dropdown SHALL render only the notification items within the visible scroll viewport plus a 100px buffer above and below, deferring DOM creation for items outside that range until the user scrolls them into proximity.
3. THE Notification_Page SHALL implement load-more pagination fetching 20 additional items per request.
4. THE Realtime_Subscription SHALL use a single channel per authenticated session rather than creating multiple subscriptions.
5. WHEN the Notification_Service fetches notifications, THE operation SHALL complete within 500ms measured from the moment the request is initiated to the moment the response data is available in the Zustand store, given a network round-trip latency of 100ms or less to the Supabase server.
6. IF the notification fetch does not complete within 2 seconds, THEN THE Notification_Service SHALL abort the request, display the UI with the currently available cached state, and log the timeout event.

### Requirement 20: Security and Privacy

**User Story:** As a user, I want my notifications to be private and secure, so that no other user can access my notification data.

#### Acceptance Criteria

1. THE Supabase notifications table SHALL enforce RLS with policies: SELECT where `user_id = auth.uid()`, UPDATE where `user_id = auth.uid()`, DELETE where `user_id = auth.uid()`, INSERT where `user_id = auth.uid()`.
2. IF the authenticated user's ID does not match the target notification's `user_id` during a client-side operation, THEN THE Notification_Service SHALL reject the operation, discard the response data, and not update the Zustand store.
3. THE Realtime_Subscription SHALL filter events by `user_id=eq.{userId}` to ensure users only receive their own notifications.
4. THE Notification_System SHALL not expose notification fields (title, message, metadata, action_href) in browser URL parameters or local storage in plain text.
5. IF the user's authentication token expires or becomes invalid while a Realtime_Subscription is active, THEN THE Notification_Service SHALL close the subscription channel and clear the notifications state from the Zustand store until the user re-authenticates.

### Requirement 21: Error Handling

**User Story:** As a user, I want the notification system to handle errors gracefully without disrupting my workflow, so that I can continue using the app even when notification operations fail.

#### Acceptance Criteria

1. IF the initial notification fetch fails (network error, timeout after 10 seconds, or server error response), THEN THE Notification_System SHALL display the UI with an empty state and log the error without blocking page render.
2. IF the Realtime_Subscription fails to connect, THEN THE Notification_System SHALL fall back to polling on page focus events and display a non-interactive connection status indicator visible only in the Notification_Dropdown header area.
3. IF a mark-as-read operation fails, THEN THE Notification_System SHALL revert the optimistic UI update within 1 second and display an error toast that auto-dismisses after 5 seconds.
4. IF the notification deletion fails, THEN THE Notification_System SHALL restore the notification to its original position in the list and display an error toast that auto-dismisses after 5 seconds.
5. THE Notification_Service SHALL apply optimistic UI updates for mark-as-read and delete operations by updating the Zustand store before the server response is received.
6. IF a notification operation fails and the user retries the same operation, THE Notification_System SHALL permit the retry without requiring a page reload.
7. IF the Realtime_Subscription reconnects after a fallback to polling, THEN THE Notification_System SHALL remove the connection status indicator and resume realtime updates.

### Requirement 22: Notification Limit and Cleanup

**User Story:** As a user, I want old notifications to be automatically managed, so that my notification list does not grow indefinitely.

#### Acceptance Criteria

1. THE Notification_System SHALL retain a maximum of 100 notifications per user in the Supabase table.
2. WHEN a new notification is inserted and the user's notification count exceeds 100, THE Notification_Service SHALL delete the oldest read notifications (ordered by `created_at` ascending) to bring the total count back to 100.
3. IF there are not enough read notifications to delete to bring the count to 100, THEN THE Notification_Service SHALL delete the oldest unread notifications (ordered by `created_at` ascending) until the total count equals 100.
4. THE client-side Zustand store SHALL hold a maximum of 30 notifications at any time for performance.
5. WHEN a new realtime notification arrives and the Zustand store already contains 30 notifications, THE Notification_System SHALL remove the oldest notification (by `created_at`) from the store before prepending the new notification.
6. THE Notification_Page SHALL support fetching older notifications beyond the initial 30 via pagination from Supabase using 20 items per page.
