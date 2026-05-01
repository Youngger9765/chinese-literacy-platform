/**
 * FluencyProgressChart — 4-attempt progress line chart for FullReading.
 *
 * Shows up to 4 attempts on X axis with CPM (or seconds for G8 文言文) on Y axis.
 * Draws lesson-specific benchmark threshold lines when available.
 * Issue #1386
 */
import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Dot,
} from 'recharts';
import type { ParsedBenchmark, BenchmarkLevelSec } from '../../../utils/fluencyAnalyzer';

export interface FullReadingAttempt {
  attempt_index: number;
  cpm: number;
  accuracy: number;
  duration_ms: number;
  transcript?: string;
  timestamp?: string;
}

interface FluencyProgressChartProps {
  attempts: FullReadingAttempt[];
  benchmark: ParsedBenchmark[] | null;
  /** Grade number (used to determine unit: cpm vs sec) */
  grade?: number;
  /** Override unit detection */
  unit?: 'cpm' | 'sec';
}

function isSec(benchmark: ParsedBenchmark[] | null): boolean {
  if (!benchmark || benchmark.length === 0) return false;
  return 'unit' in benchmark[0] && (benchmark[0] as BenchmarkLevelSec).unit === 'sec';
}

function getTrendArrow(attempts: FullReadingAttempt[], useSec: boolean): 'up' | 'down' | 'flat' | null {
  if (attempts.length < 2) return null;
  const last = attempts[attempts.length - 1];
  const prev = attempts[attempts.length - 2];
  const lastVal = useSec ? (last.duration_ms / 1000) : last.cpm;
  const prevVal = useSec ? (prev.duration_ms / 1000) : prev.cpm;
  const diff = lastVal - prevVal;
  // For CPM: higher is better (up = good)
  // For sec: lower is better (up = bad, down = good)
  if (Math.abs(diff) < (useSec ? 2 : 5)) return 'flat';
  if (useSec) {
    return diff < 0 ? 'up' : 'down'; // fewer seconds = improving = up
  }
  return diff > 0 ? 'up' : 'down';
}

function buildChartData(attempts: FullReadingAttempt[], useSec: boolean) {
  const filled = Array.from({ length: 4 }, (_, i) => {
    const a = attempts.find(x => x.attempt_index === i + 1) ?? attempts[i];
    if (!a || i >= attempts.length) return { x: i + 1, value: null };
    const value = useSec ? Math.round(a.duration_ms / 10) / 100 : a.cpm;
    return { x: i + 1, value };
  });
  return filled;
}

function extractThresholds(benchmark: ParsedBenchmark[] | null, useSec: boolean): { value: number; label: string; color: string }[] {
  if (!benchmark) return [];
  const thresholds: { value: number; label: string; color: string }[] = [];
  const colors = ['#22c55e', '#f59e0b', '#ef4444']; // green / amber / red

  benchmark.forEach((b, idx) => {
    if (useSec && 'unit' in b) {
      const bs = b as BenchmarkLevelSec;
      if (bs.maxSec !== Infinity) {
        thresholds.push({ value: bs.maxSec, label: '慢', color: colors[Math.min(idx, 2)] });
      }
      if (bs.minSec > 0) {
        thresholds.push({ value: bs.minSec, label: '快', color: colors[Math.min(idx, 2)] });
      }
    } else if (!useSec && !('unit' in b)) {
      const bc = b as import('../../../utils/fluencyAnalyzer').BenchmarkLevel;
      if (bc.minCpm > 0) {
        thresholds.push({ value: bc.minCpm, label: `${bc.minCpm}字/分`, color: colors[Math.min(idx, 2)] });
      }
    }
  });
  // Deduplicate by value
  const seen = new Set<number>();
  return thresholds.filter(t => {
    if (seen.has(t.value)) return false;
    seen.add(t.value);
    return true;
  });
}

const CustomDot: React.FC<any> = ({ cx, cy, index, dataLength }) => {
  const isLast = index === dataLength - 1;
  if (cx == null || cy == null) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={isLast ? 7 : 4}
      fill={isLast ? '#564ABF' : '#9D93FF'}
      stroke="white"
      strokeWidth={isLast ? 2 : 1}
    />
  );
};

