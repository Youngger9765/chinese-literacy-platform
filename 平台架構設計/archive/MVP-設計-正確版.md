# MVP 設計 - 國語文朗讀學習平台 (正確版)

> **專案**: 國語文朗讀學習平台 (方大哥)
>
> **設計日期**: 2026-02-13
>
> **核心理念**: AI 語音分析 + 即時回饋,協助教師精準掌握學生閱讀流暢度

---

## ❌ 之前的錯誤

### 錯誤的 MVP (已廢棄)

之前的 `MVP-設計.md` **完全誤解需求**:

| 項目 | 錯誤版本 | 正確需求 |
|------|---------|---------|
| **核心功能** | ❌ 教師手動批改 | ✅ **AI 自動分析語音** |
| **回饋速度** | ❌ 延遲批改 | ✅ **< 5 秒即時回饋** |
| **分析內容** | ❌ 無 | ✅ 語速、正確率、逐句對比、錯字詞清單 |
| **教學理論** | ❌ 無 | ✅ 曾世杰教授閱讀科學 |
| **參考實作** | ❌ 無 | ✅ 方大哥 Flutter App (9,606 字筆順) |

**問題根源**: 看到「簡化」就想做零程式碼方案,忽略了產品的核心價值是 **AI 語音分析**。

---

## 🎯 正確的 MVP 定義

### 核心價值主張

**用 AI 技術自動化分析學生的國語文朗讀表現,協助教師精準掌握每位學生的閱讀流暢度,實現個別化教學。**

### 關鍵特徵

1. **AI 語音分析** - 不是人工批改!
2. **即時回饋** - < 5 秒,不是幾天後!
3. **科學化評估** - 語速 × 正確率,不是主觀感覺!
4. **個別化教學** - 每個學生專屬學習路徑

---

## 📋 P0 功能清單 (MVP 必要)

### 教師端

- [ ] 教師註冊/登入 (Google/Microsoft SSO)
- [ ] Email 網域驗證 (確認是學校教師)
- [ ] 同意使用條款 (4 項著作權同意)
- [ ] 建立學校
- [ ] 建立班級
- [ ] 建立學生名單 (CSV 匯入)
- [ ] **上傳課文** (文字貼上)
- [ ] **設定課文目標** (語速、正確率)
- [ ] 查看學生朗讀紀錄
- [ ] 查看班級統計報告
- [ ] 查看學生個別報告

### 學生端 (核心功能)

- [ ] 學生登入
- [ ] 查看分配的課文列表
- [ ] **注音符號顯示切換** (Space 快捷鍵)
- [ ] **分段朗讀流程**:
  - [ ] 先朗讀段落 (每段獨立練習)
  - [ ] 每段達標後解鎖下一段
  - [ ] 所有段落完成後朗讀整篇
  - [ ] 錄音功能 (每段獨立錄音)
- [ ] **即時回饋六大環節** ⭐ 核心!
  1. **朗讀結果總覽** (語速、正確率、是否達標)
  2. **錄音播放與轉錄** (聽自己的聲音 + AI 轉錄文字)
  3. **逐句分析對比** (原文 vs 實讀,紅色標註錯誤)
  4. **錯字詞練習清單** (自動彙整讀錯的字,含🔊發音按鈕)
  5. **練習建議** (AI 給予改進建議)
  6. **AI 詳細分析** (跳字、加字、讀錯分類)
- [ ] 統計報告 (個人學習曲線)
- [ ] 練習紀錄查詢

### 核心技術 ⭐ 最重要!

- [ ] **Azure Speech SDK 繁體中文語音識別** (zh-TW)
- [ ] **朗讀流暢度分析** (語速、正確率)
- [ ] **錯誤偵測與分類** (跳字、加字、讀錯)
- [ ] **文本比對演算法** (Levenshtein Distance + 中文字對齊)

---

## 🏗️ 技術架構

### 整體架構圖

```
┌─────────────────┐
│   學生端 (React) │
│  - 看課文       │
│  - 錄音上傳     │
│  - 即時回饋     │ ← Space 鍵切換注音
└────────┬────────┘
         │ HTTPS
         ▼
┌────────────────────────┐
│   後端 API (NestJS)    │
│  /lessons              │
│  /submissions          │
│  /speech/analyze ⭐    │ ← 核心 API!
└────────┬───────────────┘
         │
         ├──> PostgreSQL (課程 + 作業 + 分析結果)
         ├──> Cloud Storage (音檔)
         ├──> Azure Speech SDK ⭐ (語音轉文字)
         └──> GitHub (課程 Markdown)
```

