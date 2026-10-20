# Real-Time Chat Website — Complete Project Blueprint

## 1. Project goal

Build a responsive, real-time chat website inspired by the supplied reference image. Users can chat privately, create and manage groups, share files and images, see online status, and receive instant message updates. Administrators manage accounts, settings, and user-submitted reports without having unrestricted access to private conversations by default.

**Recommended stack**
- Frontend: React + Vite, JavaScript, React Router, Socket.IO Client, Axios, CSS modules or one consistent global design system.
- Backend: Node.js + Express, Socket.IO, bcrypt, input validation (Zod or Joi), Helmet, rate limiting.
- Database: MySQL 8+, accessed through `mysql2/promise` with parameterized queries.
- Files: local upload folder while developing; private object storage in production. Store a file key/path in MySQL, not the file's binary contents.
- Deployment: HTTPS, environment variables, managed MySQL backups, and a process manager. Add Redis + a Socket.IO Redis adapter only when running multiple backend instances.

## 2. User roles and permissions

### Guest
- Register, sign in, request a password reset, and view public pages only.
- Cannot read messages or see private group contents.

### Regular user
- Manage their profile, avatar, privacy/notification preferences, and active sessions.
- Search users, start one-to-one conversations, add contacts/favorites, block users, and report abuse.
- Send and receive text messages in real time; reply, edit or delete their own messages according to the application's edit/delete policy; react with emoji.
- Upload allowed images/files, download permitted attachments, see sent/delivered/read status, and search their conversations.
- Create groups, name/describe them, set a group image, invite members, leave groups, and manage groups they own.
- Group owners/admins can add/remove members and update group settings. Ordinary members cannot promote themselves, change owner-only settings, or remove other members.
- Mute, pin, or archive a conversation locally for their own account.

### Administrator
- Use a separate protected admin area after signing in. The server must check the database role on every protected admin request.
- View dashboard totals, user directory, active/suspended accounts, open reports, and basic system settings.
- Suspend/reactivate accounts, revoke sessions, and review user-submitted reports. Record sensitive actions in `admin_audit_logs`.
- Set practical limits such as maximum upload size and allowed file types.
- Do not give administrators a hidden, unrestricted private-message browsing feature by default. Access reported content only as needed for a legitimate moderation workflow, and document that policy clearly.

## 3. Screen and navigation plan

### Main app layout (matching the reference image)
1. **Left navigation rail:** app logo, Chats, Contacts, Groups, Archived, Settings; Admin Panel appears only for admins.
2. **Conversation list:** search field, filter tabs (All/Unread/Groups), avatar, display name/group title, last-message preview, time, unread badge, online dot.
3. **Central chat panel:** conversation header and participant status; scrollable messages; date separators; reply preview; attachment preview; composer; emoji, attach, send, and optional voice-message controls.
4. **Right information panel:** direct-chat profile or group About, members, shared files, pinned messages, notifications/mute, and group management controls. Make this panel collapsible on smaller screens.

### Pages/routes
- `/login` — sign in.
- `/register` — create account.
- `/forgot-password` and `/reset-password` — account recovery flow.
- `/chat` — main chat shell; list and details are selected within the shell.
- `/contacts` — find users, saved contacts, favorites, and blocked users.
- `/groups/new` — create a group.
- `/settings/profile`, `/settings/privacy`, `/settings/notifications`, `/settings/sessions` — account settings.
- `/admin` — protected summary dashboard.
- `/admin/users` — search, suspend/reactivate, and revoke sessions.
- `/admin/reports` — moderation queue and review outcome.
- `/admin/settings` — upload limits and product settings.

Use responsive layouts: three columns on wide desktops, two columns on tablets, and one active panel at a time on phones. Keep the chat composer fixed at the bottom of the active conversation without covering messages.

## 4. Database tables and attributes

The executable starter schema is in `realtime_chat_schema.sql`. It creates the `realtime_chat` database and these tables. IDs use `BIGINT UNSIGNED`; timestamps are stored in UTC. Use soft deletion/account status for users rather than hard-deleting accounts that own messages.

### 4.1 `users` — accounts and profiles
- `id` BIGINT UNSIGNED, primary key, auto-increment.
- `username` VARCHAR(30), unique, required.
- `email` VARCHAR(255), unique, required.
- `password_hash` VARCHAR(255), required; never store a plain password.
- `display_name` VARCHAR(80), required; `phone` VARCHAR(30), optional.
- `avatar_key` VARCHAR(500), optional file-storage key; `bio` VARCHAR(300), optional.
- `role` ENUM(user, admin), defaults to user.
- `account_status` ENUM(pending_verification, active, suspended, deleted), defaults to active.
- `email_verified_at`, `last_seen_at`, `created_at`, `updated_at` DATETIME fields.

