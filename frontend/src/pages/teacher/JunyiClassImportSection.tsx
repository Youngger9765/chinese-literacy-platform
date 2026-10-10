/**
 * JunyiClassImportSection — issue #3380.
 *
 * Lives inside the teacher's "建立班級" dialog as the "匯入均一班級學生" option.
 * Lets a teacher import their Junyi classes + students on demand (no nightly
 * sync, no new DB table — see issue #3380 for the full architecture).
 *
 * Three render states:
 * 1. Feature flag off (API 404)      -> renders null (nothing at all).
 * 2. Teacher not linked to Junyi SSO -> explanatory text, no checkboxes.
 * 3. Teacher linked, classes returned -> checkboxes; already-imported ones are
 *    disabled + labelled "已匯入"; select + import shows the result stats;
 *    a T+1 freshness note is always shown.
 */
import React, { useEffect, useState } from 'react';
import {
  listJunyiImportableClasses,
  importJunyiClasses,
  ClassroomApiError,
  JunyiImportableClass,
  JunyiImportResult,
} from '../../services/classroomApi';

interface JunyiClassImportSectionProps {
  token: string;
  schoolId: number;
  onImported: () => void;
}

const JunyiClassImportSection: React.FC<JunyiClassImportSectionProps> = ({
  token,
  schoolId,
  onImported,
}) => {
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false); // feature flag off (404)
  const [linked, setLinked] = useState(false);
  const [classes, setClasses] = useState<JunyiImportableClass[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<JunyiImportResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listJunyiImportableClasses(token, schoolId);
        if (cancelled) return;
        setLinked(res.linked);
        setClasses(res.classes);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ClassroomApiError && err.status === 404) {
          // Feature flag off — hide the whole section with no error flash.
          setHidden(true);
        } else {
          setError(err instanceof Error ? err.message : '無法載入均一班級');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, schoolId]);

  const toggle = (classId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  };

  const handleImport = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0 || importing) return;
    setImporting(true);
    setError('');
    try {
      const res = await importJunyiClasses(token, schoolId, ids);
      setResult(res);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : '匯入失敗');
    } finally {
      setImporting(false);
    }
  };

  if (hidden) return null;

  if (loading) {
    return <p className="text-sm text-gray-500">載入中...</p>;
  }

  if (!linked) {
    return (
      <p className="text-sm text-gray-600">
        請先使用均一帳號登入過 LingoLeap，才能匯入均一班級學生
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        均一今天新建的班，明天才查得到
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <ul className="space-y-2">
        {classes.map((cls) => (
          <li
            key={cls.junyi_class_id}
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <label className="flex items-center gap-2 flex-1 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent"
                disabled={cls.already_imported}
                checked={selected.has(cls.junyi_class_id)}
                onChange={() => toggle(cls.junyi_class_id)}
              />
              <span className="text-gray-900">{cls.class_name}</span>
              <span className="text-xs text-gray-400">（{cls.student_count} 位）</span>
            </label>
            {cls.already_imported && (
              <span className="text-xs text-gray-500 shrink-0">已匯入</span>
            )}
          </li>
        ))}
      </ul>

      {result && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-3 py-2">
          新增 {result.added_students} 位、已存在略過 {result.skipped_existing_students} 位
        </div>
      )}

      <button
        type="button"
        onClick={handleImport}
        disabled={selected.size === 0 || importing}
        className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors"
      >
        {importing ? '匯入中...' : '匯入'}
      </button>
    </div>
  );
};

export default JunyiClassImportSection;
