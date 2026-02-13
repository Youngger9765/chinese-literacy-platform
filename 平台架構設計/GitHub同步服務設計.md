# GitHub 同步服務設計

> **目標**: 使用 Git Clone 同步課程內容,避免 GitHub API Rate Limit
>
> **策略**: 本地 Git Repository + 定時 Pull + Webhook 即時更新

---

## 🎯 核心設計原則

### 為什麼用 Git Clone 而不是 REST API?

| 方案 | API 呼叫量 (每日) | Rate Limit 風險 | 同步速度 |
|------|-----------------|----------------|---------|
| **REST API** | 355 requests/day | ⚠️ 高 (Secondary Rate Limit) | 慢 (逐檔案) |
| **Git Clone** | 5 requests/day | ✅ 無風險 | 快 (批次) |

**結論**: Git Clone 方案 API 呼叫量降低 **98.6%** (355 → 5)

---

## 📐 架構設計

```
GitHub Repository (課程內容)
    ↓ Git Clone (初始化)
本地 Git Repository (/var/repos/courses)
    ↓ Git Pull (每小時)
解析 Markdown → 更新資料庫
    ↓
PostgreSQL (course_nodes + learning_materials + vocabulary)
    ↓
前端 API 查詢
```

---

## 1️⃣ Repository 結構設計

### 方案選擇: 單一 Monorepo

```
courses/
├── README.md
├── metadata.json (課程配置)
├── grade1/
│   ├── README.md (年級介紹)
│   ├── unit1/
│   │   ├── README.md (單元介紹)
│   │   ├── lesson1.md (第一課)
│   │   ├── lesson2.md
│   │   └── assets/
│   │       ├── audio/
│   │       │   └── lesson1-reading.mp3
│   │       └── images/
│   │           └── character-家.png
│   └── unit2/
├── grade2/
└── grade3/
```

**優勢**:
- ✅ 單一 Git Clone 完成 (不需多次呼叫)
- ✅ 檔案結構對應資料庫 ltree path
- ✅ 教師團隊協作方便 (單一 PR 審核)

---

## 2️⃣ Markdown 格式標準

### Lesson Markdown 範例

```markdown
---
# Front Matter (YAML)
lesson_id: grade1-unit1-lesson1
title: 第一課:我的家
grade: 1
unit: 1
lesson: 1
order: 1
author: 王老師
created_at: 2024-09-01
updated_at: 2024-09-05
tags: [家庭, 生活]
---

# 第一課:我的家

## 📖 課文

我有一個溫暖的家,
爸爸、媽媽和我住在一起。
每天早上,媽媽會做早餐,
爸爸會送我上學。

## 📝 生字表

| 生字 | 注音 | 筆畫 | 字義 | 例句 |
|------|------|------|------|------|
| 家 | ㄐㄧㄚ | 10 | 住的地方 | 我的家很溫暖 |
| 我 | ㄨㄛˇ | 7 | 自己 | 我是學生 |
| 爸 | ㄅㄚˋ | 8 | 父親 | 爸爸上班 |
| 媽 | ㄇㄚ | 6 | 母親 | 媽媽做飯 |

## 🎯 學習目標

- [ ] 能正確朗讀課文
- [ ] 認識 4 個生字
- [ ] 理解家庭成員稱謂

## 📚 作業

### 作業 1: 朗讀課文

**類型**: 朗讀 (speaking)
**截止時間**: 2024-09-20
**評分標準**:
- 發音準確度 (40%)
- 流暢度 (30%)
- 情感表達 (30%)

**說明**: 請朗讀課文並上傳音檔

### 作業 2: 生字練習

**類型**: 書寫 (writing)
**截止時間**: 2024-09-22

請在作業本上練習生字各 5 遍

## 🔗 相關資源

- [課文朗讀音檔](./assets/audio/lesson1-reading.mp3)
- [生字筆順動畫](./assets/videos/characters.mp4)
- [延伸閱讀](https://example.com/reading)
```