### 4.2 `user_sessions` — refresh sessions/devices
- `id` primary key; `user_id` foreign key to users.
- `refresh_token_hash` CHAR(64), unique; `device_name`, `user_agent`, `ip_address`.
- `expires_at`, `revoked_at`, `created_at`.
- Store only a hash of a refresh token; revoke it at logout and when an admin/user ends a session.

### 4.3 `password_reset_tokens` — password recovery
- `id`, `user_id`, `token_hash` (unique), `expires_at`, `used_at`, `created_at`.
- Email a random, short-lived token/link; store its hash and invalidate it after use. Do not reveal whether an email exists in the public response.

### 4.4 `user_contacts` — contacts/favorites
- Composite primary key: `owner_user_id`, `contact_user_id`.
- `nickname` optional, `is_favorite` boolean, `created_at`.
- This is an address-book relationship, not a required friend approval. Add a request/acceptance table later only if the product needs friend requests.

### 4.5 `user_blocks` — blocks
- Composite primary key: `blocker_user_id`, `blocked_user_id`; plus `created_at`.
- Check in the backend before creating a direct conversation, sending a message, or inviting a blocked account.

### 4.6 `conversations` — direct chats and groups
- `id` primary key; `type` ENUM(direct, group).
- `name`, `description`, `avatar_key` (used mainly for groups).
- `created_by` foreign key to users.
- `join_policy` ENUM(invite_only, link); `allow_member_invites` boolean.
- `last_message_at`, `last_message_preview` for quickly sorting the sidebar; update these in the same transaction as a new message.
- `created_at`, `updated_at`.

### 4.7 `conversation_members` — membership and per-user chat preferences
- Composite primary key: `conversation_id`, `user_id`.
- `member_role` ENUM(owner, admin, member), `joined_at`, `left_at`, `last_read_at`.
- `is_muted`, `is_pinned`, `is_archived`, `notifications_enabled` booleans.
- Treat a row with `left_at IS NULL` as active membership. Rejoining updates the existing row safely.

### 4.8 `direct_chat_pairs` — one-to-one chat uniqueness
- `user_low_id`, `user_high_id` form the composite primary key; `conversation_id` is unique; `created_at`.
- Always sort the two user IDs before inserting. The unique pair ensures two people reuse the same direct chat rather than creating duplicates.

### 4.9 `messages` — persisted messages
- `id` primary key; `conversation_id`, `sender_id` foreign keys.
- `client_message_id` UUID for retry/idempotency; `message_type` ENUM(text, image, file, audio, video, system).
- `body` TEXT; `reply_to_message_id` self-reference.
- `edited_at`, `deleted_at`, `created_at`, `updated_at`.
- Keep message history paginated by cursor (`created_at` + `id`); do not load an entire conversation at once.

### 4.10 `message_attachments` — files attached to messages
- `id`, `message_id`, `uploaded_by`.
- `original_filename`, unique `storage_key`, `mime_type`, `size_bytes`.
- Optional media metadata: `width_px`, `height_px`, `duration_seconds`; `created_at`.
- Validate real file contents/MIME type and file size on the server. Never trust the file name supplied by a browser.

### 4.11 `message_reactions` — emoji reactions
- Composite primary key: `message_id`, `user_id`, `emoji`; `created_at`.
- Limit the supported emoji set/length and ensure the reacting user belongs to the conversation.

### 4.12 `message_receipts` — delivery/read status per recipient
- Composite primary key: `message_id`, `user_id`.
- `status` ENUM(sent, delivered, read), `delivered_at`, `read_at`, `updated_at`.
- Create recipient receipt rows when a message is sent; update when the recipient's device confirms delivery or opens the conversation. For huge groups, receipt storage can be optimized later.

### 4.13 `group_invites` — member invitations and invite links
- `id`, `conversation_id`, `invited_by`, optional `invited_user_id`.
- Optional `invite_token_hash`, `expires_at`, `max_uses`, `use_count`.
- `accepted_at`, `revoked_at`, `created_at`.
- Store a hash of a random invite token, not the raw token. Validate expiry, revocation, use count, group policy, and blocking rules.

### 4.14 `notifications` — in-app notifications
- `id`, `user_id`, optional `actor_user_id`, `type`.
- Optional `conversation_id`, `message_id`, `title`, `body`, `read_at`, `created_at`.
- Notifications are durable in MySQL; emit a Socket.IO event to show them instantly.

