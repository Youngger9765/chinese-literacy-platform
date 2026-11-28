import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ReadingLevelCard, { ReadingLevelView, fetchMyAbility } from '../ReadingLevelCard'

const base = { hint: '還在估計中，再做 5 課會更準', disclaimer: '這是參考 PISA 分級的自家等級，尚未做外部對照' }

describe('ReadingLevelCard（#4164）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('有等級時顯示等級、再做 N 課提示與自家等級聲明', () => {
    render(<ReadingLevelView data={{ ...base, ready: true, level: 4, level_label: '第 4 級：整理文章大意' }} />)
    expect(screen.getByTestId('reading-level-label').textContent).toBe('第 4 級：整理文章大意')
    expect(screen.getByTestId('reading-level-hint').textContent).toContain('再做 5 課會更準')
    expect(screen.getByText(/參考 PISA 分級的自家等級/)).toBeTruthy()
  })

  it('資料不足時不給等級，只顯示估計中', () => {
    render(<ReadingLevelView data={{ ...base, ready: false, level: null, level_label: null }} />)
    expect(screen.queryByTestId('reading-level-label')).toBeNull()
    expect(screen.getByTestId('reading-level-pending')).toBeTruthy()
  })

  it('請求失敗：整張卡不出現', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await fetchMyAbility('t')).toBeNull()
    render(<ReadingLevelCard token="t" />)
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByTestId('reading-level-card')).toBeNull()
  })

  it('請求成功：載入後出現卡片', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...base, ready: true, level: 2, level_label: '第 2 級：讀懂句子' }) }))
    render(<ReadingLevelCard token="t" />)
    await waitFor(() => expect(screen.getByTestId('reading-level-label').textContent).toBe('第 2 級：讀懂句子'))
  })
})
