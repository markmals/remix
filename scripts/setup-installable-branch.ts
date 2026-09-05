import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import * as util from 'node:util'
import { logAndExec } from './utils/process.ts'

/**
 * This script prepares a base branch (usually `main`) to be PNPM-installable
 * directly from GitHub via a new branch (usually `preview/main`):
 *
 *   pnpm install "remix-run/remix#preview/main&path:packages/remix"
 *
 * Pass `--repository owner/repo` to prepare a fork, and `--no-commit` to
 * inspect the generated package files before staging and committing them.
 *
 * To do this, we can run a build, make some minor changes to the repo, and
 * commit the build + changes to the new branch. These changes would never be
 * down-merged back to the source branch.
 *
 * This script does the following:
 *  - Checks out the new branch and resets it to the base (current) branch
 *  - Runs a build
 *  - Removes `dist/` from `.gitignore`
 *  - Updates all internal `@remix-run/*` deps to use the github format for the
 *    given installable branch
 *  - Copies all `publishConfig`'s down so we get `exports` from `dist/` instead of `src/`
 *  - Commits the changes
 *
 * Then, after pushing, `pnpm install "remix-run/remix#preview/main&path:packages/remix"`
 * sees the `remix` nested deps and they all point to github with similar URLs so
 * they install as nested deps the same way.
 */

const { positionals, values } = util.parseArgs({
  allowPositionals: true,
  options: {
    repository: { type: 'string', default: 'remix-run/remix' },
    'no-commit': { type: 'boolean', default: false },
  },
})

const installableBranch = positionals[0]
const repository = values.repository
if (!installableBranch) {
  throw new Error('Error: You must provide an installable branch name')
}

// Error if git status is not clean
const gitStatus = logAndExec('git status --porcelain', true)
if (gitStatus) {
  throw new Error('Error: Git working directory is not clean. Commit or stash changes first.')
}

// Capture the current branch name
const sha = logAndExec('git rev-parse --short HEAD ', true).trim()

console.log(`Preparing installable branch \`${installableBranch}\` from sha ${sha}`)

// Switch to new branch and reset to current commit on base branch
logAndExec(`git checkout -B ${installableBranch}`)

// Build dist/ folders
logAndExec('pnpm build')

await updateGitignore()
await runPrepackScripts()
await updatePackageDependencies()

if (!values['no-commit']) {
  logAndExec('git add .gitignore packages')
  logAndExec(`git commit -m "installable build from ${sha}"`)
}

console.log(
  [
    '',
    values['no-commit']
      ? 'Package files prepared. Review and commit them before pushing.'
      : 'Installable build committed.',
    '',
    `Install from the \`${installableBranch}\` branch after pushing it to GitHub:`,
    '',
    `  pnpm install "${repository}#${installableBranch}&path:packages/remix"`,
  ].join('\n'),
)

// Remove `dist` from gitignore so we include built code in the repo
async function updateGitignore() {
  let linesToRemove = new Set([
    'dist/',
    '/packages/cli/template/',
    '/packages/remix/src/**/README.md',
    '/packages/remix/schema/',
  ])
  let gitignorePath = path.join(process.cwd(), '.gitignore')
  let content = await fsp.readFile(gitignorePath, 'utf-8')
  let filtered = content
    .split('\n')
    .filter((line) => !linesToRemove.has(line.trim()))
    .join('\n')
  await fsp.writeFile(gitignorePath, filtered)
  console.log('Updated .gitignore')
}

// Materialize the files the pack lifecycle normally generates. The hooks
// themselves are stripped later, along with every other lifecycle script.
async function runPrepackScripts() {
  for (let name of ['cli', 'remix']) {
    let packageJsonPath = path.join(process.cwd(), 'packages', name, 'package.json')
    let pkg = JSON.parse(await fsp.readFile(packageJsonPath, 'utf-8'))
    if (!pkg.scripts?.prepack) {
      console.warn(`${pkg.name} no longer defines a prepack script; skipping file preparation.`)
      continue
    }

    console.log(`Running ${pkg.name} prepack script...`)
    logAndExec(`pnpm --filter ${pkg.name} run prepack`)
  }
}

// A consumer installing from Git gets the package exactly as committed here.
// Every script on this branch drives the workspace it was built in: pnpm would
// run `build` to prepare a Git dependency, and the rest need dev dependencies
// this branch does not install.
function removeScripts(pkg: { scripts?: Record<string, string> }): void {
  delete pkg.scripts
}

// Update `package.json` files to point to this branch on github
async function updatePackageDependencies() {
  let packagesDir = path.join(process.cwd(), 'packages')

  let packageDirNames = await fsp.readdir(packagesDir, { withFileTypes: true })

  for (let dir of packageDirNames) {
    if (!dir.isDirectory()) continue

    let packageJsonPath = path.join(packagesDir, dir.name, 'package.json')
    let content = await fsp.readFile(packageJsonPath, 'utf-8')
    let pkg = JSON.parse(content)

    // Point all `@remix-run/` dependencies to this branch on github
    if (pkg.dependencies) {
      for (let name of Object.keys(pkg.dependencies)) {
        if (name.startsWith('@remix-run/')) {
          let packageDirName = name.replace('@remix-run/', '')
          pkg.dependencies[name] =
            `${repository}#${installableBranch}&path:packages/${packageDirName}`
        }
      }
    }

    removeScripts(pkg)

    if (pkg.publishConfig) {
      Object.assign(pkg, pkg.publishConfig)
      delete pkg.publishConfig
    }

    await fsp.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`Updated ${dir.name}`)
  }

  console.log('Done')
}
