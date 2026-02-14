# Google Classroom 整合方案

> **核心定位**: Google Classroom 作為「身份管理與通知系統」,不是課程內容平台
>
> **使用場景**: OAuth 登入、學生名單同步、作業通知

---

## 🎯 為什麼需要 Google Classroom?

### 核心價值總結

| 價值 | 說明 | 省下的開發時間 |
|------|------|---------------|
| **OAuth 登入** | 學生已有 Google 帳號,一鍵登入 | 6 週 |
| **學生名單** | 自動同步班級學生,無需手動輸入 | 3 週 |
| **通知系統** | Google 自動發送 Email/推送通知 | 7 週 |
| **權限管理** | Google 統一身份驗證,家長帳號關聯 | 11 週 |
| **總節省** | | **27 週 (6.5 個月)** |

**關鍵優勢**: 完全免費,無 API 呼叫限制

---

## 📐 系統架構設計

### Google Classroom 在整體架構中的定位

```
┌─────────────────────────────────────────────────┐
│  外部系統層                                       │
│  ┌──────────┬──────────┬──────────────────────┐ │
│  │ Notion   │ GitHub   │ Google Classroom     │ │
│  │ 課程內容  │ 作業結構  │ 身份/通知             │ │
│  └──────────┴──────────┴──────────────────────┘ │
└─────────────────────────────────────────────────┘
              ↓ API 整合
┌─────────────────────────────────────────────────┐
│  我們的後端                                       │
│  ┌──────────────────────────────────────────────┐│
│  │ 資料適配層                                    ││
│  │ - NotionAdapter (課程內容)                    ││
│  │ - GitHubAdapter (作業模板)                    ││
│  │ - ClassroomAdapter (身份/通知) ← 新增         ││
│  └──────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────┐│
│  │ 業務邏輯層                                    ││
│  │ - 學生登入驗證 (使用 Google OAuth)            ││
│  │ - 班級管理 (同步 Classroom 資料)              ││
│  │ - 作業派發 (透過 Classroom 通知)              ││
│  │ - AI 評分 (我們自己的邏輯)                    ││
│  └──────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
              ↓ REST API
┌─────────────────────────────────────────────────┐
│  我們的前端 (學生/教師使用)                       │
│  - 使用 Google Sign-In 登入                      │
│  - 課程瀏覽 (從 Notion)                          │
│  - 作業完成 (提交到我們的系統)                    │
│  - 不會跳轉到真實的 Google Classroom             │
└─────────────────────────────────────────────────┘
```

---

## 🔧 技術實作

### 1. OAuth 登入整合

#### 前端:Google Sign-In Button

```typescript
// /frontend/src/components/GoogleSignIn.tsx
import { GoogleLogin } from '@react-oauth/google';

export function GoogleSignIn() {
  const handleSuccess = async (credentialResponse) => {
    // 1. 取得 Google ID Token
    const idToken = credentialResponse.credential;

    // 2. 發送到後端驗證
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });

    const { accessToken, user } = await response.json();

    // 3. 儲存 Token,跳轉到首頁
    localStorage.setItem('accessToken', accessToken);
    router.push('/dashboard');
  };

  return (
    <div>
      <h1>使用 Google 登入</h1>
      <GoogleLogin
        onSuccess={handleSuccess}
        onError={() => console.error('Login failed')}
        useOneTap
      />
    </div>
  );
}
```

#### 後端:驗證 Google ID Token

```typescript
// /backend/src/auth/google-auth.service.ts
import { OAuth2Client } from 'google-auth-library';

export class GoogleAuthService {
  private client: OAuth2Client;

  constructor() {
    this.client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
  }

  async verifyIdToken(idToken: string) {
    try {
      // 1. 驗證 Google ID Token
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();

      // 2. 取得使用者資訊
      const googleUserId = payload['sub'];
      const email = payload['email'];
      const name = payload['name'];
      const picture = payload['picture'];

      // 3. 查詢或建立使用者
      let user = await this.findUserByGoogleId(googleUserId);

      if (!user) {
        user = await this.createUser({
          googleUserId,
          email,
          name,
          picture,
        });
      }

      // 4. 產生我們自己的 Access Token (JWT)
      const accessToken = this.generateJWT(user);

      return { accessToken, user };
    } catch (error) {
      throw new Error('Invalid Google ID Token');
    }
  }

  private async findUserByGoogleId(googleUserId: string) {
    return await db.query(
      'SELECT * FROM users WHERE google_user_id = $1',
      [googleUserId]
    );
  }

  private async createUser(data: any) {
    return await db.query(
      `INSERT INTO users (google_user_id, email, name, avatar_url)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.googleUserId, data.email, data.name, data.picture]
    );
  }

  private generateJWT(user: any) {
    return jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
  }
}
```

---

### 2. Google Classroom API 整合

#### Classroom Adapter

```typescript
// /backend/src/adapters/classroom.adapter.ts
import { google } from 'googleapis';

