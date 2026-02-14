# Agent 系統架構：可插拔設計

> **核心理念**: Agent 處理不同「任務」，每個 Agent 可選擇不同「對話風格」
> **設計原則**: 模組化、可擴展、配置化

---

## 🎯 架構分層

```
┌─────────────────────────────────────┐
│         學習任務層 (Tasks)           │
│  閱讀理解 | 生字學習 | 作文批改 | ... │
└──────────────┬──────────────────────┘
               │
       ┌───────┴────────┐
       │   Agent 系統    │
       │  (可插拔模組)   │
       └───────┬────────┘
               │
┌──────────────┴──────────────────────┐
│       對話風格層 (Styles)            │
│  蘇格拉底 | 直接教學 | 遊戲化 | ...  │
└─────────────────────────────────────┘
```

---

## 📚 任務 vs 風格

### 任務（Task）：要解決什麼問題？

#### 學習端 Agent（學生使用）

```
1. 閱讀理解 Agent（Comprehension）
   - 問題：學生能不能理解文章意思？
   - 輸入：課文內容
   - 輸出：理解度評分

2. 生字學習 Agent（Vocabulary）
   - 問題：學生能不能認識生字？
   - 輸入：錯誤詞彙
   - 輸出：學習建議

3. 作文批改 Agent（Writing）
   - 問題：學生作文寫得好不好？
   - 輸入：學生作文
   - 輸出：修改建議

4. 口語表達 Agent（Speaking）
   - 問題：學生能不能清楚表達？
   - 輸入：錄音
   - 輸出：表達力評分
```

#### 教師端 Agent（老師使用）

```
5. 建立課程 Agent（Course Creation）
   - 問題：老師要建立新課程
   - 輸入：課程大綱、教學目標
   - 輸出：完整課程結構、教材建議

6. 建立班級 Agent（Class Setup）
   - 問題：老師要設定新班級
   - 輸入：班級資訊、學生名單
   - 輸出：自動建立班級、匯入學生、分組建議

7. 批改作業 Agent（Assignment Grading）
   - 問題：老師要批改大量作業
   - 輸入：學生作業
   - 輸出：評分、評語、改進建議

8. 生成測驗 Agent（Quiz Generation）
   - 問題：老師要出測驗卷
   - 輸入：課文內容、難度設定
   - 輸出：測驗題目、參考答案

9. 學習報告 Agent（Report Generation）
   - 問題：老師要生成學習報告
   - 輸入：學生學習數據
   - 輸出：個人/班級報告、視覺化圖表
```

#### 管理端 Agent（管理員使用）

```
10. 資料分析 Agent（Analytics）
    - 問題：管理員要分析平台使用情況
    - 輸入：系統日誌、使用數據
    - 輸出：分析報告、趨勢預測

11. 系統監控 Agent（Monitoring）
    - 問題：管理員要監控系統健康度
    - 輸入：伺服器狀態、錯誤日誌
    - 輸出：異常警報、優化建議
```

### 風格（Style）：怎麼跟學生互動？

```
1. 蘇格拉底風格（Socratic）
   - 特點：引導式提問，不直接給答案
   - 適用：閱讀理解、批判性思考
   - 範例：
     AI: 「你覺得主角為什麼這樣做？」
     學生: 「因為...」
     AI: 「那如果沒有這樣做，會怎樣？」

2. 直接教學風格（Didactic）
   - 特點：直接告訴學生答案和方法
   - 適用：生字學習、文法教學
   - 範例：
     AI: 「『清』這個字，左邊是水部，右邊是青。」
     AI: 「水部的字都跟水有關，你可以記住這個規則。」

3. 遊戲化風格（Gamified）
   - 特點：用遊戲、挑戰、獎勵
   - 適用：練習、複習
   - 範例：
     AI: 「太棒了！你答對了 3 題，再答對 2 題就能獲得金色勳章！」

4. 鼓勵式風格（Encouraging）
   - 特點：正向回饋、建立信心
   - 適用：作文批改、口語表達
   - 範例：
     AI: 「你的想法很有創意！如果能加上更多細節，會更生動。」
```

---

## 🔧 技術架構

### Agent 基類設計

```python
from abc import ABC, abstractmethod
from enum import Enum

class AgentRole(Enum):
    """Agent 角色"""
    STUDENT = "student"      # 學習端
    TEACHER = "teacher"      # 教師端
    ADMIN = "admin"          # 管理端

class DialogueStyle(Enum):
    SOCRATIC = "socratic"           # 蘇格拉底
    DIDACTIC = "didactic"           # 直接教學
    GAMIFIED = "gamified"           # 遊戲化
    ENCOURAGING = "encouraging"     # 鼓勵式
    EFFICIENT = "efficient"         # 高效率（適合教師端）
    ANALYTICAL = "analytical"       # 分析式（適合管理端）

class BaseAgent(ABC):
    """所有 Agent 的基類"""

    def __init__(self,
                 role: AgentRole,
                 style: DialogueStyle = DialogueStyle.SOCRATIC):
        self.role = role
        self.style = style

    @abstractmethod
    async def process(self, input_data: dict) -> dict:
        """處理任務的核心邏輯（子類必須實作）"""
        pass

    def get_prompt_template(self) -> str:
        """根據風格返回不同的 Prompt 模板"""
        templates = {
            DialogueStyle.SOCRATIC: self._socratic_template(),
            DialogueStyle.DIDACTIC: self._didactic_template(),
            DialogueStyle.GAMIFIED: self._gamified_template(),
            DialogueStyle.ENCOURAGING: self._encouraging_template(),
        }
        return templates[self.style]

    @abstractmethod
    def _socratic_template(self) -> str:
        """蘇格拉底風格的 Prompt"""
        pass

    @abstractmethod
    def _didactic_template(self) -> str:
        """直接教學風格的 Prompt"""
        pass

    # ... 其他風格模板
```