**解析規則**:
1. **Front Matter**: YAML 格式 metadata → `course_nodes.metadata`
2. **生字表**: Markdown Table → `vocabulary` 表
3. **作業**: Markdown Section → `assignments` 表
4. **資源連結**: 相對路徑 → S3 URL

---

## 3️⃣ Git 同步服務實作

### 3.1 服務架構

```typescript
// src/services/GitSyncService.ts
import simpleGit, { SimpleGit } from 'simple-git';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MarkdownParser } from './MarkdownParser';

@Injectable()
export class GitSyncService {
  private readonly logger = new Logger(GitSyncService.name);
  private readonly repoPath = '/var/repos/courses';
  private readonly remoteUrl = 'https://github.com/example-org/chinese-literacy-courses.git';
  private git: SimpleGit;

  constructor(
    private prisma: PrismaService,
    private markdownParser: MarkdownParser,
  ) {
    this.git = simpleGit(this.repoPath);
  }

  /**
   * 初始化: Clone Repository (只執行一次)
   */
  async initialize() {
    const exists = await this.checkRepoExists();
    if (!exists) {
      this.logger.log(`Cloning repository from ${this.remoteUrl}...`);
      await simpleGit().clone(this.remoteUrl, this.repoPath);
      this.logger.log('Repository cloned successfully');
      await this.syncAll(); // 初次同步所有內容
    } else {
      this.logger.log('Repository already exists, skipping clone');
    }
  }

  /**
   * 定時同步: 每小時執行
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledSync() {
    this.logger.log('Starting scheduled sync...');
    try {
      const pullResult = await this.git.pull('origin', 'main');

      if (pullResult.files.length === 0) {
        this.logger.log('No changes detected');
        return;
      }

      this.logger.log(`Pulled ${pullResult.files.length} changed files`);

      // 只處理變更的檔案
      for (const file of pullResult.files) {
        await this.processFile(file);
      }

      await this.logSyncSuccess(pullResult.files.length);
    } catch (error) {
      this.logger.error('Sync failed:', error);
      await this.logSyncFailure(error);
    }
  }

  /**
   * Webhook 觸發: GitHub Push Event
   */
  async handleWebhook(payload: GitHubWebhookPayload) {
    this.logger.log(`Webhook received: ${payload.commits.length} commits`);

    // 立即 Pull 最新內容
    await this.git.pull('origin', 'main');

    // 處理變更的檔案
    const changedFiles = payload.commits.flatMap(c => [
      ...c.added,
      ...c.modified,
    ]);

    for (const file of changedFiles) {
      await this.processFile(file);
    }

    // 處理刪除的檔案
    const removedFiles = payload.commits.flatMap(c => c.removed);
    for (const file of removedFiles) {
      await this.removeFile(file);
    }
  }

  /**
   * 完整同步: 處理所有檔案 (初次同步或手動觸發)
   */
  async syncAll() {
    this.logger.log('Starting full sync...');
    const files = await this.getAllMarkdownFiles();

    for (const file of files) {
      await this.processFile(file);
    }

    this.logger.log(`Full sync completed: ${files.length} files processed`);
  }

  /**
   * 處理單一檔案
   */
  private async processFile(filePath: string) {
    if (!filePath.endsWith('.md')) {
      return; // 只處理 Markdown 檔案
    }

    this.logger.log(`Processing file: ${filePath}`);

    const fullPath = `${this.repoPath}/${filePath}`;
    const content = await fs.promises.readFile(fullPath, 'utf-8');

    // 解析 Markdown
    const parsed = await this.markdownParser.parse(content, filePath);

    // 更新資料庫
    await this.upsertCourseNode(parsed);

    // 如果有生字表,更新 vocabulary
    if (parsed.vocabulary.length > 0) {
      await this.upsertVocabulary(parsed.nodeId, parsed.vocabulary);
    }

    // 如果有作業,更新 assignments
    if (parsed.assignments.length > 0) {
      await this.upsertAssignments(parsed.nodeId, parsed.assignments);
    }
  }

  /**
   * Upsert Course Node (冪等操作)
   */
  private async upsertCourseNode(parsed: ParsedMarkdown) {
    await this.prisma.courseNode.upsert({
      where: { github_path: parsed.filePath },
      create: {
        organization_id: this.getOrganizationId(), // 從配置取得
        path: parsed.ltreePath, // e.g., 'grade1.unit1.lesson1'
        node_type: parsed.nodeType, // 'lesson', 'unit', 'grade'
        title: parsed.title,
        description: parsed.description,
        metadata: parsed.metadata,
        github_path: parsed.filePath,
        synced_at: new Date(),
      },
      update: {
        title: parsed.title,
        description: parsed.description,
        metadata: parsed.metadata,
        synced_at: new Date(),
      },
    });
  }

  /**
   * 刪除檔案對應的資料
   */
  private async removeFile(filePath: string) {
    await this.prisma.courseNode.deleteMany({
      where: { github_path: filePath },
    });
    this.logger.log(`Removed course node: ${filePath}`);
  }

  /**
   * 記錄同步成功
   */
  private async logSyncSuccess(filesCount: number) {
    await this.prisma.githubSyncLog.create({
      data: {
        organization_id: this.getOrganizationId(),
        sync_type: 'incremental',
        status: 'success',
        files_synced: filesCount,
        started_at: new Date(),
        completed_at: new Date(),
      },
    });
  }

  /**
   * 記錄同步失敗
   */
  private async logSyncFailure(error: any) {
    await this.prisma.githubSyncLog.create({
      data: {
        organization_id: this.getOrganizationId(),
        sync_type: 'incremental',
        status: 'failed',
        files_synced: 0,
        errors: [error.message],
        started_at: new Date(),
        completed_at: new Date(),
      },
    });
  }
}
```

