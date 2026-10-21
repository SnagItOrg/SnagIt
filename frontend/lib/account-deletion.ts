/**
 * frontend/lib/account-deletion.ts
 *
 * PAN-277: delete an account and everything that is the user's.
 *
 * ── THE PLAN IS THE AUTHORITY ───────────────────────────────────────────
 * `ACCOUNT_DELETION_PLAN` names every table that holds a user id, an email
 * address or a link to a user's row, and says what happens to it. The guard in
 * scripts/lib/account-deletion.test.ts reads every migration and fails when a
 * table with `user_id`, `REFERENCES auth.users` or an `email text` column is
 * not named here, so a new user table cannot ship uncovered.
 *
 * The inventory was read from production's catalogue on 2026-10-21, not from
 * the migrations alone: production has drifted from them (saved_listings
 * cascades although 012 declares no rule; price_snapshots has no foreign key
 * although 006 declares one). Each step therefore runs explicitly rather than
 * leaning on a delete rule that might not be there.
 *
 * ── WHAT IS THE USER'S, AND WHAT IS NOT ─────────────────────────────────
 * `delete`    the row is the user's: their watchlists, saved ads, settings,
 *             the feedback they signed with their address.
 * `anonymise` the row is a fact about the catalogue that the user supplied or
 *             reviewed: the fact stays, the user id goes.
 * `detach`    the row is market data (a seller's public ad, a sold price)
 *             that is linked to one of the user's watchlists. It is not the
 *             user's, and `watchlist_id ON DELETE CASCADE` would destroy it
 *             with the watchlist — 377 product-linked Reverb sold prices
 *             among them, measured 2026-10-21. The link is cut first.
 * `cascade`   a foreign key with ON DELETE CASCADE / SET NULL removes it; no
 *             step of ours runs.
 * `not_applied` the migration that creates the table is not applied in
 *             production; the reason says what to add when it is.
 *
 * Nothing here is a legal record Klup must keep (no orders, no payments), so
 * no row is kept with personal data in it.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────
 * Every step is a delete or an update keyed on the user, so running the whole
 * plan again after a partial failure finishes the job and changes nothing
 * already done. The auth user goes last: while any step fails the account
 * still exists and the user can simply try again.
 *
 * ── LOGGING ─────────────────────────────────────────────────────────────
 * Failures carry the step's table and a static code. Never the user id, the
 * address or the provider's own message.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** What the profile page sends in the body; a request without it deletes nothing. */
export const DELETE_ACCOUNT_CONFIRMATION = 'delete-my-account'

export type DeletionAction = 'delete' | 'anonymise' | 'detach' | 'cascade' | 'not_applied'

export interface DeletionStep {
  table: string
  /** The column that ties the row to the user. */
  column: string
  action: DeletionAction
  /** How a row is found: the user's id, their address, or their watchlists. */
  key: 'user_id' | 'email' | 'watchlist' | 'none'
  reason: string
}

/** In execution order. The auth user is deleted after the last step. */
export const ACCOUNT_DELETION_PLAN: readonly DeletionStep[] = [
  // Market data first, while the user's watchlists still exist to find it by.
  { table: 'listings', column: 'watchlist_id', action: 'detach', key: 'watchlist',
    reason: "A seller's public ad, not the user's. Cut the link so the watchlist's ON DELETE CASCADE does not take it." },
  { table: 'reverb_price_history', column: 'watchlist_id', action: 'detach', key: 'watchlist',
    reason: 'Reverb sold prices are price evidence. Cut the link so the cascade does not take them.' },
  { table: 'auctionet_price_history', column: 'watchlist_id', action: 'detach', key: 'watchlist',
    reason: 'Auction results are price evidence. Cut the link so the cascade does not take them.' },
  { table: 'price_snapshots', column: 'watchlist_id', action: 'detach', key: 'watchlist',
    reason: 'Legacy price snapshots. No foreign key in production, so the id would otherwise dangle.' },

  { table: 'watchlist_notification', column: 'watchlist_id', action: 'cascade', key: 'none',
    reason: "Which listings a watchlist mail handled (066). ON DELETE CASCADE from the user's watchlists." },
  { table: 'watchlists', column: 'user_id', action: 'delete', key: 'user_id',
    reason: "The user's own searches and model watches." },
  { table: 'saved_listings', column: 'user_id', action: 'delete', key: 'user_id',
    reason: "The user's saved ads." },
  { table: 'notification_preferences', column: 'user_id', action: 'delete', key: 'user_id',
    reason: "The user's mail settings." },
  { table: 'user_preferences', column: 'user_id', action: 'delete', key: 'user_id',
    reason: "Onboarding choices and the admin flag. NO ACTION foreign key: it would block the auth delete." },
  { table: 'price_observation', column: 'user_id', action: 'anonymise', key: 'user_id',
    reason: 'A price the user reported for a listing. The price is a market fact and stays; the user id goes. NO ACTION foreign key.' },
  { table: 'kg_product_suggestions', column: 'reviewed_by', action: 'anonymise', key: 'user_id',
    reason: 'An admin\'s review of a catalogue suggestion. The decision stays; the reviewer goes. NO ACTION foreign key.' },
  { table: 'user_feedback', column: 'email', action: 'delete', key: 'email',
    reason: 'Feedback has no user id; a row signed with the account\'s address is the user\'s. Not a legal record, so deleted, not anonymised.' },

  // 064 co-creation tables: not applied in production (2026-10-21).
  { table: 'product_claim', column: 'author_id', action: 'cascade', key: 'none',
    reason: '064 declares ON DELETE SET NULL: the claim stays, anonymised.' },
  { table: 'claim_vote', column: 'user_id', action: 'cascade', key: 'none',
    reason: '064 declares ON DELETE CASCADE.' },
  { table: 'claim_flag', column: 'user_id', action: 'cascade', key: 'none',
    reason: '064 declares ON DELETE CASCADE.' },
  { table: 'cocreation_user', column: 'user_id', action: 'cascade', key: 'none',
    reason: '064 declares ON DELETE CASCADE.' },
  { table: 'claim_event', column: 'actor_id', action: 'not_applied', key: 'none',
    reason: '064 is not applied. actor_id has no foreign key, and the vote trigger writes the voter\'s id here as the cascade deletes the vote; when 064 is applied, add an anonymise step that runs after the auth delete.' },
]