### 技術選型

| 層級 | 技術 | 原因 |
|------|------|------|
| 前端 | **Next.js 14 + TypeScript** | PRD 指定 |
| 後端 | **NestJS + PostgreSQL** | PRD 指定 |
| 語音識別 | **Azure Speech SDK (zh-TW)** ⭐ | PRD 指定,排名前 2 |
| 雲端 | **GCP** | Cloud Run + Cloud SQL + Cloud Storage |
| 課程 | **GitHub (Markdown)** | 版本控制 + 免費 |

---

## 🎤 核心功能: AI 語音分析流程

### 1. 學生錄音

```typescript
// AudioRecorder.tsx
export function AudioRecorder({ lessonId, paragraph }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      setAudioBlob(e.data);
    };

    mediaRecorder.start();
    setIsRecording(true);
  };

  const submitRecording = async () => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('lessonId', lessonId);
    formData.append('paragraph', paragraph);

    // 上傳 + 分析 (一次 API 呼叫)
    const result = await api.speech.analyze(formData);

    // 顯示六大環節回饋
    showFeedback(result);
  };

  return (
    <div>
      <button onClick={isRecording ? stopRecording : startRecording}>
        {isRecording ? '停止錄音' : '開始錄音'}
      </button>
      {audioBlob && <button onClick={submitRecording}>提交</button>}
    </div>
  );
}
```

### 2. 後端 AI 分析 (核心邏輯)

```typescript
// speech-analysis.service.ts

@Injectable()
export class SpeechAnalysisService {
  constructor(
    private azureSpeech: AzureSpeechService,
    private prisma: PrismaService,
  ) {}

  async analyzeRecording(
    audioFile: Express.Multer.File,
    lessonId: string,
    paragraph: number,
  ): Promise<FeedbackResult> {

    // 1. 取得原文
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
    });
    const originalText = this.extractParagraph(lesson.content, paragraph);

    // 2. 上傳音檔到 Cloud Storage
    const audioUrl = await this.uploadAudio(audioFile);

    // 3. Azure Speech SDK 語音轉文字
    const transcription = await this.azureSpeech.recognizeFromFile(
      audioFile.buffer,
      { locale: 'zh-TW' }
    );

    // 4. 文本比對分析
    const analysis = this.compareTexts(originalText, transcription.text);

    // 5. 計算流暢度指標
    const metrics = this.calculateMetrics(
      transcription,
      analysis,
      originalText
    );

    // 6. 錯誤分類
    const errors = this.classifyErrors(analysis);

    // 7. 生成練習建議
    const suggestions = this.generateSuggestions(metrics, errors);

    // 8. 儲存結果
    await this.prisma.submission.create({
      data: {
        student_id: studentId,
        lesson_id: lessonId,
        paragraph,
        audio_url: audioUrl,
        transcription: transcription.text,
        original_text: originalText,
        speed_wpm: metrics.speed,
        accuracy_rate: metrics.accuracy,
        errors: errors,
        suggestions: suggestions,
        is_passed: metrics.accuracy >= 90 && metrics.speed >= 150,
      },
    });

    // 9. 回傳六大環節資料
    return {
      overview: {
        speed: metrics.speed,
        accuracy: metrics.accuracy,
        isPassed: metrics.accuracy >= 90 && metrics.speed >= 150,
      },
      recording: {
        audioUrl,
        transcription: transcription.text,
      },
      sentenceComparison: analysis.sentences,
      errorWordsList: errors,
      suggestions,
      aiAnalysis: this.generateAIAnalysis(metrics, errors),
    };
  }

  // 文本比對演算法
  private compareTexts(original: string, transcribed: string) {
    // 使用 Levenshtein Distance + 中文分詞
    const originalChars = Array.from(original);
    const transcribedChars = Array.from(transcribed);

    const alignment = this.alignTexts(originalChars, transcribedChars);

    return {
      sentences: this.splitIntoSentences(alignment),
      totalErrors: alignment.filter(a => a.type !== 'match').length,
      alignment,
    };
  }

  // 計算流暢度指標
  private calculateMetrics(transcription, analysis, originalText) {
    const duration = transcription.duration; // Azure 提供
    const wordCount = Array.from(originalText).length;
    const correctWords = wordCount - analysis.totalErrors;

    return {
      speed: Math.round((wordCount / duration) * 60), // 字/分
      accuracy: Math.round((correctWords / wordCount) * 100), // %
      duration,
    };
  }

  // 錯誤分類
  private classifyErrors(analysis) {
    return analysis.alignment
      .filter(a => a.type !== 'match')
      .map(a => ({
        type: a.type, // 'omission' | 'insertion' | 'substitution'
        original: a.original,
        transcribed: a.transcribed,
        position: a.position,
      }));
  }

  // 生成練習建議
  private generateSuggestions(metrics, errors) {
    const suggestions = [];

    if (metrics.speed < 150) {
      suggestions.push({
        type: 'speed',
        message: '建議多練習流暢朗讀,目標速度 150 字/分',
      });
    }

    if (metrics.accuracy < 90) {
      suggestions.push({
        type: 'accuracy',
        message: '建議仔細看清楚每個字再朗讀',
      });
    }

    // 高頻錯字提醒
    const frequentErrors = this.getFrequentErrors(errors);
    if (frequentErrors.length > 0) {
      suggestions.push({
        type: 'frequent_errors',
        message: `這些字需要特別注意: ${frequentErrors.join('、')}`,
        words: frequentErrors,
      });
    }

    return suggestions;
  }
}
```

