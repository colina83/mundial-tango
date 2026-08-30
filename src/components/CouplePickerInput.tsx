import { useEffect, useId, useMemo, useRef, useState } from "react";
import { coupleName, fold } from "../lib/format";
import type { PickCandidate } from "../lib/picks";

interface CouplePickerInputProps {
  candidates: PickCandidate[];
  value: PickCandidate | null;
  excluded: number[];
  label: string;
  placeholder: string;
  removeLabel: string;
  emptyLabel: string;
  onChange: (candidate: PickCandidate | null) => void;
}

export function CouplePickerInput({
  candidates,
  value,
  excluded,
  label,
  placeholder,
  removeLabel,
  emptyLabel,
  onChange,
}: CouplePickerInputProps) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => {
    const q = fold(query);
    if (!q) return [];
    return candidates
      .filter(
        (candidate) =>
          !excluded.includes(candidate.coupleId) &&
          (String(candidate.coupleId).includes(q) ||
            fold(candidate.dancer1).includes(q) ||
            fold(candidate.dancer2).includes(q) ||
            fold(`${candidate.dancer1} ${candidate.dancer2}`).includes(q)),
      )
      .slice(0, 12);
  }, [candidates, excluded, query]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  function choose(candidate: PickCandidate) {
    onChange(candidate);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="couple-picker" ref={root}>
      <label htmlFor={`${listId}-input`}>{label}</label>
      {value ? (
        <div className="couple-picker-value">
          <span className="couple-picker-number">#{value.coupleId}</span>
          <span>{coupleName(value)}</span>
          <button type="button" onClick={() => onChange(null)} aria-label={removeLabel}>
            ×
          </button>
        </div>
      ) : (
        <div className="couple-picker-search">
          <input
            id={`${listId}-input`}
            className="search-input"
            value={query}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && results[active] ? `${listId}-${results[active].coupleId}` : undefined
            }
            autoComplete="off"
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && results.length) {
                event.preventDefault();
                setOpen(true);
                setActive((index) => (index + 1) % results.length);
              } else if (event.key === "ArrowUp" && results.length) {
                event.preventDefault();
                setActive((index) => (index - 1 + results.length) % results.length);
              } else if (event.key === "Enter" && open && results[active]) {
                event.preventDefault();
                choose(results[active]);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {open && query.trim() && (
            <div className="couple-picker-menu" id={listId} role="listbox">
              {results.length ? (
                results.map((candidate, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    id={`${listId}-${candidate.coupleId}`}
                    className={index === active ? "is-active" : ""}
                    key={candidate.coupleId}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(candidate)}
                  >
                    <strong>#{candidate.coupleId}</strong>
                    <span>{coupleName(candidate)}</span>
                  </button>
                ))
              ) : (
                <p>{emptyLabel}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