### 4.15 `notification_preferences` — user notification settings
- `user_id` primary/foreign key; `desktop_enabled`, `sound_enabled`, `email_enabled`, `updated_at`.
- Browser desktop notifications also require user permission and should be optional.

### 4.16 `content_reports` — safety/moderation queue
- `id`, `reporter_user_id`, `target_type` ENUM(user, message, conversation), `target_id`.
- `reason` ENUM(spam, harassment, inappropriate_content, impersonation, other), `details`.
- `status` ENUM(open, under_review, resolved, dismissed), `reviewed_by_user_id`, `resolution_note`, `created_at`, `reviewed_at`.
- Since `target_id` may point to different tables, validate that target in the backend; it cannot use one ordinary foreign key.

### 4.17 `admin_audit_logs` — accountability
- `id`, `admin_user_id`, `action`, optional `target_type`, `target_id`, JSON `details`, `ip_address`, `created_at`.
- Record role changes, suspensions, session revocations, report decisions, and sensitive settings changes. Never log passwords or raw tokens.

### 4.18 `app_settings` — global configuration
- `setting_key` primary key, JSON `setting_value`, `updated_by_user_id`, `updated_at`.
- Examples: max upload size, allowed MIME types, maintenance mode. Validate settings server-side rather than directly executing arbitrary values.

**Not stored in MySQL:** online presence and typing status should be short-lived Socket.IO state (or Redis when scaling). MySQL stores durable accounts, conversations, messages, and moderation records.

## 5. How real-time chat works

Use **REST/HTTP for durable operations and initial data** (register, login, conversation list, message history, uploads, profile, admin actions). Use **Socket.IO for live events** (new messages, typing, online status, receipts, reactions, group membership changes, and notifications). Socket.IO events must go through the same authentication, membership, validation, and authorization rules as HTTP routes.

### Send a message — complete flow
1. The user signs in; the server validates the password and creates a secure session. The browser connects to Socket.IO using the authenticated session.
2. The frontend calls the API to open a direct chat or create a group. The backend checks account status, blocks, and membership, then returns the conversation ID.
3. The socket joins a room like `conversation:123` only after the backend confirms active membership. The client cannot grant itself membership by choosing a room name.
4. The sender emits `message:send` with `conversationId`, `clientMessageId`, `messageType`, `body`, optional `replyToMessageId`, and uploaded attachment IDs. Do not accept `senderId` from the client as trusted data; take it from the authenticated session.
5. The backend validates message type/length, confirms active membership and attachment ownership, and commits the message, receipts, and sidebar preview/time in a database transaction.
6. After the database commit, the server emits `message:new` to authorized members in that conversation and acknowledges the sender with the saved message (including the server ID and timestamp). If persistence fails, do not broadcast it as a successful message.
7. Recipients acknowledge delivery; when a recipient opens/reads the chat, update receipt status and `last_read_at`, then broadcast `message:receipt` / `conversation:read` to authorized participants.
8. On reconnect, the app requests missed messages through paginated REST history. Socket events alone must never be the only copy of a message.

### Direct-message flow
- Search/select a user → request `POST /api/conversations/direct` → backend checks blocks and finds/creates the unique pair → both users become members → history loads → Socket.IO delivers messages live.
- If either user blocks the other, apply a documented policy (recommended: block prevents new messages and invitations; existing history remains available to each user unless a separate retention policy says otherwise).

### Group flow
- Create group with a title and optional description/avatar → backend creates conversation and owner membership in a transaction → creator selects/invites members → invited users become active members after accepting or being added under group policy.
- Owner/admin changes group details or removes members → backend checks role and writes the change → database updates → emit `group:updated` or `group:member_removed` to remaining authorized members.
- Leaving the group sets `left_at`; removed members must immediately lose socket-room access and cannot fetch future messages. Keep old messages only according to the chosen product retention policy.

## 6. Socket.IO event contract

Use consistent names and a shared event payload schema. Authenticate every socket and authorize every conversation ID.

### Client → server
- `conversation:join` — request to subscribe; server verifies active membership.
- `message:send` — new message and client UUID.
- `message:delivered` — recipient device confirms delivery.
- `conversation:read` — user has read through a message/time.
- `typing:start`, `typing:stop` — temporary indicator; rate-limit and auto-expire.
- `message:edit`, `message:delete` — allowed only for the sender and within the product policy.
- `reaction:add`, `reaction:remove` — server verifies membership and updates SQL.

