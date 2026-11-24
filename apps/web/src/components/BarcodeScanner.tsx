import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { tr } from '../lib/i18n';
import { cleanCode } from '../lib/scanCode';
import { Modal } from './Modal';
import { Button } from './ui/button';

// Reads a barcode or QR code with the phone or laptop camera (SCANNING_PLAN.md steps 2 and 4). The browser's own reader
// (BarcodeDetector: Chrome on Android and Mac) is used when there is one; otherwise ZXing (Apache-2.0), loaded only when needed so it
// does not weigh on every page. The code can also be typed (or sent by a USB scanner, which types it). Nothing is saved here: the code
// goes to onCode and the caller decides.

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = { new (o?: { formats?: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code', 'data_matrix'];

/** The browser's own reader, if it has one that reads at least one of our formats. */
async function nativeDetector(): Promise<Detector | null> {
  const D = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (!D) return null;
  try {
    const supported = (await D.getSupportedFormats?.()) ?? FORMATS;
    const formats = FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new D({ formats }) : null;
  } catch {
    return null;
  }
}

/** A barcode box with a Scan button, for the item forms. Hidden in the sample app (no camera flow there). */
export function BarcodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <label>
        {tr('Barcode (optional)')}
        <span className="flex items-center gap-2">
          <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={64} autoComplete="off" dir="ltr" />
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>{tr('Scan')}</Button>
        </span>
      </label>
      {open ? (
        <BarcodeScanner
          onCode={(code) => {
            onChange(code);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function BarcodeScanner({ title, onCode, onClose }: { title?: string; onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'no_camera'>('starting');
  const [typed, setTyped] = useState('');
  const done = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let zxingStop: (() => void) | undefined;
    const found = (raw: string) => {
      const code = cleanCode(raw);
      if (!code || done.current) return;
      done.current = true;
      onCodeRef.current(code);
    };
    (async () => {
      const el = video.current;
      if (!el || !navigator.mediaDevices?.getUserMedia) return setState('no_camera');
      const native = await nativeDetector();
      try {
        if (native) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
          if (stopped) return;
          el.srcObject = stream;
          await el.play();
          setState('scanning');
          const tick = async () => {
            if (stopped || done.current) return;
            try {
              const codes = await native.detect(el);
              if (codes[0]?.rawValue) return found(codes[0].rawValue);
            } catch {
              // a frame that could not be read: try the next one
            }
            timer = setTimeout(tick, 200);
          };
          void tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          if (stopped) return;
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, el, (result) => {
            if (result) found(result.getText());
          });
          zxingStop = () => controls.stop();
          if (stopped) return zxingStop();
          setState('scanning');
        }
      } catch {
        // no camera, or the person said no: typing still works
        if (!stopped) setState('no_camera');
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      zxingStop?.();
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
  }, []);

  // No form element here: the scanner opens inside other forms (an order, an item), and React would pass its submit to them.
  const use = () => {
    const code = cleanCode(typed);
    if (code) onCode(code);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    use();
  };

  return (
    <Modal title={title ?? tr('Scan a barcode')} onClose={onClose}>
      <div className="stack">
        <video ref={video} className="scanner-video" muted playsInline hidden={state === 'no_camera'} />
        <p className="muted small" aria-live="polite">
          {state === 'starting'
            ? tr('Starting the camera…')
            : state === 'scanning'
              ? tr('Hold the barcode inside the picture.')
              : tr('The camera could not start. Allow the camera in the browser, or type the barcode.')}
        </p>
        <div className="flex items-center gap-2">
          <input
            aria-label={tr('Barcode')}
            placeholder={tr('Or type the barcode')}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={onKey}
            autoComplete="off"
            dir="ltr"
          />
          <Button type="button" variant="outline" disabled={!typed.trim()} onClick={use}>{tr('Use')}</Button>
        </div>
      </div>
    </Modal>
  );
}
