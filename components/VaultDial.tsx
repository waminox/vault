"use client";

import { motion } from "motion/react";

/** The vault door dial: idles slowly, spins while checking, swings open on success. */
export function VaultDial({ state }: { state: "idle" | "checking" | "error" | "open" }) {
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  return (
    <motion.div
      className="relative mx-auto size-36"
      animate={state === "error" ? { x: [0, -10, 10, -7, 7, -3, 0] } : state === "open" ? { scale: 1.08 } : { x: 0, scale: 1 }}
      transition={{ duration: state === "error" ? 0.45 : 0.6 }}
    >
      <div
        className="absolute inset-0 rounded-full blur-2xl transition-opacity duration-700"
        style={{
          background: "conic-gradient(from 0deg, #8b5cf6, #22d3ee, #8b5cf6)",
          opacity: state === "checking" ? 0.55 : state === "open" ? 0.9 : state === "error" ? 0 : 0.25,
        }}
      />
      <div
        className="absolute inset-0 rounded-full blur-2xl bg-red-500 transition-opacity duration-300"
        style={{ opacity: state === "error" ? 0.45 : 0 }}
      />
      <svg viewBox="0 0 200 200" className="relative size-full">
        <defs>
          <linearGradient id="dialG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c4b5fd" />
            <stop offset="1" stopColor="#67e8f9" />
          </linearGradient>
          <radialGradient id="dialFace" cx="0.4" cy="0.35" r="0.8">
            <stop offset="0" stopColor="#262638" />
            <stop offset="1" stopColor="#0d0d16" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="96" fill="url(#dialFace)" stroke="rgb(255 255 255 / 0.08)" strokeWidth="2" />
        <motion.g
          style={{ originX: "100px", originY: "100px" }}
          animate={{ rotate: state === "checking" ? [0, 360] : state === "open" ? 540 : state === "error" ? -30 : [0, 24, 0] }}
          transition={
            state === "checking"
              ? { duration: 1.1, repeat: Infinity, ease: "linear" }
              : state === "open"
                ? { duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }
                : state === "idle"
                  ? { duration: 9, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.3 }
          }
        >
          {ticks.map((i) => (
            <line
              key={i}
              x1="100"
              y1={i % 5 === 0 ? 14 : 18}
              x2="100"
              y2="24"
              stroke={i % 5 === 0 ? "url(#dialG)" : "rgb(255 255 255 / 0.22)"}
              strokeWidth={i % 5 === 0 ? 2.4 : 1.2}
              strokeLinecap="round"
              transform={`rotate(${i * 6} 100 100)`}
            />
          ))}
          <circle cx="100" cy="100" r="58" fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth="10" />
          {[0, 72, 144, 216, 288].map((a) => (
            <rect key={a} x="96" y="40" width="8" height="22" rx="4" fill="url(#dialG)" opacity="0.85" transform={`rotate(${a} 100 100)`} />
          ))}
        </motion.g>
        <circle cx="100" cy="100" r="26" fill="#0b0b12" stroke="url(#dialG)" strokeWidth="3" />
        <motion.path
          d="M92 101 l6 6 l12 -14"
          fill="none"
          stroke="url(#dialG)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: state === "open" ? 1 : 0, opacity: state === "open" ? 1 : 0 }}
          transition={{ delay: 0.5, duration: 0.35 }}
        />
        <motion.circle cx="100" cy="100" r="5" fill="url(#dialG)" animate={{ opacity: state === "open" ? 0 : 1 }} />
      </svg>
    </motion.div>
  );
}
