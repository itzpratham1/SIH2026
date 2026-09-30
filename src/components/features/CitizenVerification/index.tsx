import React, { useState, useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import {
  verifyAndUnpackCertificate,
  tamperEnvelopeBase64,
  extractPayloadFromScannedText,
  type VerificationResult,
} from '../../../lib/cbor';
import {
  computeDecay,
  MANDATORY_CLARIFICATION_TEXT,
} from '../../../lib/decay';
import {
  queueOfflineComplaint,
  getOfflineComplaints,
  markComplaintSynced,
  deleteOfflineComplaint,
  recordScanHistory,
  getScanHistory,
  type OfflineComplaintRecord,
  type ScanHistoryRecord,
} from '../../../lib/offline-storage';
import type { ConfidenceResult, EnrichedCertificatePayload, RevocationEntry } from '../../../lib/types';
import defaultPublicKeyMeta from '../../../data/public-key.json';
import defaultRevocationListMeta from '../../../data/revocation-list.json';
import seedCertificatesData from '../../../data/seed-certificates.json';
import styles from './styles.module.css';

interface SeedCertificate {
  cert_id: string;
  instrument_id: string;
  instrument_type: string;
  physical_seal_number: string;
  device_model: string;
  mandi_cluster?: string;
  owner_name: string;
  location: string;
  officer_id: string;
  officer_name: string;
  last_verification_date: string;
  valid_until: string;
  confidence_basis: 'time_only' | 'time_and_usage';
  usage_counter?: number;
  usage_baseline?: number;
  cbor_base64: string;
}

const seedCerts = seedCertificatesData as unknown as SeedCertificate[];

export default function CitizenVerification() {
  const [activeTab, setActiveTab] = useState<'camera' | 'upload' | 'presets' | 'manual'>('camera');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [activeEnvelopeBase64, setActiveEnvelopeBase64] = useState<string>('');
  const [manualInput, setManualInput] = useState<string>('');
  const [isTamperedMode, setIsTamperedMode] = useState<boolean>(false);

  // Physical seal cross-check states
  const [sealCheckState, setSealCheckState] = useState<'pending' | 'verified' | 'mismatched'>('pending');
  const [sealMismatchReason, setSealMismatchReason] = useState<string>('CODE_MISMATCH');
  const [observedSealInput, setObservedSealInput] = useState<string>('');
  const [compareCodeInput, setCompareCodeInput] = useState<string>('');
  const [sealReportSubmitted, setSealReportSubmitted] = useState<boolean>(false);

  // Technical details accordion state
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);

  // Complaints & History states
  const [queuedComplaints, setQueuedComplaints] = useState<OfflineComplaintRecord[]>([]);
  const [showComplaintsTray, setShowComplaintsTray] = useState<boolean>(false);
  const [lastComplaintId, setLastComplaintId] = useState<string | null>(null);
  const [isSyncingComplaints, setIsSyncingComplaints] = useState<boolean>(false);
  const [copiedSeal, setCopiedSeal] = useState<boolean>(false);
  const [copiedCertId, setCopiedCertId] = useState<boolean>(false);

  const [scanHistory, setScanHistory] = useState<ScanHistoryRecord[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanLocked, setScanLocked] = useState<boolean>(false);
  const [availableCameras, setAvailableCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [fileScanning, setFileScanning] = useState<boolean>(false);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);

  const [scanFeedback, setScanFeedback] = useState<{
    source: 'camera' | 'file' | 'preset' | 'manual' | 'url';
    timestamp: number;
    rawText: string;
    certId?: string;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isScanningRef = useRef<boolean>(false);
  const cameraSessionRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Synthesized Web Audio instant verification chime
  const playScanBeep = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      const now = ctx.currentTime;
      // High-tech ascending dual-tone chime
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.08);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.12);
    } catch {}
  };

  // Check URL query parameters on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlPayload = params.get('payload') || params.get('cbor') || params.get('cbor_base64');
      const urlCertId = params.get('cert') || params.get('cert_id') || params.get('id');

      if (urlPayload) {
        handleNewPayload(urlPayload, 'url');
      } else if (urlCertId) {
        const found = seedCerts.find((c) => c.cert_id === urlCertId || c.instrument_id === urlCertId);
        if (found) {
          setSelectedPresetId(found.cert_id);
          setActiveEnvelopeBase64(found.cbor_base64);
          setScanFeedback({
            source: 'url',
            timestamp: Date.now(),
            rawText: urlCertId,
            certId: found.cert_id,
          });
        } else {
          handleNewPayload(urlCertId, 'url');
        }
      }
    }
  }, []);

  // Load complaints and history
  useEffect(() => {
    loadRecentHistory();
    loadComplaints();

    const handleComplaintsUpdate = () => {
      loadComplaints();
    };

    window.addEventListener('weighguard:complaints-updated', handleComplaintsUpdate);
    return () => {
      window.removeEventListener('weighguard:complaints-updated', handleComplaintsUpdate);
    };
  }, []);

  const loadRecentHistory = async () => {
    try {
      const history = await getScanHistory();
      setScanHistory(history);
    } catch {}
  };

  const loadComplaints = async () => {
    try {
      const complaints = await getOfflineComplaints();
      setQueuedComplaints(complaints);
    } catch {}
  };

  const stopCamera = () => {
    // Invalidate any in-flight camera startup sessions
    cameraSessionRef.current++;
    isScanningRef.current = false;
    setScanLocked(false);

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {}
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
    setTorchOn(false);
  };

  // High-performance camera scanner lifecycle
  const startCamera = async () => {
    setCameraError(null);
    setScanLocked(false);
    stopCamera();

    const currentSession = ++cameraSessionRef.current;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not supported in this browser context. Please use Photo Upload tab.');
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cameraSessionRef.current !== currentSession) return;
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        if (videoInputs.length > 0) {
          setAvailableCameras(
            videoInputs.map((d, idx) => ({
              id: d.deviceId,
              label: d.label || `Camera ${idx + 1}`,
            }))
          );
        }
      } catch {}

      if (cameraSessionRef.current !== currentSession) return;

      // Request High-Definition resolution & high frame-rate for crisp QR feature detection
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: selectedCameraId
          ? {
              deviceId: { exact: selectedCameraId },
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
              frameRate: { ideal: 60, min: 30 },
            }
          : {
              facingMode: { ideal: facingMode },
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
              frameRate: { ideal: 60, min: 30 },
            },
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err1) {
        if (cameraSessionRef.current !== currentSession) return;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: facingMode,
              width: { ideal: 1280, min: 640 },
              height: { ideal: 720, min: 480 },
            },
          });
        } catch (err2) {
          if (cameraSessionRef.current !== currentSession) return;
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        }
      }

      if (cameraSessionRef.current !== currentSession) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      // Apply continuous hardware auto-focus & exposure lock if supported by device
      try {
        const track = stream.getVideoTracks()[0];
        const caps: any = track.getCapabilities?.();
        setHasTorch(Boolean(caps?.torch));

        const advancedSettings: any[] = [];
        if (caps?.focusMode?.includes('continuous')) {
          advancedSettings.push({ focusMode: 'continuous' });
        }
        if (caps?.exposureMode?.includes('continuous')) {
          advancedSettings.push({ exposureMode: 'continuous' });
        }
        if (advancedSettings.length > 0) {
          await track.applyConstraints({ advanced: advancedSettings } as any);
        }
      } catch {}

      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');

        try {
          const playPromise = video.play();
          if (playPromise !== undefined) {
            await playPromise;
          }
        } catch (playErr: any) {
          if (
            playErr?.name === 'AbortError' ||
            (playErr?.message && playErr.message.includes('interrupted by a new load request'))
          ) {
            return;
          }
          if (playErr?.name === 'NotAllowedError') {
            setCameraError('Tap "Start Camera" to allow camera playback.');
            setIsScanning(false);
            isScanningRef.current = false;
            return;
          }
          throw playErr;
        }

        if (cameraSessionRef.current !== currentSession) {
          return;
        }

        setIsScanning(true);
        isScanningRef.current = true;

        // Engine A: Hardware accelerated BarcodeDetector (Chrome/Android/iOS 17+)
        let detector: any = null;
        if ('BarcodeDetector' in window) {
          try {
            detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
          } catch {}
        }

        let isDecodingFrame = false;

        const scanLoop = async () => {
          if (!isScanningRef.current || cameraSessionRef.current !== currentSession) return;
          const currentVideo = videoRef.current;
          const currentCanvas = canvasRef.current;

          if (
            !isDecodingFrame &&
            currentVideo &&
            currentCanvas &&
            currentVideo.readyState >= currentVideo.HAVE_CURRENT_DATA &&
            currentVideo.videoWidth > 0
          ) {
            isDecodingFrame = true;
            let decoded: string | null = null;

            // 1. Ultra-fast Native GPU BarcodeDetector (<1ms)
            if (detector) {
              try {
                const barcodes = await detector.detect(currentVideo);
                if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                  decoded = barcodes[0].rawValue;
                }
              } catch {}
            }

            // 2. High-speed jsQR engine with Center Region-of-Interest (ROI) + Multi-Scale fallback
            if (!decoded) {
              const ctx = currentCanvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                const vw = currentVideo.videoWidth;
                const vh = currentVideo.videoHeight;

                // Pass A: Center ROI crop (where citizen aligns the QR code in the viewfinder)
                // Drops pixel count by ~70%, reducing decode time to ~2-3ms
                const roiSize = Math.min(vw, vh) * 0.7;
                const roiX = (vw - roiSize) / 2;
                const roiY = (vh - roiSize) / 2;
                const targetSize = Math.min(Math.round(roiSize), 480);

                currentCanvas.width = targetSize;
                currentCanvas.height = targetSize;
                ctx.drawImage(currentVideo, roiX, roiY, roiSize, roiSize, 0, 0, targetSize, targetSize);
                let imgData = ctx.getImageData(0, 0, targetSize, targetSize);

                try {
                  const qr = (jsQR as any)(imgData.data, targetSize, targetSize, {
                    inversionAttempts: 'attemptBoth',
                  });
                  if (qr && qr.data) {
                    decoded = qr.data;
                  }
                } catch {}

                // Pass B: Full frame downsampled to max 640px dimension if center crop missed it
                if (!decoded) {
                  const scale = Math.min(1, 640 / Math.max(vw, vh));
                  const fw = Math.round(vw * scale);
                  const fh = Math.round(vh * scale);
                  currentCanvas.width = fw;
                  currentCanvas.height = fh;
                  ctx.drawImage(currentVideo, 0, 0, fw, fh);
                  imgData = ctx.getImageData(0, 0, fw, fh);

                  try {
                    const qr = (jsQR as any)(imgData.data, fw, fh, {
                      inversionAttempts: 'attemptBoth',
                    });
                    if (qr && qr.data) {
                      decoded = qr.data;
                    }
                  } catch {}
                }
              }
            }

            isDecodingFrame = false;

            if (decoded) {
              try {
                playScanBeep();
                navigator.vibrate?.([30, 40, 60]);
              } catch {}
              setScanLocked(true);
              handleNewPayload(decoded, 'camera');
              setTimeout(() => {
                stopCamera();
                setScanLocked(false);
                scrollToVerificationResults();
              }, 120);
              return;
            }
          }

          if (isScanningRef.current && cameraSessionRef.current === currentSession) {
            animFrameRef.current = requestAnimationFrame(scanLoop);
          }
        };

        animFrameRef.current = requestAnimationFrame(scanLoop);
      }
    } catch (err: unknown) {
      if (cameraSessionRef.current !== currentSession) {
        return;
      }
      let msg = 'Unable to access camera';
      if (err instanceof Error) {
        if (
          err.name === 'AbortError' ||
          err.message.includes('interrupted by a new load request')
        ) {
          return;
        }
        if (err.name === 'NotAllowedError' || err.message.toLowerCase().includes('denied')) {
          msg = 'Camera permission denied. Please allow camera access in browser settings.';
        } else if (err.name === 'NotFoundError') {
          msg = 'No camera found. Please use the Upload Photo tab.';
        } else {
          msg = err.message;
        }
      }
      setCameraError(msg);
      setIsScanning(false);
      isScanningRef.current = false;
    }
  };

  useEffect(() => {
    if (activeTab === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [activeTab, selectedCameraId, facingMode]);

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    try {
      const track = streamRef.current.getVideoTracks()[0];
      const nextState = !torchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setTorchOn(nextState);
    } catch {}
  };

  const flipCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
    setSelectedCameraId('');
  };

  // Smoothly scroll to the verification status hero banner, compensating for sticky header
  const scrollToVerificationResults = () => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = document.getElementById('verification-results');
        if (el) {
          const header = document.querySelector('header');
          const headerHeight = header ? header.getBoundingClientRect().height : 100;
          const rect = el.getBoundingClientRect();
          const targetScroll = window.scrollY + rect.top - headerHeight - 16;
          window.scrollTo({
            top: Math.max(0, targetScroll),
            behavior: 'smooth',
          });
        }
      }, 100);
    });
  };

  // High-accuracy multi-tier image scanner for 4K / mobile phone photo uploads
  const processImageFile = (file: File) => {
    setFileScanning(true);
    setCameraError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setUploadedPreview(dataUrl);

      const img = new Image();
      img.onload = async () => {
        let decodedText: string | null = null;

        // Tier 1: Hardware BarcodeDetector
        if ('BarcodeDetector' in window) {
          try {
            const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
            const barcodes = await detector.detect(img);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              decodedText = barcodes[0].rawValue;
            }
          } catch {}
        }

        // Tier 2: Multi-resolution jsQR passes for dense/high-res photos
        if (!decodedText) {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            const targetResolutions = [800, 1200, 500];
            for (const maxDim of targetResolutions) {
              if (decodedText) break;
              const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
              const w = Math.round(img.width * scale);
              const h = Math.round(img.height * scale);
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(img, 0, 0, w, h);
              const imageData = ctx.getImageData(0, 0, w, h);

              try {
                const code = (jsQR as any)(imageData.data, w, h, {
                  inversionAttempts: 'attemptBoth',
                });
                if (code && code.data) {
                  decodedText = code.data;
                }
              } catch {}
            }

            // Tier 3: Contrast-stretched pass for glare/shadowed stickers
            if (!decodedText) {
              const scale = Math.min(1, 800 / Math.max(img.width, img.height));
              const w = Math.round(img.width * scale);
              const h = Math.round(img.height * scale);
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(img, 0, 0, w, h);
              const imgData = ctx.getImageData(0, 0, w, h);
              const data = imgData.data;

              let minLum = 255;
              let maxLum = 0;
              for (let i = 0; i < data.length; i += 4) {
                const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                if (lum < minLum) minLum = lum;
                if (lum > maxLum) maxLum = lum;
              }
              const range = maxLum - minLum;
              if (range > 20 && range < 220) {
                for (let i = 0; i < data.length; i += 4) {
                  const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                  const stretched = Math.min(255, Math.max(0, ((lum - minLum) / range) * 255));
                  data[i] = stretched;
                  data[i + 1] = stretched;
                  data[i + 2] = stretched;
                }
                try {
                  const code = (jsQR as any)(data, w, h, { inversionAttempts: 'attemptBoth' });
                  if (code && code.data) {
                    decodedText = code.data;
                  }
                } catch {}
              }
            }
          }
        }

        setFileScanning(false);

        if (decodedText) {
          try {
            playScanBeep();
            navigator.vibrate?.([30, 40, 60]);
          } catch {}
          handleNewPayload(decodedText, 'file');
          scrollToVerificationResults();
        } else {
          setCameraError('No valid QR code detected in this image. Please try a clearer photo.');
        }
      };

      img.onerror = () => {
        setFileScanning(false);
        setCameraError('Failed to load image file.');
      };

      img.src = dataUrl;
    };

    reader.onerror = () => {
      setFileScanning(false);
      setCameraError('Failed to read file.');
    };

    reader.readAsDataURL(file);
  };

  const resetVerificationInteraction = () => {
    setIsTamperedMode(false);
    setSealCheckState('pending');
    setSealReportSubmitted(false);
    setObservedSealInput('');
    setCompareCodeInput('');
    setLastComplaintId(null);
  };

  const handleNewPayload = (
    rawInput: string,
    source: 'camera' | 'file' | 'preset' | 'manual' | 'url' = 'manual'
  ) => {
    resetVerificationInteraction();
    const resolved = extractPayloadFromScannedText(rawInput);
    setActiveEnvelopeBase64(resolved.trim());

    const verified = verifyAndUnpackCertificate(resolved);
    let matchedCertId = verified.payload?.cert_id;
    if (verified.isValid && matchedCertId) {
      const match = seedCerts.find((c) => c.cert_id === matchedCertId);
      if (match) {
        setSelectedPresetId(match.cert_id);
      }
    }

    setScanFeedback({
      source,
      timestamp: Date.now(),
      rawText: rawInput,
      certId: matchedCertId,
    });
  };

  const handlePresetSelect = (certId: string) => {
    setSelectedPresetId(certId);
    resetVerificationInteraction();
    if (!certId) {
      setActiveEnvelopeBase64('');
      setScanFeedback(null);
      return;
    }
    const found = seedCerts.find((c) => c.cert_id === certId);
    if (found) {
      setActiveEnvelopeBase64(found.cbor_base64);
      setScanFeedback({
        source: 'preset',
        timestamp: Date.now(),
        rawText: certId,
        certId: found.cert_id,
      });
      scrollToVerificationResults();
    }
  };

  const toggleTamperSimulation = () => {
    if (!isTamperedMode) {
      const tampered = tamperEnvelopeBase64(activeEnvelopeBase64);
      setActiveEnvelopeBase64(tampered);
      setIsTamperedMode(true);
    } else {
      const found = seedCerts.find((c) => c.cert_id === selectedPresetId);
      if (found) {
        setActiveEnvelopeBase64(found.cbor_base64);
      }
      setIsTamperedMode(false);
    }
  };

  // Run Ed25519 verification offline
  let verification: VerificationResult = {
    isValid: false,
    payload: null,
    signatureBase64: '',
    keyVersion: '',
  };

  if (activeEnvelopeBase64) {
    verification = verifyAndUnpackCertificate(
      activeEnvelopeBase64,
      defaultPublicKeyMeta.public_key_base64
    );
  }

  const payload: EnrichedCertificatePayload | null = verification.payload;

  // Revocation list lookup
  let revocationEntry: RevocationEntry | undefined;
  if (payload) {
    revocationEntry = defaultRevocationListMeta.revoked.find(
      (r) => r.cert_id === payload.cert_id || r.instrument_id === payload.instrument_id
    );
  }
  const isRevoked = Boolean(revocationEntry);

  // Compute Trust Decay & MPE Impact offline
  let confidence: ConfidenceResult | null = null;
  if (payload) {
    confidence = computeDecay(payload);
    if (!verification.isValid) {
      confidence = {
        ...confidence,
        score: 0,
        band: 'red',
        basis_description: 'Cryptographic signature mismatch. Payload was altered or forged.',
      };
    }
  }

  // Record scan in history
  useEffect(() => {
    if (payload && confidence) {
      const effectiveBand = !verification.isValid
        ? 'tampered'
        : isRevoked
          ? 'revoked'
          : confidence.band;

      recordScanHistory({
        cert_id: payload.cert_id,
        instrument_id: payload.instrument_id,
        device_model: payload.device_model,
        physical_seal_number: payload.physical_seal_number,
        band: effectiveBand as any,
        score: verification.isValid ? confidence.score : 0,
        isValid: verification.isValid,
      }).then(() => {
        loadRecentHistory();
      });
    }
  }, [payload?.cert_id, verification.isValid, isRevoked, isTamperedMode]);

  const isHighAlert =
    !verification.isValid ||
    isRevoked ||
    sealCheckState === 'mismatched' ||
    (confidence ? confidence.band === 'red' : false);

  const handleQueueOfflineComplaint = async (overrideIssue?: string, overrideNotes?: string) => {
    let issueType:
      | 'TAMPERED_SIGNATURE'
      | 'REVOKED_CERTIFICATE'
      | 'SEAL_MISMATCH'
      | 'EXCESSIVE_DRIFT_RED' = 'TAMPERED_SIGNATURE';

    let notes = '';

    if (overrideIssue) {
      issueType = overrideIssue as any;
      notes = overrideNotes || '';
    } else if (!verification.isValid) {
      issueType = 'TAMPERED_SIGNATURE';
      notes = 'Cryptographic mismatch: QR payload was altered or forged.';
    } else if (isRevoked) {
      issueType = 'REVOKED_CERTIFICATE';
      notes = `Revoked on ${revocationEntry?.revoked_at}: ${revocationEntry?.reason}`;
    } else if (sealCheckState === 'mismatched') {
      issueType = 'SEAL_MISMATCH';
      notes = `Seal check failed (${sealMismatchReason}). Observed: ${observedSealInput || 'None'}. Expected: ${payload?.physical_seal_number || ''}`;
    } else if (confidence && confidence.band === 'red') {
      issueType = 'EXCESSIVE_DRIFT_RED';
      notes = `Confidence score ${Math.round(confidence.score)}% (Red). Verification overdue.`;
    } else {
      issueType = 'SEAL_MISMATCH';
      notes = 'User reported discrepancy on physical instrument.';
    }

    const complaint = await queueOfflineComplaint({
      instrument_id: payload?.instrument_id || 'UNKNOWN-TAMPERED-QR',
      cert_id: payload?.cert_id,
      physical_seal_number: payload?.physical_seal_number,
      device_model: payload?.device_model,
      location: payload?.location,
      issue_type: issueType,
      notes,
    });

    setLastComplaintId(complaint.complaint_id);
    await loadComplaints();
    return complaint;
  };

  const handleReportSealViolation = async () => {
    const defectLabel =
      sealMismatchReason === 'CODE_MISMATCH'
        ? 'Code does not match certificate'
        : sealMismatchReason === 'WIRE_BROKEN'
          ? 'Wire seal broken or missing'
          : sealMismatchReason === 'SEAL_TAMPERED'
          ? 'Lead seal shows physical tampering'
          : 'Hologram damaged or fake';

    const notes = `Seal defect: ${defectLabel}. Observed code: "${observedSealInput.trim() || 'Illegible'}". Expected: "${payload?.physical_seal_number || ''}".`;
    await handleQueueOfflineComplaint('SEAL_MISMATCH', notes);
    setSealReportSubmitted(true);
  };

  const handleSyncAllComplaints = async () => {
    setIsSyncingComplaints(true);
    for (const c of queuedComplaints) {
      if (!c.synced) {
        await markComplaintSynced(c.complaint_id);
      }
    }
    await loadComplaints();
    setTimeout(() => {
      setIsSyncingComplaints(false);
    }, 500);
  };

  const handleDeleteComplaint = async (id: string) => {
    await deleteOfflineComplaint(id);
    await loadComplaints();
  };

  const getSmsHref = () => {
    if (!payload) {
      return `sms:1915?body=${encodeURIComponent(
        'WeighGuard Alert: Tampered QR code detected during verification.'
      )}`;
    }

    const issue = !verification.isValid
      ? 'TAMPERED_SIGNATURE'
      : isRevoked
        ? 'REVOKED_CERTIFICATE'
        : sealCheckState === 'mismatched'
          ? `SEAL_MISMATCH_${sealMismatchReason}`
          : 'OVERDUE_VERIFICATION';

    const text = `WeighGuard Alert: Scale ${payload.instrument_id} at ${payload.location}. Seal: ${payload.physical_seal_number}. Issue: ${issue}.`;
    return `sms:1915?body=${encodeURIComponent(text)}`;
  };

  const copySealNumber = () => {
    if (payload?.physical_seal_number) {
      navigator.clipboard?.writeText(payload.physical_seal_number);
      setCopiedSeal(true);
      setTimeout(() => setCopiedSeal(false), 2000);
    }
  };

  const copyCertId = () => {
    if (payload?.cert_id) {
      navigator.clipboard?.writeText(payload.cert_id);
      setCopiedCertId(true);
      setTimeout(() => setCopiedCertId(false), 2000);
    }
  };

  // Character-by-character seal comparator
  const renderCodeComparison = () => {
    if (!payload?.physical_seal_number) return null;
    const target = payload.physical_seal_number;
    const input = compareCodeInput.trim().toUpperCase();

    if (!input) return null;

    const isMatch = target.includes(input);
    const isExactMatch = target === input;

    return (
      <div className={styles.comparatorResult}>
        <div className={styles.comparatorLetters}>
          {target.split('').map((char, idx) => {
            const typedChar = input[idx];
            let statusClass = styles.comparatorNeutral;
            if (typedChar !== undefined) {
              statusClass = typedChar === char ? styles.comparatorMatch : styles.comparatorDiff;
            }
            return (
              <span key={idx} className={`${styles.comparatorLetter} ${statusClass}`}>
                {char}
              </span>
            );
          })}
        </div>
        <div className={styles.comparatorStatusText}>
          {isExactMatch ? (
            <span className={styles.matchTextSuccess}>
              ✓ Exact Match! Stamped seal is valid.
            </span>
          ) : isMatch ? (
            <span className={styles.matchTextSuccess}>
              ✓ Substring match ({input.length} characters verified)
            </span>
          ) : (
            <span className={styles.matchTextDanger}>
              ⚠️ Code mismatch! Stamped code does not match certificate.
            </span>
          )}
        </div>
      </div>
    );
  };

  // Score circular calculation
  const score = confidence ? Math.round(confidence.score) : 0;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  const bandThemeColor =
    !verification.isValid
      ? '#ef4444'
      : confidence?.band === 'green'
        ? '#10b981'
        : confidence?.band === 'amber'
          ? '#f59e0b'
          : '#ef4444';

  return (
    <div className={styles.container}>
      {/* ─── Mode Segment Control Bar ────────────────────────────────────────── */}
      <nav aria-label="Verification mode" className={styles.tabBar}>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'camera' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('camera')}
        >
          <span className={styles.tabIcon}>📷</span>
          <span>Camera</span>
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'upload' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          <span className={styles.tabIcon}>📁</span>
          <span>Upload</span>
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'presets' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('presets')}
        >
          <span className={styles.tabIcon}>⚡</span>
          <span>Presets</span>
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'manual' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('manual')}
        >
          <span className={styles.tabIcon}>✏️</span>
          <span>Manual</span>
        </button>
      </nav>

      {/* ─── Mode 1: Presets ─────────────────────────────────────────────────── */}
      {activeTab === 'presets' && (
        <section aria-label="Demo presets" className={styles.card}>
          <div className={styles.presetGroup}>
            <label htmlFor="preset-scenario-select" className={styles.fieldLabel}>
              Select a Test Scenario
            </label>
            <select
              id="preset-scenario-select"
              className={styles.selectInput}
              value={selectedPresetId}
              onChange={(e) => handlePresetSelect(e.target.value)}
            >
              <option value="">-- Choose a Demo Scenario --</option>
              <option value="CERT-2026-4401-1001">
                🟢 1. Valid Retail Scale (Green — Compliant)
              </option>
              <option value="CERT-2026-4410-1005">
                🟢 2. Fuel Dispenser Nozzle (Green — With Telemetry)
              </option>
              <option value="CERT-2026-4402-1003">
                🟡 3. Attention Due Scale (Amber — Moderate Wear)
              </option>
              <option value="CERT-2026-4403-1004">
                🔴 4. Overdue Scale (Red — Stamping Expired)
              </option>
              <option value="CERT-2026-4491-1002">
                🚫 5. Revoked Weighbridge (Revoked — Error Exceeded)
              </option>
              <option value="CERT-2026-1082-1008">
                🚫 6. Revoked Tabletop Scale (Revoked — Broken Seal)
              </option>
            </select>
          </div>
        </section>
      )}

      {/* ─── Mode 2: Live Camera ─────────────────────────────────────────────── */}
      {activeTab === 'camera' && (
        <section aria-label="Live camera scanner" className={styles.card}>
          <div className={styles.cameraHeader}>
            <h2 className={styles.sectionTitle}>
              <span>📷</span> Scan Scale QR Code
            </h2>
            <div className={styles.cameraToolGroup}>
              {hasTorch && (
                <button
                  type="button"
                  className={`${styles.toolButton} ${torchOn ? styles.toolButtonActive : ''}`}
                  onClick={toggleTorch}
                  title="Flashlight"
                >
                  {torchOn ? '🔦 On' : '🔦 Off'}
                </button>
              )}
              <button
                type="button"
                className={styles.toolButton}
                onClick={flipCamera}
                title="Switch Camera"
              >
                🔄 Flip
              </button>
            </div>
          </div>

          <div className={styles.videoViewport}>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={styles.videoElement}
              style={{ display: isScanning ? 'block' : 'none' }}
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {!isScanning && (
              <div className={styles.cameraPlaceholder}>
                <span style={{ fontSize: '36px', marginBottom: '4px' }}>📷</span>
                <p className={styles.cameraPlaceholderTitle}>Camera is paused</p>
                <p className={styles.cameraPlaceholderSub}>Tap Start Camera to scan</p>
              </div>
            )}

            {isScanning && (
              <div
                className={`${styles.scanTargetFrame} ${scanLocked ? styles.scanTargetLocked : ''}`}
              >
                <div className={styles.scanLaser}></div>
              </div>
            )}
          </div>

          {availableCameras.length > 1 && (
            <div className={styles.cameraLensRow}>
              <label htmlFor="camera-lens-select" className={styles.cameraLensLabel}>
                Lens:
              </label>
              <select
                id="camera-lens-select"
                className={styles.selectInputSmall}
                value={selectedCameraId}
                onChange={(e) => setSelectedCameraId(e.target.value)}
              >
                {availableCameras.map((cam, idx) => (
                  <option key={cam.id} value={cam.id}>
                    {cam.label || `Camera ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {cameraError && (
            <div className={styles.errorNotice}>
              <span>⚠️</span>
              <span>{cameraError}</span>
            </div>
          )}

          <div className={styles.cameraActions}>
            {!isScanning ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => {
                  startCamera();
                }}
              >
                <span>📸</span>
                <span>{scanFeedback ? 'Scan Another QR' : 'Start Camera'}</span>
              </button>
            ) : (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={stopCamera}
              >
                <span>⏹️ Pause Camera</span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* ─── Mode 3: Image Upload ────────────────────────────────────────────── */}
      {activeTab === 'upload' && (
        <section aria-label="Upload QR image" className={styles.card}>
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) processImageFile(file);
            }}
            style={{ display: 'none' }}
          />

          <h2 className={styles.sectionTitle}>
            <span>📁</span> Upload QR Photo or Screenshot
          </h2>

          {uploadedPreview ? (
            <div className={styles.previewContainer}>
              <img src={uploadedPreview} alt="Uploaded QR Code" className={styles.previewImg} />
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => fileInputRef.current?.click()}
                disabled={fileScanning}
              >
                <span>📁 {fileScanning ? 'Scanning...' : 'Choose Another Photo'}</span>
              </button>
            </div>
          ) : (
            <div
              className={styles.dropzone}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <span style={{ fontSize: '36px' }}>📸</span>
              <p className={styles.dropzoneTitle}>Tap to select photo or screenshot</p>
              <p className={styles.dropzoneSub}>PNG, JPG, WEBP formats supported</p>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                disabled={fileScanning}
              >
                <span>📁 Choose Photo</span>
              </button>
            </div>
          )}

          {cameraError && (
            <div className={styles.errorNotice}>
              <span>⚠️</span>
              <span>{cameraError}</span>
            </div>
          )}
        </section>
      )}

      {/* ─── Mode 4: Manual Input ────────────────────────────────────────────── */}
      {activeTab === 'manual' && (
        <section aria-label="Manual CBOR Input" className={styles.card}>
          <h2 className={styles.sectionTitle}>
            <span>✏️</span> Manual Code Entry
          </h2>
          <label htmlFor="manual-cbor-input" className={styles.fieldLabel}>
            Paste Base64 payload, Certificate URL, or Certificate ID
          </label>
          <textarea
            id="manual-cbor-input"
            className={styles.textareaInput}
            placeholder="e.g. CERT-2026-4401-1001 or o2FwWQJEsGdj..."
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            rows={3}
          />
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              if (manualInput.trim()) {
                handleNewPayload(manualInput, 'manual');
                scrollToVerificationResults();
              }
            }}
          >
            <span>Verify Payload</span>
          </button>
        </section>
      )}

      {/* ─── Verification Results (When Envelope is Active) ───────────────────── */}
      {activeEnvelopeBase64 ? (
        <div id="verification-results" className={styles.resultsStack}>
          {/* Status Hero Banner */}
          {verification.isValid ? (
            <div className={`${styles.statusBanner} ${styles.statusBannerValid}`}>
              <div className={styles.statusBannerIcon}>✓</div>
              <div className={styles.statusBannerBody}>
                <div className={styles.statusBannerTitle}>
                  Certificate Verified Authentic
                </div>
                <div className={styles.statusBannerSub}>
                  Official Ed25519 signature valid. No tampering detected.
                </div>
              </div>
            </div>
          ) : (
            <div className={`${styles.statusBanner} ${styles.statusBannerInvalid}`}>
              <div className={styles.statusBannerIcon}>⚠️</div>
              <div className={styles.statusBannerBody}>
                <div className={styles.statusBannerTitle}>
                  Signature Invalid / Tampered
                </div>
                <div className={styles.statusBannerSub}>
                  {verification.error || 'Cryptographic mismatch. Do not trust this weighing scale.'}
                </div>
              </div>
            </div>
          )}

          {/* Revocation Alert if applicable */}
          {isRevoked && (
            <div className={`${styles.statusBanner} ${styles.statusBannerRevoked}`}>
              <div className={styles.statusBannerIcon}>🚫</div>
              <div className={styles.statusBannerBody}>
                <div className={styles.statusBannerTitle}>
                  Certificate Revoked
                </div>
                <div className={styles.statusBannerSub}>
                  Reason: {revocationEntry?.reason || 'Statutory revocation by Legal Metrology.'}
                </div>
              </div>
            </div>
          )}

          {/* ─── 1. Physical Seal Cross-Check Card ────────────────────────────── */}
          {payload && (
            <section aria-label="Physical Seal Check" className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardHeaderIcon}>🔒</span>
                <div>
                  <h3 className={styles.cardTitle}>Physical Seal Check</h3>
                  <p className={styles.cardSubtitle}>
                    Check the lead/wire seal stamped on the machine
                  </p>
                </div>
              </div>

              {/* Stamped Seal Number Badge */}
              <div className={styles.sealBox}>
                <div className={styles.sealBoxHeader}>
                  <span>OFFICIAL SEAL NUMBER</span>
                  <button
                    type="button"
                    className={styles.copyBtn}
                    onClick={copySealNumber}
                  >
                    {copiedSeal ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
                <div className={styles.sealCode}>{payload.physical_seal_number}</div>
                <p className={styles.sealHint}>
                  The stamped number on the scale&apos;s lead seal must match this code exactly.
                </p>
              </div>

              {/* Fast digit comparator input */}
              <div className={styles.quickCompareGroup}>
                <input
                  id="seal-compare-input"
                  type="text"
                  className={styles.quickCompareInput}
                  placeholder={`Type physical digits to verify... (e.g. ${payload.physical_seal_number.slice(-4)})`}
                  value={compareCodeInput}
                  onChange={(e) => setCompareCodeInput(e.target.value)}
                  autoComplete="off"
                />
                {renderCodeComparison()}
              </div>

              {/* 2 Result Option Buttons */}
              <div className={styles.sealOptionGrid}>
                <button
                  type="button"
                  className={`${styles.sealOptionBtn} ${
                    sealCheckState === 'verified' ? styles.sealOptionBtnVerified : ''
                  }`}
                  onClick={() => {
                    setSealCheckState('verified');
                    setSealReportSubmitted(false);
                  }}
                >
                  <span className={styles.sealOptionIcon}>✓</span>
                  <div>
                    <div className={styles.sealOptionTitle}>Seal Matches</div>
                    <div className={styles.sealOptionSub}>Wire intact, digits match</div>
                  </div>
                </button>

                <button
                  type="button"
                  className={`${styles.sealOptionBtn} ${
                    sealCheckState === 'mismatched' ? styles.sealOptionBtnMismatched : ''
                  }`}
                  onClick={() => setSealCheckState('mismatched')}
                >
                  <span className={styles.sealOptionIcon}>⚠️</span>
                  <div>
                    <div className={styles.sealOptionTitle}>Seal Differs / Broken</div>
                    <div className={styles.sealOptionSub}>Wire cut, wrong code, or missing</div>
                  </div>
                </button>
              </div>

              {/* State 1: Confirmed Match */}
              {sealCheckState === 'verified' && (
                <div className={styles.sealSuccessPill}>
                  <span>✓</span>
                  <span>Physical seal verified intact by user.</span>
                  <button
                    type="button"
                    className={styles.textLink}
                    onClick={() => setSealCheckState('pending')}
                  >
                    Reset
                  </button>
                </div>
              )}

              {/* State 2: Mismatch / Broken Defect Form */}
              {sealCheckState === 'mismatched' && (
                <div className={styles.violationBox}>
                  <div className={styles.violationTitleRow}>
                    <span style={{ fontSize: '18px' }}>🚨</span>
                    <strong>Report Seal Issue</strong>
                  </div>

                  <div className={styles.defectChipGroup}>
                    <button
                      type="button"
                      className={`${styles.defectChip} ${sealMismatchReason === 'CODE_MISMATCH' ? styles.defectChipActive : ''}`}
                      onClick={() => setSealMismatchReason('CODE_MISMATCH')}
                    >
                      Wrong Code
                    </button>
                    <button
                      type="button"
                      className={`${styles.defectChip} ${sealMismatchReason === 'WIRE_BROKEN' ? styles.defectChipActive : ''}`}
                      onClick={() => setSealMismatchReason('WIRE_BROKEN')}
                    >
                      Wire Cut / Missing
                    </button>
                    <button
                      type="button"
                      className={`${styles.defectChip} ${sealMismatchReason === 'SEAL_TAMPERED' ? styles.defectChipActive : ''}`}
                      onClick={() => setSealMismatchReason('SEAL_TAMPERED')}
                    >
                      Seal Damaged
                    </button>
                    <button
                      type="button"
                      className={`${styles.defectChip} ${sealMismatchReason === 'HOLOGRAM_DAMAGED' ? styles.defectChipActive : ''}`}
                      onClick={() => setSealMismatchReason('HOLOGRAM_DAMAGED')}
                    >
                      Fake Hologram
                    </button>
                  </div>

                  <input
                    type="text"
                    className={styles.textInput}
                    placeholder="Observed stamped code (optional)"
                    value={observedSealInput}
                    onChange={(e) => setObservedSealInput(e.target.value)}
                  />

                  <div className={styles.violationBtnRow}>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={handleReportSealViolation}
                    >
                      🚨 File Violation Report
                    </button>
                    <a href={getSmsHref()} className={styles.secondaryButton}>
                      💬 SMS 1915
                    </a>
                  </div>

                  {sealReportSubmitted && (
                    <div className={styles.successToast}>
                      ✓ Violation reported! Queued in offline complaints database.
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ─── 2. Calibration Health & Trust Score ──────────────────────────── */}
          {payload && confidence && (
            <section aria-label="Calibration Trust Score" className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardHeaderIcon}>📊</span>
                <div>
                  <h3 className={styles.cardTitle}>Calibration Health</h3>
                  <p className={styles.cardSubtitle}>
                    Continuous trust decay computed offline on-device
                  </p>
                </div>
              </div>

              {/* Gauge Row */}
              <div className={styles.scoreRow}>
                <div className={styles.gaugeContainer}>
                  <svg className={styles.gaugeSvg} viewBox="0 0 80 80">
                    <circle className={styles.gaugeTrack} cx="40" cy="40" r={radius} />
                    <circle
                      className={styles.gaugeFill}
                      cx="40"
                      cy="40"
                      r={radius}
                      stroke={bandThemeColor}
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                    />
                  </svg>
                  <div className={styles.gaugeText}>
                    <span className={styles.gaugeScore}>{score}</span>
                    <span className={styles.gaugeMax}>/100</span>
                  </div>
                </div>

                <div className={styles.scoreInfo}>
                  <div
                    className={styles.bandBadge}
                    style={{
                      color: bandThemeColor,
                      borderColor: bandThemeColor,
                      backgroundColor:
                        confidence.band === 'green'
                          ? 'var(--wg-success-bg)'
                          : confidence.band === 'amber'
                            ? 'var(--wg-warning-bg)'
                            : 'var(--wg-critical-bg)',
                    }}
                  >
                    {!verification.isValid ? 'TAMPERED' : `${confidence.band.toUpperCase()} BAND`}
                  </div>
                  <div className={styles.scoreTitle}>
                    {!verification.isValid
                      ? 'Signature Void — Do Not Trust'
                      : confidence.band === 'green'
                        ? 'Recently Verified & Compliant'
                        : confidence.band === 'amber'
                          ? 'Attention Due — Wear Monitored'
                          : 'Overdue for Re-verification'}
                  </div>
                  <div className={styles.scoreDesc}>
                    {confidence.basis_description}
                  </div>
                </div>
              </div>

              {/* Simplified Spectrum Bar */}
              <div className={styles.spectrumBar}>
                <div className={styles.spectrumTrack}>
                  <div className={styles.trackRed}>Red (&lt;40)</div>
                  <div className={styles.trackAmber}>Amber (40-69)</div>
                  <div className={styles.trackGreen}>Green (70-100)</div>
                  <div
                    className={styles.spectrumPointer}
                    style={{ left: `${Math.min(Math.max(score, 3), 97)}%` }}
                  >
                    <div className={styles.pointerPin} style={{ backgroundColor: bandThemeColor }} />
                  </div>
                </div>
              </div>

              {/* Technical Accordion Toggle */}
              <button
                type="button"
                className={styles.accordionToggle}
                onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
              >
                <span>{showTechnicalDetails ? '▼' : '▶'} View Technical &amp; Legal Details</span>
              </button>

              {showTechnicalDetails && (
                <div className={styles.accordionContent}>
                  <div className={styles.techRow}>
                    <span>MPE Tolerance Limit:</span>
                    <strong>{confidence.economic_impact.mpe_status_text}</strong>
                  </div>
                  <div className={styles.techRow}>
                    <span>Estimated Consumer Drift:</span>
                    <strong>{confidence.economic_impact.max_drift_pct}%</strong>
                  </div>
                  <div className={styles.techRow}>
                    <span>Statutory Rule:</span>
                    <span>{confidence.economic_impact.statutory_rule}</span>
                  </div>
                  <div className={styles.statutoryNote}>
                    <strong>Section 15 Notice:</strong> {MANDATORY_CLARIFICATION_TEXT}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ─── 3. Instrument & Merchant Details ─────────────────────────────── */}
          {payload && (
            <section aria-label="Instrument details" className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardHeaderIcon}>📋</span>
                <h3 className={styles.cardTitle}>Scale &amp; Owner Details</h3>
              </div>

              <div className={styles.detailsList}>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Instrument ID</span>
                  <span className={styles.detailValueMono}>{payload.instrument_id}</span>
                </div>

                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Certificate ID</span>
                  <div className={styles.detailValueRow}>
                    <span className={styles.detailValueMono}>{payload.cert_id}</span>
                    <button type="button" className={styles.copySmallBtn} onClick={copyCertId}>
                      {copiedCertId ? '✓' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Model</span>
                  <span className={styles.detailValue}>{payload.device_model}</span>
                </div>

                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Merchant / Owner</span>
                  <span className={styles.detailValue}>{payload.owner_name}</span>
                </div>

                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Market / Location</span>
                  <span className={styles.detailValue}>
                    {payload.location} ({payload.mandi_cluster || 'APMC Yard'})
                  </span>
                </div>

                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Last Verified</span>
                  <span className={styles.detailValue}>
                    {new Date(payload.last_verification_date).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>

                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Valid Until</span>
                  <span className={styles.detailValue}>
                    {new Date(payload.valid_until).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>

                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Inspected By</span>
                  <span className={styles.detailValue}>
                    {payload.officer_name} ({payload.officer_id})
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* ─── 4. Quick Action Buttons ──────────────────────────────────────── */}
          <div className={styles.actionGrid}>
            <button
              type="button"
              className={`${styles.demoTamperBtn} ${isTamperedMode ? styles.demoTamperBtnActive : ''}`}
              onClick={toggleTamperSimulation}
            >
              {isTamperedMode ? '↺ Restore Authentic QR' : '🧪 Test Tampered QR Demo'}
            </button>

            {isHighAlert && (
              <a href={getSmsHref()} className={styles.dangerButton}>
                🚨 1-Tap SMS to 1915
              </a>
            )}
          </div>

          {/* ─── 5. Collapsible Complaints & History Drawers ──────────────────── */}
          <div className={styles.drawerCard}>
            <button
              type="button"
              className={styles.drawerToggle}
              onClick={() => setShowComplaintsTray(!showComplaintsTray)}
            >
              <div className={styles.drawerToggleLeft}>
                <span>{showComplaintsTray ? '▼' : '▶'}</span>
                <span>Offline Complaints Queue</span>
                <span className={styles.counterPill}>{queuedComplaints.length}</span>
              </div>
              <span className={styles.drawerToggleRight}>
                {queuedComplaints.filter((c) => !c.synced).length > 0
                  ? `${queuedComplaints.filter((c) => !c.synced).length} pending sync`
                  : 'Synced'}
              </span>
            </button>

            {showComplaintsTray && (
              <div className={styles.drawerBody}>
                {queuedComplaints.length > 0 && (
                  <div className={styles.drawerActionRow}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={handleSyncAllComplaints}
                      disabled={isSyncingComplaints}
                    >
                      {isSyncingComplaints ? '🔄 Syncing...' : '⚡ Sync All to Portal'}
                    </button>
                  </div>
                )}

                {queuedComplaints.length === 0 ? (
                  <p className={styles.emptyText}>No offline complaints queued.</p>
                ) : (
                  <div className={styles.complaintItems}>
                    {queuedComplaints.map((item) => (
                      <div key={item.complaint_id} className={styles.complaintItem}>
                        <div className={styles.complaintItemTop}>
                          <span className={styles.monoId}>{item.complaint_id}</span>
                          <span className={item.synced ? styles.syncedPill : styles.pendingPill}>
                            {item.synced ? 'Synced' : 'Pending'}
                          </span>
                        </div>
                        <div className={styles.complaintItemBody}>
                          <div><strong>Scale:</strong> {item.instrument_id}</div>
                          <div><strong>Issue:</strong> {item.issue_type.replace(/_/g, ' ')}</div>
                          {item.notes && <div className={styles.complaintNotes}>{item.notes}</div>}
                        </div>
                        <div className={styles.complaintItemActions}>
                          <a
                            href={`sms:1915?body=${encodeURIComponent(
                              `WeighGuard Complaint ${item.complaint_id}: ${item.issue_type} on ${item.instrument_id}`
                            )}`}
                            className={styles.textAction}
                          >
                            SMS 1915
                          </a>
                          <button
                            type="button"
                            className={styles.textAction}
                            onClick={() => handleDeleteComplaint(item.complaint_id)}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Collapsible Recent Scan History */}
          <div className={styles.drawerCard}>
            <button
              type="button"
              className={styles.drawerToggle}
              onClick={() => setShowHistory(!showHistory)}
            >
              <div className={styles.drawerToggleLeft}>
                <span>{showHistory ? '▼' : '▶'}</span>
                <span>Recent Scans</span>
                <span className={styles.counterPill}>{scanHistory.length}</span>
              </div>
            </button>

            {showHistory && (
              <div className={styles.drawerBody}>
                {scanHistory.length === 0 ? (
                  <p className={styles.emptyText}>No recent scans.</p>
                ) : (
                  <div className={styles.historyList}>
                    {scanHistory.map((item) => (
                      <div
                        key={item.scan_id}
                        className={styles.historyRow}
                        onClick={() => {
                          const found = seedCerts.find((c) => c.cert_id === item.cert_id);
                          if (found) {
                            setSelectedPresetId(found.cert_id);
                            setActiveEnvelopeBase64(found.cbor_base64);
                            resetVerificationInteraction();
                          }
                        }}
                      >
                        <div>
                          <div className={styles.historyId}>{item.instrument_id}</div>
                          <div className={styles.historyModel}>{item.device_model}</div>
                        </div>
                        <div className={styles.historyRight}>
                          <span
                            className={styles.historyBand}
                            style={{
                              color:
                                item.band === 'green'
                                  ? '#10b981'
                                  : item.band === 'amber'
                                    ? '#f59e0b'
                                    : '#ef4444',
                            }}
                          >
                            {item.band.toUpperCase()}
                          </span>
                          <span className={styles.historyTime}>
                            {new Date(item.scanned_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Empty Prompt State */
        <div className={styles.emptyCard}>
          <span style={{ fontSize: '40px', marginBottom: '8px' }}>⚖️</span>
          <h3 className={styles.emptyTitle}>Ready to Verify</h3>
          <p className={styles.emptySub}>
            Scan the QR sticker on the weighing scale, upload a photo, or select a demo preset above.
          </p>
        </div>
      )}
    </div>
  );
}
