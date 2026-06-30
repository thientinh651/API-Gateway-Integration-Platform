import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchPublicGatewayFeatures, type PublicGatewayFeatures } from '../lib/api';

type GatewayFeaturesContextValue = {
  features: PublicGatewayFeatures | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const GatewayFeaturesContext = createContext<GatewayFeaturesContextValue | null>(null);

export function GatewayFeaturesProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<PublicGatewayFeatures | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchPublicGatewayFeatures();
      setFeatures(data);
    } catch {
      setFeatures(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchPublicGatewayFeatures();
        if (!cancelled) setFeatures(data);
      } catch {
        if (!cancelled) setFeatures(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ features, loading, refresh }),
    [features, loading, refresh],
  );

  return (
    <GatewayFeaturesContext.Provider value={value}>{children}</GatewayFeaturesContext.Provider>
  );
}

export function useGatewayFeatures(): GatewayFeaturesContextValue {
  const ctx = useContext(GatewayFeaturesContext);
  if (!ctx) {
    throw new Error('useGatewayFeatures must be used within GatewayFeaturesProvider');
  }
  return ctx;
}
