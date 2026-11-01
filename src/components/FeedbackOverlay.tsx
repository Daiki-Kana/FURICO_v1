import React from 'react';

interface FeedbackOverlayProps {
  score: number | null;
  advice: string | null;
  isPracticing: boolean;
}

/**
 * 画面上部のミニマルHUDオーバーレイ
 * スコアと最新のアドバイスのみを洗練されたタイポグラフィで表示
 */
export const FeedbackOverlay: React.FC<FeedbackOverlayProps> = ({
  score,
  advice,
  isPracticing,
}) => {
  if (!isPracticing || score === null) {
    return null;
  }

  // スコアに応じたトーン（高スコア: 純白、低スコア/ズレあり: 警告赤）
  const isHighAccuracy = score >= 80;

  return (
    <aside aria-label="Live dance feedback HUD" className="absolute top-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center pointer-events-none transition-all duration-200">
      <div className="bg-zinc-950/80 backdrop-blur-md px-6 py-3 rounded-full flex items-center gap-4 shadow-2xl">
        {/* スコア値 */}
        <span
          className={`text-2xl font-black tracking-tight tabular-nums ${
            isHighAccuracy ? 'text-zinc-100' : 'text-red-500'
          }`}
        >
          {score}%
        </span>

        {/* アドバイステキスト（大文字・ミニマル） */}
        {advice ? (
          <span className="text-sm font-bold uppercase tracking-widest text-red-400 animate-pulse">
            {advice}
          </span>
        ) : (
          <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            SYNCED
          </span>
        )}
      </div>
    </aside>
  );
};