### Server → client
- `message:new`, `message:updated`, `message:deleted`.
- `message:receipt` — sent/delivered/read state changes.
- `typing:update` — who is typing in a conversation.
- `presence:update` — online/offline/last-seen changes.
- `notification:new`, `notification:read`.
- `group:updated`, `group:member_added`, `group:member_removed`, `group:member_left`.
- `error` — safe error code/message; never reveal SQL errors or secrets.

Typing/presence is ephemeral. Do not write a database row every time a user types. Debounce typing events, stop them after a short timeout, and track active sockets per user so closing one browser tab does not incorrectly mark the user offline if another tab remains connected.

## 7. API endpoint plan

Prefix all endpoints with `/api/v1` and return a consistent JSON format.

### Authentication/profile
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/refresh`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `GET /auth/me`
- `GET /users/search?q=`
- `GET /users/:id`
- `PATCH /users/me`
- `POST /users/me/avatar`
- `GET /users/me/sessions`, `DELETE /users/me/sessions/:id`

### Contacts/blocking
- `GET /contacts`, `POST /contacts/:userId`, `DELETE /contacts/:userId`
- `PATCH /contacts/:userId` (nickname/favorite)
- `GET /blocks`, `POST /blocks/:userId`, `DELETE /blocks/:userId`

### Conversations/messages
- `GET /conversations`
- `POST /conversations/direct` with target user ID
- `POST /conversations/groups`
- `GET /conversations/:id`
- `PATCH /conversations/:id` (group owner/admin permissions)
- `GET /conversations/:id/messages?beforeId=&limit=`
- `POST /conversations/:id/messages` can be used as a fallback/HTTP send endpoint; the live client normally uses Socket.IO after validation.
- `POST /uploads` (authenticated upload; returns an attachment key/ID)
- `POST /conversations/:id/invites`, `POST /invites/:token/accept`, `DELETE /invites/:id`
- `POST /conversations/:id/members`, `DELETE /conversations/:id/members/:userId`, `POST /conversations/:id/leave`
- `POST /messages/:id/reactions`, `DELETE /messages/:id/reactions/:emoji`
- `POST /reports`
- `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`

### Admin (require authenticated user with role `admin`)
- `GET /admin/dashboard`
- `GET /admin/users?q=&status=&page=`
- `PATCH /admin/users/:id/status`
- `POST /admin/users/:id/revoke-sessions`
- `GET /admin/reports?status=&page=`
- `PATCH /admin/reports/:id` (assign status and resolution note)
- `GET /admin/settings`, `PATCH /admin/settings`
- `GET /admin/audit-logs?page=`

For list endpoints, paginate results, validate query parameters, and use parameterized SQL. Never accept a role value from the public registration form.

## 8. Recommended frontend/backend folder structure

```text
realtime-chat/
  client/
    src/
      app/                 # router and application providers
      components/          # Avatar, Button, Modal, SearchInput, MessageBubble
      features/
        auth/
        conversations/
        messages/
        contacts/
        groups/
        notifications/
        settings/
        admin/
      hooks/               # useSocket, useAuth, useConversations
      services/            # axios client and socket client
      styles/              # tokens, global styles, responsive rules
  server/
    src/
      config/              # env and MySQL pool
      middleware/          # auth, adminOnly, errorHandler, validation, rateLimit
      routes/              # REST route registration
      controllers/         # request/response handlers
      services/            # business rules and transactions
      repositories/        # SQL access
      sockets/              # Socket.IO initialization and event handlers
      validators/           # schemas for REST and socket payloads
      utils/                # token, file, logging helpers
      app.js
      server.js
    scripts/create-admin.js
  database/realtime_chat_schema.sql
  .env.example
  README.md
