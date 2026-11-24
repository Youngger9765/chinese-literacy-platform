/**
 * 班級分頁「學習批閱」（#4104）：全班名片 → 學生的課 → 批閱一課。
 *
 * 位置記在網址（?rs=學生&rl=課），重新整理或按瀏覽器上一頁都回得去。
 */
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import ReviewStudentGrid from './ReviewStudentGrid';
import ReviewLessonList from './ReviewLessonList';
import ReviewWorkspace from './ReviewWorkspace';

export const REVIEW_PARAMS = ['rs', 'rn', 'rl'] as const;

const LessonReviewTab: React.FC<{ classroomId: number }> = ({ classroomId }) => {
  const [params, setParams] = useSearchParams();
  const studentId = Number(params.get('rs')) || null;
  const studentName = params.get('rn') ?? '';
  const lesson = params.get('rl');

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  };
  const toClass = () => go({ rs: null, rn: null, rl: null });
  const toStudent = () => go({ rl: null });

  if (studentId && lesson) {
    return (
      <ReviewWorkspace
        classroomId={classroomId}
        studentId={studentId}
        storySlug={lesson}
        onBackToClass={toClass}
        onBackToStudent={toStudent}
      />
    );
  }
  if (studentId) {
    return (
      <ReviewLessonList
        classroomId={classroomId}
        studentId={studentId}
        studentName={studentName || '學生'}
        onBack={toClass}
        onOpen={(r) => go({ rl: r.story_slug })}
      />
    );
  }
  return (
    <ReviewStudentGrid
      classroomId={classroomId}
      onOpen={(s) => go({ rs: String(s.student_id), rn: s.name, rl: null })}
    />
  );
};

export default LessonReviewTab;