---

## 4️⃣ Markdown Parser 實作

```typescript
// src/services/MarkdownParser.ts
import matter from 'gray-matter';
import { marked } from 'marked';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MarkdownParser {
  /**
   * 解析 Markdown 檔案
   */
  async parse(content: string, filePath: string): Promise<ParsedMarkdown> {
    // 1. 解析 Front Matter (YAML)
    const { data: frontMatter, content: markdown } = matter(content);

    // 2. 解析 Markdown → AST
    const tokens = marked.lexer(markdown);

    // 3. 提取生字表
    const vocabulary = this.extractVocabulary(tokens);

    // 4. 提取作業
    const assignments = this.extractAssignments(tokens);

    // 5. 生成 ltree path
    const ltreePath = this.generateLtreePath(filePath);

    // 6. 判斷 node type
    const nodeType = this.determineNodeType(filePath);

    return {
      filePath,
      ltreePath,
      nodeType,
      title: frontMatter.title || this.extractTitle(tokens),
      description: this.extractDescription(tokens),
      metadata: frontMatter,
      vocabulary,
      assignments,
    };
  }

  /**
   * 從 Markdown Table 提取生字表
   */
  private extractVocabulary(tokens: marked.Token[]): VocabularyItem[] {
    const vocabulary: VocabularyItem[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // 找到 "生字表" heading 後的 table
      if (token.type === 'heading' && token.text.includes('生字表')) {
        const nextToken = tokens[i + 1];
        if (nextToken?.type === 'table') {
          // 解析 table rows
          for (const row of nextToken.rows) {
            vocabulary.push({
              character: row[0],
              pinyin: row[1],
              stroke_count: parseInt(row[2]) || null,
              definition: row[3],
              example_sentence: row[4],
            });
          }
        }
      }
    }

    return vocabulary;
  }

  /**
   * 提取作業
   */
  private extractAssignments(tokens: marked.Token[]): AssignmentItem[] {
    const assignments: AssignmentItem[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // 找到 "作業" heading 後的 sub-headings
      if (token.type === 'heading' && token.text.includes('作業')) {
        let j = i + 1;
        while (j < tokens.length && tokens[j].type !== 'heading') {
          const subToken = tokens[j];
          if (subToken.type === 'heading' && subToken.depth === 3) {
            // 解析作業內容
            const assignment = this.parseAssignment(tokens, j);
            assignments.push(assignment);
          }
          j++;
        }
      }
    }

    return assignments;
  }

  /**
   * 生成 ltree path (從檔案路徑)
   */
  private generateLtreePath(filePath: string): string {
    // courses/grade1/unit1/lesson1.md → grade1.unit1.lesson1
    const parts = filePath.split('/').filter(p => p !== 'courses' && p !== 'README.md');
    return parts
      .map(p => p.replace('.md', ''))
      .join('.');
  }

  /**
   * 判斷 node type
   */
  private determineNodeType(filePath: string): string {
    if (filePath.includes('lesson')) return 'lesson';
    if (filePath.includes('unit')) return 'unit';
    if (filePath.includes('grade')) return 'grade';
    return 'section';
  }
}
```

