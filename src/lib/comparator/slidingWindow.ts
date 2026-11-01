import type { ComparisonResult, JointAngles, JointDiff, JointName, PoseFrameData } from '../pose/types';

// 対象関節一覧
export const COMPARISON_JOINTS: JointName[] = [
  'leftElbow',
  'rightElbow',
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
];

/**
 * 関節ごとの修正アドバイス文（英語）を生成する
 */
export function generateAdvice(joint: JointName, userAngle: number, modelAngle: number): string {
  const diff = userAngle - modelAngle;

  switch (joint) {
    case 'leftElbow':
      return diff < 0 ? 'Extend Left Arm' : 'Bend Left Arm';
    case 'rightElbow':
      return diff < 0 ? 'Extend Right Arm' : 'Bend Right Arm';
    case 'leftShoulder':
      return diff < 0 ? 'Raise Left Arm' : 'Lower Left Arm';
    case 'rightShoulder':
      return diff < 0 ? 'Raise Right Arm' : 'Lower Right Arm';
    case 'leftKnee':
      return diff < 0 ? 'Straighten Left Leg' : 'Bend Left Knee';
    case 'rightKnee':
      return diff < 0 ? 'Straighten Right Leg' : 'Bend Right Knee';
    case 'leftHip':
      return diff < 0 ? 'Straighten Left Hip' : 'Bend Left Hip';
    case 'rightHip':
      return diff < 0 ? 'Straighten Right Hip' : 'Bend Right Hip';
    default:
      return 'Adjust Pose';
  }
}

/**
 * 2つの関節角度群の間の平均角度差分を計算する
 */
export function calculateMeanAngularError(anglesA: JointAngles, anglesB: JointAngles): number {
  let sum = 0;
  for (const joint of COMPARISON_JOINTS) {
    sum += Math.abs(anglesA[joint] - anglesB[joint]);
  }
  return sum / COMPARISON_JOINTS.length;
}

export interface SlidingWindowOptions {
  windowSeconds?: number; // 前後の検索ウィンドウ幅（秒、デフォルト ±0.5秒）
  angleThreshold?: number; // ズレと判定する角度閾値（度、デフォルト 20度）
}

/**
 * スライディングウィンドウ法によるリアルタイム動作比較
 * お手本動画の再生時刻 t に対して ±windowSeconds の範囲で最も誤差が小さいフレームを選択し、差分を判定する
 */
export function compareWithSlidingWindow(
  userAngles: JointAngles,
  videoCurrentTime: number,
  modelFrames: PoseFrameData[],
  options: SlidingWindowOptions = {}
): ComparisonResult | null {
  if (!modelFrames || modelFrames.length === 0) {
    return null;
  }

  const { windowSeconds = 0.5, angleThreshold = 20 } = options;

  const minTime = videoCurrentTime - windowSeconds;
  const maxTime = videoCurrentTime + windowSeconds;

  // 1. ウィンドウ範囲内のお手本フレームを抽出
  // バイナリサーチまたはフィルタ
  let candidateFrames = modelFrames.filter(
    (f) => f.timestamp >= minTime && f.timestamp <= maxTime
  );

  // ウィンドウ内にフレームが1つもない場合は、再生時刻に最も近いフレームを採用
  if (candidateFrames.length === 0) {
    let closestFrame = modelFrames[0];
    let minTimeDiff = Math.abs(closestFrame.timestamp - videoCurrentTime);

    for (let i = 1; i < modelFrames.length; i++) {
      const timeDiff = Math.abs(modelFrames[i].timestamp - videoCurrentTime);
      if (timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff;
        closestFrame = modelFrames[i];
      }
    }
    candidateFrames = [closestFrame];
  }

  // 2. ウィンドウ内で自撮り関節角度との総誤差が最小となるベストフレームを探索
  let bestFrame = candidateFrames[0];
  let minError = calculateMeanAngularError(userAngles, bestFrame.angles);

  for (let i = 1; i < candidateFrames.length; i++) {
    const error = calculateMeanAngularError(userAngles, candidateFrames[i].angles);
    if (error < minError) {
      minError = error;
      bestFrame = candidateFrames[i];
    }
  }

  // 3. 各関節の角度差分と不一致判定
  const diffs = {} as Record<JointName, JointDiff>;
  const activeDiscrepancies: JointName[] = [];
  let worstJoint: JointName | null = null;
  let maxDelta = 0;

  for (const joint of COMPARISON_JOINTS) {
    const uAngle = userAngles[joint];
    const mAngle = bestFrame.angles[joint];
    const delta = Math.abs(uAngle - mAngle);
    const isDiscrepancy = delta >= angleThreshold;

    const diff: JointDiff = {
      joint,
      userAngle: Math.round(uAngle * 10) / 10,
      modelAngle: Math.round(mAngle * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      isDiscrepancy,
      advice: generateAdvice(joint, uAngle, mAngle),
    };

    diffs[joint] = diff;

    if (isDiscrepancy) {
      activeDiscrepancies.push(joint);
      if (delta > maxDelta) {
        maxDelta = delta;
        worstJoint = joint;
      }
    }
  }

  // 4. 一致度スコアの計算（0〜100）
  // 平均誤差が0度なら100点、45度以上で0点
  const score = Math.max(0, Math.min(100, Math.round(100 - (minError / 45) * 100)));

  return {
    matchedTimestamp: bestFrame.timestamp,
    score,
    diffs,
    activeDiscrepancies,
    primaryAdvice: worstJoint ? diffs[worstJoint].advice : null,
  };
}
