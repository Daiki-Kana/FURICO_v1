import { COMPARISON_JOINTS, generateAdvice } from './slidingWindow';
import type { DanceSequence, JointName } from '../pose/types';

export interface TimelineErrorPoint {
  timestamp: number;
  error: number; // 0 (完璧) 〜 1 (大ズレ)
  worstJoint: JointName | null;
}

export interface KeyIssue {
  timestamp: number;
  joint: JointName;
  userAngle: number;
  modelAngle: number;
  delta: number;
  advice: string;
}

export interface VideoEvaluationReport {
  overallScore: number; // 0〜100点
  duration: number;
  jointScores: {
    arms: number; // 左右肘
    shoulders: number; // 左右肩
    hips: number; // 左右股関節
    legs: number; // 左右膝
  };
  timelineErrors: TimelineErrorPoint[];
  keyIssues: KeyIssue[];
}

/**
 * 2つのダンス動画シーケンス（お手本と提出動画）を全編比較し、総合スコアと評価レポートを生成する
 */
export function evaluateDanceSubmission(
  modelSeq: DanceSequence,
  userSeq: DanceSequence,
  windowSeconds = 0.4,
  thresholdAngle = 20
): VideoEvaluationReport {
  const userFrames = userSeq.frames;
  const modelFrames = modelSeq.frames;

  if (userFrames.length === 0 || modelFrames.length === 0) {
    return {
      overallScore: 0,
      duration: 0,
      jointScores: { arms: 0, shoulders: 0, hips: 0, legs: 0 },
      timelineErrors: [],
      keyIssues: [],
    };
  }

  const timelineErrors: TimelineErrorPoint[] = [];
  const allIssues: KeyIssue[] = [];

  // 各部位ごとの累積誤差
  const jointErrorSums: Record<JointName, number> = {
    leftElbow: 0,
    rightElbow: 0,
    leftShoulder: 0,
    rightShoulder: 0,
    leftHip: 0,
    rightHip: 0,
    leftKnee: 0,
    rightKnee: 0,
  };

  let totalFramesCompared = 0;
  let totalMeanError = 0;

  for (const uFrame of userFrames) {
    const t = uFrame.timestamp;
    // お手本フレームから近傍のベストマッチを探索
    const minTime = t - windowSeconds;
    const maxTime = t + windowSeconds;

    let candidates = modelFrames.filter((f) => f.timestamp >= minTime && f.timestamp <= maxTime);
    if (candidates.length === 0) {
      // 最も近いフレームを採用
      candidates = [
        modelFrames.reduce((prev, curr) =>
          Math.abs(curr.timestamp - t) < Math.abs(prev.timestamp - t) ? curr : prev
        ),
      ];
    }

    // ベストマッチ探索
    let bestModel = candidates[0];
    let minErr = 999;

    for (const c of candidates) {
      let errSum = 0;
      for (const j of COMPARISON_JOINTS) {
        errSum += Math.abs(uFrame.angles[j] - c.angles[j]);
      }
      if (errSum < minErr) {
        minErr = errSum;
        bestModel = c;
      }
    }

    // 各関節の誤差集計
    let frameMaxDelta = 0;
    let frameWorstJoint: JointName | null = null;
    let frameErrorSum = 0;

    for (const j of COMPARISON_JOINTS) {
      const uAngle = uFrame.angles[j];
      const mAngle = bestModel.angles[j];
      const delta = Math.abs(uAngle - mAngle);

      jointErrorSums[j] += delta;
      frameErrorSum += delta;

      if (delta > frameMaxDelta) {
        frameMaxDelta = delta;
        frameWorstJoint = j;
      }

      if (delta >= thresholdAngle) {
        allIssues.push({
          timestamp: Math.round(t * 10) / 10,
          joint: j,
          userAngle: Math.round(uAngle),
          modelAngle: Math.round(mAngle),
          delta: Math.round(delta),
          advice: generateAdvice(j, uAngle, mAngle),
        });
      }
    }

    const frameMeanErr = frameErrorSum / COMPARISON_JOINTS.length;
    totalMeanError += frameMeanErr;
    totalFramesCompared++;

    timelineErrors.push({
      timestamp: Math.round(t * 10) / 10,
      error: Math.min(1.0, frameMeanErr / 40), // 40度ズレでエラー度1.0
      worstJoint: frameWorstJoint,
    });
  }

  // 総合スコア（平均誤差0度で100点、40度で0点）
  const avgError = totalFramesCompared > 0 ? totalMeanError / totalFramesCompared : 40;
  const overallScore = Math.max(0, Math.min(100, Math.round(100 - (avgError / 40) * 100)));

  // 部位別スコア
  const calcGroupScore = (joints: JointName[]) => {
    let sum = 0;
    for (const j of joints) {
      sum += jointErrorSums[j];
    }
    const groupAvg = totalFramesCompared > 0 ? sum / (joints.length * totalFramesCompared) : 40;
    return Math.max(0, Math.min(100, Math.round(100 - (groupAvg / 40) * 100)));
  };

  const jointScores = {
    arms: calcGroupScore(['leftElbow', 'rightElbow']),
    shoulders: calcGroupScore(['leftShoulder', 'rightShoulder']),
    hips: calcGroupScore(['leftHip', 'rightHip']),
    legs: calcGroupScore(['leftKnee', 'rightKnee']),
  };

  // 課題箇所のソートと重複除去（ズレが大きいトップ5件）
  allIssues.sort((a, b) => b.delta - a.delta);
  const keyIssues: KeyIssue[] = [];
  const seenTimes = new Set<number>();

  for (const issue of allIssues) {
    if (!seenTimes.has(issue.timestamp)) {
      seenTimes.add(issue.timestamp);
      keyIssues.push(issue);
      if (keyIssues.length >= 5) break;
    }
  }

  return {
    overallScore,
    duration: Math.max(modelSeq.duration, userSeq.duration),
    jointScores,
    timelineErrors,
    keyIssues,
  };
}
