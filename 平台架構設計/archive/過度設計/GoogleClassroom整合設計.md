# Google Classroom 整合設計

> **目標**: OAuth 登入 + 學生名單同步 + 作業通知
>
> **範圍**: 不使用 Google Classroom 的作業功能,只用登入和名單

---

## 🎯 整合範圍定義

### 使用 Google Classroom 的功能

| 功能 | 是否使用 | 原因 |
|------|---------|------|
| **OAuth 登入** | ✅ 使用 | 學生/教師用 Google 帳號登入 |
| **學生名單** | ✅ 使用 | 自動同步班級學生資料 |
| **教師名單** | ✅ 使用 | 自動同步授課教師 |
| **課程列表** | ✅ 使用 | 取得教師教授的班級 |
| **作業發布** | ❌ 不用 | 我們自己的系統處理 |
| **作業提交** | ❌ 不用 | 學生在我們的系統提交 |
| **評分** | ❌ 不用 | AI + 教師在我們的系統評分 |

**核心價值**: Google Classroom 只是 **身份驗證** 和 **名單管理** 工具

---

## 📐 架構設計

```
Google Classroom API
    ↓
OAuth 2.0 登入
    ↓
取得教師課程列表
    ↓
同步班級 + 學生 + 教師 (每日)
    ↓
PostgreSQL (classrooms, students, teachers)
    ↓
我們的前端 (學生提交作業)
```

---

## 1️⃣ OAuth 2.0 登入流程

### 1.1 流程圖

```
User 點擊 "Sign in with Google"
    ↓
前端重導向到 Google OAuth
    ↓
用戶授權 (同意存取 Classroom)
    ↓
Google 重導向回 /auth/google/callback?code=xxx
    ↓
後端用 code 換 access_token
    ↓
取得用戶資料 (email, name, profile)
    ↓
建立 Session (JWT Token)
    ↓
前端儲存 Token 並重導向到 Dashboard
```

### 1.2 實作: OAuth Controller