const CustomTooltip: React.FC<any> = ({ active, payload, label, useSec }: any) => {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  if (val == null) return null;
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-editorial px-3 py-2 text-sm">
      <p className="font-headline font-bold text-on-surface">第 {label} 次</p>
      <p className="text-accent">
        {useSec ? `${val} 秒` : `${val} 字/分`}
      </p>
    </div>
  );
};

const FluencyProgressChart: React.FC<FluencyProgressChartProps> = ({
  attempts,
  benchmark,
  unit,
}) => {
  const useSec = unit === 'sec' || (unit == null && isSec(benchmark));
  const chartData = buildChartData(attempts, useSec);
  const thresholds = extractThresholds(benchmark, useSec);
  const trend = getTrendArrow(attempts, useSec);
  const dataLength = attempts.length;

  if (attempts.length === 0) return null;

  const values = chartData.map(d => d.value).filter(v => v != null) as number[];
  const allValues = [...values, ...thresholds.map(t => t.value)];
  const minY = Math.max(0, Math.floor(Math.min(...allValues) * 0.85));
  const maxY = Math.ceil(Math.max(...allValues) * 1.15);

  const trendIcon = trend === 'up' ? '↗' : trend === 'down' ? '↘' : trend === 'flat' ? '→' : null;
  const trendColor =
    trend === 'up' ? 'text-emerald-600' :
    trend === 'down' ? 'text-tertiary' :
    'text-on-surface-variant';
  const trendLabel =
    trend === 'up' ? '進步中' :
    trend === 'down' ? '速度下降' :
    trend === 'flat' ? '持平' : '';

  return (
    <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider">
          練習進步曲線
        </p>
        {trendIcon && (
          <span className={`text-sm font-headline font-bold ${trendColor} flex items-center gap-1`}>
            <span className="text-base">{trendIcon}</span>
            {trendLabel}
          </span>
        )}
      </div>

      {/* 4-cell grid indicator */}
      <div className="flex gap-2 mb-4">
        {Array.from({ length: 4 }, (_, i) => {
          const done = i < attempts.length;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`w-full h-1.5 rounded-full transition-colors ${
                  done ? 'bg-accent' : 'bg-surface-container-high'
                }`}
              />
              <span className="text-xs text-on-surface-variant/60 font-headline">
                {i + 1}/{4}
              </span>
            </div>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(94,91,85,0.08)" />
          <XAxis
            dataKey="x"
            tick={{ fontSize: 11, fill: '#5E5B55', fontFamily: '"Plus Jakarta Sans", sans-serif' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `第${v}次`}
          />
          <YAxis
            domain={[minY, maxY]}
            tick={{ fontSize: 11, fill: '#5E5B55', fontFamily: '"Plus Jakarta Sans", sans-serif' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => useSec ? `${v}s` : `${v}`}
            width={32}
          />
          <Tooltip content={<CustomTooltip useSec={useSec} />} />

          {/* Threshold reference lines */}
          {thresholds.map((t) => (
            <ReferenceLine
              key={t.value}
              y={t.value}
              stroke={t.color}
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{
                value: t.label,
                position: 'insideTopRight',
                fontSize: 10,
                fill: t.color,
                fontFamily: '"Plus Jakarta Sans", sans-serif',
              }}
            />
          ))}

          <Line
            type="monotone"
            dataKey="value"
            stroke="#564ABF"
            strokeWidth={2.5}
            connectNulls={false}
            dot={(props: any) => (
              <CustomDot {...props} dataLength={dataLength} />
            )}
            activeDot={{ r: 6, fill: '#564ABF', stroke: 'white', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>

      <p className="text-xs text-on-surface-variant/60 text-center mt-2 font-headline">
        {useSec ? '秒數越少越好' : '字/分越高越好'} ·
        已完成 {attempts.length}/4 次
      </p>
    </div>
  );
};

export default FluencyProgressChart;
