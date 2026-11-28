/**
 * 閱讀等級卡（#4164）：顯示「參考 PISA 分級的自家等級」與「再做 N 課會更準」。
 * 資料不足（ready=false）時只顯示估計中的提示，不給等級；請求失敗整張卡不出現，不擋報告頁。
 */
import { useEffect, useState } from 'react'
import { API_BASE } from '../../services/apiConfig'

export interface MyAbility {
  ready: boolean
  level: number | null
  level_label: string | null
  hint: string
  disclaimer: string
}

export async function fetchMyAbility(token: string): Promise<MyAbility | null> {
  try {
    const res = await fetch(`${API_BASE}/api/learning/ability/me`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return null
    return (await res.json()) as MyAbility
  } catch {
    return null
  }
}

export function ReadingLevelView({ data }: { data: MyAbility }) {
  return (
    <section className="mt-6 rounded-3xl bg-surface-container-lowest shadow-editorial p-6" data-testid="reading-level-card" aria-label="閱讀等級">
      <h3 className="font-headline font-bold text-lg text-on-surface">我的閱讀等級</h3>
      {data.ready && data.level_label ? (
        <p className="mt-2 text-2xl font-headline font-bold text-primary" data-testid="reading-level-label">{data.level_label}</p>
      ) : (
        <p className="mt-2 text-on-surface-variant" data-testid="reading-level-pending">還在估計中，先不給等級</p>
      )}
      <p className="text-sm text-on-surface-variant mt-1" data-testid="reading-level-hint">{data.hint}</p>
      <p className="text-xs text-on-surface-variant mt-3">{data.disclaimer}</p>
    </section>
  )
}

export default function ReadingLevelCard({ token }: { token: string | null | undefined }) {
  const [data, setData] = useState<MyAbility | null>(null)
  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetchMyAbility(token).then((d) => { if (!cancelled) setData(d) })
    return () => { cancelled = true }
  }, [token])
  return data ? <ReadingLevelView data={data} /> : null
}
