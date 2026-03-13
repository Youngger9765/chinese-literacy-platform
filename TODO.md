# TODO

## skill-tree.html 改用 progressive levels

`docs/intern-training/skill-tree.html` 目前用 localStorage + binary yes/no，需要改成讀 JSON 檔 + 1-5 星等級。

### 要改的部分

1. **資料來源**：localStorage → fetch `interns/raymond.json` + `interns/xiung.json`
2. **Node 顯示**：binary completed/locked → ★★★☆☆ 星級顯示
3. **Node 樣式**：依 level 漸進顯示（0=灰, 1-2=淺色, 3-4=中色, 5=滿色+勾勾）
4. **Profile card**：XP 改成加權計算 `sum(level/5 * xp)`
5. **Detail panel**：顯示星級 + level 名稱 + history timeline
6. **移除所有 localStorage**

### JSON 格式（已更新）

```json
{
  "skills": {
    "1": { "level": 3, "maxLevel": 5, "history": [{"date": "...", "level": 3, "reason": "..."}] }
  },
  "recommendations": ["建議1"],
  "lastReview": "2026-03-13"
}
```

### 不動的部分

- CSS 結構（只新增星級樣式）
- HTML 結構
- SKILLS 定義、tier 定義、confetti
- 響應式佈局