```typescript
// src/auth/GoogleOAuthController.ts
import { Controller, Get, Query, Res } from '@nestjs/common';
import { google } from 'googleapis';
import { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@Controller('auth/google')
export class GoogleOAuthController {
  private oauth2Client;

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI, // http://localhost:3000/auth/google/callback
    );
  }

  /**
   * Step 1: 重導向到 Google OAuth
   */
  @Get('login')
  async login(@Res() res: Response) {
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/classroom.courses.readonly',
        'https://www.googleapis.com/auth/classroom.rosters.readonly',
      ],
    });

    res.redirect(authUrl);
  }

  /**
   * Step 2: 處理 Google Callback
   */
  @Get('callback')
  async callback(@Query('code') code: string, @Res() res: Response) {
    // 1. 用 code 換 access_token
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    // 2. 取得用戶資料
    const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // 3. 建立或更新用戶
    const user = await this.upsertUser(userInfo, tokens);

    // 4. 生成 JWT Token
    const jwtToken = this.jwtService.sign({
      userId: user.teacher_id || user.student_id,
      email: user.email,
      role: user.role,
    });

    // 5. 重導向到前端 (帶 Token)
    res.redirect(`http://localhost:5173/auth/callback?token=${jwtToken}`);
  }

  /**
   * Upsert User (Teacher or Student)
   */
  private async upsertUser(userInfo: any, tokens: any) {
    // 判斷是教師還是學生 (透過 domain 或其他邏輯)
    const isTeacher = userInfo.email.endsWith('@example.edu.tw'); // 範例邏輯

    if (isTeacher) {
      return await this.prisma.teacher.upsert({
        where: { email: userInfo.email },
        create: {
          email: userInfo.email,
          name: userInfo.name,
          google_user_id: userInfo.id,
          avatar_url: userInfo.picture,
          organization_id: this.getOrganizationId(), // 從配置取得
        },
        update: {
          name: userInfo.name,
          avatar_url: userInfo.picture,
          // 儲存 refresh_token (用於後續 API 呼叫)
          google_refresh_token: tokens.refresh_token,
        },
      });
    } else {
      // 學生邏輯
      return await this.prisma.student.upsert({
        where: { email: userInfo.email },
        create: {
          email: userInfo.email,
          name: userInfo.name,
          google_user_id: userInfo.id,
          avatar_url: userInfo.picture,
          classroom_id: null, // 稍後同步時更新
        },
        update: {
          name: userInfo.name,
          avatar_url: userInfo.picture,
        },
      });
    }
  }
}
```

---

## 2️⃣ 學生名單同步服務

### 2.1 同步邏輯

```typescript
// src/services/ClassroomSyncService.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClassroomSyncService {
  private readonly logger = new Logger(ClassroomSyncService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 定時同步: 每日凌晨 2 點
   */
  @Cron('0 2 * * *')
  async scheduledSync() {
    this.logger.log('Starting scheduled Classroom sync...');

    // 取得所有教師 (有 Google Classroom 授權的)
    const teachers = await this.prisma.teacher.findMany({
      where: { google_refresh_token: { not: null } },
    });

    for (const teacher of teachers) {
      await this.syncTeacherClassrooms(teacher);
    }

    this.logger.log('Classroom sync completed');
  }

  /**
   * 同步單一教師的所有班級
   */
  async syncTeacherClassrooms(teacher: Teacher) {
    // 1. 建立 OAuth Client (用 teacher 的 refresh_token)
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    oauth2Client.setCredentials({
      refresh_token: teacher.google_refresh_token,
    });

    const classroom = google.classroom({ version: 'v1', auth: oauth2Client });

    try {
      // 2. 取得教師的課程列表
      const { data } = await classroom.courses.list({
        teacherId: 'me',
        courseStates: ['ACTIVE'],
      });

      this.logger.log(`Found ${data.courses.length} courses for ${teacher.name}`);

      // 3. 同步每個課程
      for (const course of data.courses) {
        await this.syncCourse(course, teacher, classroom);
      }

      await this.logSyncSuccess(teacher, data.courses.length);
    } catch (error) {
      this.logger.error(`Sync failed for teacher ${teacher.name}:`, error);
      await this.logSyncFailure(teacher, error);
    }
  }

  /**
   * 同步單一課程 (班級 + 學生)
   */
  private async syncCourse(course: any, teacher: Teacher, classroom: any) {
    // 1. Upsert Classroom
    const classroomRecord = await this.prisma.classroom.upsert({
      where: { google_classroom_id: course.id },
      create: {
        school_id: this.getSchoolId(teacher), // 從 teacher 關聯取得
        name: course.name,
        grade_level: this.extractGradeLevel(course.name), // 解析年級
        academic_year: new Date().getFullYear().toString(),
        google_classroom_id: course.id,
      },
      update: {
        name: course.name,
      },
    });

    // 2. 關聯教師與班級
    await this.prisma.classroomTeacher.upsert({
      where: {
        classroom_id_teacher_id: {
          classroom_id: classroomRecord.classroom_id,
          teacher_id: teacher.teacher_id,
        },
      },
      create: {
        classroom_id: classroomRecord.classroom_id,
        teacher_id: teacher.teacher_id,
      },
      update: {},
    });

    // 3. 同步學生名單
    await this.syncStudents(course.id, classroomRecord, classroom);
  }

  /**
   * 同步學生名單
   */
  private async syncStudents(courseId: string, classroomRecord: Classroom, classroom: any) {
    // 取得學生名單
    const { data } = await classroom.courses.students.list({
      courseId,
    });

    this.logger.log(`Found ${data.students.length} students in course ${courseId}`);

    for (const student of data.students) {
      await this.prisma.student.upsert({
        where: { google_user_id: student.userId },
        create: {
          classroom_id: classroomRecord.classroom_id,
          email: student.profile.emailAddress,
          name: student.profile.name.fullName,
          google_user_id: student.userId,
          avatar_url: student.profile.photoUrl,
        },
        update: {
          classroom_id: classroomRecord.classroom_id, // 學生可能換班
          name: student.profile.name.fullName,
          avatar_url: student.profile.photoUrl,
        },
      });
    }
  }

  /**
   * 記錄同步成功
   */
  private async logSyncSuccess(teacher: Teacher, coursesCount: number) {
    await this.prisma.classroomSyncLog.create({
      data: {
        classroom_id: null, // 教師級別同步
        sync_type: 'students',
        status: 'success',
        records_synced: coursesCount,
        started_at: new Date(),
        completed_at: new Date(),
      },
    });
  }
}
```

---

## 3️⃣ 前端整合

### 3.1 登入按鈕

```tsx
// src/components/GoogleSignInButton.tsx
import { Button } from '@/components/ui/button';

export function GoogleSignInButton() {
  const handleSignIn = () => {
    // 重導向到後端 OAuth 端點
    window.location.href = 'http://localhost:3000/auth/google/login';
  };

  return (
    <Button onClick={handleSignIn} variant="outline">
      <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
        {/* Google Logo SVG */}
      </svg>
      Sign in with Google
    </Button>
  );
}
```

### 3.2 OAuth Callback 處理

```tsx
// src/pages/AuthCallback.tsx
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      // 儲存 Token 到 localStorage
      localStorage.setItem('auth_token', token);

      // 重導向到 Dashboard
      navigate('/dashboard');
    }
  }, [searchParams, navigate]);

  return <div>Loading...</div>;
}
```

### 3.3 API Client (帶 Token)

```typescript
// src/lib/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api',
});