```

Keep authorization/business logic in backend services, not only in React buttons. The UI may hide controls, but the server must still reject unauthorized actions.

## 9. First administrator setup

1. Import `realtime_chat_schema.sql` into MySQL.
2. In the Node server, install `dotenv`, `mysql2`, and `bcrypt`.
3. Put DB settings and a unique, strong `ADMIN_PASSWORD` in a local `.env` file that is ignored by Git. Use `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_DISPLAY_NAME` too.
4. Run `node scripts/create-admin.js` from the server directory (place the companion script there).
5. Sign in through the regular login form. Protect every `/admin/*` route using server-side role middleware. Optionally require MFA before a production administrator can use the panel.
6. Remove the bootstrap password from the environment after creation and rotate it if it may have been exposed. Never ship a universal/default admin password and never let users select `admin` during registration.

Example `.env.example` keys (replace placeholder values locally; never commit real secrets):

```env
PORT=5000
CLIENT_ORIGIN=http://localhost:5173
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=replace_locally
DB_NAME=realtime_chat
SESSION_SECRET=replace_with_a_long_random_secret
ADMIN_USERNAME=siteadmin
ADMIN_EMAIL=admin@example.com
ADMIN_DISPLAY_NAME=Site Administrator
ADMIN_PASSWORD=replace_with_a_unique_password_at_least_12_chars
```

## 10. Security and reliability requirements

- Hash passwords with bcrypt (or Argon2) and compare hashes; never encrypt/store plaintext passwords.
- Prefer secure, `HttpOnly`, `SameSite` cookies for session/refresh credentials, with `Secure` enabled over HTTPS; configure CSRF protections appropriate to the chosen cookie/auth design. Do not place long-lived secrets in localStorage.
- Use TLS/HTTPS outside localhost; configure strict CORS for the known frontend origin, Helmet, rate limits, request size limits, and validated environment variables.
- Use prepared SQL statements (`?` placeholders); never concatenate user input into SQL.
- Check active account status and conversation membership on every message/history/file operation and relevant Socket.IO event.
- Validate uploads by size and actual type; allow-list extensions/MIME types; randomize stored names; keep private files outside the public web root and authorize every download.
- Validate message length, group sizes, usernames, reactions, and invite usage; escape/sanitize rendered user content to prevent XSS.
- Make message send idempotent with `client_message_id`; broadcast only after SQL commit; handle duplicate retries gracefully.
- Add database backup/restore tests, structured error logging, account suspension/session revocation, and audit logs.
- Do not include message content, passwords, cookies, or raw tokens in logs. Define retention, reporting, privacy, and account-deletion rules before public launch.

## 11. Development phases and acceptance checklist

### Phase 1 — Foundation
- Set up client/server/MySQL, `.env`, error handling, routing, reusable layout, schema migration/import.
- Register, login, logout, profile, unique username/email, hashed password, authorization middleware.
- Acceptance: a normal user cannot open admin API routes; suspended users cannot connect/send messages.

### Phase 2 — Direct chats
- Search users, create/reuse one direct chat, load messages with pagination, send/receive text live, show timestamps and unread counts.
- Acceptance: two browser sessions exchange messages immediately; refresh/reconnect loads messages from MySQL; duplicates are prevented on retry.

### Phase 3 — Real-time quality
- Presence, typing, delivered/read receipts, replies, edits/deletes, reactions, search, pinned/archived/muted chats, notifications.
- Acceptance: typing never persists as a message; receipts belong to actual recipients; reconnect recovers missed history.

### Phase 4 — Groups/files
- Create groups, roles, invite links, add/remove/leave, group info panel, uploads, shared-file list.
- Acceptance: only owner/admin can perform privileged group changes; removed members cannot retrieve future messages or receive room events.

### Phase 5 — Admin and safety
- Admin dashboard, user management, suspension, session revocation, reports, settings, audit log.
- Acceptance: every admin endpoint checks role server-side and sensitive changes create audit records.

### Phase 6 — Polish/deploy
- Responsive desktop/tablet/mobile UI matching the reference, loading/empty/error states, accessibility, secure deployment, backups, basic tests, rate limits, and upload policy.
- Acceptance: database backup can be restored; HTTPS and secrets are configured; no default admin password exists; key flows work on desktop and mobile.

## 12. UI finishing details to make it feel complete

- Consistent typography, spacing, subtle borders/shadows, clear focus states, keyboard navigation, and accessible contrast.
- Message states: sending, sent, delivered, read, failed, edited, deleted.
- Useful empty states: no chat selected, no contacts, no search results, no messages, no groups, no notifications.
- Loading skeletons for conversation list and message history; retry UI for failed sends; optimistic display only with a clear pending/failed state.
- Conversation list sorted by `last_message_at`, unread count, online status, and last activity.
- Message pagination with scroll-position preservation; virtualize very long message lists when necessary.
- Confirmation dialogs for removing group members, leaving groups, deleting messages, and suspending accounts.
- Mobile layout: conversation list opens first; selecting a chat navigates to the chat panel; back returns to the list.

## 13. Important implementation notes

- The SQL file is a starting schema, not a complete production security review. Check all constraints and transaction flows while building.
- Keep UTC timestamps in storage and localize them in the browser.
- Do not store online/typing flags permanently in SQL. With one server, in-memory Socket.IO state can be enough; with multiple instances, use Redis and the Socket.IO Redis adapter.
- Avoid loading all users, groups, or messages at once. Use search, indexed filters, and pagination.
- Write tests for authorization and membership edge cases, not only the happy path.
