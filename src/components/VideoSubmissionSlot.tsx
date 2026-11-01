import React, { useEffect, useRef, useState } from 'react';
import { Camera, Monitor, Square, Upload } from 'lucide-react';
import {
  isScreenCaptureSupported,
  startScreenRecording,
  type ProcessVideoProgress,
  type ScreenRecorderSession,
} from '../lib/pose/videoProcessor';
import { TrackedVideoPlayer } from './TrackedVideoPlayer';
import type { DanceSequence } from '../lib/pose/types';

interface VideoSubmissionSlotProps {
  type: 'reference' | 'user';
  label: string;
  sublabel: string;
  sequence: DanceSequence | null;
  isProcessing: boolean;
  progress: ProcessVideoProgress | null;
  onFileSelected: (file: File) => void;
  onClearSequence?: () => void;
}

export const VideoSubmissionSlot: React.FC<VideoSubmissionSlotProps> = ({
  type,
  label,
  sublabel,
  sequence,
  isProcessing,
  progress,
  onFileSelected,
  onClearSequence,
}) => {
  const [dragOver, setDragOver] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const recorderSessionRef = useRef<ScreenRecorderSession | null>(null);
  const timerRef = useRef<number | null>(null);

  const supportsScreenCapture = isScreenCaptureSupported();

  // 画面キャプチャの録画開始
  const handleStartCapture = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const session = await startScreenRecording();
      recorderSessionRef.current = session;
      setIsRecording(true);
      setRecordSeconds(0);

      const startTime = Date.now();
      timerRef.current = window.setInterval(() => {
        setRecordSeconds(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

      session.stream.getVideoTracks()[0].onended = async () => {
        handleStopCapture();
      };
    } catch (err) {
      console.warn('Screen capture cancelled or failed:', err);
      setIsRecording(false);
    }
  };

  // 画面キャプチャの録画停止
  const handleStopCapture = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (timerRef.current) clearInterval(timerRef.current);

    if (recorderSessionRef.current) {
      const file = await recorderSessionRef.current.stop();
      recorderSessionRef.current = null;
      setIsRecording(false);
      onFileSelected(file);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // シーケンスが存在する場合（先行ロード時または解析完了時）は即座にプレイヤーを表示！
  if (sequence) {
    return (
      <div className="relative w-full aspect-[4/3] rounded-3xl overflow-hidden shadow-xl">
        <TrackedVideoPlayer
          sequence={sequence}
          label={label}
          onReplace={onClearSequence ? onClearSequence : () => fileInputRef.current?.click()}
        />

        {/* バックグラウンド解析中のスマートなミニプログレス表示 */}
        {isProcessing && progress && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-950/90 text-xs font-bold tracking-widest uppercase text-white shadow-xl backdrop-blur-md pointer-events-none">
            <div className="w-2 h-2 rounded-full bg-white animate-ping" />
            <span>AI TRACKING {progress.progressPercent}%</span>
          </div>
        )}

        {/* 差し替え用の隠しinput */}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              onFileSelected(e.target.files[0]);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.[0]) {
          onFileSelected(e.dataTransfer.files[0]);
        }
      }}
      className={`relative w-full aspect-[4/3] rounded-3xl p-6 flex flex-col items-center justify-center transition select-none overflow-hidden ${
        dragOver ? 'bg-zinc-800' : 'bg-zinc-900/60'
      }`}
    >
      {/* 隠しファイル入力（通常動画・カメラロール） */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) {
            onFileSelected(e.target.files[0]);
          }
        }}
      />

      {/* 隠しカメラ直接起動入力（スマホ用） */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) {
            onFileSelected(e.target.files[0]);
          }
        }}
      />

      {/* 1. 画面共有の録画中状態 */}
      {isRecording ? (
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-950/80 text-red-400 text-xs font-bold tracking-widest uppercase animate-pulse">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
            RECORDING TAB ({recordSeconds}s)
          </div>
          <span className="text-[11px] text-zinc-400 uppercase tracking-wider max-w-[240px]">
            PLAY THE YOUTUBE DANCE NOW
          </span>
          <button
            onClick={handleStopCapture}
            className="px-6 py-3 rounded-full bg-white text-zinc-950 hover:bg-zinc-100 flex items-center gap-2 text-xs font-bold tracking-widest uppercase transition active:scale-95 cursor-pointer shadow-xl"
          >
            <Square className="w-4 h-4 fill-current text-red-600" />
            <span>FINISH & ANALYZE</span>
          </button>
        </div>
      ) : isProcessing && progress ? (
        /* 2. 解析中プログレス状態 */
        <div className="w-full flex flex-col items-center justify-center space-y-3 px-4">
          <span className="text-3xl font-black tabular-nums text-white">
            {progress.progressPercent}%
          </span>
          <div className="w-full max-w-[220px] bg-zinc-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-white h-full transition-all duration-150 rounded-full"
              style={{ width: `${progress.progressPercent}%` }}
            />
          </div>
          <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-400">
            EXTRACTING POSES ({progress.framesExtracted})
          </span>
        </div>
      ) : (
        /* 3. 未提出状態（選択ボタン群） */
        <div className="flex flex-col items-center text-center space-y-3 max-w-[280px]">
          <span className="text-xs font-black tracking-widest uppercase text-zinc-200">
            {label}
          </span>
          <span className="text-[10px] tracking-wider text-zinc-500 uppercase">
            {sublabel}
          </span>

          {/* お手本スロットの場合: 画面共有 ＆ ファイル選択 */}
          {type === 'reference' ? (
            <div className="w-full flex flex-col gap-2 pt-1">
              {/* PC向け: 画面共有ボタン */}
              {supportsScreenCapture && (
                <button
                  onClick={handleStartCapture}
                  className="w-full py-2.5 px-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white flex items-center justify-center gap-2.5 transition active:scale-98 cursor-pointer shadow-md"
                >
                  <Monitor className="w-4 h-4 text-zinc-300" />
                  <span className="text-xs font-bold tracking-wider uppercase">
                    SHARE YOUTUBE TAB
                  </span>
                </button>
              )}

              {/* スマホ画面録画 / ファイル選択ボタン */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`w-full py-2.5 px-4 rounded-2xl flex items-center justify-center gap-2.5 transition active:scale-98 cursor-pointer ${
                  supportsScreenCapture
                    ? 'bg-zinc-950/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-white shadow-md'
                }`}
              >
                <Upload className="w-4 h-4 text-zinc-400" />
                <span className="text-xs font-bold tracking-wider uppercase">
                  SCREEN RECORDING / MP4
                </span>
              </button>
            </div>
          ) : (
            /* 練習動画スロットの場合: カメラ直接撮影 ＆ カメラロール選択 */
            <div className="w-full flex flex-col gap-2 pt-1">
              {/* スマホ向け: カメラ直接起動録画 */}
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="w-full py-2.5 px-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white flex items-center justify-center gap-2.5 transition active:scale-98 cursor-pointer shadow-md"
              >
                <Camera className="w-4 h-4 text-zinc-300" />
                <span className="text-xs font-bold tracking-wider uppercase">
                  RECORD WITH CAMERA
                </span>
              </button>

              {/* 保存済み動画選択 */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2.5 px-4 rounded-2xl bg-zinc-950/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 flex items-center justify-center gap-2.5 transition active:scale-98 cursor-pointer"
              >
                <Upload className="w-4 h-4 text-zinc-400" />
                <span className="text-xs font-bold tracking-wider uppercase">
                  CHOOSE FROM ALBUM
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