export class ClassroomAdapter {
  private classroom: any;

  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    this.classroom = google.classroom({ version: 'v1', auth });
  }

  // ========== 取得教師的所有班級 ==========
  async listCourses() {
    const response = await this.classroom.courses.list({
      teacherId: 'me',
      courseStates: ['ACTIVE'],
    });

    return response.data.courses.map(course => ({
      id: course.id,
      name: course.name,
      section: course.section,
      enrollmentCode: course.enrollmentCode,
    }));
  }

  // ========== 取得班級學生名單 ==========
  async listStudents(courseId: string) {
    const response = await this.classroom.courses.students.list({
      courseId,
    });

    return response.data.students.map(student => ({
      userId: student.userId,
      email: student.profile.emailAddress,
      name: student.profile.name.fullName,
      photoUrl: student.profile.photoUrl,
    }));
  }

  // ========== 建立作業 CourseWork ==========
  async createCourseWork(courseId: string, data: CreateCourseWorkDTO) {
    const response = await this.classroom.courses.courseWork.create({
      courseId,
      requestBody: {
        title: data.title,
        description: data.description,
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        dueDate: {
          year: data.dueDate.getFullYear(),
          month: data.dueDate.getMonth() + 1,
          day: data.dueDate.getDate(),
        },
        dueTime: {
          hours: data.dueDate.getHours(),
          minutes: data.dueDate.getMinutes(),
        },
        maxPoints: data.maxPoints || 100,
        materials: [
          {
            link: {
              url: data.linkUrl, // 連結到我們的平台
              title: '點此完成作業',
            },
          },
        ],
      },
    });

    return {
      id: response.data.id,
      title: response.data.title,
      state: response.data.state,
    };
  }

  // ========== 更新學生作業狀態 ==========
  async updateStudentSubmission(
    courseId: string,
    courseWorkId: string,
    studentId: string,
    grade: number
  ) {
    // 1. 取得學生的提交記錄
    const submission = await this.classroom.courses.courseWork.studentSubmissions.get({
      courseId,
      courseWorkId,
      id: studentId,
    });

    // 2. 更新成績
    await this.classroom.courses.courseWork.studentSubmissions.patch({
      courseId,
      courseWorkId,
      id: submission.data.id,
      updateMask: 'assignedGrade,draftGrade',
      requestBody: {
        assignedGrade: grade,
        draftGrade: grade,
      },
    });

    // 3. 回傳作業
    await this.classroom.courses.courseWork.studentSubmissions.return({
      courseId,
      courseWorkId,
      id: submission.data.id,
    });
  }
}
```

---

### 3. 班級同步服務

```typescript
// /backend/src/services/classroom-sync.service.ts

export class ClassroomSyncService {
  constructor(
    private classroomAdapter: ClassroomAdapter,
    private db: Database
  ) {}

  // ========== 同步教師的所有班級 ==========
  async syncTeacherCourses(teacherId: string, accessToken: string) {
    const adapter = new ClassroomAdapter(accessToken);

    // 1. 從 Google Classroom 取得班級列表
    const courses = await adapter.listCourses();

    // 2. 更新到資料庫
    for (const course of courses) {
      await this.db.query(
        `INSERT INTO classrooms (
          teacher_id,
          google_course_id,
          classroom_name,
          enrollment_code
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (google_course_id) DO UPDATE SET
          classroom_name = EXCLUDED.classroom_name,
          updated_at = NOW()`,
        [teacherId, course.id, course.name, course.enrollmentCode]
      );

      // 3. 同步學生名單
      await this.syncCourseStudents(course.id, accessToken);
    }
  }

