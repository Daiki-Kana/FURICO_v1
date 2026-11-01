import { useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { ScoreReport } from './components/ScoreReport';
import { VideoComparisonViewer } from './components/VideoComparisonViewer';
import { VideoSubmissionSlot } from './components/VideoSubmissionSlot';
import { evaluateDanceSubmission, type VideoEvaluationReport } from './lib/comparator/videoComparator';
import { processVideoFile, type ProcessVideoProgress } from './lib/pose/videoProcessor';
import type { DanceSequence, JointName } from './lib/pose/types';

export function App() {
  // 提出動画シーケンス
  const [modelSequence, setModelSequence] = useState<DanceSequence | null>(null);
  const [userSequence, setUserSequence] = useState<DanceSequence | null>(null);

  // 解析ステート
  const [isProcessingModel, setIsProcessingModel] = useState(false);
  const [modelProgress, setModelProgress] = useState<ProcessVideoProgress | null>(null);

  const [isProcessingUser, setIsProcessingUser] = useState(false);
  const [userProgress, setUserProgress] = useState<ProcessVideoProgress | null>(null);

  // 評価レポートと再生時刻
  const [evaluationReport, setEvaluationReport] = useState<VideoEvaluationReport | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);

  // お手本動画の読み込み処理
  const handleModelFile = async (file: File) => {
    setIsProcessingModel(true);
    setModelProgress(null);
    try {
      const seq = await processVideoFile(file, {
        fps: 15,
        onInitialized: (initialSeq) => {
          setModelSequence(initialSeq); // ドロップした瞬間に即座にプレビュー表示！
        },
        onProgress: setModelProgress,
      });
      setModelSequence(seq);
      // もし自撮り動画がすでに存在していれば評価を更新
      if (userSequence && userSequence.frames.length > 0) {
        const report = evaluateDanceSubmission(seq, userSequence);
        setEvaluationReport(report);
      }
    } catch (err) {
      console.error('Model analysis failed:', err);
    } finally {
      setIsProcessingModel(false);
      setModelProgress(null);
    }
  };

  // 提出動画（自撮りダンス）の読み込み処理
  const handleUserFile = async (file: File) => {
    setIsProcessingUser(true);
    setUserProgress(null);
    try {
      const seq = await processVideoFile(file, {
        fps: 15,
        onInitialized: (initialSeq) => {
          setUserSequence(initialSeq); // ドロップした瞬間に即座にプレビュー表示！
        },
        onProgress: setUserProgress,
      });
      setUserSequence(seq);
      // お手本動画がすでに存在していれば即座に評価を算出
      if (modelSequence && modelSequence.frames.length > 0) {
        const report = evaluateDanceSubmission(modelSequence, seq);
        setEvaluationReport(report);
      }
    } catch (err) {
      console.error('User submission analysis failed:', err);
    } finally {
      setIsProcessingUser(false);
      setUserProgress(null);
    }
  };

  // 評価実行
  const startEvaluation = () => {
    if (!modelSequence || !userSequence) return;
    const report = evaluateDanceSubmission(modelSequence, userSequence);
    setEvaluationReport(report);
    setCurrentTime(0);
  };

  // リセット（新規提出）
  const handleResetAll = () => {
    setModelSequence(null);
    setUserSequence(null);
    setEvaluationReport(null);
    setCurrentTime(0);
  };

  // 現在再生時刻におけるズレ関節の特定
  const getActiveDiscrepancies = (): JointName[] => {
    if (!evaluationReport || !userSequence || !modelSequence) return [];
    // 現在時刻付近のキーイシューを抽出
    const active = evaluationReport.keyIssues
      .filter((k) => Math.abs(k.timestamp - currentTime) < 0.35)
      .map((k) => k.joint);
    return active;
  };

  return (
    <main className="relative w-full h-full min-h-screen bg-zinc-950 text-zinc-100 flex flex-col p-4 sm:p-6 overflow-y-auto select-none">
      {/* 画面ヘッダー（ミニマル） */}
      <header className="w-full flex items-center justify-between pb-4">
        <span className="text-xs font-black tracking-widest uppercase text-zinc-400">
          FURICO — DANCE EVALUATOR
        </span>

        {evaluationReport && (
          <button
            onClick={handleResetAll}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-bold tracking-wider uppercase transition active:scale-95 cursor-pointer shadow-md"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>NEW SUBMISSION</span>
          </button>
        )}
      </header>

      {/* 1. 動画提出画面（両方の動画が未完了または評価前） */}
      {!evaluationReport ? (
        <div className="flex-1 w-full max-w-4xl mx-auto flex flex-col justify-center items-center gap-6 py-6 animate-fadeIn">
          <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* スロット1: お手本動画 */}
            <VideoSubmissionSlot
              type="reference"
              label="REFERENCE DANCE"
              sublabel="SHARE YOUTUBE TAB OR DROP RECORDING"
              sequence={modelSequence}
              isProcessing={isProcessingModel}
              progress={modelProgress}
              onFileSelected={handleModelFile}
              onClearSequence={() => setModelSequence(null)}
            />

            {/* スロット2: 自分のダンス動画 */}
            <VideoSubmissionSlot
              type="user"
              label="YOUR DANCE SUBMISSION"
              sublabel="RECORD WITH CAMERA OR CHOOSE VIDEO"
              sequence={userSequence}
              isProcessing={isProcessingUser}
              progress={userProgress}
              onFileSelected={handleUserFile}
              onClearSequence={() => setUserSequence(null)}
            />
          </div>

          {/* 評価開始ボタン */}
          {modelSequence && userSequence && (
            <button
              onClick={startEvaluation}
              disabled={
                isProcessingModel ||
                isProcessingUser ||
                modelSequence.frames.length === 0 ||
                userSequence.frames.length === 0
              }
              className={`px-8 py-4 rounded-full flex items-center gap-3 font-bold text-xs tracking-widest uppercase transition active:scale-95 shadow-2xl ${
                isProcessingModel ||
                isProcessingUser ||
                modelSequence.frames.length === 0 ||
                userSequence.frames.length === 0
                  ? 'bg-zinc-850 text-zinc-500 cursor-not-allowed opacity-70'
                  : 'bg-white text-zinc-950 hover:bg-zinc-100 cursor-pointer animate-pulse'
              }`}
            >
              <span>
                {isProcessingModel || isProcessingUser
                  ? 'EXTRACTING SKELETON...'
                  : 'EVALUATE DANCE'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
        /* 2. 比較・採点レポート画面 */
        <div className="w-full max-w-5xl mx-auto flex flex-col gap-6 animate-fadeIn pb-12">
          {/* 同期サイドバイサイドプレイヤー */}
          {modelSequence && userSequence && (
            <VideoComparisonViewer
              modelSeq={modelSequence}
              userSeq={userSequence}
              currentTime={currentTime}
              onTimeUpdate={setCurrentTime}
              activeDiscrepancies={getActiveDiscrepancies()}
            />
          )}

          {/* 採点・詳細フィードバックレポート */}
          <ScoreReport
            report={evaluationReport}
            currentTime={currentTime}
            onSeek={setCurrentTime}
          />
        </div>
      )}
    </main>
  );
}

export default App;