---

### 具體 Agent 實作

#### 學習端 Agent

##### 1. 閱讀理解 Agent

```python
class ComprehensionAgent(BaseAgent):
    """閱讀理解 Agent"""

    async def process(self, input_data: dict) -> dict:
        """
        輸入：
        {
            "lesson_content": "課文內容",
            "student_answer": "學生回答"
        }

        輸出：
        {
            "score": 85,
            "next_question": "那你覺得...",
            "feedback": "很好！..."
        }
        """
        lesson = input_data["lesson_content"]
        answer = input_data.get("student_answer", "")

        # 根據風格生成不同的回應
        prompt = self.get_prompt_template().format(
            lesson=lesson,
            answer=answer
        )

        # 調用 LLM（或 Rule-based）
        response = await self._call_llm(prompt)

        return {
            "score": response.score,
            "next_question": response.question,
            "feedback": response.feedback
        }

    def _socratic_template(self) -> str:
        return """
你是一位使用蘇格拉底對話法的老師。
課文：{lesson}
學生回答：{answer}

請用引導式提問，幫助學生深入思考，不要直接給答案。
        """

    def _didactic_template(self) -> str:
        return """
你是一位直接教學的老師。
課文：{lesson}
學生回答：{answer}

請直接告訴學生正確答案，並解釋原因。
        """
```

##### 2. 生字學習 Agent

```python
class VocabularyAgent(BaseAgent):
    """生字學習 Agent"""

    async def process(self, input_data: dict) -> dict:
        """
        輸入：
        {
            "error_words": ["清", "晴", "請"]
        }

        輸出：
        {
            "learning_plan": [
                {
                    "word": "清",
                    "explanation": "...",
                    "practice": "..."
                }
            ]
        }
        """
        words = input_data["error_words"]

        # 根據風格生成不同的學習計劃
        prompt = self.get_prompt_template().format(
            words=", ".join(words)
        )

        response = await self._call_llm(prompt)

        return {
            "learning_plan": response.plan
        }

    def _socratic_template(self) -> str:
        return """
這些字：{words}

請用提問的方式，引導學生發現這些字的規律。
例如：「你有沒有發現這些字有什麼共同點？」
        """

    def _didactic_template(self) -> str:
        return """
這些字：{words}

請直接教學生這些字的：
1. 部首
2. 筆順
3. 字義
4. 記憶口訣
        """
```

##### 3. 作文批改 Agent

```python
class WritingAgent(BaseAgent):
    """作文批改 Agent"""

    async def process(self, input_data: dict) -> dict:
        """
        輸入：
        {
            "essay": "學生作文內容"
        }

        輸出：
        {
            "score": 75,
            "suggestions": ["...", "..."],
            "revised_version": "修改後版本"
        }
        """
        essay = input_data["essay"]

        prompt = self.get_prompt_template().format(essay=essay)
        response = await self._call_llm(prompt)

        return {
            "score": response.score,
            "suggestions": response.suggestions,
            "revised_version": response.revised
        }

    def _socratic_template(self) -> str:
        return """
作文：{essay}

請用提問的方式，引導學生自己發現可以改進的地方。
例如：「你覺得這個段落，是不是可以加入更多細節？」
        """

    def _encouraging_template(self) -> str:
        return """
作文：{essay}

請用鼓勵的方式給予回饋：
1. 先肯定優點
2. 再提出建議
3. 給予信心
        """
```

---

## 🎛️ Agent 管理器

```python
class AgentManager:
    """管理所有 Agent，支援動態載入"""

    def __init__(self):
        self.agents = {}

    def register_agent(self, task_type: str, agent: BaseAgent):
        """註冊 Agent"""
        self.agents[task_type] = agent

    async def execute(self, task_type: str, input_data: dict) -> dict:
        """執行指定的 Agent"""
        if task_type not in self.agents:
            raise ValueError(f"Agent for {task_type} not found")

        agent = self.agents[task_type]
        return await agent.process(input_data)

    def set_style(self, task_type: str, style: DialogueStyle):
        """動態切換 Agent 的對話風格"""
        if task_type in self.agents:
            self.agents[task_type].style = style


# 使用範例
manager = AgentManager()

# 註冊 Agent（使用蘇格拉底風格）
manager.register_agent(
    "comprehension",
    ComprehensionAgent(style=DialogueStyle.SOCRATIC)
)

# 註冊 Agent（使用直接教學風格）
manager.register_agent(
    "vocabulary",
    VocabularyAgent(style=DialogueStyle.DIDACTIC)
)

# 執行 Agent
result = await manager.execute("comprehension", {
    "lesson_content": "小狗在公園玩...",
    "student_answer": "主角是小狗"
})

# 動態切換風格
manager.set_style("comprehension", DialogueStyle.DIDACTIC)
```

