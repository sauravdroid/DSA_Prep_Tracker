import { nodeShapeFromCustomType } from './leetcodeTypes'

// Accepts a full problem URL, a /problems/... path, or a bare slug.
export function slugFromUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  const fromUrl = raw.match(/leetcode\.(?:com|cn)\/problems\/([a-zA-Z0-9-]+)/)
  if (fromUrl) return fromUrl[1]
  const fromPath = raw.match(/^\/?problems\/([a-zA-Z0-9-]+)/)
  if (fromPath) return fromPath[1]
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) return raw
  return null
}

// Expected outputs are not exposed as structured data — they only exist in the
// rendered description, alongside each "Input:" block.
function extractOutputs(html) {
  if (!html) return []
  // Parsed, never inserted into the document: scripts do not run and nothing is rendered.
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent || ''
  const outputs = []
  const re = /^[ \t]*Output:[ \t]*(.*)$/gm
  let m
  while ((m = re.exec(text))) outputs.push(m[1].trim())
  return outputs
}

function parseMetaData(metaData) {
  try {
    return JSON.parse(metaData || '{}')
  } catch {
    return {}
  }
}

export function parseQuestion(question) {
  if (!question) throw new Error('Problem not found. Check the URL.')
  if (question.isPaidOnly && !question.content) {
    throw new Error('This is a premium problem — its examples are not available.')
  }

  const meta = parseMetaData(question.metaData)
  const outputs = extractOutputs(question.content)
  const inputs = question.exampleTestcaseList || []

  if (inputs.length === 0) throw new Error('No sample test cases found for this problem.')

  let paramTypes = Array.isArray(meta.params) ? meta.params.map(p => p.type || '') : []
  let returnType = meta.return?.type || ''

  // For "manual" problems the declared types are wrong (Clone Graph claims
  // integer[][] -> boolean); the custom class declaration is what to trust.
  const nodeShape = nodeShapeFromCustomType(meta.typescriptCustomType)
  if (nodeShape) {
    paramTypes = paramTypes.length > 0 ? [nodeShape, ...paramTypes.slice(1)] : [nodeShape]
    returnType = nodeShape
  }

  return {
    slug: question.titleSlug,
    title: `${question.questionFrontendId}. ${question.title}`,
    difficulty: question.difficulty,
    entry: typeof meta.name === 'string' ? meta.name : '',
    paramTypes,
    returnType,
    starterCode: question.codeSnippets?.find(s => s.langSlug === 'javascript')?.code || '',
    cases: inputs.map((input, i) => ({ input, expected: outputs[i] ?? '' })),
    missingExpected: inputs.length > outputs.length,
  }
}
