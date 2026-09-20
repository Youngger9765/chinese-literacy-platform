# 學習單 GCS Mapping
生成時間：2026-09-19T00:27:22.869130+00:00

## 用途

這份 mapping 有兩個用途：

1. **驗身分**：不用下載就知道 GCS 上那份是不是 `specs/modules/fidelity/<uid>.json` 記的同一份
   原稿 —— 比對 `sha256_16` 欄位（sha256 前 16 碼、每 4 碼分組，跟
   `scripts/content_fidelity_attest.py::sha()` 用同一套格式，避免完整 64 碼雜湊觸發
   secret 掃描器誤判）
2. **抓漂移**：哪天 Drive 上的原稿被換掉，下次重新計算 sha256 會對不上這份紀錄

## 規則

- **原始 docx 本體不進這個 repo**（本 repo 是 PUBLIC，內容住 GCS private bucket，見 `.gitignore`）
- `gcs_path` 是**規劃中**的物件路徑（`worksheets-gated/{lesson_uid}-{student|teacher}.docx`），
  `gcs_uploaded` 為 `false` 代表尚未實際上傳（見 #3276 blocked on GCS 寫入權限）
- 比對方法：Drive 資料夾 `1.教材/2.各年級分課/`，用 `backend/data/lessons/{uid}/v3/lesson.yml`
  的 `catalog_slot` 欄位對應 Drive 檔名裡的代碼（如 `G4-L19`），不是用檔名關鍵字猜

## 結構總覽

- 總課數：179
- 有教師版：179 ／ 有學生版：179 ／ 兩版都有：179
- 孤兒（對不到任何課的 Drive 檔案，或有課但缺一版）：0

（本次盤點零孤兒）

## 逐課對照表

