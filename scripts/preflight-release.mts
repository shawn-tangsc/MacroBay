/**
 * Before a release tag is pushed, check the things that actually go wrong.
 *
 * Written after 0.4.0 was tagged from a working copy whose `main` was five commits
 * behind and carried one stale local commit: the tag pointed at a tree that still
 * said 0.3.1, the release job built it, and the mistake was only visible two minutes
 * later in a cancelled job. Every check below is one thing that would have caught it
 * before anything was pushed.
 *
 * The release workflow has its own guard (`check-release-version.mjs`), but it runs
 * after the tag is public and a build has started. This one runs before.
 *
 * Usage: pnpm release:preflight v0.4.0 [--online] v0.4.0 [--online]
 *   --online  also asks GitHub whether the commit's CI is green (needs
 *             DSH_SECRET_GITHUB_TOKEN; skipped with a note when absent)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { releaseNotesLimits } from '../platform/updates/contracts/releaseNotes'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const tag = (args.find((value) => !value.startsWith('--')) ?? '').trim()
const online = args.includes('--online')

const problems: string[] = []
const passed: string[] = []

function ok(label: string, detail: string): void {
  passed.push(`${label}: ${detail}`)
}

function bad(label: string, detail: string): void {
  problems.push(`${label}: ${detail}`)
}

function git(...gitArgs: string[]): string {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim()
}

/** A tag is `v` + the exact version electron-builder will name artifacts after. */
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  bad('tag name', `"${tag}" is not vMAJOR.MINOR.PATCH`)
}

let version = ''
try {
  version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
} catch (error) {
  bad('package.json', `unreadable: ${error instanceof Error ? error.message : String(error)}`)
}
if (version && tag && tag !== `v${version}`) {
  bad('tag vs package.json', `tag ${tag} but the app version is ${version}`)
} else if (version && tag) {
  ok('tag vs package.json', `both say ${version}`)
}

/** Both languages, because the app shows this file in its About page. */
if (version) {
  const notes = [`docs/reference/release-notes/${version}.md`, `docs/reference/release-notes/${version}.zh-CN.md`]
  const missing = notes.filter((path) => !existsSync(join(ROOT, path)))
  if (missing.length > 0) bad('release notes', `missing ${missing.join(', ')}`)
  else ok('release notes', 'both languages present')
}

/**
 * The published release body, which is also what the app's About page renders.
 *
 * It used to be a sentence hard-coded in the release workflow plus a link, and the reader-facing
 * version of it was pasted into the release page by hand after publishing — so the page and the
 * repository could disagree, and the pages that were worth reading were the ones nobody had
 * remembered to patch. Now the workflow publishes these two files verbatim, which makes them a
 * release input that has to exist before the tag, exactly like the notes.
 */
/** The tree being tagged must be the tree that was reviewed and verified. */
try {
  // Tracked changes only: an untracked build product does not change what the tag points at.
  const dirty = git('status', '--porcelain', '--untracked-files=no')
  if (dirty !== '') bad('working tree', `not clean:\n${dirty}`)
  else ok('working tree', 'clean')
} catch {
  bad('working tree', 'git status failed')
}

let head = ''
try {
  head = git('rev-parse', 'HEAD')
  const remoteHead = git('rev-parse', 'origin/main')
  if (head !== remoteHead) {
    const ahead = git('rev-list', '--count', 'origin/main..HEAD')
    const behind = git('rev-list', '--count', 'HEAD..origin/main')
    bad(
      'HEAD vs origin/main',
      `local ${head.slice(0, 7)} is ${ahead} ahead / ${behind} behind ${remoteHead.slice(0, 7)} - a stale or divergent checkout tags the wrong tree`
    )
  } else {
    ok('HEAD vs origin/main', `both at ${head.slice(0, 7)}`)
  }

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (branch !== 'main') bad('branch', `on "${branch}"; a release is cut from main`)
  else ok('branch', 'main')
} catch {
  bad('repository', 'git could not resolve HEAD or origin/main (did you fetch?)')
}

/** The tag must not already exist somewhere else; moving a published tag is not allowed. */
try {
  // `ls-remote --tags` lists an annotated tag twice: the tag object and, as `^{}`,
  // the commit it peels to. Compare commits - the tag object sha never equals HEAD.
  const lines = git('ls-remote', '--tags', 'origin', `refs/tags/${tag}*`)
    .split('\n')
    .filter((line) => line !== '')
  const peeled = lines.find((line) => line.endsWith('^{}'))
  const chosen = peeled ?? lines[0]
  if (chosen !== undefined) {
    const [sha] = chosen.split(/\s+/u)
    if (head && sha !== head) bad('existing tag', `${tag} already points at ${sha.slice(0, 7)} on the remote`)
    else ok('existing tag', `${tag} already points at this commit`)
  } else {
    ok('existing tag', 'not on the remote yet')
  }
} catch {
  bad('existing tag', 'git ls-remote failed')
}

if (online && head) {
  const token = process.env.DSH_SECRET_GITHUB_TOKEN ?? ''
  if (!token) {
    ok('CI on this commit', 'skipped: no token available for the GitHub API')
  } else {
    try {
      const remote = git('remote', 'get-url', 'origin')
      const slug = /github\.com[:/]([^/]+)\/([^/.]+)/u.exec(remote)
      if (!slug) throw new Error(`cannot read owner/repo from origin "${remote}"`)
      // Ask the CI workflow, not "every check on this commit": a release run attaches its own
      // packaging jobs to the same sha, and those are what the tag is about to start.
      const runsUrl = `https://api.github.com/repos/${slug[1]}/${slug[2]}/actions/workflows/ci.yml/runs?head_sha=${head}&per_page=1`
      const response = await fetch(runsUrl, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      const [run] = body.workflow_runs ?? []
      if (!run) bad('CI on this commit', 'CI has not run on this commit')
      else if (run.status !== 'completed' || run.conclusion !== 'success') {
        bad('CI on this commit', `CI run #${run.run_number} is ${run.status} ${run.conclusion ?? ''}`)
      } else ok('CI on this commit', `CI run #${run.run_number} green`)
    } catch (error) {
      bad('CI on this commit', `could not ask GitHub: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

for (const line of passed) console.log(`  ok   ${line}`)
for (const line of problems) console.error(`  FAIL ${line}`)

if (problems.length > 0) {
  console.error(`\n${problems.length} check(s) failed - do not push ${tag || 'the tag'} yet.`)
  process.exit(1)
}

console.log(`\npreflight passed for ${tag}. Push the tag only after this line.`)
