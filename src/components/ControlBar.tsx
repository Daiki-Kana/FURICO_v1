import React from 'react';
import {
  Camera,
  Columns,
  LayoutTemplate,
  Play,
  Pause,
  RotateCcw,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';

interface ControlBarProps {
  isPracticing: boolean;
  hasSequence: boolean;
  isCameraActive: boolean;
  layoutMode: 'split' | 'pip';
  onTogglePractice: () => void;
  onReset: () => void;
  onOpenUpload: () => void;
  onToggleCamera: () => void;
  onToggleLayout: () => void;
  onOpenSettings: () => void;
}

/**
 * フローティング・ボーダーレス・アイコンファーストの操作パネル
 */
export const ControlBar: React.FC<ControlBarProps> = ({
  isPracticing,
  hasSequence,
  isCameraActive,
  layoutMode,
  onTogglePractice,
  onReset,
  onOpenUpload,
  onToggleCamera,
  onToggleLayout,
  onOpenSettings,
}) => {
  return (
    <nav aria-label="Main controls" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
      <div className="flex items-center gap-2 bg-zinc-900/95 backdrop-blur-xl px-4 py-3 rounded-full shadow-2xl">
        {/* 動画アップロード/選択ボタン */}
        <button
          onClick={onOpenUpload}
          className="p-3 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer"
          title="Upload / Select Video"
          aria-label="Upload Video"
        >
          <Upload className="w-5 h-5" />
        </button>

        {/* カメラオン/オフボタン */}
        <button
          onClick={onToggleCamera}
          className={`p-3 rounded-full transition active:scale-95 cursor-pointer ${
            isCameraActive
              ? 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-100'
              : 'bg-zinc-800/30 text-zinc-500 hover:text-zinc-300'
          }`}
          title="Toggle Camera"
          aria-label="Toggle Camera"
        >
          <Camera className="w-5 h-5" />
        </button>

        {/* 練習開始 / 一時停止（メインアクションボタン） */}
        <button
          onClick={onTogglePractice}
          disabled={!hasSequence || !isCameraActive}
          className={`p-4 rounded-full transition-all active:scale-90 cursor-pointer ${
            !hasSequence || !isCameraActive
              ? 'bg-zinc-800/40 text-zinc-600 cursor-not-allowed'
              : isPracticing
              ? 'bg-white text-zinc-950 shadow-lg'
              : 'bg-zinc-100 hover:bg-white text-zinc-950 shadow-md'
          }`}
          title={isPracticing ? 'Pause Practice' : 'Start Practice'}
          aria-label={isPracticing ? 'Pause Practice' : 'Start Practice'}
        >
          {isPracticing ? (
            <Pause className="w-6 h-6 fill-current" />
          ) : (
            <Play className="w-6 h-6 fill-current ml-0.5" />
          )}
        </button>

        {/* リセット（最初から再生） */}
        <button
          onClick={onReset}
          disabled={!hasSequence}
          className={`p-3 rounded-full transition active:scale-95 cursor-pointer ${
            !hasSequence
              ? 'bg-zinc-800/30 text-zinc-600 cursor-not-allowed'
              : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white'
          }`}
          title="Reset to Beginning"
          aria-label="Reset"
        >
          <RotateCcw className="w-5 h-5" />
        </button>

        {/* 画面レイアウト切り替え（Split / PiP） */}
        <button
          onClick={onToggleLayout}
          className="p-3 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer"
          title="Toggle Layout"
          aria-label="Toggle Layout"
        >
          {layoutMode === 'split' ? (
            <LayoutTemplate className="w-5 h-5" />
          ) : (
            <Columns className="w-5 h-5" />
          )}
        </button>

        {/* 設定モーダルオープン */}
        <button
          onClick={onOpenSettings}
          className="p-3 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer"
          title="Settings"
          aria-label="Settings"
        >
          <SlidersHorizontal className="w-5 h-5" />
        </button>
      </div>
    </nav>
  );
};