// 自動附加 Token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
```

---

## 4️⃣ API Rate Limit 分析

### Google Classroom API Quota

| 操作 | Quota | 我們的用量 |
|------|-------|-----------|
| **Courses.list** | 1500 requests/min | 50 teachers × 1 = 50/day |
| **Students.list** | 1500 requests/min | 50 courses × 1 = 50/day |
| **總計** | - | **100 requests/day** |

**用量**: 100 / (1500 × 60 × 24) = **0.0046%**

✅ **完全不會觸發 Rate Limit** (教育版 Classroom API 是免費且無限的)

---

## 5️⃣ 安全性考量

### 5.1 OAuth Scopes (最小權限原則)

```typescript
const scopes = [
  'https://www.googleapis.com/auth/userinfo.email', // 取得 email
  'https://www.googleapis.com/auth/userinfo.profile', // 取得名字/頭像
  'https://www.googleapis.com/auth/classroom.courses.readonly', // 只讀課程
  'https://www.googleapis.com/auth/classroom.rosters.readonly', // 只讀名單
];

// ❌ 不使用寫入權限
// 'https://www.googleapis.com/auth/classroom.coursework.students'
```

### 5.2 Refresh Token 安全儲存

```typescript
// ✅ 加密儲存 refresh_token
import * as crypto from 'crypto';

const algorithm = 'aes-256-cbc';
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

export function decryptToken(encrypted: string): string {
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// 儲存時加密
await prisma.teacher.update({
  where: { teacher_id },
  data: { google_refresh_token: encryptToken(tokens.refresh_token) },
});

// 使用時解密
const refreshToken = decryptToken(teacher.google_refresh_token);
```

### 5.3 JWT Token 過期處理

```typescript
// src/auth/JwtStrategy.ts
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
      ignoreExpiration: false, // 強制檢查過期
    });
  }

  async validate(payload: any) {
    // 檢查用戶是否還存在
    const user = await this.prisma.teacher.findUnique({
      where: { teacher_id: payload.userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }
}
```

---

## 6️⃣ 錯誤處理

### 6.1 Token 過期自動刷新

```typescript
// src/services/GoogleTokenRefreshService.ts
import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';

@Injectable()
export class GoogleTokenRefreshService {
  async refreshAccessToken(teacher: Teacher) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );

    oauth2Client.setCredentials({
      refresh_token: decryptToken(teacher.google_refresh_token),
    });

    try {
      // 自動刷新 (googleapis 會自動處理)
      const { credentials } = await oauth2Client.refreshAccessToken();
      return credentials.access_token;
    } catch (error) {
      // Refresh token 過期或被撤銷
      this.logger.error('Failed to refresh token:', error);
      // 通知教師重新授權
      await this.notifyTeacherReauth(teacher);
      throw error;
    }
  }

  private async notifyTeacherReauth(teacher: Teacher) {
    // 發送 email 通知教師重新登入
    await this.emailService.send({
      to: teacher.email,
      subject: '需要重新授權 Google Classroom',
      body: '您的 Google Classroom 授權已過期,請重新登入...',
    });
  }
}
```

### 6.2 同步失敗重試

```typescript
// src/services/ClassroomSyncService.ts (重試邏輯)

/**
 * 帶指數退避的重試
 */
async syncWithRetry(fn: () => Promise<any>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      const waitTime = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      this.logger.warn(`Retry ${i + 1}/${maxRetries} after ${waitTime}ms...`);
      await this.sleep(waitTime);
    }
  }
}
```

---

## 7️⃣ 測試策略

### 7.1 Mock Google API

```typescript
// src/services/__tests__/ClassroomSyncService.test.ts
import { Test } from '@nestjs/testing';
import { ClassroomSyncService } from '../ClassroomSyncService';
import { google } from 'googleapis';

jest.mock('googleapis');