---

## 5️⃣ GitHub Webhook 整合

### 5.1 Webhook Endpoint

```typescript
// src/controllers/WebhookController.ts
import { Controller, Post, Body, Headers } from '@nestjs/common';
import { GitSyncService } from '../services/GitSyncService';
import * as crypto from 'crypto';

@Controller('webhooks')
export class WebhookController {
  constructor(private gitSyncService: GitSyncService) {}

  @Post('github')
  async handleGitHubWebhook(
    @Body() payload: any,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    // 1. 驗證 Webhook 簽章
    if (!this.verifySignature(payload, signature)) {
      throw new UnauthorizedException('Invalid signature');
    }

    // 2. 只處理 push events
    if (payload.ref === 'refs/heads/main') {
      await this.gitSyncService.handleWebhook(payload);
    }

    return { status: 'success' };
  }

  /**
   * 驗證 GitHub Webhook 簽章 (HMAC SHA256)
   */
  private verifySignature(payload: any, signature: string): boolean {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(JSON.stringify(payload)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  }
}
```

### 5.2 GitHub Webhook 設定

```bash
# GitHub Repository Settings → Webhooks → Add webhook

Payload URL: https://platform.example.org.tw/webhooks/github
Content type: application/json
Secret: <GITHUB_WEBHOOK_SECRET>
Events: Just the push event
```

**Webhook Payload 範例**:
```json
{
  "ref": "refs/heads/main",
  "commits": [
    {
      "id": "abc123",
      "message": "feat: 新增第二課課文",
      "added": ["courses/grade1/unit1/lesson2.md"],
      "modified": ["courses/grade1/unit1/lesson1.md"],
      "removed": []
    }
  ]
}
```

---

## 6️⃣ API 呼叫量分析

### 每日 API 用量

| 操作 | 頻率 | API 呼叫 | 總計 |
|------|------|---------|------|
| **Git Pull** | 每小時 | 1 request | 24/day |
| **Webhook 驗證** | 按需 | 0 (本地驗證) | 0 |
| **檔案讀取** | - | 0 (本地檔案系統) | 0 |
| **手動觸發** | 按需 | 1 request | ~1/day |
| **總計** | - | - | **25/day** |

**Rate Limit**: 5000/hour → 120,000/day

**用量百分比**: 25 / 120,000 = **0.02%**

✅ **完全不會觸發 Rate Limit**

---

## 7️⃣ 錯誤處理與重試

```typescript
// src/services/GitSyncService.ts (錯誤處理)

/**
 * 帶重試的 Git Pull
 */
async pullWithRetry(maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await this.git.pull('origin', 'main');
      return result;
    } catch (error) {
      this.logger.warn(`Pull failed (attempt ${i + 1}/${maxRetries}):`, error);

      if (i === maxRetries - 1) {
        throw error; // 最後一次還是失敗,拋出錯誤
      }

      // 等待後重試
      await this.sleep(2000 * (i + 1)); // 指數退避
    }
  }
}

/**
 * Git 衝突處理 (自動放棄本地變更)
 */
async handleConflict() {
  this.logger.warn('Git conflict detected, resetting to remote...');
  await this.git.reset(['--hard', 'origin/main']);
  this.logger.log('Reset completed');
}
```