  // ========== 同步班級學生名單 ==========
  async syncCourseStudents(courseId: string, accessToken: string) {
    const adapter = new ClassroomAdapter(accessToken);

    // 1. 從 Google Classroom 取得學生列表
    const students = await adapter.listStudents(courseId);

    // 2. 取得本地 classroom_id
    const classroom = await this.db.query(
      'SELECT classroom_id FROM classrooms WHERE google_course_id = $1',
      [courseId]
    );

    // 3. 更新學生資料
    for (const student of students) {
      // 3.1 建立或更新學生
      const result = await this.db.query(
        `INSERT INTO students (
          google_user_id,
          email,
          name,
          avatar_url
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (google_user_id) DO UPDATE SET
          name = EXCLUDED.name,
          avatar_url = EXCLUDED.avatar_url,
          updated_at = NOW()
        RETURNING student_id`,
        [student.userId, student.email, student.name, student.photoUrl]
      );

      const studentId = result.rows[0].student_id;

      // 3.2 建立學生與班級的關聯
      await this.db.query(
        `INSERT INTO classroom_students (classroom_id, student_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [classroom.rows[0].classroom_id, studentId]
      );
    }
  }

  // ========== 定期同步 (每天一次) ==========
  @Cron('0 3 * * *') // 每天凌晨 3 點
  async scheduledSync() {
    console.log('[ClassroomSync] Starting daily sync...');

    // 取得所有教師
    const teachers = await this.db.query(
      'SELECT teacher_id, google_access_token FROM teachers WHERE google_access_token IS NOT NULL'
    );

    for (const teacher of teachers.rows) {
      try {
        await this.syncTeacherCourses(teacher.teacher_id, teacher.google_access_token);
        console.log(`[ClassroomSync] Synced teacher ${teacher.teacher_id}`);
      } catch (error) {
        console.error(`[ClassroomSync] Failed to sync teacher ${teacher.teacher_id}:`, error);
      }
    }

    console.log('[ClassroomSync] Daily sync completed');
  }
}
```

---

### 4. 作業派發流程(完整範例)

```typescript
// /backend/src/services/assignment.service.ts

export class AssignmentService {
  constructor(
    private db: Database,
    private classroomAdapter: ClassroomAdapter,
    private githubAdapter: GitHubAdapter
  ) {}

  async createAssignment(data: CreateAssignmentDTO) {
    // 1. 從 GitHub 取得作業模板
    const template = await this.githubAdapter.getAssignment(data.templateId);

    // 2. 在我們的資料庫建立作業實例
    const assignment = await this.db.query(
      `INSERT INTO assignments (
        classroom_id,
        template_id,
        title,
        description,
        due_date,
        max_points,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'active')
      RETURNING assignment_id`,
      [
        data.classroomId,
        data.templateId,
        template.title,
        template.description,
        data.dueDate,
        data.maxPoints || 100,
      ]
    );

    const assignmentId = assignment.rows[0].assignment_id;

    // 3. 取得班級的 Google Course ID
    const classroom = await this.db.query(
      'SELECT google_course_id FROM classrooms WHERE classroom_id = $1',
      [data.classroomId]
    );

    const googleCourseId = classroom.rows[0].google_course_id;

    // 4. 透過 Google Classroom API 建立 CourseWork
    const courseWork = await this.classroomAdapter.createCourseWork(
      googleCourseId,
      {
        title: template.title,
        description: template.description,
        dueDate: data.dueDate,
        maxPoints: data.maxPoints,
        linkUrl: `${process.env.FRONTEND_URL}/assignments/${assignmentId}`,
      }
    );

    // 5. 儲存 Google CourseWork ID
    await this.db.query(
      'UPDATE assignments SET google_coursework_id = $1 WHERE assignment_id = $2',
      [courseWork.id, assignmentId]
    );

    // 6. Google Classroom 自動發送通知給學生
    // (不需要我們寫任何通知邏輯!)

    return {
      assignmentId,
      googleCourseWorkId: courseWork.id,
      notificationSent: true, // Google 自動處理
    };
  }

  // 學生完成作業後,同步成績到 Google Classroom
  async submitAssignment(assignmentId: string, studentId: string, score: number) {
    // 1. 儲存到我們的資料庫
    await this.db.query(
      `INSERT INTO assignment_submissions (
        assignment_id,
        student_id,
        score,
        submitted_at
      ) VALUES ($1, $2, $3, NOW())`,
      [assignmentId, studentId, score]
    );

    // 2. 取得 Google Classroom 相關 ID
    const data = await this.db.query(
      `SELECT
         a.google_coursework_id,
         c.google_course_id,
         s.google_user_id
       FROM assignments a
       JOIN classrooms c ON a.classroom_id = c.classroom_id
       JOIN students s ON s.student_id = $2
       WHERE a.assignment_id = $1`,
      [assignmentId, studentId]
    );

    const { google_coursework_id, google_course_id, google_user_id } = data.rows[0];

    // 3. 同步成績到 Google Classroom
    await this.classroomAdapter.updateStudentSubmission(
      google_course_id,
      google_coursework_id,
      google_user_id,
      score
    );

    // Google Classroom 會自動通知學生成績已出
  }
}
```

---

## 🔄 完整資料流圖

### 教師建立班級流程

```
1. 教師在 Google Classroom 建立班級(真實的 Google Classroom)
   - 班級名稱: 一年甲班
   - 科目: 國語
   - 邀請學生

2. 學生加入 Google Classroom
   - 點擊邀請連結
   - 自動加入班級

3. 教師在我們的平台登入(使用 Google OAuth)
   ↓
4. 我們的後端自動同步班級資料
   - 呼叫 Classroom API: courses.list()
   - 呼叫 Classroom API: students.list()
   - 儲存到資料庫

5. 教師在我們的平台看到班級列表
   ✅ 不需要手動輸入學生名單
```

### 教師派發作業流程

```
1. 教師在我們的平台選擇作業模板(來自 GitHub)
   ↓
2. 設定截止日期、班級
   ↓
3. 點擊「派發作業」
   ↓
4. 我們的後端處理:
   - 在資料庫建立作業實例
   - 呼叫 Classroom API: courseWork.create()
   ↓
5. Google Classroom 自動通知:
   - Email 給所有學生
   - 推送通知到 App
   - 家長也會收到通知(如果有設定)
```

### 學生完成作業流程

```
1. 學生收到 Google Classroom 通知
   ↓
2. 點擊通知中的連結
   ↓
3. 跳轉到我們的平台(不是 Google Classroom)
   ↓
4. 學生在我們的平台完成作業(朗讀練習)
   ↓
5. 提交後,我們的 AI 評分
   ↓
6. 成績儲存到我們的資料庫
   ↓
7. (可選)同步成績到 Google Classroom
   - 呼叫 Classroom API: studentSubmissions.patch()
   - 學生在 Google Classroom 也能看到成績
```

---

## 🎯 多租戶架構:Google Classroom 整合

### 機構層級隔離

```typescript
// 每個機構使用獨立的 Google Workspace Domain

機構 A: taipei-edu.edu.tw
├─ Google Classroom Courses
│  ├─ 中正國小-一年甲班
│  └─ 中正國小-一年乙班

機構 B: private-school-group.com
├─ Google Classroom Courses
│  ├─ 明星小學-二年甲班
│  └─ 明星小學-二年乙班

我們的資料庫:
organizations
├─ org_id: 1 (台北市教育局)
│  google_workspace_domain: taipei-edu.edu.tw
│  google_admin_email: admin@taipei-edu.edu.tw
│
└─ org_id: 2 (私立學校集團)
   google_workspace_domain: private-school-group.com
   google_admin_email: admin@private-school-group.com
```

### OAuth Scope 管理

```typescript
// 不同角色需要不同的 Google Classroom 權限

教師 Scopes:
  - classroom.courses.readonly (查看班級)
  - classroom.rosters.readonly (查看學生名單)
  - classroom.coursework.students (建立作業)
  - classroom.student-submissions.students.readonly (查看繳交狀態)

學生 Scopes:
  - classroom.courses.readonly (查看自己的班級)
  - classroom.coursework.me.readonly (查看自己的作業)

管理員 Scopes:
  - classroom.courses (完整課程管理)
  - classroom.rosters (完整名單管理)
```

---

## 💰 成本與限制

### API 配額

```
Google Classroom API 配額(免費):
  - 每天 50,000,000 次請求
  - 每分鐘 1,500 次請求
  - 每秒 60 次請求

實際用量估算(500 學生):
  - 每日同步學生名單: 50 次
  - 每日派發作業: 100 次
  - 每日更新成績: 200 次
  總計: 350 次/天

結論: 配額綽綽有餘,完全不用擔心
```

### 費用

```
✅ Google Classroom API: 完全免費
✅ Google Workspace for Education: 免費(教育機構)
✅ OAuth 登入: 免費

總成本: $0
```

---

## ⚠️ 限制與風險

### 技術限制

| 限制 | 說明 | 解決方案 |
|------|------|---------|
| 需要 Google 帳號 | 學生必須有 Google 帳號 | 學校統一申請(標準做法) |
| Domain 限制 | 只能管理同 Domain 的使用者 | 每個機構用獨立 Workspace |
| 無法客製化 UI | Classroom 的通知介面固定 | 通知只是入口,學習在我們平台 |

### 依賴性風險

```
風險: Google Classroom API 變更或停用

對策:
  1. 核心資料在我們資料庫(學習記錄、AI 評分)
  2. Google Classroom 只負責:
     - OAuth 登入 (可替換成其他 OAuth Provider)
     - 通知 (可替換成 Email/SMS)
  3. 資料備份(每日備份學生名單)
  4. 抽象層設計(易於切換 Provider)
```

---

## ✅ 總結

### Google Classroom 在我們系統中的角色

```
✅ 負責:
  - OAuth 登入(學生/教師/家長)
  - 學生名單同步
  - 作業通知(Email + Push)
  - (可選)成績同步

❌ 不負責:
  - 課程內容(由 Notion 負責)
  - 作業結構(由 GitHub 負責)
  - 學習記錄(我們的資料庫)
  - AI 評分(我們的後端)
  - 前端介面(100% 我們自己)
```

### 價值量化

| 項目 | 自建 | Google Classroom | 節省 |
|------|------|------------------|------|
| 開發時間 | 31 週 | 2 週 | 29 週 |
| 維護成本 | 高 | 零(Google 維護) | 100% |
| 年度費用 | $10,000+ | $0 | $10,000+ |

**結論**: Google Classroom 是三個外部系統中 **ROI 最高** 的選擇。

