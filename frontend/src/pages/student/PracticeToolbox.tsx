/**
 * PracticeToolbox — /tools 練習工具箱
 *
 * 2-column layout: left = lesson picker (radio), right = tool picker (radio).
 * Bottom sticky action bar shows selection + 開始練習 button.
 *
 * Flow: 開始練習 → /learn/:storyId/:toolPath
 * The step page's onFinish / onCancel should navigate back to /tools.
 *
 * Issue #1165 (replaces #1153 card-grid design)
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Story } from '../../types';
import LessonPicker from '../../components/tools/LessonPicker';
import ToolPicker, { ToolOption } from '../../components/tools/ToolPicker';
import { setToolboxMode } from '../../services/learningStorageScope';

const PracticeToolbox: React.FC = () => {
  const navigate = useNavigate();
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [selectedTool, setSelectedTool] = useState<ToolOption | null>(null);

  // Returning to /tools means leaving toolbox-mode — clear the flag so
  // subsequent self-practice / assignment flows aren't scoped under "__t".
  useEffect(() => {
    setToolboxMode(false);
  }, []);

  const canStart = selectedStory != null && selectedTool != null;

  const handleStart = () => {
    if (!canStart) return;
    // Activate toolbox-mode before navigation so the tool component reads
    // localStorage under the isolated "__t" scope from first render (#1460).
    setToolboxMode(true);
    navigate(`/learn/${selectedStory.id}/${selectedTool.stepPath}`, {
      state: { returnTo: '/tools' },
    });
  };

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Page header */}
      <div className="px-6 py-5 border-b border-gray-100 bg-white shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">練習工具箱</h1>
        <p className="text-sm text-gray-500 mt-1">選一篇課文，搭配一種練習方式，專注深練</p>
      </div>

      {/* 2-column body */}
      <div className="flex-1 overflow-hidden flex min-h-0">
        {/* Left column — lesson picker */}
        <div className="flex-1 min-w-0 overflow-hidden border-r border-gray-100 bg-white">
          <div className="h-full p-5 overflow-y-auto">
            <LessonPicker
              selectedId={selectedStory?.id ?? null}
              onChange={setSelectedStory}
            />
          </div>
        </div>

        {/* Right column — tool picker */}
        <div className="w-72 shrink-0 bg-white overflow-hidden">
          <div className="h-full p-5 overflow-y-auto">
            <ToolPicker
              selectedId={selectedTool?.id ?? null}
              onChange={setSelectedTool}
            />
          </div>
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-4 max-w-4xl mx-auto">
          {/* Selection summary */}
          <div className="flex-1 min-w-0">
            {!selectedStory && !selectedTool && (
              <p className="text-sm text-gray-400">請先選擇課文和練習工具</p>
            )}
            {selectedStory && !selectedTool && (
              <p className="text-sm text-gray-600">
                已選課文：
                <span className="font-semibold text-gray-900">{selectedStory.title}</span>
                <span className="text-gray-400"> · 請選擇工具</span>
              </p>
            )}
            {!selectedStory && selectedTool && (
              <p className="text-sm text-gray-600">
                已選工具：
                <span className="font-semibold text-gray-900">{selectedTool.label}</span>
                <span className="text-gray-400"> · 請選擇課文</span>
              </p>
            )}
            {selectedStory && selectedTool && (
              <p className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{selectedStory.title}</span>
                <span className="text-gray-400 mx-2">×</span>
                <span className="font-semibold text-accent">{selectedTool.label}</span>
              </p>
            )}
          </div>

          {/* Start button */}
          <button
            type="button"
            onClick={handleStart}
            disabled={!canStart}
            className={`
              px-6 py-2.5 rounded-xl text-sm font-semibold transition-all shrink-0
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
              ${canStart
                ? 'bg-accent text-white hover:bg-primary-light shadow-sm active:scale-95'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }
            `}
          >
            開始練習
          </button>
        </div>
      </div>
    </div>
  );
};

export default PracticeToolbox;