---

## 📊 資料庫設計（支援 Agent 系統）

```sql
-- Agent 配置表
CREATE TABLE agent_configs (
    id UUID PRIMARY KEY,
    task_type VARCHAR(50) NOT NULL,        -- comprehension, vocabulary, writing
    style VARCHAR(50) NOT NULL,             -- socratic, didactic, gamified
    is_enabled BOOLEAN DEFAULT true,
    settings JSONB,                         -- Agent 特定設定
    created_at TIMESTAMP DEFAULT NOW()
);

-- Agent 執行記錄
CREATE TABLE agent_executions (
    id UUID PRIMARY KEY,
    student_id UUID REFERENCES students(id),
    agent_config_id UUID REFERENCES agent_configs(id),
    input_data JSONB,
    output_data JSONB,
    execution_time_ms INT,                  -- 執行時間（毫秒）
    created_at TIMESTAMP DEFAULT NOW()
);

-- 學習記錄（關聯到 Agent）
ALTER TABLE submissions
    ADD COLUMN agent_execution_id UUID REFERENCES agent_executions(id);
```

---

## 🚀 開發順序（調整後）

### Phase 1 (Week 3-10): 朗讀分析核心（不含 Agent）

```
Week 3-4:   資料庫設計
Week 5-7:   Whisper 整合 + 文本比對
Week 8-10:  學生介面 + 即時回饋

暫不做：
- ❌ Agent 系統（延後）
- ❌ 蘇格拉底對話（延後）
```

**Demo 2 (Week 10)**: 展示朗讀分析核心

---

### Phase 2 (Week 11-16): Agent 系統基礎建設

```
Week 11-12: Agent 架構設計
  - BaseAgent 基類
  - AgentManager
  - 資料庫設計

Week 13-14: 第一個 Agent - 閱讀理解 Agent
  - 支援蘇格拉底風格
  - 支援直接教學風格

Week 15-16: Agent 整合測試
  - 學生介面整合
  - 風格切換測試
```

**Demo 3 (Week 16)**: 展示 Agent 系統 + 風格切換

---

### Phase 3 (Week 17-20): 校班師生課

```
保持不變
```

---

### Phase 4 (Week 21-22): 更多 Agent

```
Week 21: 生字學習 Agent
Week 22: 作文批改 Agent（如果有餘力）
```

---

### Phase 5 (Week 23-24): Beta 測試

```
測試所有 Agent
```

---

## 🎯 Agent 配置範例（可由老師/管理員設定）

```json
{
  "comprehension_agent": {
    "task_type": "comprehension",
    "style": "socratic",
    "settings": {
      "max_questions": 3,
      "difficulty_level": "medium",
      "language": "zh-TW"
    }
  },
  "vocabulary_agent": {
    "task_type": "vocabulary",
    "style": "didactic",
    "settings": {
      "show_stroke_order": true,
      "show_radical": true,
      "practice_mode": "game"
    }
  }
}
```

---

## 💡 未來擴展

### 可能的 Agent（未來）

```
1. 口語表達 Agent（Speaking）
   - 評估學生口語表達能力
   - 風格：蘇格拉底 / 鼓勵式

2. 聽力理解 Agent（Listening）
   - 播放音檔，測試聽力
   - 風格：遊戲化 / 直接教學

3. 詩詞鑑賞 Agent（Poetry）
   - 引導學生理解詩詞
   - 風格：蘇格拉底 / 藝術性

4. 成語教學 Agent（Idiom）
   - 教學生成語典故
   - 風格：故事化 / 遊戲化
```

### 可能的風格（未來）

```
5. 同儕互動風格（Peer）
   - 像朋友一樣對話
   - 適用：口語表達、作文批改

6. 競賽風格（Competitive）
   - 排行榜、計時挑戰
   - 適用：複習、測驗

7. 情境模擬風格（Scenario）
   - 模擬真實情境
   - 適用：口語表達、聽力
```

---

## 🔑 關鍵設計原則

### 1. 分離關注點
```
任務邏輯（做什麼）← Agent 核心
對話風格（怎麼做）← Prompt 模板
```

### 2. 可插拔
```
新增 Agent：只需繼承 BaseAgent
新增風格：只需加 Prompt 模板
```

### 3. 配置化
```
不寫死在程式碼
可由資料庫/配置檔控制
老師可以自己選風格
```

### 4. 可測試
```
每個 Agent 獨立測試
每種風格獨立測試
```

---

**Generated with [Claude Code](https://claude.ai/code) via [Happy](https://happy.engineering)**

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
