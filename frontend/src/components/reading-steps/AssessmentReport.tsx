
import React, { useRef, useState, useEffect } from 'react';
import { LearningSession } from '../../types';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';

/**
 * A wrapper around ResponsiveContainer that only renders the chart
 * once the container has been measured with positive dimensions.
 * This prevents Recharts from logging warnings about negative width/height.
 */
const SafeResponsiveContainer: React.FC<{
  children: React.ReactNode;
  width?: string | number;
  height?: string | number;
}> = ({ children, width = '100%', height = '100%' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const check = () => {
      const { width: w, height: h } = el.getBoundingClientRect();
      if (w > 0 && h > 0) setReady(true);
    };

    check();

    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      {ready && (
        <ResponsiveContainer width={width} height={height}>
          {children as React.ReactElement}
        </ResponsiveContainer>
      )}
    </div>
  );
};

interface AssessmentReportProps {
  session: LearningSession | null;
  onRetry: () => void;
}

// Research-based CPM thresholds for 國小高年級～國中生
const getCpmFeedback = (cpm: number) => {
  if (cpm >= 180) return { text: '非常流利！你讀得又快又準！', level: 'very-fast' };
  if (cpm >= 130) return { text: '流利度很好，繼續保持！', level: 'fast' };
  if (cpm >= 90) return { text: '速度適中，每天練習會越來越快！', level: 'medium' };
  if (cpm >= 50) return { text: '慢慢來沒關係，多練習就會進步！', level: 'slow' };
  return { text: '不要急，一個字一個字慢慢讀就好！', level: 'very-slow' };
};

const speedSegments = [
  { label: '慢', threshold: 50, color: 'bg-red-400' },
  { label: '適中', threshold: 90, color: 'bg-amber-400' },
  { label: '快', threshold: 130, color: 'bg-green-400' },
  { label: '很快', threshold: 180, color: 'bg-emerald-400' },
];

const getCurrentSegment = (cpm: number) => {
  if (cpm < 50) return 0;
  if (cpm < 90) return 1;
  if (cpm < 130) return 2;
  return 3;
};

