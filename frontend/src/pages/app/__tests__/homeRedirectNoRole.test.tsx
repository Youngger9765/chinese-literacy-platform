/**
 * 沒有角色的人也要落到學生首頁，不能是白畫面（#1198 均一九宮格）。
 *
 * ## 為什麼會有「沒有角色」的人
 *
 * `sso_login_service.resolve_junyi_user` 建新 User 時**不指派任何角色**，
 * 而 `/api/auth/me` 的 roles 純粹從 `user_roles` 表撈、沒有任何 fallback。
 * 所以第一次從均一九宮格點進來的人，`user.roles` 就是 `[]`。
 *
 * `HomePage` 原本寫 `if (roles.length === 0) return null` —— 那一行的本意是
 * 「等 roles 灌好再轉，避免閃到錯的頁」，但對**真的沒有角色**的人來說
 * 它永遠不會結束：使用者看到一片空白，而且不會有任何錯誤訊息。
 *
 * 均一主站的九宮格按鈕一上線，第一批點進來的就是這種人。
 *
 * ## 為什麼是導向層而不是後端補角色
 *
 * 學生端三個主要路由檔（learning / gamification / stories）**一個 role gate 都沒有**，
 * `ProtectedRoute` 也只看有沒有登入。也就是說沒有角色的人本來就用得了學生功能 ——
 * 缺的只是「該把他送到哪一頁」。在後端補一筆 student 角色會**多給實際權限**，
 * 那是比這個 bug 更大的改動；這裡只改導向，不動權限。
 *
 * Owner 2026-09-01：「空白 role 就是給學生」。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const authState: { user: unknown; isAuthenticated: boolean; isLoading: boolean } = {
  user: null, isAuthenticated: true, isLoading: false,
};
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

import { HomePage } from '../InlinePages';

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/student" element={<div>STUDENT_HOME</div>} />
        <Route path="/teacher-home" element={<div>TEACHER_HOME</div>} />
        <Route path="/admin" element={<div>ADMIN_HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authState.isAuthenticated = true;
  authState.isLoading = false;
});

describe('#1198 空白 role 視為學生', () => {
  it('roles 是空陣列時導到學生首頁，不是白畫面', () => {
    authState.user = { roles: [] };
    renderHome();
    expect(screen.getByText('STUDENT_HOME')).toBeTruthy();
  });

  it('roles 欄位不存在時也一樣', () => {
    authState.user = {};
    renderHome();
    expect(screen.getByText('STUDENT_HOME')).toBeTruthy();
  });

  // ⭐ 負向對照。少了這三條，上面兩條可以靠「一律導學生」通過 ——
  //    那會把老師和管理員也送進學生首頁。
  it('老師還是去老師首頁', () => {
    authState.user = { roles: [{ role_name: 'teacher' }] };
    renderHome();
    expect(screen.getByText('TEACHER_HOME')).toBeTruthy();
  });

  it('管理員還是去管理後台', () => {
    authState.user = { roles: [{ role_name: 'org_admin' }] };
    renderHome();
    expect(screen.getByText('ADMIN_HOME')).toBeTruthy();
  });

  it('還在載入 auth 時不導向（避免閃到錯的頁）', () => {
    authState.isLoading = true;
    authState.user = { roles: [] };
    const { container } = renderHome();
    expect(container.textContent).toBe('');
  });
});
