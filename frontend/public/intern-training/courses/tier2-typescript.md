# Tier 2：TypeScript

TypeScript 是 JavaScript 加上「型別」的語言。LingoLeap 整個前端都用 TypeScript 寫的，你一定要懂它。

---

## 為什麼需要型別？

想像你在寄信。信封上要填「收件人姓名：___，地址：___，郵遞區號：___（5位數字）」。

如果有人在「郵遞區號」那格填了「你好」，郵局送得到嗎？當然不行。

TypeScript 就是那份信封格式。你在寫程式時就定義好「這個函式接收什麼格式的資料、回傳什麼格式的結果」。格式錯了，TypeScript 馬上報錯 — 在你 push 程式碼之前，不是在學生使用時。

```typescript
// 沒有型別（JavaScript）
function greet(user) {
  return '你好，' + user.name;
}

greet({ username: '靖杭' });  // 沒報錯，但執行結果是「你好，undefined」

// 有型別（TypeScript）
interface User {
  name: string;
}

function greet(user: User): string {
  return '你好，' + user.name;
}

greet({ username: '靖杭' });  // 立刻報錯：'username' 不在 User 裡
```

> 💡 提示：TypeScript 的錯誤是「早期預警」。在開發時看到紅線，比在生產環境讓 500 個學生碰到 bug 好太多了。

---

## 基本型別

```typescript
// 基本型別
const name: string = '靖杭';
const age: number = 17;
const isActive: boolean = true;

// 陣列
const steps: string[] = ['簡介', '朗讀', '理解'];
const scores: number[] = [85, 90, 78];

// 可以是 null 或 undefined
let session: string | null = null;
session = 'abc-123';  // OK
session = 123;         // 錯誤：number 不是 string | null

// any — 不建議用，後面會解釋
const data: any = '什麼都行';  // 這樣就失去了型別保護
```

---

## interface vs type

這兩個很像，但用途略不同。LingoLeap 主要用 `interface` 定義物件格式，用 `type` 定義聯合型別（多選一）。

```typescript
// interface：定義物件的「形狀」
interface Story {
  id: string;
  title: string;
  level: number;
  content: string[];
  category: 'prose' | 'poetry' | 'dialogue';  // 只能是這三個值之一
}

// type：常用在聯合型別或複雜組合
type AppView =
  | 'library'
  | 'intro'
  | 'tutor'
  | 'comprehension'
  | 'vocab'
  | 'fullreading'
  | 'report';

// type 也可以定義物件，但物件建議用 interface
type Coordinate = { x: number; y: number };
```

> 💡 提示：簡單原則：描述一個物件用 `interface`，描述「這個值是多選一」用 `type`。

---

## 函式型別

```typescript
// 函式參數和回傳值都可以加型別
function add(a: number, b: number): number {
  return a + b;
}

// 箭頭函式
const multiply = (a: number, b: number): number => a * b;

// 選填參數（加 ?）
function createUser(name: string, role?: string): string {
  return role ? `${name} (${role})` : name;
}

createUser('靖杭');           // OK：role 可以不傳
createUser('啟翔', 'admin');  // OK

// 函式作為型別（常見在 Props）
interface ButtonProps {
  label: string;
  onClick: () => void;             // 無參數、無回傳值的函式
  onHover?: (text: string) => void; // 選填，接收 string 參數
}
```

---

## LingoLeap 範例：api.ts 裡的型別

打開 `frontend/src/services/api.ts`，會看到這樣的型別定義：

```typescript
// 定義「後端 API 回傳的課文格式」
interface ApiStoryListItem {
  id: number;
  lesson_number: number;
  title: string;
  grade: number;
  genre: string;
  char_count: number;
  thumbnail_url: string;
  reading_strategy: string | null;  // 可能是 null
  intro: ApiStoryIntro;             // 巢狀介面
}

// 定義「前端使用的課文格式」（跟 API 格式不同！）
interface Story {
  id: string;       // API 給 number，但前端轉成 string
  title: string;
  level: number;
  content: string[];
  // ...
}

// 轉換函式：把 API 格式轉成前端格式
function apiListItemToStory(item: ApiStoryListItem): Story {
  return {
    id: String(item.lesson_number),  // number → string
    title: item.title,
    level: item.grade,
    content: [],
    // ...
  };
}
```

這樣做的好處：如果後端改了 API，TypeScript 會立刻告訴你哪些地方受影響，不用一個一個去找。

---

## 泛型（Generics）入門

泛型就是「型別的變數」，讓函式可以處理不同型別但保持型別安全。

```typescript
// 不用泛型：每種型別都要寫一個函式
function getFirstString(arr: string[]): string {
  return arr[0];
}
function getFirstNumber(arr: number[]): number {
  return arr[0];
}

// 用泛型：一個函式搞定
function getFirst<T>(arr: T[]): T {
  return arr[0];
}

const firstStory = getFirst(['朗讀', '理解', '生字']);  // TypeScript 知道回傳值是 string
const firstScore = getFirst([85, 90, 78]);              // TypeScript 知道回傳值是 number
```

LingoLeap 的 `useState` 就用了泛型：

```typescript
const [session, setSession] = useState<string | null>(null);
//                                     ↑ 告訴 TypeScript 這個 state 的型別
```

---

## 常見錯誤：過度使用 `any`

⚠️ 注意：`any` 是「關掉型別檢查」的意思。用了 `any`，TypeScript 就變回 JavaScript 了。

```typescript
// 錯誤的寫法
const handleResponse = (data: any) => {
  console.log(data.user.name);  // TypeScript 不報錯，但如果 data.user 不存在就爆了
};

// 正確的寫法：定義清楚型別
interface ApiResponse {
  user: {
    name: string;
    id: number;
  };
  status: 'ok' | 'error';
}

const handleResponse = (data: ApiResponse) => {
  console.log(data.user.name);  // 安全
};
```

什麼時候可以用 `any`？當你真的不知道型別（比如處理第三方套件的奇怪格式），而且暫時沒空處理時，可以先用 `any` 標記，但要加上 `TODO` 註解：

```typescript
// TODO: 補上正確型別 — 等第三方套件加上 @types 後再修
const externalData: any = thirdPartyLib.getData();
```

---

## 練習

**任務**：把以下未加型別的函式改成 TypeScript 版本

```typescript
// 原始版本（JavaScript 風格）
function calculateScore(attempts, correct) {
  if (attempts === 0) return 0;
  return Math.round((correct / attempts) * 100);
}

function formatStep(stepNumber, stepName, isCompleted) {
  return {
    label: `第 ${stepNumber} 步：${stepName}`,
    done: isCompleted,
    icon: isCompleted ? '✓' : '○',
  };
}

// TODO：
// 1. 幫 calculateScore 的參數和回傳值加型別
// 2. 為 formatStep 的回傳值定義一個 interface
// 3. 幫 formatStep 加上參數和回傳值型別
```

完成後，在 `frontend/src/utils/` 下建立 `scoring.ts`，把你的型別版本放進去，確認沒有 TypeScript 錯誤（VS Code 不顯示紅線）。