| lesson_uid | catalog_slot | 教師版 GCS 路徑 | 教師版 sha256 | 學生版 GCS 路徑 | 學生版 sha256 |
|---|---|---|---|---|---|
| L0001 | G4-L10 | `worksheets-gated/L0001-teacher.docx` | `1ea0-81ea-4b1d-52f2` | `worksheets-gated/L0001-student.docx` | `8b49-8022-1751-8cc4` |
| L0002 | G4-L11 | `worksheets-gated/L0002-teacher.docx` | `77fd-6a0a-5739-c075` | `worksheets-gated/L0002-student.docx` | `dabd-da61-807e-8be9` |
| L0003 | G4-L12 | `worksheets-gated/L0003-teacher.docx` | `47aa-73cb-31b9-de5a` | `worksheets-gated/L0003-student.docx` | `1762-141e-3ab4-794c` |
| L0004 | G4-L13 | `worksheets-gated/L0004-teacher.docx` | `e954-5676-0d48-6e75` | `worksheets-gated/L0004-student.docx` | `6558-c551-e975-fdee` |
| L0005 | G4-L14 | `worksheets-gated/L0005-teacher.docx` | `3e17-008e-875c-079f` | `worksheets-gated/L0005-student.docx` | `a057-7d6e-659a-901b` |
| L0006 | G4-L15 | `worksheets-gated/L0006-teacher.docx` | `4fc0-42b0-b943-27cb` | `worksheets-gated/L0006-student.docx` | `2a1b-a07a-b288-87d2` |
| L0007 | G4-L16 | `worksheets-gated/L0007-teacher.docx` | `721f-055a-a0b9-059e` | `worksheets-gated/L0007-student.docx` | `5008-9876-76e2-c81d` |
| L0008 | G4-L17 | `worksheets-gated/L0008-teacher.docx` | `9354-9dd0-a110-9d4c` | `worksheets-gated/L0008-student.docx` | `03b4-e8ab-557a-151e` |
| L0009 | G4-L18 | `worksheets-gated/L0009-teacher.docx` | `cd54-a5b4-da4a-f89a` | `worksheets-gated/L0009-student.docx` | `fc17-05cc-7f2d-1c89` |
| L0010 | G4-L19 | `worksheets-gated/L0010-teacher.docx` | `ede0-24e5-fcb9-18e7` | `worksheets-gated/L0010-student.docx` | `72f0-ed09-f661-8dbd` |
| L0011 | G4-L1 | `worksheets-gated/L0011-teacher.docx` | `d74f-a29a-4960-9ff4` | `worksheets-gated/L0011-student.docx` | `d35a-020f-e81e-3ec5` |
| L0012 | G4-L20 | `worksheets-gated/L0012-teacher.docx` | `099b-aecf-9fe1-5564` | `worksheets-gated/L0012-student.docx` | `db25-1209-496a-6207` |
| L0013 | G4-L2 | `worksheets-gated/L0013-teacher.docx` | `1023-7b7f-dc43-e49e` | `worksheets-gated/L0013-student.docx` | `1b8b-7b16-bdb6-b12d` |
| L0014 | G4-L3 | `worksheets-gated/L0014-teacher.docx` | `1e6b-580e-8034-44ed` | `worksheets-gated/L0014-student.docx` | `90c7-78eb-9d81-9f39` |
| L0015 | G4-L4 | `worksheets-gated/L0015-teacher.docx` | `a886-0b75-1eac-4a21` | `worksheets-gated/L0015-student.docx` | `cbac-219b-796e-ae19` |
| L0016 | G4-L5 | `worksheets-gated/L0016-teacher.docx` | `9cc6-2422-07fc-4329` | `worksheets-gated/L0016-student.docx` | `8135-70f3-051f-971b` |
| L0017 | G4-L6 | `worksheets-gated/L0017-teacher.docx` | `a195-d1d1-2373-66a2` | `worksheets-gated/L0017-student.docx` | `e8b1-7573-1afd-7c62` |
| L0018 | G4-L7 | `worksheets-gated/L0018-teacher.docx` | `97a6-7554-9df7-7968` | `worksheets-gated/L0018-student.docx` | `e0d4-b136-874e-d94e` |
| L0019 | G4-L8 | `worksheets-gated/L0019-teacher.docx` | `928e-0479-a3e8-c74b` | `worksheets-gated/L0019-student.docx` | `c462-3e12-b9df-09a8` |
| L0020 | G4-L9 | `worksheets-gated/L0020-teacher.docx` | `efd0-2319-db96-e34f` | `worksheets-gated/L0020-student.docx` | `6aa7-1e1f-6140-a83d` |
| L0021 | G5-L0 | `worksheets-gated/L0021-teacher.docx` | `b291-e587-8f04-5899` | `worksheets-gated/L0021-student.docx` | `b43b-1d14-156e-466f` |
| L0022 | G5-L10 | `worksheets-gated/L0022-teacher.docx` | `98cc-3b2c-9c95-2020` | `worksheets-gated/L0022-student.docx` | `9ee3-7267-4747-6f36` |
| L0023 | G5-L11 | `worksheets-gated/L0023-teacher.docx` | `2dc6-cff5-203e-969b` | `worksheets-gated/L0023-student.docx` | `51a8-f624-1e94-78f7` |
| L0024 | G5-L12 | `worksheets-gated/L0024-teacher.docx` | `4ea3-344a-e454-78bd` | `worksheets-gated/L0024-student.docx` | `a6d4-1c7d-7b83-8f9e` |
| L0025 | G5-L13 | `worksheets-gated/L0025-teacher.docx` | `85a8-13a0-53a4-36f1` | `worksheets-gated/L0025-student.docx` | `0551-d315-4ca4-3f76` |
| L0026 | G5-L14 | `worksheets-gated/L0026-teacher.docx` | `d844-6c6a-40b1-a22e` | `worksheets-gated/L0026-student.docx` | `8f61-0936-d248-91a1` |
| L0027 | G5-L15 | `worksheets-gated/L0027-teacher.docx` | `89e0-1608-55e9-a013` | `worksheets-gated/L0027-student.docx` | `8917-fc82-f728-0ede` |
| L0028 | G5-L16 | `worksheets-gated/L0028-teacher.docx` | `869f-ec47-3865-ca2b` | `worksheets-gated/L0028-student.docx` | `0b1c-3790-9642-8bbc` |
| L0029 | G5-L17 | `worksheets-gated/L0029-teacher.docx` | `bd09-b626-76b1-0191` | `worksheets-gated/L0029-student.docx` | `b529-1651-88b3-22ed` |
| L0030 | G5-L19 | `worksheets-gated/L0030-teacher.docx` | `63cc-095b-a1e5-8141` | `worksheets-gated/L0030-student.docx` | `36a0-ff83-1b12-c150` |
| L0031 | G5-L1 | `worksheets-gated/L0031-teacher.docx` | `0baa-121c-569f-179b` | `worksheets-gated/L0031-student.docx` | `f5cc-eb2b-86e0-9c69` |
| L0032 | G5-L20 | `worksheets-gated/L0032-teacher.docx` | `6c8b-7b0d-7fb3-9b03` | `worksheets-gated/L0032-student.docx` | `69c3-fa27-3224-c331` |
| L0033 | G5-L21 | `worksheets-gated/L0033-teacher.docx` | `902b-c2f4-7129-68f8` | `worksheets-gated/L0033-student.docx` | `c87c-1e8b-ae7b-f528` |
| L0034 | G5-L22 | `worksheets-gated/L0034-teacher.docx` | `6d74-22e6-022b-1e66` | `worksheets-gated/L0034-student.docx` | `5df5-92d1-14bd-db21` |
| L0035 | G5-L23 | `worksheets-gated/L0035-teacher.docx` | `6618-01ed-e923-6136` | `worksheets-gated/L0035-student.docx` | `a797-34b8-aab9-d443` |
| L0036 | G5-L24 | `worksheets-gated/L0036-teacher.docx` | `6d46-5cd9-a1d3-581e` | `worksheets-gated/L0036-student.docx` | `454a-51d7-5840-b200` |
| L0037 | G5-L25 | `worksheets-gated/L0037-teacher.docx` | `69f8-df2e-2095-7488` | `worksheets-gated/L0037-student.docx` | `e390-5fb4-96c1-d1de` |
| L0038 | G5-L26 | `worksheets-gated/L0038-teacher.docx` | `d4b1-e17f-4ada-a3c9` | `worksheets-gated/L0038-student.docx` | `0644-f079-b85f-0f92` |
| L0039 | G5-L27 | `worksheets-gated/L0039-teacher.docx` | `39e3-ea8b-3e57-1c63` | `worksheets-gated/L0039-student.docx` | `bb26-c3a0-8a52-e450` |
| L0040 | G5-L28 | `worksheets-gated/L0040-teacher.docx` | `e719-fcef-a2e3-d556` | `worksheets-gated/L0040-student.docx` | `3867-877b-d2c8-1ad6` |
| L0041 | G5-L2 | `worksheets-gated/L0041-teacher.docx` | `9a59-1192-5e6a-fab1` | `worksheets-gated/L0041-student.docx` | `b3ed-1245-87c8-1c7a` |
| L0042 | G5-L3 | `worksheets-gated/L0042-teacher.docx` | `338c-ba69-4f13-8dcb` | `worksheets-gated/L0042-student.docx` | `6303-52bc-c61c-e2b3` |
| L0043 | G5-L4 | `worksheets-gated/L0043-teacher.docx` | `7a4b-0d64-f0da-c60d` | `worksheets-gated/L0043-student.docx` | `b456-0e93-7e2d-4986` |
| L0044 | G5-L5 | `worksheets-gated/L0044-teacher.docx` | `bb32-3fbe-5319-d64f` | `worksheets-gated/L0044-student.docx` | `ee86-97fb-509c-6671` |
| L0045 | G5-L6 | `worksheets-gated/L0045-teacher.docx` | `0bc7-5127-e85d-b7e6` | `worksheets-gated/L0045-student.docx` | `d908-c160-48ce-f529` |
| L0046 | G5-L7 | `worksheets-gated/L0046-teacher.docx` | `c1b7-1861-ae53-a9d1` | `worksheets-gated/L0046-student.docx` | `f0ff-3a4a-8057-82a0` |
| L0047 | G5-L8 | `worksheets-gated/L0047-teacher.docx` | `2654-4fe7-06fb-d609` | `worksheets-gated/L0047-student.docx` | `4b59-84e4-f8a1-faec` |
| L0048 | G5-L9 | `worksheets-gated/L0048-teacher.docx` | `c735-5a69-2a38-db1d` | `worksheets-gated/L0048-student.docx` | `054b-8f35-cd7e-84f2` |
| L0049 | G6-L0 | `worksheets-gated/L0049-teacher.docx` | `e247-7fc9-fd40-a156` | `worksheets-gated/L0049-student.docx` | `986b-d88e-0efc-9001` |
| L0050 | G6-L10 | `worksheets-gated/L0050-teacher.docx` | `7c94-19da-77c6-8eb6` | `worksheets-gated/L0050-student.docx` | `673e-86a1-b27b-acfa` |
| L0051 | G6-L11 | `worksheets-gated/L0051-teacher.docx` | `e4df-f085-9cf9-db0f` | `worksheets-gated/L0051-student.docx` | `a4a0-d29d-91ea-4866` |
| L0052 | G6-L12 | `worksheets-gated/L0052-teacher.docx` | `e90b-1c6b-a8c4-daa5` | `worksheets-gated/L0052-student.docx` | `ed44-13f1-15c3-4b3a` |
| L0053 | G6-L13 | `worksheets-gated/L0053-teacher.docx` | `4619-203c-ab28-6e82` | `worksheets-gated/L0053-student.docx` | `4235-646a-6c96-54a9` |
| L0054 | G6-L14 | `worksheets-gated/L0054-teacher.docx` | `7b10-b2f6-de66-3e22` | `worksheets-gated/L0054-student.docx` | `8bfa-b069-b451-ade8` |
| L0055 | G6-L15 | `worksheets-gated/L0055-teacher.docx` | `fafd-9c3b-9c4f-2c3d` | `worksheets-gated/L0055-student.docx` | `1d01-2e5f-ebdc-9f81` |
| L0056 | G6-L16 | `worksheets-gated/L0056-teacher.docx` | `e587-84ee-5f4d-e1ac` | `worksheets-gated/L0056-student.docx` | `cc08-43bc-326b-93db` |
| L0057 | G6-L17 | `worksheets-gated/L0057-teacher.docx` | `a836-001b-9a18-db97` | `worksheets-gated/L0057-student.docx` | `ae80-9be4-672d-3b4c` |
| L0058 | G6-L18 | `worksheets-gated/L0058-teacher.docx` | `f694-71c8-6bdf-829b` | `worksheets-gated/L0058-student.docx` | `8dec-d467-43ec-47f5` |
| L0059 | G6-L19 | `worksheets-gated/L0059-teacher.docx` | `b3d0-9508-7867-0312` | `worksheets-gated/L0059-student.docx` | `af77-3887-7e61-009a` |
| L0060 | G6-L1 | `worksheets-gated/L0060-teacher.docx` | `e41e-5449-3f0a-6fcd` | `worksheets-gated/L0060-student.docx` | `9a35-8a6c-0458-2e0d` |
| L0061 | G6-L20 | `worksheets-gated/L0061-teacher.docx` | `9aff-4ae4-bfc7-9a26` | `worksheets-gated/L0061-student.docx` | `614b-3b4b-d38a-adc7` |
| L0062 | G6-L21 | `worksheets-gated/L0062-teacher.docx` | `96b0-a18a-64a5-0a2f` | `worksheets-gated/L0062-student.docx` | `8830-f4fd-854d-0b47` |
| L0063 | G6-L22 | `worksheets-gated/L0063-teacher.docx` | `39a9-1fe4-0878-4b6b` | `worksheets-gated/L0063-student.docx` | `fb17-f4c5-c240-a734` |
| L0064 | G6-L25 | `worksheets-gated/L0064-teacher.docx` | `3488-1969-673b-9c38` | `worksheets-gated/L0064-student.docx` | `9b10-ab9c-b1ca-d85c` |
| L0065 | G6-L26 | `worksheets-gated/L0065-teacher.docx` | `b611-b374-e10d-a1d0` | `worksheets-gated/L0065-student.docx` | `faff-b8d8-ff00-e837` |
| L0066 | G6-L27 | `worksheets-gated/L0066-teacher.docx` | `accf-e023-98f3-0636` | `worksheets-gated/L0066-student.docx` | `0010-cdf1-33d6-908b` |
| L0067 | G6-L28 | `worksheets-gated/L0067-teacher.docx` | `b969-ab21-4c96-9b13` | `worksheets-gated/L0067-student.docx` | `def2-9989-ca4e-6248` |
| L0068 | G6-L29 | `worksheets-gated/L0068-teacher.docx` | `aa4f-3e3b-592c-1c72` | `worksheets-gated/L0068-student.docx` | `cf62-daf1-4552-f316` |
| L0069 | G6-L2 | `worksheets-gated/L0069-teacher.docx` | `6d12-36b9-592a-1d1c` | `worksheets-gated/L0069-student.docx` | `d166-4009-37c4-09a9` |
| L0070 | G6-L3 | `worksheets-gated/L0070-teacher.docx` | `1141-b1ef-a2e5-0b65` | `worksheets-gated/L0070-student.docx` | `2000-c111-1b51-d5ef` |
| L0071 | G6-L4 | `worksheets-gated/L0071-teacher.docx` | `2ecc-d3e7-4232-435a` | `worksheets-gated/L0071-student.docx` | `a1cb-8997-5e39-40e7` |
| L0072 | G6-L5 | `worksheets-gated/L0072-teacher.docx` | `ecfe-fc59-eb5d-7994` | `worksheets-gated/L0072-student.docx` | `7a56-81ce-da9a-1163` |
| L0073 | G6-L6 | `worksheets-gated/L0073-teacher.docx` | `b74e-641b-f4b9-ee50` | `worksheets-gated/L0073-student.docx` | `56e6-9df7-2ce8-1a46` |
| L0074 | G6-L7 | `worksheets-gated/L0074-teacher.docx` | `c2eb-e112-3c81-9418` | `worksheets-gated/L0074-student.docx` | `3205-6c15-e49a-3ab6` |
| L0075 | G6-L8 | `worksheets-gated/L0075-teacher.docx` | `da7f-4dac-d55d-1dff` | `worksheets-gated/L0075-student.docx` | `f4a1-dfb9-d5a4-f78b` |
| L0076 | G6-L9 | `worksheets-gated/L0076-teacher.docx` | `f5b0-c9d6-fb2b-4bdc` | `worksheets-gated/L0076-student.docx` | `efac-0f8a-0602-2be0` |
| L0077 | G7-L0 | `worksheets-gated/L0077-teacher.docx` | `17c5-4c07-890b-574e` | `worksheets-gated/L0077-student.docx` | `a2e0-bf40-4ff1-9e0f` |
| L0078 | G7-L10 | `worksheets-gated/L0078-teacher.docx` | `48e6-b6b7-b45a-beeb` | `worksheets-gated/L0078-student.docx` | `2088-1301-fae0-7ee9` |
| L0079 | G7-L11 | `worksheets-gated/L0079-teacher.docx` | `a06c-58c9-cf1d-b3fa` | `worksheets-gated/L0079-student.docx` | `7b5e-22ad-d748-c637` |
| L0080 | G7-L12 | `worksheets-gated/L0080-teacher.docx` | `2878-7b25-4b49-c8f7` | `worksheets-gated/L0080-student.docx` | `ace8-8550-4db4-a16c` |
| L0081 | G7-L13 | `worksheets-gated/L0081-teacher.docx` | `0af5-2dab-df2a-accb` | `worksheets-gated/L0081-student.docx` | `9e5a-85a1-b5bd-1778` |
| L0082 | G7-L14 | `worksheets-gated/L0082-teacher.docx` | `5319-aa1f-d486-890f` | `worksheets-gated/L0082-student.docx` | `1992-115c-72b7-b398` |
| L0083 | G7-L15 | `worksheets-gated/L0083-teacher.docx` | `126f-a03d-4781-a0aa` | `worksheets-gated/L0083-student.docx` | `aa24-ee81-4834-aa4b` |
| L0084 | G7-L16 | `worksheets-gated/L0084-teacher.docx` | `c4c3-3067-1307-9850` | `worksheets-gated/L0084-student.docx` | `a5a9-a487-3e88-0564` |
| L0085 | G7-L17 | `worksheets-gated/L0085-teacher.docx` | `76e0-1873-5622-31df` | `worksheets-gated/L0085-student.docx` | `5415-6f3c-693a-f1a0` |
| L0086 | G7-L18 | `worksheets-gated/L0086-teacher.docx` | `75db-73d8-7ee5-5944` | `worksheets-gated/L0086-student.docx` | `7442-e0cc-4cdc-37d3` |
| L0087 | G7-L19 | `worksheets-gated/L0087-teacher.docx` | `bd95-d28e-17af-4877` | `worksheets-gated/L0087-student.docx` | `aaf5-3108-7655-2dfa` |
| L0088 | G7-L1 | `worksheets-gated/L0088-teacher.docx` | `982c-60c0-9fa1-cd2d` | `worksheets-gated/L0088-student.docx` | `b1e9-5a15-c76d-f0fb` |
| L0089 | G7-L20 | `worksheets-gated/L0089-teacher.docx` | `fe19-61fd-2fd1-01ea` | `worksheets-gated/L0089-student.docx` | `d0a1-7af3-9861-45be` |
| L0090 | G7-L21 | `worksheets-gated/L0090-teacher.docx` | `6c5f-eafd-7c00-3675` | `worksheets-gated/L0090-student.docx` | `2f18-15d5-7803-4892` |
| L0091 | G7-L22 | `worksheets-gated/L0091-teacher.docx` | `b9eb-d211-dda4-160f` | `worksheets-gated/L0091-student.docx` | `90dd-6f9a-d713-6db4` |
| L0092 | G7-L23 | `worksheets-gated/L0092-teacher.docx` | `2e17-1f5e-37dc-c5c7` | `worksheets-gated/L0092-student.docx` | `2f1f-b437-1b39-e32e` |
| L0093 | G7-L24 | `worksheets-gated/L0093-teacher.docx` | `7512-2036-c5ec-e3f1` | `worksheets-gated/L0093-student.docx` | `599f-4deb-ad6d-16bd` |
| L0094 | G7-L25 | `worksheets-gated/L0094-teacher.docx` | `67d2-a190-7d12-6e5d` | `worksheets-gated/L0094-student.docx` | `568b-74bb-ffae-c2fe` |
| L0095 | G7-L26 | `worksheets-gated/L0095-teacher.docx` | `8bc2-f5ad-d0b9-04a0` | `worksheets-gated/L0095-student.docx` | `2e9a-9a63-49e6-c46e` |
| L0096 | G7-L27 | `worksheets-gated/L0096-teacher.docx` | `84c6-d343-c951-bf81` | `worksheets-gated/L0096-student.docx` | `5cab-0e97-d6f0-d374` |
| L0097 | G7-L28 | `worksheets-gated/L0097-teacher.docx` | `d5ee-f45a-3e50-1812` | `worksheets-gated/L0097-student.docx` | `7131-5192-33e1-be9f` |
| L0098 | G7-L29 | `worksheets-gated/L0098-teacher.docx` | `4f2e-60f4-937f-ca16` | `worksheets-gated/L0098-student.docx` | `ccbf-ef85-318e-2184` |
| L0099 | G7-L2 | `worksheets-gated/L0099-teacher.docx` | `740e-a52f-b7f6-15ee` | `worksheets-gated/L0099-student.docx` | `5a97-3005-f3f4-907d` |
| L0100 | G7-L3 | `worksheets-gated/L0100-teacher.docx` | `441e-c1cd-402e-da9c` | `worksheets-gated/L0100-student.docx` | `b912-fd81-c7bd-8834` |
| L0101 | G7-L4 | `worksheets-gated/L0101-teacher.docx` | `59da-83ac-0f7a-843b` | `worksheets-gated/L0101-student.docx` | `1b7b-97bc-9fd4-cce8` |
| L0102 | G7-L5 | `worksheets-gated/L0102-teacher.docx` | `d314-0b15-15f6-248d` | `worksheets-gated/L0102-student.docx` | `50ed-65d9-efed-4075` |
| L0103 | G7-L6 | `worksheets-gated/L0103-teacher.docx` | `0a49-c0a4-5dcf-a32f` | `worksheets-gated/L0103-student.docx` | `d21d-9d64-ae2d-dbae` |
| L0104 | G7-L7 | `worksheets-gated/L0104-teacher.docx` | `3edb-f630-f2e5-8591` | `worksheets-gated/L0104-student.docx` | `5518-e200-21e3-b65d` |
| L0105 | G7-L8 | `worksheets-gated/L0105-teacher.docx` | `764e-2135-ca85-279e` | `worksheets-gated/L0105-student.docx` | `4347-69dc-f2c6-10c7` |
| L0106 | G7-L9 | `worksheets-gated/L0106-teacher.docx` | `942c-8fab-22a8-97c9` | `worksheets-gated/L0106-student.docx` | `1c9e-5767-4354-173a` |
| L0107 | G8-L0 | `worksheets-gated/L0107-teacher.docx` | `4540-a6d7-5236-632d` | `worksheets-gated/L0107-student.docx` | `8dfe-a75c-37a7-cadc` |
| L0108 | G8-L10 | `worksheets-gated/L0108-teacher.docx` | `5eea-a3dc-b3d6-79c2` | `worksheets-gated/L0108-student.docx` | `3266-db55-49bc-0ba9` |
| L0109 | G8-L11 | `worksheets-gated/L0109-teacher.docx` | `c4cc-2bf9-e282-4564` | `worksheets-gated/L0109-student.docx` | `8f61-a68b-e856-68b4` |
| L0110 | G8-L12 | `worksheets-gated/L0110-teacher.docx` | `07ae-c70f-7417-d95e` | `worksheets-gated/L0110-student.docx` | `7067-ffbc-da1b-ec60` |
| L0111 | G8-L13 | `worksheets-gated/L0111-teacher.docx` | `a02f-5b69-9d82-7043` | `worksheets-gated/L0111-student.docx` | `6a27-36d3-59bb-237f` |
| L0112 | G8-L15 | `worksheets-gated/L0112-teacher.docx` | `fa0f-e5f9-8e2d-5079` | `worksheets-gated/L0112-student.docx` | `56fd-0044-74ae-c4b2` |
| L0113 | G8-L16 | `worksheets-gated/L0113-teacher.docx` | `b8df-5d4f-47a1-cc54` | `worksheets-gated/L0113-student.docx` | `fa27-c943-edd2-5804` |
| L0114 | G8-L17 | `worksheets-gated/L0114-teacher.docx` | `dd96-3827-8bf8-aae8` | `worksheets-gated/L0114-student.docx` | `6b74-ab4d-4850-4722` |
| L0115 | G8-L18 | `worksheets-gated/L0115-teacher.docx` | `1ecc-679a-7e52-3a52` | `worksheets-gated/L0115-student.docx` | `e376-b3ab-7b55-09cc` |
| L0116 | G8-L19 | `worksheets-gated/L0116-teacher.docx` | `3b89-b45e-b485-6458` | `worksheets-gated/L0116-student.docx` | `0e25-e3c8-7089-d11d` |
| L0117 | G8-L1 | `worksheets-gated/L0117-teacher.docx` | `24df-8729-df02-0c06` | `worksheets-gated/L0117-student.docx` | `2fcc-41f3-f73c-64f8` |
| L0118 | G8-L20 | `worksheets-gated/L0118-teacher.docx` | `a70a-36fe-7c19-bd3a` | `worksheets-gated/L0118-student.docx` | `8e7e-dbb5-32e6-61c9` |
| L0119 | G8-L21 | `worksheets-gated/L0119-teacher.docx` | `2d31-682d-ddac-12b1` | `worksheets-gated/L0119-student.docx` | `6329-d152-3fe2-f835` |
| L0120 | G8-L22 | `worksheets-gated/L0120-teacher.docx` | `af86-c55e-8188-348b` | `worksheets-gated/L0120-student.docx` | `e8dd-5456-6653-10c0` |
| L0121 | G8-L23 | `worksheets-gated/L0121-teacher.docx` | `d1b5-60f7-0413-a345` | `worksheets-gated/L0121-student.docx` | `b4a4-f879-26af-dd7d` |
| L0122 | G8-L2 | `worksheets-gated/L0122-teacher.docx` | `80c0-4a14-b91b-6c6b` | `worksheets-gated/L0122-student.docx` | `ffb1-eb0d-aedb-48ef` |
| L0123 | G8-L3 | `worksheets-gated/L0123-teacher.docx` | `d2b6-968b-ea11-b211` | `worksheets-gated/L0123-student.docx` | `dac5-1fdc-97d9-e3d4` |
| L0124 | G8-L4 | `worksheets-gated/L0124-teacher.docx` | `3aeb-92e5-d342-5189` | `worksheets-gated/L0124-student.docx` | `5175-ef04-ce7f-ab0b` |
| L0125 | G8-L5 | `worksheets-gated/L0125-teacher.docx` | `71be-c2a7-74b9-9919` | `worksheets-gated/L0125-student.docx` | `bb1b-ffa9-9ab8-dee2` |
| L0126 | G8-L6 | `worksheets-gated/L0126-teacher.docx` | `c006-ff25-582b-bb71` | `worksheets-gated/L0126-student.docx` | `74d9-a749-c973-f87d` |
| L0127 | G8-L7 | `worksheets-gated/L0127-teacher.docx` | `1793-71f6-7223-4f98` | `worksheets-gated/L0127-student.docx` | `c82c-217b-c0fd-8b7f` |
| L0128 | G8-L8 | `worksheets-gated/L0128-teacher.docx` | `4191-751a-ba12-f7df` | `worksheets-gated/L0128-student.docx` | `8d79-a3aa-dc85-20bc` |
| L0129 | G8-L9 | `worksheets-gated/L0129-teacher.docx` | `789b-09eb-bdce-7330` | `worksheets-gated/L0129-student.docx` | `fc33-550d-9dcb-cb4d` |
| L0130 | G9-L0 | `worksheets-gated/L0130-teacher.docx` | `213d-897a-aa9f-86ad` | `worksheets-gated/L0130-student.docx` | `ed1a-609d-25a7-f4f6` |
| L0131 | G9-L10 | `worksheets-gated/L0131-teacher.docx` | `2d4c-ec99-e9db-b9e7` | `worksheets-gated/L0131-student.docx` | `284a-58ff-de99-3dd1` |
| L0132 | G9-L11 | `worksheets-gated/L0132-teacher.docx` | `e0ca-035a-865e-38ff` | `worksheets-gated/L0132-student.docx` | `dc5a-e21b-e6fd-4135` |
| L0133 | G9-L12 | `worksheets-gated/L0133-teacher.docx` | `31ae-a3e5-a0e0-3fcb` | `worksheets-gated/L0133-student.docx` | `d681-f08a-a27b-f1b2` |
| L0134 | G9-L13 | `worksheets-gated/L0134-teacher.docx` | `105d-1f80-abc6-6ebf` | `worksheets-gated/L0134-student.docx` | `4012-0992-4104-b389` |
| L0135 | G9-L14 | `worksheets-gated/L0135-teacher.docx` | `390b-0b70-42a0-c597` | `worksheets-gated/L0135-student.docx` | `e0d1-7421-2bf5-4fdf` |
| L0136 | G9-L15 | `worksheets-gated/L0136-teacher.docx` | `8f9d-eec1-abf9-b4fb` | `worksheets-gated/L0136-student.docx` | `ea7f-9d98-4b1d-f6ba` |
| L0137 | G9-L16 | `worksheets-gated/L0137-teacher.docx` | `af49-1e02-77c1-2b6f` | `worksheets-gated/L0137-student.docx` | `6ae8-0d2b-3b78-12a5` |
| L0138 | G9-L18 | `worksheets-gated/L0138-teacher.docx` | `05c5-8837-7118-1171` | `worksheets-gated/L0138-student.docx` | `7e57-490a-21cd-da26` |
| L0139 | G9-L19 | `worksheets-gated/L0139-teacher.docx` | `0071-29a3-af71-af70` | `worksheets-gated/L0139-student.docx` | `2ec5-771c-c145-6f8e` |
| L0140 | G9-L1 | `worksheets-gated/L0140-teacher.docx` | `8f44-9e55-2eb2-e6e5` | `worksheets-gated/L0140-student.docx` | `77a7-7cfc-4225-056b` |
| L0141 | G9-L20 | `worksheets-gated/L0141-teacher.docx` | `8bd4-b42f-2dd0-7e88` | `worksheets-gated/L0141-student.docx` | `3eee-d9c3-7f71-0646` |
| L0142 | G9-L21 | `worksheets-gated/L0142-teacher.docx` | `030c-a55b-a72f-a3fc` | `worksheets-gated/L0142-student.docx` | `567e-221e-4bc5-de80` |
| L0143 | G9-L22 | `worksheets-gated/L0143-teacher.docx` | `2cc2-a33e-fd19-6c41` | `worksheets-gated/L0143-student.docx` | `08b9-5e59-8bb7-efea` |
| L0144 | G9-L23 | `worksheets-gated/L0144-teacher.docx` | `9b5f-b3c5-bf51-6438` | `worksheets-gated/L0144-student.docx` | `c6e2-d18b-1314-e21d` |
| L0145 | G9-L2 | `worksheets-gated/L0145-teacher.docx` | `ab93-1016-32e6-bfef` | `worksheets-gated/L0145-student.docx` | `cb3e-1ace-f04f-84b5` |
| L0146 | G9-L3 | `worksheets-gated/L0146-teacher.docx` | `dcca-29bb-1530-10c7` | `worksheets-gated/L0146-student.docx` | `fe1e-9dc3-9803-d908` |
| L0147 | G9-L4 | `worksheets-gated/L0147-teacher.docx` | `dde1-1e8d-ca7d-6029` | `worksheets-gated/L0147-student.docx` | `467e-df39-c0ba-1d5f` |
| L0148 | G9-L5 | `worksheets-gated/L0148-teacher.docx` | `3f99-df29-2edc-4831` | `worksheets-gated/L0148-student.docx` | `6fbe-25d2-fe67-8725` |
| L0149 | G9-L6 | `worksheets-gated/L0149-teacher.docx` | `acb4-5f0e-8a05-8583` | `worksheets-gated/L0149-student.docx` | `293b-4a9d-ac6f-fcb3` |
| L0150 | G9-L7 | `worksheets-gated/L0150-teacher.docx` | `34e5-90f5-d0e2-43c2` | `worksheets-gated/L0150-student.docx` | `e9ad-7941-0d23-3892` |
| L0151 | G9-L8 | `worksheets-gated/L0151-teacher.docx` | `9c6b-5219-5da8-6374` | `worksheets-gated/L0151-student.docx` | `58d1-7d5d-fc0b-cebb` |
| L0152 | G9-L9 | `worksheets-gated/L0152-teacher.docx` | `4ac2-bc37-5c5a-8b06` | `worksheets-gated/L0152-student.docx` | `d0e6-c387-16e6-e873` |
| L0153 | 文-L10 | `worksheets-gated/L0153-teacher.docx` | `6356-6788-f2e6-c131` | `worksheets-gated/L0153-student.docx` | `5767-e911-b271-41cd` |
| L0154 | 文-L11 | `worksheets-gated/L0154-teacher.docx` | `b792-ac3c-a8fc-ffaf` | `worksheets-gated/L0154-student.docx` | `7799-981f-491f-b28d` |
| L0155 | 文-L12 | `worksheets-gated/L0155-teacher.docx` | `0e86-6dc3-0a4c-a2fa` | `worksheets-gated/L0155-student.docx` | `cd6b-5267-500c-0701` |
| L0156 | 文-L1 | `worksheets-gated/L0156-teacher.docx` | `264d-5592-8160-1116` | `worksheets-gated/L0156-student.docx` | `799f-d02c-10fb-2993` |
| L0157 | 文-L2 | `worksheets-gated/L0157-teacher.docx` | `7e94-32ef-6cd0-ca41` | `worksheets-gated/L0157-student.docx` | `d1b5-85bd-b543-8d34` |
| L0158 | 文-L3 | `worksheets-gated/L0158-teacher.docx` | `a7e1-98de-8866-6c76` | `worksheets-gated/L0158-student.docx` | `28eb-bb9c-0eb8-60f3` |
| L0159 | 文-L4 | `worksheets-gated/L0159-teacher.docx` | `f341-87b3-4ed3-e73f` | `worksheets-gated/L0159-student.docx` | `0ca3-52ed-91e7-84f8` |
| L0160 | 文-L5 | `worksheets-gated/L0160-teacher.docx` | `4db2-cdcc-961b-f8e2` | `worksheets-gated/L0160-student.docx` | `7738-94f5-22db-65a6` |
| L0161 | 文-L6 | `worksheets-gated/L0161-teacher.docx` | `31e6-c228-1bf9-d103` | `worksheets-gated/L0161-student.docx` | `7556-dcfb-82d6-898e` |
| L0162 | 文-L7 | `worksheets-gated/L0162-teacher.docx` | `0a10-5529-bf24-ae59` | `worksheets-gated/L0162-student.docx` | `02f1-57ee-7c01-f43a` |
| L0163 | 文-L8 | `worksheets-gated/L0163-teacher.docx` | `a217-ba57-d753-b229` | `worksheets-gated/L0163-student.docx` | `c202-7a0b-9970-99b9` |
| L0164 | 文-L9 | `worksheets-gated/L0164-teacher.docx` | `b174-60bf-da37-70d7` | `worksheets-gated/L0164-student.docx` | `1ce7-7a86-345c-dad4` |
| L0165 | 體-L10 | `worksheets-gated/L0165-teacher.docx` | `587c-d0fa-76fd-7dc1` | `worksheets-gated/L0165-student.docx` | `d775-542f-401e-d824` |
| L0166 | 體-L11 | `worksheets-gated/L0166-teacher.docx` | `40b3-ed9c-c887-e991` | `worksheets-gated/L0166-student.docx` | `3413-f57d-1f14-7df4` |
| L0167 | 體-L1 | `worksheets-gated/L0167-teacher.docx` | `3447-11e8-365b-54a8` | `worksheets-gated/L0167-student.docx` | `316e-7d2d-91cb-d515` |
| L0168 | 體-L2 | `worksheets-gated/L0168-teacher.docx` | `c600-42fe-807e-52f9` | `worksheets-gated/L0168-student.docx` | `37fa-23f0-ebb9-5e33` |
| L0169 | 體-L3 | `worksheets-gated/L0169-teacher.docx` | `f5ba-39a3-2a13-b8ca` | `worksheets-gated/L0169-student.docx` | `808f-fc6e-3222-ec17` |
| L0170 | 體-L4 | `worksheets-gated/L0170-teacher.docx` | `4367-e312-63cc-218b` | `worksheets-gated/L0170-student.docx` | `6f67-d410-eedf-f2be` |
| L0171 | 體-L5 | `worksheets-gated/L0171-teacher.docx` | `c5a3-299d-55f0-ca36` | `worksheets-gated/L0171-student.docx` | `b74b-c4cd-42a8-1d13` |
| L0172 | 體-L6 | `worksheets-gated/L0172-teacher.docx` | `a3e7-24f1-6368-c09e` | `worksheets-gated/L0172-student.docx` | `11d2-0d2a-fae0-e73f` |
| L0173 | 體-L7 | `worksheets-gated/L0173-teacher.docx` | `a81c-9ed9-6f03-da16` | `worksheets-gated/L0173-student.docx` | `2301-d0d5-a383-121e` |
| L0174 | 體-L8 | `worksheets-gated/L0174-teacher.docx` | `2d55-ce4e-87a6-bdcc` | `worksheets-gated/L0174-student.docx` | `dc96-c0bf-6c60-8d01` |
| L0175 | 體-L9 | `worksheets-gated/L0175-teacher.docx` | `e83b-7fac-91de-f458` | `worksheets-gated/L0175-student.docx` | `3d23-7c40-59e6-e694` |
| L0176 | 體-L12 | `worksheets-gated/L0176-teacher.docx` | `0c07-51e7-2a69-cd94` | `worksheets-gated/L0176-student.docx` | `7635-ddf7-a45d-d76f` |
| L0177 | 體-L13 | `worksheets-gated/L0177-teacher.docx` | `1cf2-3740-f619-0cd1` | `worksheets-gated/L0177-student.docx` | `98f4-3211-77e7-2c1e` |
| L0178 | 體-L14 | `worksheets-gated/L0178-teacher.docx` | `8233-37a3-caf1-c7e8` | `worksheets-gated/L0178-student.docx` | `a595-06c5-a987-48e4` |
| L0179 | 體-L15 | `worksheets-gated/L0179-teacher.docx` | `8bb9-f612-0cc0-908d` | `worksheets-gated/L0179-student.docx` | `43bb-ab6c-a36c-92bb` |