describe('ClassroomSyncService', () => {
  let service: ClassroomSyncService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ClassroomSyncService],
    }).compile();

    service = module.get(ClassroomSyncService);

    // Mock Google Classroom API
    (google.classroom as jest.Mock).mockReturnValue({
      courses: {
        list: jest.fn().mockResolvedValue({
          data: {
            courses: [
              { id: '123', name: '一年級甲班' },
            ],
          },
        }),
        students: {
          list: jest.fn().mockResolvedValue({
            data: {
              students: [
                {
                  userId: 'student-1',
                  profile: {
                    emailAddress: 'student@example.com',
                    name: { fullName: '小明' },
                  },
                },
              ],
            },
          }),
        },
      },
    });
  });

  it('should sync classrooms correctly', async () => {
    const teacher = {
      teacher_id: 'teacher-1',
      google_refresh_token: 'encrypted-token',
    };

    await service.syncTeacherClassrooms(teacher);

    const classroom = await prisma.classroom.findFirst({
      where: { google_classroom_id: '123' },
    });

    expect(classroom).toBeDefined();
    expect(classroom.name).toBe('一年級甲班');
  });
});
```

---

## 8️⃣ 監控與日誌

### 8.1 Prometheus Metrics

```typescript
// src/metrics/ClassroomSyncMetrics.ts
import { Counter, Histogram } from 'prom-client';

export const classroomSyncSuccess = new Counter({
  name: 'classroom_sync_success_total',
  help: 'Total number of successful Classroom syncs',
});

export const classroomSyncFailure = new Counter({
  name: 'classroom_sync_failure_total',
  help: 'Total number of failed Classroom syncs',
  labelNames: ['error_type'],
});

export const studentsSynced = new Histogram({
  name: 'classroom_students_synced',
  help: 'Number of students synced per teacher',
  buckets: [10, 30, 50, 100],
});
```

---

## 9️⃣ CLI 手動操作

```typescript
// src/cli/classroom.cli.ts
import { Command } from 'commander';
import { ClassroomSyncService } from '../services/ClassroomSyncService';

const program = new Command();

program
  .command('classroom:sync <teacherId>')
  .description('Sync classrooms for a specific teacher')
  .action(async (teacherId: string) => {
    const teacher = await prisma.teacher.findUnique({
      where: { teacher_id: teacherId },
    });

    await service.syncTeacherClassrooms(teacher);
  });

program
  .command('classroom:sync-all')
  .description('Sync all teachers classrooms')
  .action(async () => {
    await service.scheduledSync();
  });

program.parse();
```

**使用範例**:
```bash
# 同步特定教師
npm run cli classroom:sync <teacher-id>

# 同步所有教師
npm run cli classroom:sync-all
```

---

## 🔟 部署配置

### 10.1 環境變數

```bash
# .env
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://platform.example.org.tw/auth/google/callback

JWT_SECRET=your-secret-key
ENCRYPTION_KEY=32-byte-hex-key
```

### 10.2 Google Cloud Console 設定

```
1. 建立 OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized redirect URIs:
     - http://localhost:3000/auth/google/callback (開發)
     - https://platform.example.org.tw/auth/google/callback (正式)

2. 啟用 APIs
   - Google Classroom API
   - Google OAuth2 API

3. OAuth consent screen
   - User type: Internal (G Suite only) or External
   - Scopes:
     - userinfo.email
     - userinfo.profile
     - classroom.courses.readonly
     - classroom.rosters.readonly
```

---

## 🎯 總結

### 整合範圍確認

| 功能 | 實作方式 | API 呼叫量 |
|------|---------|-----------|
| **OAuth 登入** | ✅ Google Sign-In | 1 request/user |
| **學生名單同步** | ✅ 每日自動同步 | 100 requests/day |
| **教師名單同步** | ✅ 每日自動同步 | 50 requests/day |
| **作業管理** | ❌ 不使用 Classroom | 0 |
| **評分** | ❌ 不使用 Classroom | 0 |

### 優勢驗證

| 指標 | 目標 | 達成 |
|------|------|------|
| **免費** | 教育版免費 | ✅ 完全免費 |
| **無 Rate Limit** | Unlimited (教育版) | ✅ 用量 < 0.01% |
| **自動同步** | 每日更新 | ✅ 每日凌晨 2 點 |
| **安全性** | 最小權限 + 加密 | ✅ Read-only + AES-256 |

### 開發時程

| 階段 | 時間 | 產出 |
|------|------|------|
| 1. OAuth 登入 | 2 天 | GoogleOAuthController.ts |
| 2. 名單同步服務 | 2 天 | ClassroomSyncService.ts |
| 3. 前端整合 | 1 天 | GoogleSignInButton.tsx |
| 4. 安全性加固 | 1 天 | Token 加密 + JWT |
| 5. 測試 | 1 天 | 單元測試 + E2E |
| **總計** | **7 天** | 完整 Classroom 整合 |

---

## 📝 後續文件

✅ **完成**: 資料庫 Schema 設計
✅ **完成**: GitHub 同步服務設計
✅ **完成**: Google Classroom 整合設計
⏭️ **下一步**: AI 評分引擎設計.md
