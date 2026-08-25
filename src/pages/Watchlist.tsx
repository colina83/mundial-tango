import { Link } from "react-router-dom";
import { CoupleCard } from "../components/CoupleCard";
import { useData } from "../context/DataContext";
import { useI18n } from "../context/I18nContext";
import { useWatchlist } from "../context/WatchlistContext";
import { matchesQuery } from "../lib/format";
import { useState } from "react";
import type { ScoreRow } from "../types";

export function WatchlistPage() {
  const { data } = useData();
  const { t } = useI18n();
  const { pins } = useWatchlist();
  const [query, setQuery] = useState("");
  if (!data) return null;

  const rows = pins
    .map((p) =>
      data.rows.find((r) => r.coupleId === p.coupleId && r.blockId === p.blockId),
    )
    .filter((r): r is ScoreRow => Boolean(r))
    .filter((r) => matchesQuery(r, query));

  return (
    <div className="page">
      <h1>{t("navWatchlist")}</h1>
      <input
        className="search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("searchPlaceholder")}
        type="search"
      />
      {pins.length === 0 ? (
        <div className="empty">
          <p>{t("emptyWatch")}</p>
          <Link className="btn" to="/rankings">
            {t("watchCta")}
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">{t("noResults")}</div>
      ) : (
        <div className="card-list wide">
          {rows.map((row) => {
            const count =
              data.blocks.find((b) => b.id === row.blockId)?.coupleCount ?? 0;
            return (
              <CoupleCard
                key={`${row.blockId}-${row.coupleId}`}
                row={row}
                coupleCount={count}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