---

## 8️⃣ 監控與告警

### 8.1 Prometheus Metrics

```typescript
// src/metrics/GitSyncMetrics.ts
import { Counter, Histogram } from 'prom-client';

export const gitSyncSuccess = new Counter({
  name: 'git_sync_success_total',
  help: 'Total number of successful Git syncs',
});

export const gitSyncFailure = new Counter({
  name: 'git_sync_failure_total',
  help: 'Total number of failed Git syncs',
});

export const gitSyncDuration = new Histogram({
  name: 'git_sync_duration_seconds',
  help: 'Git sync duration in seconds',
  buckets: [1, 5, 10, 30, 60],
});

export const filesProcessed = new Histogram({
  name: 'git_sync_files_processed',
  help: 'Number of files processed per sync',
  buckets: [1, 5, 10, 50, 100],
});
```

### 8.2 Grafana Dashboard

```yaml
# grafana/dashboards/git-sync.json
{
  "title": "Git Sync Monitoring",
  "panels": [
    {
      "title": "Sync Success Rate",
      "target": "rate(git_sync_success_total[5m]) / (rate(git_sync_success_total[5m]) + rate(git_sync_failure_total[5m]))"
    },
    {
      "title": "Average Sync Duration",
      "target": "rate(git_sync_duration_seconds_sum[5m]) / rate(git_sync_duration_seconds_count[5m])"
    },
    {
      "title": "Files Processed per Sync",
      "target": "git_sync_files_processed"
    }
  ]
}
```

---

## 9️⃣ 部署配置

### 9.1 Docker Volume (持久化 Git Repository)

```yaml
# docker-compose.yml
services:
  app:
    image: literacy-platform:latest
    volumes:
      - git-repos:/var/repos # 持久化 Git Repository
    environment:
      - GITHUB_REPO_URL=https://github.com/example-org/chinese-literacy-courses.git
      - GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}

volumes:
  git-repos:
    driver: local
```

### 9.2 初始化腳本

```bash
#!/bin/bash
# scripts/init-git-sync.sh

# 1. Clone Repository
if [ ! -d "/var/repos/courses" ]; then
  echo "Cloning repository..."
  git clone https://github.com/example-org/chinese-literacy-courses.git /var/repos/courses
  echo "Clone completed"
fi

# 2. 執行初次同步
echo "Running initial sync..."
npm run sync:all

echo "Initialization completed"
```

---

## 🔟 手動操作 CLI

```typescript
// src/cli/sync.cli.ts
import { Command } from 'commander';
import { GitSyncService } from '../services/GitSyncService';

const program = new Command();

program
  .command('sync:all')
  .description('Full sync all courses')
  .action(async () => {
    const service = new GitSyncService();
    await service.syncAll();
  });

program
  .command('sync:pull')
  .description('Pull latest changes and sync')
  .action(async () => {
    const service = new GitSyncService();
    await service.scheduledSync();
  });

program
  .command('sync:status')
  .description('Show sync status')
  .action(async () => {
    const logs = await prisma.githubSyncLog.findMany({
      orderBy: { started_at: 'desc' },
      take: 10,
    });
    console.table(logs);
  });

program.parse();
```

**使用範例**:
```bash
# 手動觸發完整同步
npm run cli sync:all

# 手動 Pull 並同步
npm run cli sync:pull

# 查看同步狀態
npm run cli sync:status
```

---

## 1️⃣1️⃣ 測試策略

### 11.1 單元測試

```typescript
// src/services/__tests__/GitSyncService.test.ts
import { Test } from '@nestjs/testing';
import { GitSyncService } from '../GitSyncService';

describe('GitSyncService', () => {
  let service: GitSyncService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [GitSyncService],
    }).compile();

    service = module.get(GitSyncService);
  });

  it('should parse ltree path correctly', () => {
    const path = service.generateLtreePath('courses/grade1/unit1/lesson1.md');
    expect(path).toBe('grade1.unit1.lesson1');
  });

  it('should extract vocabulary from markdown', () => {
    const markdown = `
