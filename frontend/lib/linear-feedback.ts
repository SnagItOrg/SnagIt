/**
 * The manager's copy of a piece of feedback (PAN-251/PAN-256): one Linear
 * issue in the Feedback project, opened by /api/feedback after the row and
 * the email. Opt-in — nothing happens until LINEAR_API_KEY and
 * LINEAR_FEEDBACK_PROJECT_ID are set in Vercel — and best-effort: a failure
 * is a bounded code for the route to log, never a failed request.
 *
 * The visitor's address never reaches Linear. The issue says only whether an
 * answer is wanted; the address stays on the row and in the owner's email.
 */
import type { Feedback } from './feedback'

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql'
/** The issue's team. The project id names the project; Linear still needs the team. */
const TEAM_KEY = 'PAN'
const TIMEOUT_MS = 5_000

/** Pure, so the "never the address" rule is testable from plain Node. */
export function linearIssueText(f: Feedback, appUrl: string): { title: string; description: string } {
  const title = `[feedback] ${f.kind} — ${f.productSlug ?? f.path}`
  const description = [
    `**Kind:** ${f.kind}`,
    `**Surface:** ${f.surface}`,
    `**Page:** ${appUrl}${f.path}`,
    f.productSlug ? `**Product:** ${appUrl}/product/${f.productSlug}` : null,
    f.state ? `**Check state:** ${f.state}` : null,
    f.tipPriceDkk != null ? `**Tip:** ${f.tipPriceDkk.toLocaleString('da-DK')} kr used` : null,
    f.tipName ? `**Tip says it is:** ${f.tipName}` : null,
    f.listingUrl ? `**Ad:** ${f.listingUrl}` : null,
    `**Svar ønsket:** ${f.email ? 'ja' : 'nej'}`,
    '',
    f.text ?? '_(no text)_',
  ].filter((line) => line !== null).join('\n')
  return { title, description }
}

export type LinearIssueResult = { ok: true; issueId: string } | { ok: false; code: string }

/** Codes the route may log. Anything else collapses to the error's class name. */
const BOUNDED = /^(http_\d{3}|graphql_error|team_not_found|not_created)$/

let teamId: string | null = null

export async function createFeedbackIssue(f: Feedback): Promise<LinearIssueResult> {
  const key = process.env.LINEAR_API_KEY
  const projectId = process.env.LINEAR_FEEDBACK_PROJECT_ID
  if (!key || !projectId) return { ok: false, code: 'not_configured' }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.klup.dk'

  const gql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    const res = await fetch(LINEAR_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`http_${res.status}`)
    const json = (await res.json()) as { data?: T; errors?: unknown[] }
    if (!json.data || json.errors?.length) throw new Error('graphql_error')
    return json.data
  }

  try {
    if (!teamId) {
      const data = await gql<{ teams: { nodes: { id: string }[] } }>(
        'query($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }',
        { key: TEAM_KEY },
      )
      teamId = data.teams.nodes[0]?.id ?? null
      if (!teamId) throw new Error('team_not_found')
    }
    const { title, description } = linearIssueText(f, appUrl)
    const data = await gql<{ issueCreate: { success: boolean; issue: { id: string } | null } }>(
      'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id } } }',
      { input: { teamId, projectId, title, description } },
    )
    if (!data.issueCreate.success || !data.issueCreate.issue) throw new Error('not_created')
    return { ok: true, issueId: data.issueCreate.issue.id }
  } catch (e) {
    // A bounded code or the error's class (TimeoutError, TypeError): never the key, the text or the address.
    const code = e instanceof Error ? (BOUNDED.test(e.message) ? e.message : e.name) : 'unknown'
    return { ok: false, code }
  }
}