## 原始檔名對照

（給人核對用：這個 lesson_uid 對應 Drive 上的哪個檔名）

| lesson_uid | 教師版原始檔名 | 學生版原始檔名 |
|---|---|---|
| L0001 | G4-L10十秒的背後（寫作手法：順敘－從時間詞判斷事件順序）.docx | G4-L10十秒的背後學生版.docx |
| L0002 | G4-L11動物的生存妙招（摘要策略-找小主題和重要細節）.docx | G4-L11動物的生存妙招學生版.docx |
| L0003 | G4-L12大自然的氣象小幫手（摘要策略-找小主題與重要細節）.docx | G4-L12大自然的氣象小幫手學生版.docx |
| L0004 | G4-L13感情小日記2──喜歡是什麼？（品格力-自我覺察─想法與情緒的關係）.docx | G4-L13感情小日記2──喜歡是什麼？學生版.docx |
| L0005 | G4-L14美好的一天（推論策略-推論情緒和感受）.docx | G4-L14美好的一天學生版.docx |
| L0006 | G4-L15誤會（推論策略-推論情緒和感受）.docx | G4-L15誤會學生版.docx |
| L0007 | G4-L16黃絲帶（推論策略-推論情緒和感受）.docx | G4-L16黃絲帶學生版.docx |
| L0008 | G4-L17第一百碗麵（品格力-想法感受的換位思考）.docx | G4-L17第一百碗麵學生版.docx |
| L0009 | G4-L18白牙的最後一戰（品格力-情緒管理ＡＢＣ）.docx | G4-L18白牙的最後一戰學生版.docx |
| L0010 | G4-L19把球打好，就夠了嗎？—阿耀與健豪學長的通信（一）（生涯探索-讀書，讓夢想多一條路）.docx | G4-L19把球打好，就夠了嗎？—阿耀與健豪學長的通信學生版.docx |
| L0011 | G4-L1贏得喝采的輸家.docx | G4-L1贏得喝采的輸家學生版.docx |
| L0012 | G4-L20想讀書，該從哪裡著手？—阿耀與健豪學長的通信(二)（生涯探索-轉個彎，熱愛還在前方）.docx | G4-L20想讀書，該從哪裡著手？—阿耀與健豪學長的通信(二)學生版.docx |
| L0013 | G4-L2正太與小豬：武僧的養成之路（推論策略-找出故事道理）.docx | G4-L2正太與小豬：武僧的養成之路學生版.docx |
| L0014 | G4-L3最美的畫面（推論策略-推論文章主旨）.docx | G4-L3最美的畫面學生版.docx |
| L0015 | G4-L4穿越極限的跑者（推論策略-推論代名詞）.docx | G4-L4穿越極限的跑者學生版.docx |
| L0016 | G4-L5這是什麼「意思」（推論策略-推論代名詞）.docx | G4-L5這是什麼「意思」學生版.docx |
| L0017 | G4-L6感情小日記1──是友情還是愛情？（品格力-自我覺察-是友情還是愛情）.docx | G4-L6感情小日記1──是友情還是愛情？學生版.docx |
| L0018 | G4-L7長高的祕密（認識句型-遞進複句）.docx | G4-L7長高的祕密學生版.docx |
| L0019 | G4-L8運動科學（認識句型-條件複句）.docx | G4-L8運動科學學生版.docx |
| L0020 | G4-L9跟著「但是」轉個彎（解題策略-轉折詞後有重點）.docx | G4-L9跟著「但是」轉個彎學生版.docx |
| L0021 | G5-L0正太與小豬：武僧的養成之路.docx | G5-L0正太與小豬：武僧的養成之路學生版.docx |
| L0022 | G5-L10感情小日記3──吃醋的滋味（品格力-情緒覺察與調節-當我「吃醋」時）.docx | G5-L10感情小日記3──吃醋的滋味學生版.docx |
| L0023 | G5-L11比運氣更重要的事：《長腿叔叔》的啟發（推論策略-觀點找支持理由）.docx | G5-L11比運氣更重要的事：《長腿叔叔》的啟發學生版.docx |
| L0024 | G5-L12堅持到底的棒球人生──周思齊(前篇)（推論策略-找出觀點和支持理由）.docx | G5-L12堅持到底的棒球人生──周思齊(前篇)學生版.docx |
| L0025 | G5-L13堅持到底的棒球人生──周思齊(後篇)（推論策略-找出觀點與支持理由）.docx | G5-L13堅持到底的棒球人生──周思齊(後篇)學生版.docx |
| L0026 | G5-L14感情小日記4──我被告白了（品格力-人際溝通-拒絕的藝術）.docx | G5-L14感情小日記4──我被告白了學生版.docx |
| L0027 | G5-L15救援大隊的好幫手（用表格整理訊息-比較兩個對象）.docx | G5-L15救援大隊的好幫手學生版.docx |
| L0028 | G5-L16掃雷英雄馬嘎瓦（用表格整理訊息-閱讀表格策略）.docx | G5-L16掃雷英雄馬嘎瓦學生版.docx |
| L0029 | G5-L17-18牧羊少年的逆轉勝（多文本閱讀-品格力-認識自我-看見長處與限制）.docx | G5-L17-18牧羊少年的逆轉勝學生版.docx |
| L0030 | G5-L19六塊肌六塊雞（摘要策略-用主題細節結構整理重點）.docx | G5-L19六塊肌六塊雞學生版.docx |
| L0031 | G5-L1奧運銀牌背後的自我鍛鍊（推論策略-找言行，認識人物特質）.docx | G5-L1奧運銀牌背後的自我鍛鍊學生版.docx |
| L0032 | G5-L20小丑醫生（摘要策略-從細節找小主題）.docx | G5-L20小丑醫生學生版.docx |
| L0033 | G5-L21垃圾食物的誘惑與代價（摘要策略-刪除法找重點-刪除舉例）.docx | G5-L21垃圾食物的誘惑與代價學生版.docx |
| L0034 | G5-L22抗拒指尖上的誘惑（品格力-建立好習慣）.docx | G5-L22抗拒指尖上的誘惑學生版.docx |
| L0035 | G5-L23信件的力量──寫信馬拉松（提取上位概念-從具體描述提取上位概念）.docx | G5-L23信件的力量──寫信馬拉松學生版.docx |
| L0036 | G5-L24臺灣棒球先驅──來自花蓮的能高團（提取上位概念-從具體描述提取上位概念）.docx | G5-L24臺灣棒球先驅──來自花蓮的能高團學生版.docx |
| L0037 | G5-L25小兵立大功：雞鳴狗盜的故事（摘要策略-問題.解決.結果找重點）.docx | G5-L25小兵立大功：雞鳴狗盜的故事學生版.docx |
| L0038 | G5-L26魚來了，叮咚叮咚請開門（摘要策略-問題.解決結構找重點）.docx | G5-L26魚來了，叮咚叮咚請開門學生版.docx |
| L0039 | G5-L27我有一個棒球夢（自我管理-時間管理策略）.docx | G5-L27我有一個棒球夢學生版.docx |
| L0040 | G5-L28我的電競夢：從熬夜打遊戲到拿下全國冠軍（自我管理-制定作息時間表）.docx | G5-L28我的電競夢：從熬夜打遊戲到拿下全國冠軍學生版.docx |
| L0041 | G5-L2周天成的一天──頂尖選手的養成（推論策略-從言行推論人物特質）.docx | G5-L2周天成的一天──頂尖選手的養成學生版.docx |
| L0042 | G5-L3拳力出擊──陳念琴（推論策略──用特質理解人物成長）.docx | G5-L3拳力出擊──陳念琴學生版.docx |
| L0043 | G5-L4從童工到大學教授之路（推論人物特質-從特質理解選擇與發展）.docx | G5-L4從童工到大學教授之路學生版.docx |
| L0044 | G5-L5文字路上的閱讀號誌 （解題策略-看特殊標點找線索）.docx | G5-L5文字路上的閱讀號誌 學生版.docx |
| L0045 | G5-L6兵來將擋，水來土掩（詞彙推測策略-拆詞釋義）.docx | G5-L6兵來將擋，水來土掩學生版.docx |
| L0046 | G5-L7以植物為師的科學（詞彙推測策略-拆詞釋義）.docx | G5-L7以植物為師的科學學生版.docx |
| L0047 | G5-L8工地大嫂（詞彙推測策略-從上下文推測詞義）.docx | G5-L8工地大嫂學生版.docx |
| L0048 | G5-L9災難預言準不準（拆詞釋義＋從上下文推測詞義）.docx | G5-L9災難預言準不準學生版.docx |
| L0049 | G6-L0正太與小豬：武僧的養成之路.docx | G6-L0正太與小豬：武僧的養成之路學生版.docx |
| L0050 | G6-L10全世界第一張股票的誕生（摘要策略-問題.解決.結果找重點）.docx | G6-L10全世界第一張股票的誕生學生版.docx |
| L0051 | G6-L11奇蹟行動（摘要策略-問題-解決-結果找重點）.docx | G6-L11奇蹟行動學生版.docx |
| L0052 | G6-L12小藍鯨之死（推論策略-看證據如何支持判斷）.docx | G6-L12小藍鯨之死學生版.docx |
| L0053 | G6-L13昆蟲會思考嗎？（推論策略-整合證據，形成結論）.docx | G6-L13昆蟲會思考嗎？學生版.docx |
| L0054 | G6-L14動物談情說愛的方式（摘要策略-用標題整理重點）.docx | G6-L14動物談情說愛的方式學生版.docx |
| L0055 | G6-L15愛冒險逞強的雄性動物（摘要策略-從段落找主題句）.docx | G6-L15愛冒險逞強的雄性動物學生版.docx |
| L0056 | G6-L16把手上的餅吃香一點（品格力-正向思考-換個角度看事情）.docx | G6-L16把手上的餅吃香一點學生版.docx |
| L0057 | G6-L17祝你好眠（摘要策略-從主題句找小主題）.docx | G6-L17祝你好眠學生版.docx |
| L0058 | G6-L18末日種子庫（摘要策略-找小主題與細節）.docx | G6-L18末日種子庫學生版.docx |
| L0059 | G6-L19紅領帶（品格力-正向思考-如何面對不能改變的事）.docx | G6-L19紅領帶學生版.docx |
| L0060 | G6-L1心理出狀況,是壞事導致的嗎（推論策略-推論故事主旨）.docx | G6-L1心理出狀況,是壞事導致的嗎學生版.docx |
| L0061 | G6-L20因人而異，才有真正的公平（寫作手法-用例子說明觀點）.docx | G6-L20因人而異，才有真正的公平學生版.docx |
| L0062 | G6-L21感情小日記5──我該告白嗎？（品格力-負責任的決定-區辨控制圈）.docx | G6-L21感情小日記5──我該告白嗎？學生版.docx |
| L0063 | G6-L22-24物以稀為貴（多文本閱讀-寫作手法-用不同角度的例子說明概念）.docx | G6-L22-24物以稀為貴學生版.docx |
| L0064 | G6-L25感情小日記6──我失戀了（品格力-情緒管理-悲傷五階段）.docx | G6-L25感情小日記6──我失戀了學生版.docx |
| L0065 | G6-L26運動傷害，怎麼辦（寫作手法-倒反：讀懂反話）.docx | G6-L26運動傷害，怎麼辦學生版.docx |
| L0066 | G6-L27古代畫家心中的仙境（寫作手法-從具體內容到作者觀點）.docx | G6-L27古代畫家心中的仙境學生版.docx |
| L0067 | G6-L28森林大軍的守護者（自我提問策略1-跟著人物故事線問問題）.docx | G6-L28森林大軍的守護者學生版.docx |
| L0068 | G6-L29植物獵人（自我提問策略2-跟著人物故事線問問題）.docx | G6-L29植物獵人學生版.docx |
| L0069 | G6-L2一件班服，一場思辨討論（多元觀點）.docx | G6-L2一件班服，一場思辨討論學生版.docx |
| L0070 | G6-L3文章中的「關鍵少數」 （解題策略-看頭尾、找結論線索）.docx | G6-L3文章中的「關鍵少數」 學生版.docx |
| L0071 | G6-L4數字記憶的奧秘（用表格整理訊息-比較異同）.docx | G6-L4數字記憶的奧秘學生版.docx |
| L0072 | G6-L5重複朗讀的重要性：柳丁和文旦的比喻（寫作手法：譬喻-以A比喻B）.docx | G6-L5重複朗讀的重要性：柳丁和文旦的比喻學生版.docx |
| L0073 | G6-L6與小學說再見（寫作手法：譬喻-從譬喻推論作者感受）.docx | G6-L6與小學說再見學生版.docx |
| L0074 | G6-L7老鷹紅豆的故事（摘要策略—問題—解決—結果找重點）.docx | G6-L7老鷹紅豆的故事學生版.docx |
| L0075 | G6-L8白鯨救援（摘要策略—問題—解決—結果找重點）.docx | G6-L8白鯨救援學生版.docx |
| L0076 | G6-L9給神明發會診單（品格力-跨文化理解與接納）.docx | G6-L9給神明發會診單學生版.docx |
| L0077 | G7-L0正太與小豬：武僧的養成之路.docx | G7-L0正太與小豬：武僧的養成之路學生版.docx |
| L0078 | G7-L10別上「誘餌式標題」的鉤（媒體素養與識讀-認識誘餌式新聞標題）.docx | G7-L10別上「誘餌式標題」的鉤學生版.docx |
| L0079 | G7-L11一封向醫師求助的信（從事實歸納概念-從具體事實提取上位概念）.docx | G7-L11一封向醫師求助的信學生版.docx |
| L0080 | G7-L12澳洲奧運金牌的X機密（用表格整理訊息-比較兩者異同）.docx | G7-L12澳洲奧運金牌的X機密學生版.docx |
| L0081 | G7-L13女性太空人登月（用表格整理訊息-從細節歸納比較項目).docx | G7-L13女性太空人登月學生版.docx |
| L0082 | G7-L14從〈螞蟻與蟋蟀〉看生命的多樣性（用表格整理訊息-依比較項目看出異同）.docx | G7-L14從〈螞蟻與蟋蟀〉看生命的多樣性學生版.docx |
| L0083 | G7-L15爺爺奶奶來了以後（用表格整理訊息-從細節歸納比較項目）.docx | G7-L15爺爺奶奶來了以後學生版.docx |
| L0084 | G7-L16長大後，我才讀懂〈夏夜〉（寫作手法：排比─從排比歸納文意重點）.docx | G7-L16長大後，我才讀懂〈夏夜〉學生版.docx |
| L0085 | G7-L17大自然的氣象小幫手（自我提問策略1-讀出重點）.docx | G7-L17大自然的氣象小幫手學生版.docx |
| L0086 | G7-L18正太與小豬（自我提問策略2-讀出關係）.docx | G7-L18正太與小豬學生版.docx |
| L0087 | G7-L19把手上的餅吃香一點（自我提問策略3-依閱讀需要選問題）.docx | G7-L19把手上的餅吃香一點學生版.docx |
| L0088 | G7-L1塑膠，好用不好甩（推論策略-找作者觀點和支持理由）.docx | G7-L1塑膠，好用不好甩學生版.docx |
| L0089 | G7-L20「背影」讀書會（自我提問-詰問作者）.docx | G7-L20「背影」讀書會學生版.docx |
| L0090 | G7-L21奧運性別平等這條路（用表格整理訊息-從數據資料歸納趨勢）.docx | G7-L21奧運性別平等這條路學生版.docx |
| L0091 | G7-L22你看見時代的灰犀牛了嗎談人口負成長（圖表繪製與判讀-折線圖）.docx | G7-L22你看見時代的灰犀牛了嗎談人口負成長學生版.docx |
| L0092 | G7-L23信眾與教主（媒體素養與識讀-檢查誠信，辨識詐騙）.docx | G7-L23信眾與教主學生版.docx |
| L0093 | G7-L24用科學方法伸張正義的神探（科學推理策略--用科學步驟解決問題）.docx | G7-L24用科學方法伸張正義的神探學生版.docx |
| L0094 | G7-L25看到了嗎，然後呢（科學推理策略-用線索和知識推論）.docx | G7-L25看到了嗎，然後呢學生版.docx |
| L0095 | G7-L26科學怪人（推論策略—從文本線索理解標題）.docx | G7-L26科學怪人學生版.docx |
| L0096 | G7-L27吐瓦魯：逐漸被淹沒的島國（反思策略-4F反思法）.docx | G7-L27吐瓦魯：逐漸被淹沒的島國學生版.docx |
| L0097 | G7-L28綠色賽事（品格力-落實環保3R-從問題到行動）.docx | G7-L28綠色賽事學生版.docx |
| L0098 | G7-L29隱藏在日常對話中的微歧視（品格力-辨識與回應微歧視）.docx | G7-L29隱藏在日常對話中的微歧視學生版.docx |
| L0099 | G7-L2AI什麼都會，我們還要學什麼？（推論策略-找觀點與理由，推隱含意義）.docx | G7-L2AI什麼都會，我們還要學什麼？學生版.docx |
| L0100 | G7-L3你以為的浪漫，可能是跟騷（推論策略-推論作者觀點和寫作目的）.docx | G7-L3你以為的浪漫，可能是跟騷學生版.docx |
| L0101 | G7-L4小米酒的祝福（推論策略-找段落重點.推論作者觀點）.docx | G7-L4小米酒的祝福學生版.docx |
| L0102 | G7-L5網紅的電子煙實驗：偽科學的陷阱（媒體素養與識讀-辨別網路訊息真偽）.docx | G7-L5網紅的電子煙實驗：偽科學的陷阱學生版.docx |
| L0103 | G7-L6果醬男孩（摘要策略-用問題、解決、結果找重點）.docx | G7-L6果醬男孩學生版.docx |
| L0104 | G7-L7當全世界都在笑你，你可以怎麼做（摘要策略-用問題解決結果找重點）.docx | G7-L7當全世界都在笑你，你可以怎麼做學生版.docx |
| L0105 | G7-L8黑猩猩的守護者（摘要策略-從人物發展找重點）.docx | G7-L8黑猩猩的守護者學生版.docx |
| L0106 | G7-L9帶著血拼清單閱讀（解題策略-帶著問題閱讀）.docx | G7-L9帶著血拼清單閱讀學生版.docx |
| L0107 | G8-L0正太與小豬：武僧的養成之路.docx | G8-L0正太與小豬：武僧的養成之路學生版.docx |
| L0108 | G8-L10虎襲事件的真相：誰才是受害者？（推論策略-從多個例子推論作者觀點）.docx | G8-L10虎襲事件的真相：誰才是受害者？學生版.docx |
| L0109 | G8-L11球場上的另類指揮家（推論策略-推論主要論點與作者意圖）.docx | G8-L11球場上的另類指揮家學生版.docx |
| L0110 | G8-L12我的阿嬤（推論策略-推論角色關係與觀點）.docx | G8-L12我的阿嬤學生版.docx |
| L0111 | G8-L13-14雨林裡的奇蹟藥物和最後一隻旅人鴿（閱讀策略-跳過卡關，先瀏覽全文）.docx | G8-L13-14雨林裡的奇蹟藥物和最後一隻旅人鴿學生版.docx |
| L0112 | G8-L15未來的農夫（閱讀策略-跳過卡關，先瀏覽全文）.docx | G8-L15未來的農夫學生版.docx |
| L0113 | G8-L16我能不能選擇告別方式(比較多元觀點).docx | G8-L16我能不能選擇告別方式(比較多元觀點)學生版.docx |
| L0114 | G8-L17石虎保育：遷移與否的兩難（比較多元觀點）.docx | G8-L17石虎保育：遷移與否的兩難學生版.docx |
| L0115 | G8-L18核能的兩難抉擇（比較多元觀點）.docx | G8-L18核能的兩難抉擇學生版.docx |
| L0116 | G8-L19塞翁失馬，焉知非福（寫作手法-用故事和例子支持觀點）.docx | G8-L19塞翁失馬，焉知非福學生版.docx |
| L0117 | G8-L1讓你口中的甜蜜成為遠方農民的希望（推論策略-找出一連串因果）.docx | G8-L1讓你口中的甜蜜成為遠方農民的希望學生版.docx |
| L0118 | G8-L20懸崖邊的那顆草莓（寫作手法-用故事說道理）.docx | G8-L20懸崖邊的那顆草莓學生版.docx |
| L0119 | G8-L21致台東：一封過客的情書（寫作手法-擬人－從擬人推論文章意涵）.docx | G8-L21致台東：一封過客的情書學生版.docx |
| L0120 | G8-L22靈異與科學（科學探究策略-假設與假設檢驗）.docx | G8-L22靈異與科學學生版.docx |
| L0121 | G8-L23MeToo運動與我們的權利（性別平等-辨識界線、安全回應、支持他人).docx | G8-L23MeToo運動與我們的權利學生版.docx |
| L0122 | G8-L2隱形的征服者（推論策略-找出一連串因果）.docx | G8-L2隱形的征服者學生版.docx |
| L0123 | G8-L3爸爸的恩人們（寫作手法-對比-從對比歸納作者意圖）.docx | G8-L3爸爸的恩人們學生版.docx |
| L0124 | G8-L4新奇!「植物肉」你聽過嗎（推論策略-由課文觀點找出支持理由）.docx | G8-L4新奇!「植物肉」你聽過嗎學生版.docx |
| L0125 | G8-L5好心沒好報的玻璃娃娃爭議事件（推論策略-推論人物行為的背後動機）.docx | G8-L5好心沒好報的玻璃娃娃爭議事件學生版.docx |
| L0126 | G8-L6戲院、賭場、檳榔攤：在時代夾縫中成長的我（推論策略-推論人物的動機、情緒與想法）.docx | G8-L6戲院、賭場、檳榔攤：在時代夾縫中成長的我學生版.docx |
| L0127 | G8-L7當壞事已不可逆轉：集中營裡的一門課（寫作手法-用例子與道理支持主旨）.docx | G8-L7當壞事已不可逆轉：集中營裡的一門課學生版.docx |
| L0128 | G8-L8讓黑猩猩被看見的人（推論策略-從對比推論作者觀點）.docx | G8-L8讓黑猩猩被看見的人學生版.docx |
| L0129 | G8-L9「按讚」背後的真相（推論策略-整合各段觀點，找主要論點）.docx | G8-L9「按讚」背後的真相學生版.docx |
| L0130 | G9-L0正太與小豬：武僧的養成之路.docx | G9-L0正太與小豬：武僧的養成之路學生版.docx |
| L0131 | G9-L10國高中數學當然可以使用計算機!（議論文結構-用論據支持論點）.docx | G9-L10國高中數學當然可以使用計算機1學生版.docx |
| L0132 | G9-L11預防近視？多點戶外活動就對了！（科學推理策略-整合多項研究證據）.docx | G9-L11預防近視？多點戶外活動就對了！學生版.docx |
| L0133 | G9-L12看不見的兇手：以實驗破解肉湯腐敗之謎（圖文整合閱讀策略）.docx | G9-L12看不見的兇手：以實驗破解肉湯腐敗之謎學生版.docx |
| L0134 | G9-L13從四張圖看地球暖化（圖文整合閱讀策略）.docx | G9-L13從四張圖看地球暖化學生版.docx |
| L0135 | G9-L14都是八哥為什麼命運不一樣（文圖表整合閱讀策略）.docx | G9-L14都是八哥為什麼命運不一樣學生版.docx |
| L0136 | G9-L15會考圖文題實戰（圖文整合閱讀策略）.docx | G9-L15會考圖文題實戰學生版.docx |
| L0137 | G9-L16~17多文本-未解之謎-巨石陣+摩艾走路（多文本閱讀-比較異同＋科學步驟-假設驗證歷程）.docx | G9-L16~17多文本-未解之謎-巨石陣+摩艾走路學生版.docx |
| L0138 | G9-L18樂觀者勝：向NBA球員學習「詮釋失敗」的智慧（品格力-正向思考-用樂觀詮釋面對失敗）.docx | G9-L18樂觀者勝：向NBA球員學習「詮釋失敗」的智慧學生版.docx |
| L0139 | G9-L19見前人所未見--達爾文與長喙天蛾的故事（摘要策略-科學探究故事結構）.docx | G9-L19見前人所未見--達爾文與長喙天蛾的故事學生版.docx |
| L0140 | G9-L1認命是強者的選項（寫作手法-用故事帶出觀點）.docx | G9-L1認命是強者的選項學生版.docx |
| L0141 | G9-L20臺灣的太空之眼（摘要策略-從小標題找重要細節）.docx | G9-L20臺灣的太空之眼學生版.docx |
| L0142 | G9-L21焚而不毀的倫敦（品格力-正向思考-培養心理韌性）.docx | G9-L21焚而不毀的倫敦學生版.docx |
| L0143 | G9-L22高地訓練有助於運動表現嗎？(說明文結構─用研究證據回答問題).docx | G9-L22高地訓練有助於運動表現嗎？(說明文結構─用研究證據回答問題)學生版.docx |
| L0144 | G9-L23~25運動記錄的突破與公平（多文本閱讀-看文章之間的關係）.docx | G9-L23~25運動記錄的突破與公平學生版.docx |
| L0145 | G9-L2看不見的故事，推動看得見的世界（寫作手法-用例子說明觀點）.docx | G9-L2看不見的故事，推動看得見的世界學生版.docx |
| L0146 | G9-L3語言的足跡：從臺北萬華到南太平洋的航海之路（推論策略-從例子推論作者觀點）.docx | G9-L3語言的足跡：從臺北萬華到南太平洋的航海之路學生版.docx |
| L0147 | G9-L4構樹：南島祖先「出臺灣說」的植物證據（科學推理策略-研究結果支持假說嗎？）.docx | G9-L4構樹：南島祖先「出臺灣說」的植物證據學生版.docx |
| L0148 | G9-L5科學辦案：破解蝴蝶蘭的花期密碼（科學推理策略-用科學步驟解決問題）.docx | G9-L5科學辦案：破解蝴蝶蘭的花期密碼學生版.docx |
| L0149 | G9-L6從基因來的特別禮物（圖表繪製與判讀-長條圖與圓形圖）.docx | G9-L6從基因來的特別禮物學生版.docx |
| L0150 | G9-L7臺灣學生的閱讀力：美麗與哀愁（圖表判讀-折線圖）.docx | G9-L7臺灣學生的閱讀力：美麗與哀愁學生版.docx |
| L0151 | G9-L8盡信書不如無書：從一件殺人案談起（媒體素養與識讀-查核、辨識假新聞）.docx | G9-L8盡信書不如無書：從一件殺人案談起學生版.docx |
| L0152 | G9-L9帝國家書：一個普通家庭的生與死（分辨事實與判斷）.docx | G9-L9帝國家書：一個普通家庭的生與死學生版.docx |
| L0153 | 文-L10荒野救亡記（固定句式：以--為.）.docx | 文-L10荒野救亡記學生版.docx |
| L0154 | 文-L11祁黃羊的思路解密(疑問助詞).docx | 文-L11祁黃羊的思路解密(疑問助詞)學生版.docx |
| L0155 | 文-L12-不流血的戰爭（倒裝句）.docx | 文-L12-不流血的戰爭學生版.docx |
| L0156 | 文-L1這是假新聞嗎？──以鞭虎救弟記為例（媒體素養與識讀-善用網路資源找證據）.docx | 文-L1這是假新聞嗎？──以〈鞭虎救弟記〉為例學生版.docx |
| L0157 | 文-L2文言文怎麼讀？──以〈鞭虎救弟記〉為例（文言文閱讀策略-如何讀懂文言文）.docx | 文-L2文言文怎麼讀？──以〈鞭虎救弟記〉為例學生版.docx |
| L0158 | 文-L3不量田（判讀主語）.docx | 文-L3不量田學生版.docx |
| L0159 | 文-L4陸公買硯（斷句與判讀主語II）.docx | 文-L4陸公買硯學生版.docx |
| L0160 | 文-L5重義的荀巨伯（人稱代詞）.docx | 文-L5重義的荀巨伯學生版.docx |
| L0161 | 文-L6江乙媽媽告御狀（指示與疑問代詞）.docx | 文-L6江乙媽媽告御狀學生版.docx |
| L0162 | 文-L7相隔千里的約定（判斷句）.docx | 文-L7相隔千里的約定學生版.docx |
| L0163 | 文-L8愛讀書的顧寧人（一字多義「少」）.docx | 文-L8愛讀書的顧寧人學生版.docx |
| L0164 | 文-L9從天才跌為凡人的神童（一字多義「聞」）.docx | 文-L9從天才跌為凡人的神童學生版.docx |
| L0165 | 體-L10信任_下一球，我相信你（品格力-合作中的信任：溝通與調整）.docx | 體-L10信任_下一球，我相信你學生版.docx |
| L0166 | 體-L11信任_因為相信，所以能向前（品格力-成為值得信任的夥伴）.docx | 體-L11信任_因為相信，所以能向前學生版.docx |
| L0167 | 體-L1心，也要一起練（品格力-自我覺察）.docx | 體-L1心，也要一起練學生版.docx |
| L0168 | 體-L2成為身體的最佳夥伴（品格力-身體覺察與照護）.docx | 體-L2成為身體的最佳夥伴學生版.docx |
| L0169 | 體-L3身體，謝謝你（品格力-身體覺察與照護）.docx | 體-L3身體，謝謝你學生版.docx |
| L0170 | 體-L4專注當下：關掉內心的批評噪音（品格力-念頭覺察）.docx | 體-L4專注當下：關掉內心的批評噪音學生版.docx |
| L0171 | 體-L5從白熊到藍海豚：學習與念頭和平相處（品格力-念頭覺察）.docx | 體-L5從白熊到藍海豚：學習與念頭和平相處學生版.docx |
| L0172 | 體-L6不是想太多，只是好在乎（品格力-特質的多元樣貌）.docx | 體-L6不是想太多，只是好在乎學生版.docx |
| L0173 | 體-L7讓「想很多」助你一臂之力（品格力-把焦慮化為助力）.docx | 體-L7讓「想很多」助你一臂之力學生版.docx |
| L0174 | 體-L8面對「失敗」不只有一種可能（品格力-面對失敗）.docx | 體-L8面對「失敗」不只有一種可能學生版.docx |
| L0175 | 體-L9成長型思維 翻轉失敗的關鍵（品格力-成長型思維）.docx | 體-L9成長型思維 翻轉失敗的關鍵學生版.docx |
| L0176 | 體L12-團隊_一起變強會更好（品格力-我好，你也好）.docx | 體L12-團隊_一起變強會更好學生版.docx |
| L0177 | 體L13-評價_別讓一句話決定你是誰（品格力-面對評價的方法）.docx | 體L13-評價_別讓一句話決定你是誰學生版.docx |
| L0178 | 體L14-職涯_在看不見成長的日子中（品格力-找回內在動力）.docx | 體L14-職涯_在看不見成長的日子中學生版.docx |
| L0179 | 體L15-結尾_ 練過的心，陪你走更遠（品格力-心理韌性）.docx | 體L15-結尾_ 練過的心，陪你走更遠學生版.docx |