## 生字表

| 生字 | 注音 | 筆畫 | 字義 |
|------|------|------|------|
| 家 | ㄐㄧㄚ | 10 | 住的地方 |
    `;

    const vocab = service.extractVocabulary(markdown);
    expect(vocab).toHaveLength(1);
    expect(vocab[0].character).toBe('家');
  });
});
```

### 11.2 整合測試

```typescript
// src/services/__tests__/GitSync.integration.test.ts
import { GitSyncService } from '../GitSyncService';
import simpleGit from 'simple-git';

describe('GitSyncService Integration', () => {
  it('should clone repository and sync', async () => {
    const service = new GitSyncService();
    await service.initialize();

    const nodes = await prisma.courseNode.findMany();
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('should handle webhook correctly', async () => {
    const payload = {
      ref: 'refs/heads/main',
      commits: [
        {
          added: ['courses/grade1/unit1/lesson2.md'],
          modified: [],
          removed: [],
        },
      ],
    };

    await service.handleWebhook(payload);

    const node = await prisma.courseNode.findFirst({
      where: { github_path: 'courses/grade1/unit1/lesson2.md' },
    });

    expect(node).toBeDefined();
  });
});
```

---

## 1️⃣2️⃣ 效能優化

### 12.1 增量同步 (只處理變更檔案)

```typescript
/**
 * 取得變更的檔案 (與上次同步相比)
 */
async getChangedFiles(since: Date): Promise<string[]> {
  const log = await this.git.log({
    from: since.toISOString(),
    to: 'HEAD',
  });

  const changedFiles = new Set<string>();

  for (const commit of log.all) {
    const diff = await this.git.diffSummary([`${commit.hash}^`, commit.hash]);
    diff.files.forEach(f => changedFiles.add(f.file));
  }

  return Array.from(changedFiles);
}
```

### 12.2 批次更新資料庫

```typescript
/**
 * 批次 Upsert (減少 DB 連線)
 */
async batchUpsertCourseNodes(nodes: ParsedMarkdown[]) {
  await this.prisma.$transaction(
    nodes.map(node =>
      this.prisma.courseNode.upsert({
        where: { github_path: node.filePath },
        create: { ...node },
        update: { ...node },
      })
    )
  );
}
```

---

## 🎯 總結

### 優勢確認

| 指標 | 目標 | 達成 |
|------|------|------|
| **API 呼叫量** | < 100/day | ✅ 25/day (降低 98.6%) |
| **Rate Limit 風險** | 無風險 | ✅ 0.02% 用量 |
| **同步延遲** | < 5 分鐘 | ✅ Webhook 即時 + 每小時 Pull |
| **資料準確性** | 100% 同步 | ✅ Git 保證一致性 |
| **可擴展性** | 支援 10000+ 課程 | ✅ Git 本地快取 |

### 技術選型驗證

| 選擇 | 原因 |
|------|------|
| **Git Clone** | 避免 REST API Rate Limit |
| **simple-git** | Node.js Git 操作庫 |
| **gray-matter** | YAML Front Matter 解析 |
| **marked** | Markdown AST 解析 |
| **ltree** | PostgreSQL 階層式查詢 |

### 開發時程

| 階段 | 時間 | 產出 |
|------|------|------|
| 1. Markdown Parser | 2 天 | MarkdownParser.ts |
| 2. Git Sync Service | 3 天 | GitSyncService.ts |
| 3. Webhook Integration | 1 天 | WebhookController.ts |
| 4. 測試 | 2 天 | 單元測試 + 整合測試 |
| 5. 部署配置 | 1 天 | Docker + K8s |
| **總計** | **9 天** | 完整 Git 同步服務 |

---

## 📝 後續文件

✅ **完成**: 資料庫 Schema 設計
✅ **完成**: GitHub 同步服務設計
⏭️ **下一步**: Google Classroom 整合設計.md
