import React, { useRef, useState } from 'react';
import {
  downloadCsvTemplate,
  uploadCsvStudents,
  type CsvUploadResult,
} from '../../services/classroomApi';

interface CsvUploadModalProps {
  token: string;
  classroomId: number;
  onClose: () => void;
  onSuccess: () => void;
}

type UploadPhase = 'select' | 'preview' | 'result';

interface ParsedRow {
  name: string;
  seat_number: string;
}

const MAX_PREVIEW_ROWS = 5;

function parseCsvPreview(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  // Detect header
  const firstLower = lines[0].toLowerCase();
  const hasHeader = firstLower.includes('name') || firstLower.includes('姓名') || firstLower.includes('seat');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.slice(0, MAX_PREVIEW_ROWS).map((line) => {
    const parts = line.split(',');
    return {
      name: (parts[0] ?? '').trim(),
      seat_number: (parts[1] ?? '').trim(),
    };
  });
}

const CsvUploadModal: React.FC<CsvUploadModalProps> = ({
  token,
  classroomId,
  onClose,
  onSuccess,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>('select');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<ParsedRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<CsvUploadResult | null>(null);
  const [error, setError] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setSelectedFile(file);

    // Parse preview
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const preview = parseCsvPreview(text);
      // Count total data rows
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const firstLower = lines[0]?.toLowerCase() ?? '';
      const hasHeader = firstLower.includes('name') || firstLower.includes('姓名') || firstLower.includes('seat');
      setTotalRows(hasHeader ? lines.length - 1 : lines.length);
      setPreviewRows(preview);
      setPhase('preview');
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setError('');
    try {
      const result = await uploadCsvStudents(token, classroomId, selectedFile);
      setUploadResult(result);
      setPhase('result');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '上傳失敗，請重試';
      setError(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setPhase('select');
    setSelectedFile(null);
    setPreviewRows([]);
    setTotalRows(0);
    setUploadResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDone = () => {
    if (uploadResult && uploadResult.created_count > 0) {
      onSuccess();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">匯入 CSV 學生名單</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
            aria-label="關閉"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Phase: select */}
          {phase === 'select' && (
            <>
              <p className="text-sm text-gray-600">
                上傳包含學生姓名和座號的 CSV 檔案，系統將自動建立帳號並加入班級。
              </p>

              {/* Format guide */}
              <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-600 space-y-1">
                <p className="font-medium text-gray-700">CSV 格式：</p>
                <p className="font-mono">name,seat_number</p>
                <p className="font-mono text-gray-500">王小明,01</p>
                <p className="font-mono text-gray-500">李小美,02</p>
                <p className="mt-2 text-gray-500">表頭行為可選，最多 100 位學生，檔案上限 1 MB</p>
              </div>

              {/* Template download */}
              <button
                onClick={() => downloadCsvTemplate(token)}
                className="text-sm text-accent hover:text-accent-hover underline underline-offset-2 transition-colors cursor-pointer"
              >
                下載範本 CSV
              </button>

              {/* File input */}
              <div>
                <label
                  htmlFor="csv-file-input"
                  className="block w-full cursor-pointer border-2 border-dashed border-gray-300 hover:border-accent rounded-xl p-6 text-center transition-colors"
                >
                  <svg className="mx-auto w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm font-medium text-gray-700">點擊或拖曳 CSV 檔案至此</p>
                  <p className="text-xs text-gray-400 mt-1">支援 .csv 格式，UTF-8 或 UTF-8 BOM 編碼</p>
                </label>
                <input
                  id="csv-file-input"
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={handleFileChange}
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          )}

          {/* Phase: preview */}
          {phase === 'preview' && selectedFile && (
            <>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  <span className="font-medium">{selectedFile.name}</span>
                  {' '}— 共 <span className="font-medium text-accent">{totalRows}</span> 位學生
                </span>
              </div>

              {previewRows.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">
                    預覽（前 {Math.min(previewRows.length, MAX_PREVIEW_ROWS)} 筆）：
                  </p>
                  <div className="border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-left">
                          <th className="px-3 py-2 text-xs font-medium text-gray-500">姓名</th>
                          <th className="px-3 py-2 text-xs font-medium text-gray-500">座號</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {previewRows.map((row, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-gray-900">{row.name || <span className="text-red-400 italic">空白</span>}</td>
                            <td className="px-3 py-2 text-gray-600">{row.seat_number || <span className="text-red-400 italic">空白</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {totalRows > MAX_PREVIEW_ROWS && (
                      <p className="px-3 py-2 text-xs text-gray-400 border-t border-gray-100">
                        ...以及其餘 {totalRows - MAX_PREVIEW_ROWS} 位學生
                      </p>
                    )}
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          )}

          {/* Phase: result */}
          {phase === 'result' && uploadResult && (
            <div className="space-y-3">
              {/* Summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-center">
                  <p className="text-2xl font-bold text-emerald-700">{uploadResult.created_count}</p>
                  <p className="text-xs text-emerald-600 mt-0.5">成功建立</p>
                </div>
                <div className={`border rounded-lg px-4 py-3 text-center ${uploadResult.skipped_count > 0 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                  <p className={`text-2xl font-bold ${uploadResult.skipped_count > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                    {uploadResult.skipped_count}
                  </p>
                  <p className={`text-xs mt-0.5 ${uploadResult.skipped_count > 0 ? 'text-amber-600' : 'text-gray-400'}`}>跳過</p>
                </div>
              </div>

              {/* Credentials table */}
              {uploadResult.created.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">帳號資訊（請妥善保存）：</p>
                  <div className="border border-gray-200 rounded-lg max-h-48 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-500">姓名</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500">帳號</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500">密碼</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {uploadResult.created.map((s, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-gray-900">{s.name}</td>
                            <td className="px-3 py-2 font-mono text-gray-700">{s.username}</td>
                            <td className="px-3 py-2 font-mono text-gray-700">{s.password}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Errors */}
              {uploadResult.errors.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-amber-700 mb-1">
                    跳過的項目（{uploadResult.errors.length} 筆）：
                  </p>
                  <ul className="space-y-1 max-h-32 overflow-y-auto">
                    {uploadResult.errors.map((e, i) => (
                      <li key={i} className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-3 py-1.5">
                        {e.name ? `${e.name}（座號 ${e.seat_number}）：` : ''}{e.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
          {phase === 'select' && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
            >
              取消
            </button>
          )}

          {phase === 'preview' && (
            <>
              <button
                onClick={handleReset}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
              >
                重新選擇
              </button>
              <button
                onClick={handleUpload}
                disabled={isUploading || totalRows === 0}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
              >
                {isUploading ? '匯入中...' : `確認匯入 ${totalRows} 位學生`}
              </button>
            </>
          )}

          {phase === 'result' && (
            <>
              {uploadResult && uploadResult.created_count === 0 && (
                <button
                  onClick={handleReset}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  重試
                </button>
              )}
              <button
                onClick={handleDone}
                className="bg-accent hover:bg-accent-hover text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
              >
                完成
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CsvUploadModal;