const AssessmentReport: React.FC<AssessmentReportProps> = ({ session, onRetry }) => {
  if (!session) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col items-center justify-center gap-6 py-24 text-center">
        <p className="text-gray-500 text-lg">請先選擇課文開始學習</p>
        <button
          onClick={onRetry}
          className="bg-accent hover:bg-accent-hover text-white px-8 py-3 rounded-xl font-bold transition-all"
        >
          回圖書館
        </button>
      </div>
    );
  }

  const { readingAttempt, comprehensionResult, vocabResult, fullReadingResult } = session;

  // Compute overall score from available steps
  const scores: number[] = [];
  if (readingAttempt) scores.push(readingAttempt.accuracy);
  if (comprehensionResult) scores.push(Math.round((comprehensionResult.understoodCount / Math.max(comprehensionResult.requiredCount, 1)) * 100));
  if (vocabResult) scores.push(vocabResult.totalChars > 0 ? Math.round((vocabResult.practicedChars.length / vocabResult.totalChars) * 100) : 100);
  if (fullReadingResult) scores.push(Math.round(fullReadingResult.matchRate * 100));
  const overallScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  // Reading attempt chart data
  const scoreData = readingAttempt
    ? [
        { name: '字詞準確度', value: readingAttempt.accuracy, color: '#4f46e5' },
        { name: '待改進', value: 100 - readingAttempt.accuracy, color: '#f1f5f9' },
      ]
    : null;

  const barData = readingAttempt
    ? [
        { name: '準確度', score: readingAttempt.accuracy },
        { name: '朗讀速度 (CPM)', score: Math.min(readingAttempt.cpm, 300) },
      ]
    : null;

  const cpmFeedback = readingAttempt ? getCpmFeedback(readingAttempt.cpm) : null;
  const currentSegment = readingAttempt ? getCurrentSegment(readingAttempt.cpm) : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="text-center">
        <div className="inline-block bg-green-100 text-green-700 px-4 py-1 rounded-full text-sm font-bold mb-4">
          恭喜完成練習！
        </div>
        <h2 className="text-4xl font-bold mb-2">好棒！你今天又進步了。</h2>
        <p className="text-gray-500">讓我們看看這次學習的完整成果吧。</p>
        {overallScore !== null && (
          <div className="mt-4 inline-flex items-center gap-2 bg-accent/10 text-accent px-5 py-2 rounded-full">
            <span className="text-sm font-bold">綜合成績</span>
            <span className="text-2xl font-black">{overallScore}%</span>
          </div>
        )}
      </div>

      {/* Step cards */}
      <div className="grid gap-6">

        {/* Step 2: 逐段朗讀 */}
        <div className={`rounded-3xl border p-6 ${readingAttempt ? 'bg-white border-slate-200 shadow-sm' : 'bg-gray-50 border-dashed border-gray-300'}`}>
          <div className="flex items-center gap-3 mb-4">
            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black ${readingAttempt ? 'bg-accent text-white' : 'bg-gray-200 text-gray-400'}`}>
              2
            </span>
            <h3 className={`text-lg font-bold ${readingAttempt ? 'text-gray-900' : 'text-gray-400'}`}>逐段朗讀</h3>
            {!readingAttempt && (
              <span className="ml-auto text-xs text-gray-400 font-medium">未完成</span>
            )}
          </div>

          {readingAttempt && scoreData && barData && cpmFeedback ? (
            <div className="grid md:grid-cols-2 gap-6">
              <div className="flex flex-col items-center">
                <div className="w-full h-40 relative">
                  <SafeResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={scoreData}
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {scoreData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </SafeResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-black text-accent">{readingAttempt.accuracy}%</span>
                    <span className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">準確度</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="h-32">
                  <SafeResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} layout="vertical" margin={{ left: 30, right: 20 }}>
                      <XAxis type="number" hide domain={[0, 300]} />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={110} />
                      <Tooltip />
                      <Bar dataKey="score" fill="#818cf8" radius={[0, 8, 8, 0]} barSize={20} />
                    </BarChart>
                  </SafeResponsiveContainer>
                </div>

                {/* Speed indicator */}
                <div className="bg-gray-50 p-3 rounded-2xl">
                  <p className="text-xs text-gray-600 font-bold mb-1">朗讀速度: {readingAttempt.cpm} 字/分鐘</p>
                  <div className="flex gap-0.5 mb-1">
                    {speedSegments.map((segment, idx) => (
                      <div
                        key={idx}
                        className={`flex-1 h-2 rounded-sm ${idx === currentSegment ? segment.color : 'bg-gray-200'}`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between text-[8px] text-gray-500">
                    {speedSegments.map((segment, idx) => (
                      <span key={idx} className="flex-1 text-center">{segment.label}</span>
                    ))}
                  </div>
                  <p className="text-xs text-gray-600 mt-2">{cpmFeedback.text}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-4 text-center">此步驟尚未完成</p>
          )}
        </div>

        {/* Step 3: 生字練習 */}
        <div className={`rounded-3xl border p-6 ${vocabResult ? 'bg-white border-slate-200 shadow-sm' : 'bg-gray-50 border-dashed border-gray-300'}`}>
          <div className="flex items-center gap-3 mb-4">
            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black ${vocabResult ? 'bg-accent text-white' : 'bg-gray-200 text-gray-400'}`}>
              3
            </span>
            <h3 className={`text-lg font-bold ${vocabResult ? 'text-gray-900' : 'text-gray-400'}`}>生字練習</h3>
            {!vocabResult && (
              <span className="ml-auto text-xs text-gray-400 font-medium">未完成</span>
            )}
          </div>

          {vocabResult ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-accent h-3 rounded-full transition-all"
                    style={{ width: vocabResult.totalChars > 0 ? `${Math.round((vocabResult.practicedChars.length / vocabResult.totalChars) * 100)}%` : '0%' }}
                  />
                </div>
                <span className="text-sm font-bold text-gray-700 shrink-0">
                  {vocabResult.practicedChars.length} / {vocabResult.totalChars}
                </span>
              </div>
              {vocabResult.practicedChars.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {vocabResult.practicedChars.map(ch => (
                    <span key={ch} className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-bold px-2 py-0.5 rounded-lg">
                      {ch}
                    </span>
                  ))}
                </div>
              )}
              {vocabResult.practicedChars.length === 0 && (
                <p className="text-sm text-gray-500">本次未練習任何生字（跳過）</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-4 text-center">此步驟尚未完成</p>
          )}
        </div>

        {/* Step 4: 課文理解 */}
        <div className={`rounded-3xl border p-6 ${comprehensionResult ? 'bg-white border-slate-200 shadow-sm' : 'bg-gray-50 border-dashed border-gray-300'}`}>
          <div className="flex items-center gap-3 mb-4">
            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black ${comprehensionResult ? 'bg-accent text-white' : 'bg-gray-200 text-gray-400'}`}>
              4
            </span>
            <h3 className={`text-lg font-bold ${comprehensionResult ? 'text-gray-900' : 'text-gray-400'}`}>課文理解</h3>
            {comprehensionResult?.isComplete && (
              <span className="ml-auto bg-emerald-100 text-emerald-700 text-xs font-bold px-3 py-1 rounded-full">已完成</span>
            )}
            {comprehensionResult && !comprehensionResult.isComplete && (
              <span className="ml-auto bg-amber-100 text-amber-700 text-xs font-bold px-3 py-1 rounded-full">部分完成</span>
            )}
            {!comprehensionResult && (
              <span className="ml-auto text-xs text-gray-400 font-medium">未完成</span>
            )}
          </div>

          {comprehensionResult ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-emerald-500 h-3 rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.round((comprehensionResult.understoodCount / Math.max(comprehensionResult.requiredCount, 1)) * 100))}%` }}
                  />
                </div>
                <span className="text-sm font-bold text-gray-700 shrink-0">
                  {comprehensionResult.understoodCount} / {comprehensionResult.requiredCount}
                </span>
              </div>
              <div className="flex gap-4 text-sm text-gray-600">
                <span>對話輪數：{comprehensionResult.conversationLength} 回</span>
                <span>理解率：{Math.round((comprehensionResult.understoodCount / Math.max(comprehensionResult.requiredCount, 1)) * 100)}%</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-4 text-center">此步驟尚未完成</p>
          )}
        </div>

        {/* Step 5: 全文朗讀 */}
        <div className={`rounded-3xl border p-6 ${fullReadingResult ? 'bg-white border-slate-200 shadow-sm' : 'bg-gray-50 border-dashed border-gray-300'}`}>
          <div className="flex items-center gap-3 mb-4">
            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black ${fullReadingResult ? 'bg-accent text-white' : 'bg-gray-200 text-gray-400'}`}>
              5
            </span>
            <h3 className={`text-lg font-bold ${fullReadingResult ? 'text-gray-900' : 'text-gray-400'}`}>全文朗讀</h3>
            {!fullReadingResult && (
              <span className="ml-auto text-xs text-gray-400 font-medium">未完成</span>
            )}
          </div>

          {fullReadingResult ? (
            <div className="flex items-center gap-6">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center border-4 shrink-0 ${
                fullReadingResult.matchRate >= 0.80 ? 'border-emerald-500 text-emerald-800'
                : fullReadingResult.matchRate >= 0.60 ? 'border-amber-500 text-amber-800'
                : 'border-red-400 text-red-600'
              }`}>
                <span className="text-xl font-black">{Math.round(fullReadingResult.matchRate * 100)}%</span>
              </div>
              <p className={`text-sm font-bold ${
                fullReadingResult.matchRate >= 0.80 ? 'text-emerald-800'
                : fullReadingResult.matchRate >= 0.60 ? 'text-amber-800'
                : 'text-gray-600'
              }`}>
                {fullReadingResult.feedback}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-4 text-center">此步驟尚未完成</p>
          )}
        </div>
      </div>

      {/* CTA */}
      <div className="bg-gradient-to-r from-accent to-violet-600 rounded-3xl p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
        <div>
          <h3 className="text-2xl font-bold">準備好讀下一個故事了嗎？</h3>
          <p className="text-white/80">每天進步一點點，你就會變成閱讀小達人！</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={onRetry}
            className="bg-white text-accent px-8 py-3 rounded-xl font-bold hover:shadow-lg transition-all"
          >
            回圖書館
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssessmentReport;
