import React, { useEffect, useRef, useState } from 'react';
import { Monitor, Trash2, Upload, X } from 'lucide-react';
import { deleteDanceSequence, getAllDanceSequences, saveDanceSequence } from '../lib/db/poseStorage';
import { captureDisplayStream, processVideoFile, type ProcessVideoProgress } from '../lib/pose/videoProcessor';
import type { DanceSequence } from '../lib/pose/types';

interface VideoUploaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSequence: (sequence: DanceSequence) => void;
}

export const VideoUploaderModal: React.FC<VideoUploaderModalProps> = ({
  isOpen,
  onClose,
  onSelectSequence,
}) => {
  const [savedSequences, setSavedSequences] = useState<DanceSequence[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProcessVideoProgress | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 保存済みシーケンスの読み込み
  const reloadSaved = async () => {
    try {
      const items = await getAllDanceSequences();
      setSavedSequences(items);
    } catch (e) {
      console.warn('Failed to load sequences from IDB:', e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      reloadSaved();
    }
  }, [isOpen]);

  // ファイル解析処理
  const handleFile = async (file: File) => {
    if (!file.type.startsWith('video/')) return;
    setIsProcessing(true);
    setProgress(null);

    try {
      const sequence = await processVideoFile(file, {
        fps: 15,
        onProgress: (p) => setProgress(p),
      });

      // IndexedDBに保存
      await saveDanceSequence(sequence);
      await reloadSaved();

      // 自動選択して閉じる
      onSelectSequence(sequence);
      onClose();
    } catch (err) {
      console.error('Video extraction error:', err);
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  // 画面キャプチャAPI（getDisplayMedia）による取り込み
  const handleDisplayMedia = async () => {
    try {
      const stream = await captureDisplayStream();
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const file = new File([blob], `capture_${Date.now()}.webm`, { type: 'video/webm' });
        await handleFile(file);
      };

      mediaRecorder.start();

      // ストリームのトラック終了（ユーザーが共有停止を押した時）で録画停止
      const videoTrack = stream.getVideoTracks()[0];
      videoTrack.onended = () => {
        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      };
    } catch (e) {
      console.warn('Display capture cancelled or failed:', e);
    }
  };

  // シーケンスの削除
  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteDanceSequence(id);
    await reloadSaved();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-lg bg-zinc-900/95 rounded-3xl p-6 shadow-2xl space-y-6 max-h-[85vh] flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between shrink-0">
          <span className="text-xs font-bold tracking-widest uppercase text-zinc-400">
            REFERENCE DANCE
          </span>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-2 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition active:scale-95 cursor-pointer disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 解析中プログレス表示 */}
        {isProcessing && progress ? (
          <div className="p-8 bg-zinc-950/60 rounded-3xl flex flex-col items-center justify-center space-y-4">
            <span className="text-3xl font-black tabular-nums text-white">
              {progress.progressPercent}%
            </span>
            <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-white h-full transition-all duration-150 rounded-full"
                style={{ width: `${progress.progressPercent}%` }}
              />
            </div>
            <span className="text-xs tracking-wider uppercase text-zinc-400">
              EXTRACTING POSES ({progress.framesExtracted} FRAMES)
            </span>
          </div>
        ) : (
          <>
            {/* ドラッグ＆ドロップ / ファイルアップロード領域 */}
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
                  handleFile(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`p-8 rounded-3xl flex flex-col items-center justify-center transition cursor-pointer select-none ${
                dragOver
                  ? 'bg-zinc-800'
                  : 'bg-zinc-950/60 hover:bg-zinc-800/60 active:scale-[0.99]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    handleFile(e.target.files[0]);
                  }
                }}
              />
              <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
                <Upload className="w-6 h-6 text-zinc-300" />
              </div>
              <span className="text-xs font-bold tracking-wider uppercase text-zinc-300">
                DROP VIDEO OR CLICK TO BROWSE
              </span>
              <span className="text-[10px] tracking-wider text-zinc-500 uppercase mt-1">
                MP4 / WEBM
              </span>
            </div>

            {/* 画面キャプチャボタン */}
            <button
              onClick={handleDisplayMedia}
              className="w-full py-3 px-4 rounded-2xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 hover:text-white flex items-center justify-center gap-3 transition active:scale-98 cursor-pointer"
            >
              <Monitor className="w-4 h-4 text-zinc-400" />
              <span className="text-xs font-semibold tracking-wider uppercase">
                CAPTURE SCREEN / TAB
              </span>
            </button>
          </>
        )}

        {/* 保存済みシーケンスリスト（IndexedDB） */}
        {savedSequences.length > 0 && !isProcessing && (
          <div className="space-y-2 overflow-hidden flex flex-col flex-1">
            <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-500">
              SAVED SEQUENCES ({savedSequences.length})
            </span>
            <div className="space-y-1.5 overflow-y-auto pr-1">
              {savedSequences.map((seq) => (
                <div
                  key={seq.id}
                  onClick={() => {
                    onSelectSequence(seq);
                    onClose();
                  }}
                  className="flex items-center justify-between p-3.5 bg-zinc-950/50 hover:bg-zinc-800/60 rounded-2xl transition cursor-pointer group"
                >
                  <div className="flex flex-col min-w-0 pr-3">
                    <span className="text-xs font-medium text-zinc-200 truncate group-hover:text-white">
                      {seq.name}
                    </span>
                    <span className="text-[10px] text-zinc-500 tabular-nums">
                      {Math.round(seq.duration)}s · {seq.frames.length} poses
                    </span>
                  </div>

                  <button
                    onClick={(e) => handleDelete(e, seq.id)}
                    className="p-2 rounded-full hover:bg-zinc-700/60 text-zinc-500 hover:text-red-400 transition"
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
