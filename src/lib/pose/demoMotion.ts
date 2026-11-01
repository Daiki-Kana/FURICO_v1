import { extractJointAngles } from './geometry';
import type { DanceSequence, NormalizedLandmark, PoseFrameData } from './types';

/**
 * 三角関数キネマティクスによる、滑らかで自然なデモダンスモーション（3.6秒ループ）を生成する
 */
export function generateDemoDanceSequence(): DanceSequence {
  const duration = 3.6;
  const fps = 20; // 抽出元20fps（補間により60fps以上で極めて滑らかに動く）
  const totalFrames = Math.round(duration * fps);
  const frames: PoseFrameData[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const time = i / fps;
    const progress = (time / duration) * (Math.PI * 2);

    // 体全体のグルーヴと左右リズム
    const bounceY = Math.abs(Math.sin(progress * 2)) * 0.04;
    const swayX = Math.sin(progress) * 0.05;
    const twistAngle = Math.sin(progress) * 0.3;

    // 基本ベース座標（直立）
    const centerY = 0.5 + bounceY;
    const centerX = 0.5 + swayX;

    // ランドマーク33点の生成
    const landmarks: NormalizedLandmark[] = new Array(33).fill(null).map(() => ({ x: centerX, y: centerY, z: 0 }));

    // 0: 鼻（頭部）
    landmarks[0] = { x: centerX, y: centerY - 0.32, z: Math.sin(progress) * 0.03 };
    // 7: 左耳, 8: 右耳
    landmarks[7] = { x: centerX - 0.03, y: centerY - 0.32, z: 0 };
    landmarks[8] = { x: centerX + 0.03, y: centerY - 0.32, z: 0 };

    // 11: 左肩, 12: 右肩
    const shoulderWidth = 0.12;
    landmarks[11] = {
      x: centerX - shoulderWidth,
      y: centerY - 0.22,
      z: -twistAngle * 0.05,
    };
    landmarks[12] = {
      x: centerX + shoulderWidth,
      y: centerY - 0.22,
      z: twistAngle * 0.05,
    };

    // 腕のウェーブモーション
    // 左腕: 上下・内外の滑らかなウェーブ
    const leftArmWave = Math.sin(progress * 2);
    landmarks[13] = {
      x: centerX - shoulderWidth - 0.08,
      y: centerY - 0.15 + leftArmWave * 0.06,
      z: 0.05,
    };
    landmarks[15] = {
      x: centerX - shoulderWidth - 0.13,
      y: centerY - 0.25 - Math.cos(progress * 2) * 0.1,
      z: 0.1,
    };

    // 右腕: リズムに合わせたパンプ動作
    const rightArmWave = Math.cos(progress * 2);
    landmarks[14] = {
      x: centerX + shoulderWidth + 0.08,
      y: centerY - 0.12 + rightArmWave * 0.06,
      z: -0.05,
    };
    landmarks[16] = {
      x: centerX + shoulderWidth + 0.14,
      y: centerY - 0.22 + Math.sin(progress * 2) * 0.09,
      z: 0.08,
    };

    // 23: 左腰, 24: 右腰
    const hipWidth = 0.08;
    landmarks[23] = {
      x: centerX - hipWidth,
      y: centerY,
      z: 0,
    };
    landmarks[24] = {
      x: centerX + hipWidth,
      y: centerY,
      z: 0,
    };

    // 脚のステップ・屈伸モーション
    // 左膝・足首
    const leftLegBend = Math.max(0, Math.sin(progress * 2)) * 0.05;
    landmarks[25] = {
      x: centerX - hipWidth - 0.02,
      y: centerY + 0.18 - leftLegBend,
      z: 0.04,
    };
    landmarks[27] = {
      x: centerX - hipWidth - 0.03 + Math.sin(progress) * 0.04,
      y: centerY + 0.36,
      z: 0,
    };

    // 右膝・足首
    const rightLegBend = Math.max(0, -Math.sin(progress * 2)) * 0.05;
    landmarks[26] = {
      x: centerX + hipWidth + 0.02,
      y: centerY + 0.18 - rightLegBend,
      z: -0.04,
    };
    landmarks[28] = {
      x: centerX + hipWidth + 0.03 - Math.sin(progress) * 0.04,
      y: centerY + 0.36,
      z: 0,
    };

    const angles = extractJointAngles(landmarks) || {
      leftElbow: 90,
      rightElbow: 90,
      leftShoulder: 45,
      rightShoulder: 45,
      leftHip: 170,
      rightHip: 170,
      leftKnee: 170,
      rightKnee: 170,
    };

    frames.push({
      timestamp: Math.round(time * 1000) / 1000,
      landmarks,
      angles,
    });
  }

  return {
    id: 'demo_groove_step',
    name: 'Sample Groove Step',
    duration,
    fps,
    createdAt: Date.now(),
    frames,
  };
}
