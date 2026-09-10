import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Renders a QR data URL for `url`. Returns an empty image while drawing or when `url` is empty; `failed` only for the current URL. */
export function useQr(url: string) {
  const [state, setState] = useState<{ url: string; dataUrl: string; failed: boolean }>({ url: '', dataUrl: '', failed: false });
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    QRCode.toDataURL(url, { width: 720, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#05071a', light: '#fff6e5' } })
      .then((value) => {
        if (!cancelled) setState({ url, dataUrl: value, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url, dataUrl: '', failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  const current = state.url === url;
  return { dataUrl: current ? state.dataUrl : '', failed: current && state.failed };
}
