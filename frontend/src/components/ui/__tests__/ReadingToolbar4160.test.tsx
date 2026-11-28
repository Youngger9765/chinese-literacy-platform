import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ReadingToolbar from '../ReadingToolbar'
import { reloadReadingPrefsFromStorage, resetReadingPrefs, useReadingPrefs } from '../../../hooks/useReadingPrefs'
import { READING_PREFS_KEY } from '../../../utils/readingPrefs'

function Probe() {
  const p = useReadingPrefs()
  return <div data-testid="probe" data-size={p.sizeIndex} data-font={p.font} data-theme={p.theme} data-align={p.align} />
}
const open = () => fireEvent.click(screen.getByLabelText('閱讀設定'))
const probe = () => screen.getByTestId('probe').dataset

describe('ReadingToolbar（#4160）', () => {
  beforeEach(() => {
    localStorage.clear()
    act(() => resetReadingPrefs())
  })

  it('按 A＋ 兩次，字級升兩檔；另一個訂閱者（模擬下一關）也看到', () => {
    render(<><ReadingToolbar /><Probe /></>)
    open()
    fireEvent.click(screen.getByLabelText('字級放大'))
    fireEvent.click(screen.getByLabelText('字級放大'))
    expect(probe().size).toBe('4')
    expect(screen.getByTestId('reading-size-label').textContent).toBe('特大')
    expect(screen.getByLabelText('字級放大')).toBeDisabled()
  })

  it('選明體與深色後寫進本機，重新載入仍在', () => {
    render(<><ReadingToolbar /><Probe /></>)
    open()
    fireEvent.click(screen.getByText('明體'))
    fireEvent.click(screen.getByText('深色'))
    expect(JSON.parse(localStorage.getItem(READING_PREFS_KEY)!)).toMatchObject({ font: 'serif', theme: 'dark' })
    act(() => reloadReadingPrefsFromStorage())
    expect(probe().font).toBe('serif')
    expect(probe().theme).toBe('dark')
  })

  it('恢復預設：四組都回預設', () => {
    render(<><ReadingToolbar /><Probe /></>)
    open()
    fireEvent.click(screen.getByLabelText('字級放大'))
    fireEvent.click(screen.getByText('楷體'))
    fireEvent.click(screen.getByText('置中'))
    fireEvent.click(screen.getByText('護眼'))
    fireEvent.click(screen.getByText('恢復預設'))
    expect(probe()).toMatchObject({ size: '2', font: 'default', align: 'left', theme: 'light' })
  })
})
