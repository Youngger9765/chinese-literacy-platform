# Raw Common-Characters Data Sources

## moe-standard-4808.txt

- **Source file**: https://github.com/ButTaiwan/cjktables/blob/master/taiwan/standard/edu_standard_1.txt
- **Original**: 教育部《常用國字標準字體表》（4,808 字，甲表），1982 年頒布
- **Government publisher**: 中華民國教育部（Ministry of Education, Taiwan）
- **License**: 政府公開資料（government open data）— MOE standard character list published 1982, public domain. ButTaiwan/cjktables provides the machine-readable form as an open-data compilation (no explicit license declared).
- **Downloaded**: 2026-04-18
- **Format**: TSV — `國字\tUnicode`，首行為表頭
- **Usage**: 作為「小學/國中常見字」白名單，用於過濾 `frontend/src/data/radical-meanings.json` 中罕用的相關字，使部件教學面板只顯示學生熟悉的漢字（issue #1099）。