export type DeletionFailure = { ok: false; table: string; code: 'step_failed' | 'auth_delete_failed' }
export type DeletionResult = { ok: true } | DeletionFailure

/**
 * The address as a case-insensitive ILIKE prefilter. `%`, `_` and `\` are LIKE
 * metacharacters and `*` is PostgREST's alias for `%`; each becomes the
 * single-character wildcard, so the prefilter is a superset and the exact
 * comparison happens in code.
 */
export function emailPrefilter(email: string): string {
  return email.replace(/[%_\\*]/g, '_')
}

export function sameEmail(a: string | null, b: string): boolean {
  return a != null && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Run the plan for one user, then delete the auth user.
 *
 * `admin` must be the service-role client: the plan touches rows RLS does not
 * show the user (market data, feedback) and the auth admin API.
 */
export async function deleteAccount(
  admin: SupabaseClient,
  user: { id: string; email: string | null | undefined },
): Promise<DeletionResult> {
  const { data: wl, error: wlError } = await admin.from('watchlists').select('id').eq('user_id', user.id)
  if (wlError) return { ok: false, table: 'watchlists', code: 'step_failed' }
  const watchlistIds = (wl ?? []).map((w: { id: string }) => w.id)

  for (const step of ACCOUNT_DELETION_PLAN) {
    const failed = await runStep(admin, step, user, watchlistIds)
    if (failed) return { ok: false, table: step.table, code: 'step_failed' }
  }

  const { error } = await admin.auth.admin.deleteUser(user.id)
  // Already gone is the outcome we wanted.
  if (error && error.status !== 404) return { ok: false, table: 'auth.users', code: 'auth_delete_failed' }
  return { ok: true }
}

/** True when the step failed. */
async function runStep(
  admin: SupabaseClient,
  step: DeletionStep,
  user: { id: string; email: string | null | undefined },
  watchlistIds: string[],
): Promise<boolean> {
  const q = admin.from(step.table)
  switch (step.action) {
    case 'cascade':
    case 'not_applied':
      return false
    case 'detach': {
      if (watchlistIds.length === 0) return false
      const { error } = await q.update({ [step.column]: null }).in(step.column, watchlistIds)
      return Boolean(error)
    }
    case 'anonymise': {
      const { error } = await q.update({ [step.column]: null }).eq(step.column, user.id)
      return Boolean(error)
    }
    case 'delete': {
      if (step.key === 'email') {
        if (!user.email) return false
        const { data, error } = await q.select('id, email').ilike(step.column, emailPrefilter(user.email))
        if (error) return true
        const ids = (data ?? [])
          .filter((r: { email: string | null }) => sameEmail(r.email, user.email!))
          .map((r: { id: string }) => r.id)
        if (ids.length === 0) return false
        const { error: delError } = await admin.from(step.table).delete().in('id', ids)
        return Boolean(delError)
      }
      const { error } = await q.delete().eq(step.column, user.id)
      return Boolean(error)
    }
  }
}
