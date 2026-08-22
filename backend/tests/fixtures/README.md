# 測試用合成學習單

`synthetic_worksheet.docx` / `.pdf` —— **自己編的假課文**，不是客戶原稿。

真原稿在 `private/curriculum-source/`（gitignore），不能進 repo，
所以要讓「見證對帳」那類門在 CI 跑得起來，只能自己造一份**版面結構相同**的。

結構（三頁）：

```
p1  一 讀全文-做記號        (1)(2)(3)
p2  （續，沒有再印標題）      (4)          ← 測跨頁：續頁沒標題不能整頁跳過
p3  三 語詞我最棒 …在空格內填入語詞  (1)(2)(3)   ← 測標題後面還有字
    四 語詞應用             (1)(2)      ← 測同頁兩節不能混
```

重造：`backend/tests/fixtures/build_synthetic_worksheet.py`
