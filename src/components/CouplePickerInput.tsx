import { useEffect, useRef, useState } from "react";
import { useI18n } from "../context/I18nContext";
import { fold, coupleName } from "../lib/format";
import type { ScoreRow } from "../types";

interface Props {
  rows: ScoreRow[];
  value: ScoreRow | null;
  onChange: (row: ScoreRow | null) => void;
  label: string;
  excluded?: number[];
  placeholder?: string;
}

export function CouplePickerInput({ rows, value, onChange, label, excluded = [], placeholder }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? rows.filter((r) => {
        if (excluded.includes(r.coupleId) && r.coupleId !== value?.coupleId) return false;
        const q = fold(query.trim());
        if (String(r.coupleId).includes(q)) return true;
        if (fold(r.dancer1).includes(q)) return true;
        if (fold(r.dancer2).includes(q)) return true;
        return false;
      }).slice(0, 12)
    : [];

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function select(row: ScoreRow) {
    onChange(row);
    setQuery("");
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setQuery("");
  }

  return (
    <div className="couple-picker" ref={containerRef}>
      <label className="couple-picker-label">{label}</label>
      {value ? (
        <div className="couple-picker-chosen">
          <span className="couple-picker-id">#{value.coupleId}</span>
          <span className="couple-picker-name">{coupleName(value)}</span>
          <button type="button" className="couple-picker-clear" onClick={clear} aria-label="Remove">
            ×
          </button>
        </div>
      ) : (
        <div className="couple-picker-field">
          <input
            type="text"
            className="search-input couple-picker-input"
            placeholder={placeholder ?? t("picksSearchCouple")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            autoComplete="off"
          />
          {open && filtered.length > 0 && (
            <ul className="couple-picker-dropdown" role="listbox">
              {filtered.map((row) => (
                <li
                  key={`${row.blockId}-${row.coupleId}`}
                  role="option"
                  aria-selected={false}
                  className="couple-picker-option"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(row);
                  }}
                >
                  <span className="couple-picker-option-id">#{row.coupleId}</span>
                  <span className="couple-picker-option-name">{coupleName(row)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