### 3. Azure Speech SDK 整合

```typescript
// azure-speech.service.ts

import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

@Injectable()
export class AzureSpeechService {
  private speechConfig: sdk.SpeechConfig;

  constructor() {
    this.speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY,
      process.env.AZURE_SPEECH_REGION,
    );
    this.speechConfig.speechRecognitionLanguage = 'zh-TW';
  }

  async recognizeFromFile(audioBuffer: Buffer): Promise<RecognitionResult> {
    const audioConfig = sdk.AudioConfig.fromWavFileInput(audioBuffer);
    const recognizer = new sdk.SpeechRecognizer(this.speechConfig, audioConfig);

    return new Promise((resolve, reject) => {
      recognizer.recognizeOnceAsync(
        (result) => {
          if (result.reason === sdk.ResultReason.RecognizedSpeech) {
            resolve({
              text: result.text,
              duration: result.duration / 10000000, // 轉換為秒
              confidence: result.privProperties.getProperty('SpeechServiceResponse_JsonResult'),
            });
          } else {
            reject(new Error(`語音識別失敗: ${result.errorDetails}`));
          }
          recognizer.close();
        },
        (error) => {
          recognizer.close();
          reject(error);
        }
      );
    });
  }
}
```

---

## 📊 資料庫設計 (完整版)

### Schema

```sql
-- 1. 學校
CREATE TABLE schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email_domain VARCHAR(255) UNIQUE, -- e.g., "school.edu.tw"
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. 教師
CREATE TABLE teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  auth_provider VARCHAR(50), -- 'google' | 'microsoft'
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. 班級
CREATE TABLE classrooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id),
  name VARCHAR(100) NOT NULL,
  grade INTEGER, -- 1 | 2 | 3
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. 學生
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID REFERENCES classrooms(id),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 5. 課程
CREATE TABLE lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content TEXT,
  vocabulary JSONB, -- [{"char": "動", "pinyin": "dòng", "def": "..."}]
  github_path VARCHAR(500),
  target_speed INTEGER DEFAULT 150, -- 字/分
  target_accuracy INTEGER DEFAULT 90, -- %
  created_at TIMESTAMP DEFAULT NOW()
);

-- 6. 課程分配
CREATE TABLE lesson_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID REFERENCES classrooms(id),
  lesson_id UUID REFERENCES lessons(id),
  assigned_at TIMESTAMP DEFAULT NOW()
);

-- 7. 作業提交 (含 AI 分析結果) ⭐
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id),
  lesson_id UUID REFERENCES lessons(id),
  paragraph INTEGER, -- 第幾段
  audio_url VARCHAR(500),

  -- AI 分析結果
  transcription TEXT, -- AI 轉錄文字
  original_text TEXT, -- 原文
  speed_wpm INTEGER, -- 語速 (字/分)
  accuracy_rate INTEGER, -- 正確率 (%)
  duration_seconds FLOAT, -- 朗讀時長 (秒)

  errors JSONB, -- 錯誤清單
  suggestions JSONB, -- 練習建議

  is_passed BOOLEAN DEFAULT false, -- 是否達標

  created_at TIMESTAMP DEFAULT NOW()
);

-- 8. 錯字詞記錄 (用於生字學習)
CREATE TABLE error_words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id),
  word VARCHAR(10) NOT NULL,
  error_count INTEGER DEFAULT 1,
  last_seen_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🎨 前端設計 (關鍵頁面)

### 1. 學生朗讀頁面 (核心)

```tsx
// app/lessons/[id]/page.tsx

