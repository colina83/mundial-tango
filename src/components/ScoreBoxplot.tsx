import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../context/I18nContext";
import {
  SCORE_DOMAIN_HI,
  SCORE_DOMAIN_LO,
  boxplotFromRow,
} from "../lib/boxplot";
import type { ScoreRow } from "../types";

type Size = "row" | "card" | "hero";

function canHover(): boolean {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function ScoreBoxplot({
  row,
  size = "row",
}: {
  row: ScoreRow;
  size?: Size;
}) {
  const { t } = useI18n();
  const stats = boxplotFromRow(row);
  const trimmed = row.judges.some((j) => j.dropped);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<number>(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const tipId = useId();

  const lo = Math.min(SCORE_DOMAIN_LO, stats.min - 0.05);
  const hi = Math.max(SCORE_DOMAIN_HI, stats.max + 0.05);
  const vbW = size === "hero" ? 320 : size === "card" ? 280 : 220;
  const vbH = size === "hero" ? 64 : size === "card" ? 48 : 36;
  const padX = 14;
  const inner = vbW - padX * 2;
  const midY = size === "hero" ? 28 : vbH / 2;
  const boxH = size === "hero" ? 22 : size === "card" ? 18 : 14;

  const x = (v: number) => padX + ((v - lo) / (hi - lo)) * inner;

  const placeTip = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(280, window.innerWidth - 16);
    let left = r.left + r.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = r.bottom + 8;
    if (top + 240 > window.innerHeight) {
      top = Math.max(8, r.top - 248);
    }
    setPos({ top, left });
  };

  const cancelLeave = () => {
    window.clearTimeout(leaveTimer.current);
  };

  const scheduleClose = () => {
    cancelLeave();
    leaveTimer.current = window.setTimeout(() => setOpen(false), 140);
  };

  useEffect(() => {
    if (!open) return;
    placeTip();
    const close = (e: Event) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || tipRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("touchstart", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("touchstart", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const xMin = x(stats.min);
  const xMax = x(stats.max);
  const xLo = x(stats.boxLo);
  const xHi = x(stats.boxHi);
  const xMid = x(stats.boxMid);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`boxplot boxplot-${size} ${open ? "is-open" : ""}`}
        aria-expanded={open}
        aria-controls={tipId}
        aria-label={t("tapMarks")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!canHover()) {
            setOpen((v) => !v);
            placeTip();
          }
        }}
        onMouseEnter={() => {
          if (!canHover()) return;
          cancelLeave();
          setOpen(true);
          placeTip();
        }}
        onMouseLeave={() => {
          if (canHover()) scheduleClose();
        }}
      >
        <svg
          viewBox={`0 0 ${vbW} ${vbH}`}
          width="100%"
          height={vbH}
          role="img"
          aria-hidden="true"
        >
          <line
            x1={xMin}
            x2={xMax}
            y1={midY}
            y2={midY}
            className="boxplot-whisker"
          />
          <line
            x1={xMin}
            x2={xMin}
            y1={midY - boxH / 2}
            y2={midY + boxH / 2}
            className={`boxplot-cap ${trimmed ? "dropped" : ""}`}
          />
          <line
            x1={xMax}
            x2={xMax}
            y1={midY - boxH / 2}
            y2={midY + boxH / 2}
            className={`boxplot-cap ${trimmed ? "dropped" : ""}`}
          />
          <rect
            x={Math.min(xLo, xHi)}
            y={midY - boxH / 2}
            width={Math.max(2, Math.abs(xHi - xLo))}
            height={boxH}
            rx="3"
            className="boxplot-box"
          />
          <line
            x1={xMid}
            x2={xMid}
            y1={midY - boxH / 2}
            y2={midY + boxH / 2}
            className="boxplot-median"
          />
          <circle cx={xMin} cy={midY} r="3.2" className="boxplot-end" />
          <circle cx={xMax} cy={midY} r="3.2" className="boxplot-end" />
          {size === "hero" &&
            [5, 6, 7, 8].map((tick) => (
              <text
                key={tick}
                x={x(tick)}
                y={vbH - 4}
                className="boxplot-tick"
                textAnchor="middle"
              >
                {tick}
              </text>
            ))}
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            className="boxplot-tip"
            role="tooltip"
            style={{
              top: pos.top,
              left: pos.left,
              width: Math.min(280, window.innerWidth - 16),
            }}
            onMouseEnter={() => {
              cancelLeave();
              setOpen(true);
            }}
            onMouseLeave={() => {
              if (canHover()) scheduleClose();
            }}
          >
            <p className="boxplot-tip-title">{t("judges")}</p>
            <ul>
              {stats.judges.map((j) => (
                <li key={j.name} className={j.dropped ? "is-dropped" : ""}>
                  <span className="tip-name">{j.name}</span>
                  <span className="tip-score">{j.score.toFixed(2)}</span>
                  <span className="tip-flag">
                    {trimmed ? (j.dropped ? t("dropped") : t("kept")) : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="boxplot-tip-legend">{trimmed ? t("droppedHint") : t("droppedHintSimple")}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
