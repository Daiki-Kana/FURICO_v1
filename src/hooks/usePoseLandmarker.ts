import { useEffect, useRef, useState } from 'react';
import { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createPoseLandmarkerInstance } from '../lib/pose/landmarker';

export function usePoseLandmarker() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        setIsLoading(true);
        setError(null);
        const instance = await createPoseLandmarkerInstance('VIDEO');
        if (isMounted) {
          landmarkerRef.current = instance;
          setIsLoading(false);
        } else {
          instance.close();
        }
      } catch (err: unknown) {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : 'Failed to initialize MediaPipe Pose';
          setError(msg);
          setIsLoading(false);
        }
      }
    }

    init();

    return () => {
      isMounted = false;
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }
    };
  }, []);

  return {
    landmarkerRef,
    isLoading,
    error,
  };
}
