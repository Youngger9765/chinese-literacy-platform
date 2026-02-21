
import React, { useRef, useState, useEffect } from 'react';
import { ReadingAttempt } from '../../types';
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

    // Check immediately (covers the common case where layout is already done)
    check();

    // Also observe resizes for late-layout scenarios (animation, tab switch, etc.)
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
  attempt: ReadingAttempt | null;
  onRetry: () => void;
}

const AssessmentReport: React.FC<AssessmentReportProps> = ({ attempt, onRetry }) => {
  if (!attempt) return null;

  const scoreData = [
    { name: '字詞準確度', value: attempt.accuracy, color: '#4f46e5' },
    { name: '待改進', value: 100 - attempt.accuracy, color: '#f1f5f9' }
  ];

  const barData = [
    { name: '準確度', score: attempt.accuracy },
    { name: '朗讀速度 (CPM)', score: Math.min(attempt.cpm, 300) }, // cap for chart
  ];

  // Friendly CPM description for young students
  const cpmDescription = (() => {
    const cpm = attempt.cpm;
    if (cpm >= 200) return '你讀得很快很流利！';
    if (cpm >= 120) return '速度適中，很棒！';
    if (cpm >= 60) return '慢慢讀也很好，繼續練習會越來越快！';
    return '不要急，慢慢來就好！';
  })();

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fadeIn">
      <div className="text-center">
        <div className="inline-block bg-green-100 text-green-700 px-4 py-1 rounded-full text-sm font-bold mb-4">
          恭喜完成練習！
        </div>
        <h2 className="text-4xl font-bold mb-2">好棒！你今天又進步了。</h2>
        <p className="text-slate-500">讓我們看看這次朗讀的分析數據吧。</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center">
          <h3 className="text-lg font-bold mb-6">核心表現</h3>
          <div className="w-full h-48 relative">
             <SafeResponsiveContainer width="100%" height="100%">
               <PieChart>
                 <Pie
                   data={scoreData}
                   innerRadius={60}
                   outerRadius={80}
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
                <span className="text-4xl font-black text-indigo-600">{attempt.accuracy}%</span>
                <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">準確度</span>
             </div>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 w-full">
            <div className="bg-slate-50 p-4 rounded-2xl text-center">
              <p className="text-xs text-slate-400 font-bold mb-1">朗讀速度</p>
              <p className="text-xl font-bold text-slate-800">{attempt.cpm}</p>
              <p className="text-[10px] text-slate-400">字/分鐘</p>
            </div>
            <div className="bg-slate-50 p-4 rounded-2xl text-center">
              <p className="text-xs text-slate-400 font-bold mb-1">準確度</p>
              <p className="text-xl font-bold text-slate-800">{attempt.accuracy}%</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold mb-6">能力指標</h3>
          <div className="h-48">
            <SafeResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} layout="vertical" margin={{ left: 30, right: 30 }}>
                <XAxis type="number" hide domain={[0, 300]} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={120} />
                <Tooltip />
                <Bar dataKey="score" fill="#818cf8" radius={[0, 10, 10, 0]} barSize={24} />
              </BarChart>
            </SafeResponsiveContainer>
          </div>
          <div className="mt-4 p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
            <h4 className="text-sm font-bold text-indigo-800 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" /></svg>
              朗讀分析
            </h4>
            <p className="text-sm text-indigo-900/80 leading-relaxed">
              你的朗讀速度是每分鐘 {attempt.cpm} 個字。{cpmDescription}
              字詞準確度達到 {attempt.accuracy}%，繼續保持！
            </p>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 rounded-3xl p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
        <div>
          <h3 className="text-2xl font-bold">準備好讀下一個故事了嗎？</h3>
          <p className="text-indigo-100">每天進步一點點，你就會變成閱讀小達人！</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={onRetry}
            className="bg-white text-indigo-600 px-8 py-3 rounded-xl font-bold hover:shadow-lg transition-all"
          >
            回圖書館
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssessmentReport;
