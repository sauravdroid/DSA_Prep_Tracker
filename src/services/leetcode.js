const PROXY = '/api/leetcode'
import { toLocalDateStr, todayStr } from '../utils/dateUtils'

async function gql(query, variables, session) {
  const res = await fetch(PROXY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { 'x-leetcode-session': session } : {}),
    },
    body: JSON.stringify({ query, variables }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`)
  }
  if (json.errors) throw new Error(json.errors[0].message)
  if (!json.data) throw new Error(`No data in response: ${JSON.stringify(json).slice(0, 200)}`)
  return json.data
}

export async function fetchSubmissions(session, startDate, onProgress, existingProblems = {}) {
  const startTs = Math.floor(new Date(startDate).getTime() / 1000)
  const endTs = Math.floor(Date.now() / 1000) + 86400
  const problemMap = {} // slug -> problem data (keeps getting overwritten to oldest date)
  const failCounts = {} // slug -> number of non-Accepted submissions
  const failures = [] // { slug, date, ts } for each non-Accepted submission
  const resubmissions = [] // { slug, date } for accepted re-submissions (revisions)
  const seenSlugDates = new Set() // "slug|date" to dedupe same-day re-submissions
  let offset = 0
  const LIMIT = 20
  let hasMore = true

  while (hasMore) {
    const data = await gql(
      `query ($offset: Int!, $limit: Int!, $slug: String) {
        submissionList(offset: $offset, limit: $limit, questionSlug: $slug) {
          hasNext
          submissions {
            title
            titleSlug
            statusDisplay
            timestamp
          }
        }
      }`,
      { offset, limit: LIMIT },
      session
    )

    const { submissions, hasNext } = data.submissionList
    if (!submissions || submissions.length === 0) break

    for (const s of submissions) {
      const ts = Number(s.timestamp)
      if (ts < startTs) {
        hasMore = false
        break
      }
      if (ts >= endTs) continue
      if (s.statusDisplay !== 'Accepted') {
        failCounts[s.titleSlug] = (failCounts[s.titleSlug] || 0) + 1
        failures.push({ slug: s.titleSlug, date: toLocalDateStr(new Date(ts * 1000)), ts })
        continue
      }
      const solvedDate = toLocalDateStr(new Date(ts * 1000))
      const key = `${s.titleSlug}|${solvedDate}`

      if (seenSlugDates.has(key)) continue
      seenSlugDates.add(key)

      // Detect revision: problem already seen in this fetch OR exists in store with a different date
      const existingDate = problemMap[s.titleSlug]?.dateSolved
        || existingProblems[s.titleSlug]?.dateSolved
      if (existingDate && existingDate !== solvedDate) {
        // Newest-first: the first occurrence is the latest solve, which is the revision
        // Only record the newer date as a revision (skip if this date is older)
        if (solvedDate > existingDate) {
          resubmissions.push({ slug: s.titleSlug, date: solvedDate })
        } else if (problemMap[s.titleSlug]) {
          // We already recorded the newer date in problemMap; that's the revision
          resubmissions.push({ slug: s.titleSlug, date: problemMap[s.titleSlug].dateSolved })
        }
      }

      // Always overwrite — since we iterate newest-first, the last write wins (oldest date)
      problemMap[s.titleSlug] = {
        title: s.title,
        slug: s.titleSlug,
        dateSolved: solvedDate,
      }
    }

    hasMore = hasMore && hasNext
    offset += LIMIT
    if (onProgress) onProgress(`Fetched ${Object.keys(problemMap).length} problems...`)
    if (hasMore) await delay(350)
  }

  return { problems: Object.values(problemMap), failCounts, failures, resubmissions }
}

export async function fetchProblemDetails(slug, session) {
  const data = await gql(
    `query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        title
        titleSlug
        difficulty
        acRate
        topicTags { name slug }
      }
    }`,
    { titleSlug: slug },
    session
  )
  return data.question
}

// Everything needed to seed the recursion visualizer: sample inputs, the expected
// outputs (only available inside the rendered description) and the starter code.
export async function fetchQuestion(slug, session) {
  const data = await gql(
    `query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionFrontendId
        title
        titleSlug
        difficulty
        isPaidOnly
        content
        exampleTestcaseList
        metaData
        codeSnippets { langSlug code }
      }
    }`,
    { titleSlug: slug },
    session
  )
  return data.question
}

export async function syncProblems(session, startDate, onProgress, existingProblems = {}) {
  onProgress?.('Fetching submissions...')
  const { problems: submissions, failCounts, failures, resubmissions } = await fetchSubmissions(session, startDate, onProgress, existingProblems)

  const results = []
  for (let i = 0; i < submissions.length; i++) {
    const s = submissions[i]
    onProgress?.(`Fetching details ${i + 1}/${submissions.length}: ${s.title}`)
    try {
      const details = await fetchProblemDetails(s.slug, session)
      results.push({
        title: details.title,
        slug: details.titleSlug,
        difficulty: details.difficulty,
        acRate: details.acRate ?? null,
        failedCount: failCounts[details.titleSlug] || 0,
        tags: details.topicTags.map(t => t.name),
        dateSolved: s.dateSolved,
        url: `https://leetcode.com/problems/${details.titleSlug}/`,
      })
    } catch {
      results.push({
        title: s.title,
        slug: s.slug,
        difficulty: 'Unknown',
        acRate: null,
        failedCount: failCounts[s.slug] || 0,
        tags: [],
        dateSolved: s.dateSolved,
        url: `https://leetcode.com/problems/${s.slug}/`,
      })
    }
    if (i < submissions.length - 1) await delay(250)
  }

  onProgress?.(`Done! Synced ${results.length} problems, ${resubmissions.length} re-submissions.`)
  return { results, resubmissions, failures }
}

// Quick sync: catch up from last sync through today (falls back to today when never synced).
export async function syncToday(session, onProgress, existingProblems = {}, since = null) {
  const startDate = since || todayStr()
  return syncProblems(session, startDate, onProgress, existingProblems)
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}