'use client';

export default function LessonReadingPage({ params }: { params: { id: string } }) {
  const { data: lesson } = useQuery(['lesson', params.id], () =>
    api.lessons.get(params.id)
  );

  const [currentParagraph, setCurrentParagraph] = useState(1);
  const [showPinyin, setShowPinyin] = useState(true); // 注音顯示

  // Space 鍵切換注音
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.target.matches('input, textarea')) {
        e.preventDefault();
        setShowPinyin(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  return (
    <div className="container max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-4">{lesson?.title}</h1>

      {/* 注音開關提示 */}
      <div className="mb-4 text-sm text-gray-600">
        按 <kbd className="px-2 py-1 bg-gray-200 rounded">Space</kbd> 切換注音符號
      </div>

      {/* 課文 (分段顯示) */}
      <div className="mb-8">
        {lesson?.paragraphs.map((para, idx) => {
          const isLocked = idx + 1 > currentParagraph;
          const isCurrent = idx + 1 === currentParagraph;

          return (
            <div
              key={idx}
              className={cn(
                'mb-6 p-4 rounded-lg',
                isCurrent && 'bg-blue-50 border-2 border-blue-300',
                isLocked && 'opacity-50 pointer-events-none'
              )}
            >
              <div className="text-2xl leading-relaxed">
                {showPinyin ? (
                  // 顯示注音
                  <ruby>
                    {para.text.split('').map((char, i) => (
                      <React.Fragment key={i}>
                        <rb>{char}</rb>
                        <rp>(</rp>
                        <rt className="text-sm text-gray-500">{para.pinyin[i]}</rt>
                        <rp>)</rp>
                      </React.Fragment>
                    ))}
                  </ruby>
                ) : (
                  // 隱藏注音
                  para.text
                )}
              </div>

              {isCurrent && (
                <div className="mt-4">
                  <AudioRecorder
                    lessonId={params.id}
                    paragraph={idx + 1}
                    onAnalysisComplete={(result) => {
                      // 顯示六大環節回饋
                      setFeedbackResult(result);

                      // 如果達標,解鎖下一段
                      if (result.overview.isPassed) {
                        setCurrentParagraph(prev => prev + 1);
                      }
                    }}
                  />
                </div>
              )}

              {isLocked && (
                <div className="mt-2 text-gray-500">
                  🔒 完成上一段後解鎖
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 六大環節回饋 */}
      {feedbackResult && (
        <FeedbackPanel result={feedbackResult} />
      )}
    </div>
  );
}
```

### 2. 六大環節回饋面板

```tsx
// components/FeedbackPanel.tsx

export function FeedbackPanel({ result }: { result: FeedbackResult }) {
  const [activeTab, setActiveTab] = useState(0);

  const tabs = [
    { label: '1. 結果總覽', icon: '📊' },
    { label: '2. 錄音播放', icon: '🎤' },
    { label: '3. 逐句對比', icon: '🔍' },
    { label: '4. 錯字詞', icon: '📝' },
    { label: '5. 建議', icon: '💡' },
    { label: '6. AI 分析', icon: '🤖' },
  ];

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      {/* Tab 導航 */}
      <div className="flex space-x-2 mb-6">
        {tabs.map((tab, idx) => (
          <button
            key={idx}
            onClick={() => setActiveTab(idx)}
            className={cn(
              'px-4 py-2 rounded-lg',
              activeTab === idx ? 'bg-blue-500 text-white' : 'bg-gray-100'
            )}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* 1. 結果總覽 */}
      {activeTab === 0 && (
        <div>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center p-4 bg-blue-50 rounded">
              <div className="text-3xl font-bold">{result.overview.speed}</div>
              <div className="text-gray-600">字/分</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded">
              <div className="text-3xl font-bold">{result.overview.accuracy}%</div>
              <div className="text-gray-600">正確率</div>
            </div>
            <div className="text-center p-4 bg-purple-50 rounded">
              <div className="text-3xl">
                {result.overview.isPassed ? '✅' : '❌'}
              </div>
              <div className="text-gray-600">
                {result.overview.isPassed ? '達標' : '未達標'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. 錄音播放與轉錄 */}
      {activeTab === 1 && (
        <div>
          <audio src={result.recording.audioUrl} controls className="w-full mb-4" />
          <div className="bg-gray-50 p-4 rounded">
            <h3 className="font-semibold mb-2">AI 轉錄:</h3>
            <p className="text-lg">{result.recording.transcription}</p>
          </div>
        </div>
      )}

      {/* 3. 逐句對比 */}
      {activeTab === 2 && (
        <div className="space-y-4">
          {result.sentenceComparison.map((sentence, idx) => (
            <div key={idx} className="border-l-4 border-blue-300 pl-4">
              <div className="mb-2">
                <span className="text-gray-600">原文:</span>
                <div className="text-lg">{sentence.original}</div>
              </div>
              <div>
                <span className="text-gray-600">實讀:</span>
                <div className="text-lg">
                  {sentence.transcribed.split('').map((char, i) => {
                    const isError = sentence.errors?.includes(i);
                    return (
                      <span
                        key={i}
                        className={cn(
                          isError && 'text-red-500 font-bold underline'
                        )}
                      >
                        {char}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4. 錯字詞練習清單 */}
      {activeTab === 3 && (
        <div className="space-y-2">
          {result.errorWordsList.length === 0 ? (
            <div className="text-center text-green-600 text-xl">
              🎉 太棒了!沒有錯字!
            </div>
          ) : (
            result.errorWordsList.map((error, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 bg-red-50 rounded"
              >
                <div className="flex items-center space-x-4">
                  <span className="text-3xl">{error.word}</span>
                  <div>
                    <div className="text-sm text-gray-600">
                      {error.type === 'omission' && '❌ 跳過'}
                      {error.type === 'substitution' && '❌ 讀錯'}
                      {error.type === 'insertion' && '➕ 多讀'}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => playAudio(error.word)}
                  className="p-2 bg-blue-500 text-white rounded-full"
                >
                  🔊 聽正確發音
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* 5. 練習建議 */}
      {activeTab === 4 && (
        <div className="space-y-3">
          {result.suggestions.map((suggestion, idx) => (
            <div key={idx} className="p-4 bg-yellow-50 rounded-lg">
              <div className="flex items-start">
                <span className="text-2xl mr-3">💡</span>
                <div>
                  <h4 className="font-semibold mb-1">{suggestion.title}</h4>
                  <p>{suggestion.message}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 6. AI 詳細分析 */}
      {activeTab === 5 && (
        <div className="prose max-w-none">
          <h3>詳細分析報告</h3>
          <p>{result.aiAnalysis}</p>
        </div>
      )}
    </div>
  );
}
```

---

## 📅 4 週開發計畫 (正確版)

### Week 1: 後端 + Azure Speech SDK 整合

**目標**: 完成 AI 語音分析核心功能

- [ ] Day 1-2: 資料庫 Schema 建立
- [ ] Day 3-4: Azure Speech SDK 整合與測試
  - 錄製 10 段國小生朗讀測試音檔
  - 測試 Azure zh-TW WER (目標 < 10%)
  - 如不達標,立即切換 Google Chirp 3
- [ ] Day 5: 文本比對演算法實作
  - Levenshtein Distance
  - 中文字對齊
  - 錯誤分類 (跳字、加字、讀錯)

### Week 2: 前端學生端 + 錄音組件

**目標**: 學生能錄音並看到六大環節回饋

- [ ] Day 1-2: 課程列表 + 課程內容頁面
- [ ] Day 3: 注音符號顯示切換 (Space 鍵)
- [ ] Day 4-5: AudioRecorder 組件
  - 錄音 UI
  - 上傳到 Cloud Storage
  - 呼叫 AI 分析 API
- [ ] Day 5: FeedbackPanel 組件 (六大環節)

### Week 3: 分段朗讀流程 + 教師端

**目標**: 完整學習流程 + 教師查看報告

- [ ] Day 1-2: 分段朗讀流程
  - 段落解鎖機制
  - 達標判定
  - 進度追蹤
- [ ] Day 3-4: 教師端頁面
  - 班級統計報告
  - 個別學生報告
  - 學習曲線圖
- [ ] Day 5: GitHub 課程同步服務

### Week 4: 測試 + 部署 + 修 Bug

**目標**: 上線到 GCP,真實使用者測試

- [ ] Day 1-2: E2E 測試 (Playwright)
  - 學生完整流程
  - AI 分析準確性驗證
- [ ] Day 3: GCP 部署
  - Cloud Run
  - Cloud SQL
  - Cloud Storage
- [ ] Day 4-5: 真實使用者測試 + 修 Bug
  - 至少 2-3 位國小學生測試
  - 收集回饋並改進

---

## 💰 成本估算 (正確版)

### Azure Speech SDK 成本

| 項目 | 規格 | 月成本 (50 學生) | 月成本 (500 學生) |
|------|------|-----------------|------------------|
| Azure Speech STT | $1/小時 | $250 | $2,500 |
| Cloud Run | 100 萬次請求 | $0 (免費) | $10 |
| Cloud SQL | db-f1-micro | $7 | $70 |
| Cloud Storage | 5 GB → 50 GB | $0.10 | $1 |
| Firebase Hosting | 10 GB | $0 (免費) | $0 (免費) |
| **總計** | - | **~$257/月** | **~$2,581/月** |

**重要發現**: Azure Speech SDK 是最大成本項!

### 成本優化方案

#### 方案 A: 使用 Azure 免費額度

- Azure 提供每月 5 小時免費 STT
- 50 學生每月 ~250 小時 → 超出很多
- ❌ 不適用

#### 方案 B: 切換到 OpenAI Whisper (自建)

- 成本: GCP Compute Engine (g2-standard-4 with GPU)
- 月成本: ~$300 (比 Azure $250 貴,但無用量限制)
- ✅ 適合高使用量場景

#### 方案 C: Hybrid 混合模式

- 即時回饋: Azure Speech SDK (快速,< 5 秒)
- 批次分析: Whisper (慢,但免費)
- 月成本: ~$150
- ✅ 最佳平衡

**建議**: MVP 階段先用 Azure (快速驗證),V2 再考慮 Whisper 降成本。

---

## ✅ MVP 完成定義 (正確版)

當以下全部達成,MVP 就算完成:

- [ ] **AI 語音分析準確率 > 90%** (Azure zh-TW WER < 10%)
- [ ] **即時回饋 < 5 秒** (從錄音結束到顯示結果)
- [ ] **六大環節完整呈現** (總覽、錄音、對比、錯字詞、建議、分析)
- [ ] **分段朗讀流程可運作** (段落解鎖、達標判定)
- [ ] **注音符號切換正常** (Space 鍵)
- [ ] **教師能查看班級報告**
- [ ] **至少 2-3 位國小學生測試通過**
- [ ] **曾世杰教授確認符合閱讀科學原理** ⭐

---

## 🚨 關鍵風險與應對

| 風險 | 影響 | 應對 |
|------|------|------|
| **Azure zh-TW WER > 10%** | **高** | Week 1 立即測試,不達標切換 Google Chirp 3 |
| **Azure 成本超支** | 中 | 設定預算告警,準備 Whisper 備案 |
| **中文字對齊演算法不準** | 高 | 參考方大哥 Flutter App 實作 |
| **國小生錄音品質差** | 中 | 前端加音量檢測,提示重錄 |
| **曾教授驗證不通過** | **高** | Week 2/8/14 定期 Demo,及早調整 |

---

## 📚 參考資料

### 教學理論

- [PRD.md](../docs/PRD.md) - 完整產品需求文件
- 曾世杰教授教學方法 (PRD 第 56-143 行)
- 閱讀方程式: 識字解碼 × 背景知識

### 技術參考

- [方大哥 Flutter App](https://github.com/Shinjou/learning-to-read-chinese) - 9,606 字筆順資料
- [Azure Speech SDK 繁體中文研究](../docs/references/azure-speech-sdk-zh-tw-research.md)
- [教育資源清單](../docs/EDUCATIONAL_RESOURCES.md)

### 成本與效能

- Azure Speech SDK: $1/小時
- Google Chirp 3: $2.40/小時 (比 Azure 貴 140%)
- OpenAI Whisper: WER 10.3% (迦納學生研究)

---

**Generated with [Claude Code](https://claude.ai/code) via [Happy](https://happy.engineering)**

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
