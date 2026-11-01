import React from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, Zap } from 'lucide-react';
import type { VideoEvaluationReport } from '../lib/comparator/videoComparator';

interface ScoreReportProps {
  report: VideoEvaluationReport;
  currentTime: number;
  onSeek: (seconds: number) => void;
}

export const ScoreReport: React.FC<ScoreReportProps> = ({
  report,
  currentTime,
  onSeek,
}) => {
  const isExcellent = report.overallScore >= 80;

  return (
    <div className="w-full bg-zinc-900/90 rounded-3xl p-6 space-y-6 shadow-2xl backdrop-blur-xl">
      {/* 上部: 総合スコアと評価バッジ */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-4xl sm:text-5xl font-black tabular-nums tracking-tight text-white">
            {report.overallScore}
          </span>
          <span className="text-xs font-bold tracking-widest text-zinc-500 uppercase">
            / 100 SCORE
          </span>
        </div>

        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-800 text-xs font-semibold tracking-wider uppercase text-zinc-300">
          {isExcellent ? (
            <CheckCircle2 className="w-4 h-4 text-white" />
          ) : (
            <Zap className="w-4 h-4 text-amber-400" />
          )}
          <span>{isExcellent ? 'HIGH SYNC' : 'NEEDS PRACTICE'}</span>
        </div>
      </div>

      {/* タイムラインエラーヒートマップ */}
      <div className="space-y-2">
        <div className="flex justify-between text-[11px] font-bold tracking-wider uppercase text-zinc-400">
          <span>TIMELINE ACCURACY</span>
          <span className="tabular-nums font-mono text-zinc-400">
            {currentTime.toFixed(1)}s / {report.duration.toFixed(1)}s
          </span>
        </div>

        <div className="relative w-full h-4 bg-zinc-950 rounded-full overflow-hidden flex items-stretch cursor-pointer select-none">
          {report.timelineErrors.map((pt, idx) => {
            const isError = pt.error > 0.45;
            const isMedium = pt.error > 0.25;
            const bgClass = isError
              ? 'bg-red-500'
              : isMedium
              ? 'bg-zinc-600'
              : 'bg-zinc-300';

            return (
              <div
                key={idx}
                onClick={() => onSeek(pt.timestamp)}
                className={`flex-1 h-full transition-opacity hover:opacity-100 ${bgClass}`}
                style={{ opacity: isError ? 0.95 : 0.4 }}
                title={`@${pt.timestamp}s - Error: ${Math.round(pt.error * 100)}%`}
              />
            );
          })}

          {/* 現在再生位置インジケータ */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-white shadow-lg pointer-events-none transition-all duration-75"
            style={{
              left: `${(currentTime / (report.duration || 1)) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* 部位別スコアバー */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'ARMS', val: report.jointScores.arms },
          { label: 'SHOULDERS', val: report.jointScores.shoulders },
          { label: 'HIPS', val: report.jointScores.hips },
          { label: 'LEGS', val: report.jointScores.legs },
        ].map((item) => (
          <div key={item.label} className="p-3 bg-zinc-950/60 rounded-2xl space-y-1.5">
            <div className="flex justify-between text-[10px] font-bold tracking-wider text-zinc-500">
              <span>{item.label}</span>
              <span className="tabular-nums text-zinc-300">{item.val}%</span>
            </div>
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-300"
                style={{ width: `${item.val}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 主な改善ポイント（上位の問題箇所） */}
      {report.keyIssues.length > 0 && (
        <div className="space-y-2 pt-1">
          <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-500">
            KEY IMPROVEMENTS
          </span>

          <div className="space-y-1.5">
            {report.keyIssues.map((issue, idx) => (
              <button
                key={idx}
                onClick={() => onSeek(issue.timestamp)}
                className="w-full flex items-center justify-between p-3 bg-zinc-950/40 hover:bg-zinc-800/60 rounded-2xl transition cursor-pointer text-left group"
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold tracking-wide uppercase text-zinc-200 group-hover:text-white truncate">
                      {issue.advice}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">
                      @{issue.timestamp}s · Offset: {issue.delta}°
                    </span>
                  </div>
                </div>

                <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 shrink-0 transition" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
