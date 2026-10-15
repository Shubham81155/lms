"use client";

import React from "react";
import {
  X,
  Award,
  ShieldCheck,
  CheckCircle2,
  Download,
  Share2,
  ExternalLink,
  QrCode,
} from "lucide-react";

interface CertificateVerificationProps {
  studentName: string;
  courseTitle: string;
  certificateId: string;
  onClose: () => void;
}

export const CertificateVerification: React.FC<CertificateVerificationProps> = ({
  studentName,
  courseTitle,
  certificateId,
  onClose,
}) => {
  const issueDate = "October 8, 2026";
  const signatureHash = "0x8f9c7a6e5d4c3b2a10f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7";

  return (
    <div className="fixed inset-0 z-50 bg-canvas/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-surface border border-line rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-canvas border-b border-line px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
              <Award className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-ink">W3C Verifiable Credential</h3>
              <p className="text-[11px] text-ink-muted">1EdTech Open Badges 3.0 Standard</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-raised text-ink-muted hover:text-ink transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Certificate Display Card */}
        <div className="p-8 bg-gradient-to-b from-surface to-canvas flex flex-col items-center text-center space-y-6">
          <div className="p-4 rounded-2xl bg-gradient-to-tr from-accent/10 via-brand/10 to-brand/10 border border-accent/30 w-full max-w-lg space-y-4">
            <div className="text-[11px] uppercase tracking-widest font-bold text-accent">
              Certificate of Academic Mastery
            </div>

            <h2 className="text-xl font-bold text-ink tracking-tight">{studentName}</h2>

            <p className="text-xs text-ink">
              has successfully fulfilled all requirements, proctored assessments, and rigorous laboratory coursework in
            </p>

            <div className="text-base font-semibold text-brand-fg py-1 border-y border-line/80">
              {courseTitle}
            </div>

            <div className="flex items-center justify-between text-[11px] text-ink-muted pt-2">
              <span>Issued: {issueDate}</span>
              <span className="font-mono text-ink">ID: {certificateId}</span>
            </div>
          </div>

          {/* Verification Audit Proof */}
          <div className="w-full max-w-lg bg-canvas border border-line rounded-xl p-4 text-left space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-success" />
                <span>Cryptographic Proof Status</span>
              </span>
              <span className="text-[10px] bg-success/10 text-success border border-success/30 px-2 py-0.5 rounded-full font-bold">
                VALID SIGNATURE
              </span>
            </div>

            <div className="text-[10px] font-mono text-ink-muted break-all bg-surface p-2 rounded border border-line">
              <span className="text-ink-subtle">SHA-256 Hash: </span>{signatureHash}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 w-full max-w-lg">
            <button
              onClick={() => {
                alert(`Downloaded Open Badges 3.0 JSON-LD Credential for ${studentName}`);
              }}
              className="flex-1 py-2.5 bg-brand hover:bg-brand-hover text-on-brand rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-brand/20 transition-all"
            >
              <Download className="h-4 w-4" />
              <span>Export Open Badge JSON-LD</span>
            </button>

            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-raised hover:bg-line text-ink rounded-xl text-xs font-semibold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
