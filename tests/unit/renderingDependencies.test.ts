import { Marp } from '@marp-team/marp-core'
import { describe, expect, it } from 'vitest'

// Dependency compatibility viewpoints: normal inline/display math, untrusted
// link data, and MathJax's XML path. Browser E2E covers iframe/UI rendering.
describe('patched Marp math dependencies', () => {
  it('retains KaTeX inline and display output after the scoped override', () => {
    const { html, css } = new Marp({ math: 'katex', html: false }).render(
      '# Formula\n\n$E = mc^2$\n\n$$\n\\frac{1}{2} + \\sqrt{x}\n$$',
    )
    expect(html).toContain('class="katex"')
    expect(html).toContain('katex-display')
    expect(html).not.toContain('katex-error')
    expect(css).toContain('.katex')
  })
  it('keeps unsafe KaTeX link protocols disabled', () => {
    const { html } = new Marp({ math: 'katex', html: false }).render(
      '$\\href{javascript:alert(1)}{unsafe}$',
    )
    expect(html).not.toMatch(/href=["']javascript:/i)
  })
  it('retains the default MathJax XML rendering path', () => {
    const { html } = new Marp({ html: false }).render('# Math\n\n$x^2 + y^2$')
    expect(html).toContain('mjx-container')
    expect(html).not.toContain('data-mjx-error')
  })
})
