/**
 * DevLessonPage — local demo harness for AI-extracted lesson_content.
 *
 * Route: /dev/lesson/:code  (public, lazy, NO auth guard, NO API/DB call).
 *
 * It loads AI-produced lesson fixtures from `src/dev/fixtures/*.lesson.json`
 * (the exact snake_case bytes a lesson.yml exports), runs them through the SAME
 * `camelizeKeys` + `LessonSchema` path api.ts uses on the wire, and mounts the
 * unified <LessonRenderer/>. This proves the vision end-to-end WITHOUT touching
 * the #2205 runtime pipeline, staging, prod data, or the DB.
 *
 * Fixtures are discovered via import.meta.glob so adding a new
 * `{CODE}.lesson.json` needs no code change here (and a missing dir won't break).
 */
import React from 'react';
import { useParams, Link } from 'react-router-dom';

import { camelizeKeys } from '../../schema/camelize';
import { LessonSchema, type Lesson } from '../../schema/lessonContent';
import LessonRenderer from '../../components/lesson-content/LessonRenderer';

// Eagerly bundle every AI-extracted demo fixture. Keys look like
// '../../dev/fixtures/G4-L04.lesson.json'. If the dir is empty the map is empty.
const FIXTURE_MODULES = import.meta.glob('../../dev/fixtures/*.lesson.json', {
  eager: true,
}) as Record<string, { default: unknown }>;

/** code (e.g. 'G4-L04') → raw snake_case backend-shaped object. */
const RAW_BY_CODE: Record<string, unknown> = Object.fromEntries(
  Object.entries(FIXTURE_MODULES).map(([path, mod]) => {
    const file = path.split('/').pop() ?? '';
    const code = file.replace(/\.lesson\.json$/, '');
    return [code, mod.default];
  }),
);

const AVAILABLE_CODES = Object.keys(RAW_BY_CODE).sort();

/** The exact api.ts transform: snake_case backend dict → typed Lesson (or an error). */
function parseLesson(raw: unknown): { lesson?: Lesson; error?: string } {
  const res = LessonSchema.safeParse(camelizeKeys(raw));
  if (!res.success) {
    return { error: JSON.stringify(res.error.issues, null, 2) };
  }
  return { lesson: res.data };
}

const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
    <div
      style={{
        marginBottom: 16,
        padding: '8px 12px',
        borderRadius: 8,
        background: '#eef2ff',
        color: '#3730a3',
        fontSize: 14,
      }}
    >
      🧪 <strong>AI-extracted lesson demo</strong> — 由 AI 直接讀原始學習單產出、經契約驗證的
      lesson_content。本頁純前端、不打 API、不動線上資料。
    </div>
    {children}
  </div>
);

const Menu: React.FC = () => (
  <Frame>
    <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Demo 課文</h1>
    {AVAILABLE_CODES.length === 0 ? (
      <p style={{ color: '#6b7280' }}>
        尚無 demo fixture。請把 AI 產出的 <code>{'{CODE}.lesson.json'}</code> 放到{' '}
        <code>frontend/src/dev/fixtures/</code>。
      </p>
    ) : (
      <ul style={{ lineHeight: 2 }}>
        {AVAILABLE_CODES.map((code) => (
          <li key={code}>
            <Link to={`/dev/lesson/${code}`} style={{ color: '#4f46e5', fontWeight: 600 }}>
              {code}
            </Link>
          </li>
        ))}
      </ul>
    )}
  </Frame>
);

const DevLessonPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();

  if (!code) return <Menu />;

  const raw = RAW_BY_CODE[code];
  if (raw === undefined) {
    return (
      <Frame>
        <p style={{ color: '#b91c1c' }}>
          找不到 demo fixture:<code>{code}</code>
        </p>
        <p>
          <Link to="/dev/lesson" style={{ color: '#4f46e5' }}>
            ← 回 demo 清單
          </Link>
        </p>
      </Frame>
    );
  }

  const { lesson, error } = parseLesson(raw);
  if (error || !lesson) {
    return (
      <Frame>
        <p style={{ color: '#b91c1c', fontWeight: 600 }}>
          {code} 未通過 LessonSchema(契約)驗證:
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#7f1d1d' }}>{error}</pre>
      </Frame>
    );
  }

  return (
    <Frame>
      <div style={{ marginBottom: 8, fontSize: 13, color: '#6b7280' }}>
        <Link to="/dev/lesson" style={{ color: '#4f46e5' }}>
          ← demo 清單
        </Link>
        {'　'}
        <span>
          {lesson.lessonCode}
          {lesson.title ? `　${lesson.title}` : ''}
        </span>
      </div>
      <LessonRenderer lesson={lesson} lessonCode={lesson.lessonCode} />
    </Frame>
  );
};

export default DevLessonPage;
