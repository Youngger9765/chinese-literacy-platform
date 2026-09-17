import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { resolve, relative, dirname, join } from 'path'
import { describe, it, expect } from 'vitest'

/**
 * vitest 套件讀到的每個 repo 檔，都必須在 `frontend-checks.yml` 的
 * paths-filter 上（2026-09-18 系統性掃描）。
 *
 * 不在＝改那個檔的 PR 不會觸發這支 workflow，於是那條鎖不會跑，而
 * **檢查清單上不會出現那一列** —— 看起來就是全綠。紅燈會被看到，
 * 不出現的那一列不會。
 *
 * 這個病在這個 repo 犯過五次，每次的修法都是「補上出事的那一格」：
 * `public/data`（#3177 讀音對調）、`public/qa-shared`（#3188）、
 * `scripts/` + `typecheck-baseline.json`（#3195）、`tests/**`（#3242）。
 * 2026-09-18 全庫掃描又找到兩個：
 *
 *   · `frontend/index.html` —— `csp-meta-tag.test.ts` 讀它，斷言 CSP meta
 *     的 img-src 含 blob:、且不含瀏覽器會忽略的 frame-ancestors（#535/#1932）。
 *     拔掉那個 meta tag 的 PR 不會跑這道鎖，**而它會照樣部署**
 *     （deploy.yml 盯 `frontend/**`）。
 *   · `backend/data/lessons/**` —— `BlockSequenceRenderer.realdata.test.tsx`
 *     拿真課文當輸入。改課文的 PR 會跑後端套件，但不會跑這支。
 *
 * 所以這一輪不補格子，改成讓「漏一格」本身會紅。
 *
 * ⚠️ 後端那一半是 `backend/specs/test_workflow_path_filters_spec.py` 的
 * `test_every_gate_input_is_in_its_filter`。兩邊要各自存在：那支是 Python、
 * 跑在 spec-check；這支是 vitest、跑在 frontend-checks —— 換句話說
 * 「新增一個 vitest 依賴」只有這一支追得到。
 */

const REPO = resolve(__dirname, '../../..')
const WORKFLOW = resolve(REPO, '.github/workflows/frontend-checks.yml')

/** filter 的 glob 清單（`- 'x/**'` 那些行；註解行不算）。 */
function filterGlobs(): string[] {
  const raw = readFileSync(WORKFLOW, 'utf-8')
  const body = raw.slice(raw.indexOf('filters: |'))
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- '"))
    .map((l) => l.slice(2).trim().replace(/^'|'$/g, ''))
}

/**
 * dorny/paths-filter（picomatch）的比對語意。被比的是**變更檔**的路徑，
 * 所以 `a/**` 命中 a 底下任意深度。測試引用的若是一個目錄，只要有
 * `dir/**` 就算覆蓋 —— 目錄裡任何檔案變更都會觸發。
 */
function covered(path: string, globs: string[]): boolean {
  for (const g of globs) {
    if (g === path) return true
    if (g.endsWith('/**')) {
      const base = g.slice(0, -3)
      if (path === base || path.startsWith(base + '/')) return true
    }
    if (g.includes('*')) {
      const re = new RegExp(
        '^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^/]*') + '$',
      )
      if (re.test(path)) return true
    }
  }
  return false
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** vitest 會跑到的檔（`*.test.ts` / `*.test.tsx`）。 */
function vitestFiles(): string[] {
  return walk(resolve(REPO, 'frontend/src')).filter((p) => /\.test\.tsx?$/.test(p))
}

/** 這個檔在**程式碼裡**引用、且真的存在於 repo 的路徑（註解先剝掉）。 */
function referencedRepoPaths(file: string): string[] {
  const src = readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
  const out = new Set<string>()
  const lit = /["'`]((?:\.{0,2}[A-Za-z0-9_.\-]*\/)+[A-Za-z0-9_.\-]+)["'`]/g
  let m: RegExpExecArray | null
  while ((m = lit.exec(src)) !== null) {
    // 相對於檔案所在目錄先試，再試 repo root —— 解析錯的路徑會被 existsSync 剔掉
    for (const base of [dirname(file), REPO]) {
      const abs = resolve(base, m[1])
      const rel = relative(REPO, abs)
      // ⛔ 垃圾路徑就是在這裡漏掉的：`resolve(__dirname, '../../..')` 會解成
      //    repo root 本身（rel === ''），而 repo root 當然存在 —— 於是這條門
      //    會對著一個空字串叫。上一次嘗試寫通用版就是死在這種路徑上
      //    （`frontend/..`、`frontend/../../../backend/...`），
      //    而會亂叫的門會被下一個人關掉。
      if (!rel || rel === '.' || rel.startsWith('..')) continue
      if (existsSync(abs)) {
        out.add(rel)
        break
      }
    }
  }
  return [...out]
}

describe('CI: frontend-checks 的 paths-filter 要蓋住 vitest 讀的東西', () => {
  const globs = filterGlobs()
  const files = vitestFiles()

  it('filter 跟測試清單都解析得到東西（正向對照）', () => {
    // ⛔ 少了這條，解析壞掉時下面那條會對空集合斷言、永遠綠
    expect(globs).toContain('frontend/src/**')
    expect(globs.length).toBeGreaterThanOrEqual(10)
    expect(files.length).toBeGreaterThanOrEqual(50)
  })

  it('比對器分得開「有盯」跟「沒盯」（負向對照）', () => {
    // ⛔ 少了這條，把 covered 寫成 `return true` 上下都會綠 ——
    //    那正是「測試存在但什麼都沒測」的樣子
    expect(covered('frontend/src/App.tsx', globs)).toBe(true)
    expect(covered('frontend/index.html', globs)).toBe(true)
    expect(covered('docs/meetings/2026-09-11-agenda.md', globs)).toBe(false)
    expect(covered('README.md', globs)).toBe(false)
  })

  it('每一個被 vitest 讀到的 repo 檔都在 filter 上', () => {
    const missing: Record<string, string[]> = {}
    for (const f of files) {
      for (const p of referencedRepoPaths(f)) {
        if (!covered(p, globs)) {
          missing[p] = [...(missing[p] ?? []), relative(REPO, f)]
        }
      }
    }
    expect(
      missing,
      `這些檔被 vitest 讀，但 frontend-checks.yml 的 paths-filter 沒盯 —— ` +
        `改它們的 PR 不會跑這道門（門在，那條路沒插電）:\n` +
        Object.entries(missing)
          .map(([p, who]) => `  ${p}   ← ${who.slice(0, 3).join(', ')}`)
          .join('\n'),
    ).toEqual({})
  })
})
