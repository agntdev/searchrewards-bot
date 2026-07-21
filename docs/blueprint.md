# SearchRewards Bot — Bot specification

**Archetype:** commerce

**Voice:** professional and friendly — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that combines fast search functionality with a referral-based earnings system, allowing users to earn and withdraw money while enabling admins to manage payouts and users securely. Features include referral tracking, USD wallet balances, and admin-controlled payout workflows with anti-fraud protections.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- general public
- casual users
- passive earners

## Success criteria

- 1,000+ active users with search history
- 100+ monthly referral signups
- 95% processed withdrawal requests

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Register user and show referral link
- **/search** (command, actor: user, command: /search) — Execute search query and log activity
- **/referral** (command, actor: user, command: /referral) — Display referral metrics and sharing options
- **/withdraw** (command, actor: user, command: /withdraw) — Initiate withdrawal request workflow
- **Admin Dashboard** (button, actor: admin, callback: admin:dashboard) — Access user/referral/withdrawal management

## Flows

### Referral Signup
_Trigger:_ referral link usage

1. Detect referral code in /start
2. Register new user with referrer_id
3. Track referee's first search
4. Credit $0.01 to referrer after verification

_Data touched:_ User, Referral record

### Withdrawal Processing
_Trigger:_ /withdraw command

1. Validate min/max amount
2. Collect payment method details
3. Notify admin chat
4. Update request status

_Data touched:_ Withdrawal request, Wallet

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: persistent)_ — Registered user with referral relationships
  - fields: id, name, username, referrer_id, registration_date
- **Wallet** _(retention: persistent)_ — User earnings and withdrawal history
  - fields: user_id, balance, pending_withdrawals
- **Withdrawal request** _(retention: persistent)_ — Pending payout instructions
  - fields: id, user_id, amount, method, account_details, status

## Integrations

- **Telegram** (required) — Bot API messaging and admin chat
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Admin chat access for @CHARLIES801
- Referral reward rate configuration
- Withdrawal min/max limits
- Anti-fraud rule adjustments

## Notifications

- Admin alerts for new withdrawals
- User status updates on payouts
- Fraud pattern notifications

## Permissions & privacy

- Telegram ID-based user identification
- Anonymized search query logging
- Referral link encryption

## Edge cases

- Multiple referral link clicks
- Withdrawal request fraud attempts
- Inactive user account cleanup

## Required tests

- End-to-end referral crediting flow
- Withdrawal request validation scenarios
- Admin dashboard data accuracy

## Assumptions

- Manual payout processing by admin
- Referral requires minimum activity
- Search results sourced internally
