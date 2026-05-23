import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect } from 'vitest'

/**
 * TDD test for #535: CSP frame-ancestors meta tag warning
 *
 * The `frame-ancestors` directive is a navigation directive that browsers
 * IGNORE when delivered via <meta http-equiv="Content-Security-Policy">.
 * It must only appear in HTTP response headers.
 *
 * The backend SecurityHeadersMiddleware already sets:
 *   Content-Security-Policy: ... frame-ancestors 'none'; ...
 *   X-Frame-Options: DENY
 *
 * So the meta tag version is both redundant and causes a console warning.
 */

/**
 * TDD test for #1932: img-src must include blob: in frontend CSP meta tag
 *
 * /omo upload creates blob: URLs for image preview. The backend CSP header
 * was fixed in PR #1924 but the frontend <meta> tag still had img-src without
 * blob:, causing browser CSP violations (browser enforces strictest policy).
 *
 * Fix: img-src 'self' data: blob: https:
 */
describe('CSP meta tag — img-src blob: for OMO image upload (#1932)', () => {
  const indexHtmlPath = resolve(__dirname, '../../index.html')
  const indexHtml = readFileSync(indexHtmlPath, 'utf-8')

  it('should include blob: in img-src directive', () => {
    const cspMetaMatch = indexHtml.match(
      /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/
    )
    expect(cspMetaMatch).not.toBeNull()

    const cspContent = cspMetaMatch![1]
    // Extract img-src directive value
    const imgSrcMatch = cspContent.match(/img-src\s+([^;]+)/)
    expect(imgSrcMatch).not.toBeNull()

    const imgSrcValue = imgSrcMatch![1]
    expect(imgSrcValue).toContain('blob:')
  })
})

describe('CSP meta tag — frame-ancestors directive', () => {
  const indexHtml = readFileSync(
    resolve(__dirname, '../../index.html'),
    'utf-8'
  )

  it('should NOT contain frame-ancestors in the CSP meta tag', () => {
    // Extract the CSP meta tag content
    const cspMetaMatch = indexHtml.match(
      /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/
    )
    expect(cspMetaMatch).not.toBeNull()

    const cspContent = cspMetaMatch![1]
    expect(cspContent).not.toContain('frame-ancestors')
  })

  it('should still have a CSP meta tag with essential directives', () => {
    expect(indexHtml).toContain('http-equiv="Content-Security-Policy"')
    expect(indexHtml).toContain("default-src 'self'")
  })
})
