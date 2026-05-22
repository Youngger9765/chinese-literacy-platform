import React from 'react';
import type { TeacherTextDetail } from '../../../services/teacherTextsApi';

interface MyTextPreviewModalProps {
  previewText: TeacherTextDetail | null;
  onClose: () => void;
}

const MyTextPreviewModal: React.FC<MyTextPreviewModalProps> = ({ previewText, onClose }) => {
  if (!previewText) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 overflow-y-auto py-8"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="text-base font-semibold text-gray-800">{previewText.title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="關閉預覽">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex gap-2 flex-wrap">
            <span className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 rounded-full">
              {previewText.grade} 年級
            </span>
            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
              {previewText.genre}
            </span>
            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
              {previewText.char_count} 字
            </span>
          </div>

          <div className="space-y-3">
            {previewText.paragraphs.map((para, idx) => (
              <p key={idx} className="text-sm text-gray-700 leading-relaxed">
                {para}
              </p>
            ))}
          </div>

          {previewText.vocabulary && previewText.vocabulary.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">生字詞彙</h4>
              <div className="space-y-1">
                {previewText.vocabulary.map((v, idx) => (
                  <div key={idx} className="flex gap-3 text-sm">
                    <span className="font-medium text-gray-800 w-16 shrink-0">{v.word}</span>
                    <span className="text-gray-600">{v.definition}</span>
                    {v.note && <span className="text-gray-400 text-xs">({v.note})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MyTextPreviewModal;
