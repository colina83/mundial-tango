import { useState } from "react";
import { CouplePickerInput } from "../components/CouplePickerInput";
import { useData } from "../context/DataContext";
import { useI18n } from "../context/I18nContext";
import { usePicks, type PickEntry, type VoterInfo } from "../context/PicksContext";
import type { ScoreRow } from "../types";

const SLOT_EMOJI = ["🥇", "🥈", "🥉"] as const;

export function Picks() {
  const { data, year, category } = useData();
  const { t } = useI18n();
  const { hasPicked, myPicks, submitPicks, clearPicks, votes } = usePicks();

  const already = hasPicked(year, category);
  const myVote = myPicks(year, category);

  const [firstName, setFirstName] = useState(myVote?.voter.firstName ?? "");
  const [lastName, setLastName] = useState(myVote?.voter.lastName ?? "");
  const [country, setCountry] = useState(myVote?.voter.country ?? "");
  const [tangoComm, setTangoComm] = useState(myVote?.voter.tangoComm ?? "");
  const [slots, setSlots] = useState<[ScoreRow | null, ScoreRow | null, ScoreRow | null]>([
    null,
    null,
    null,
  ]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  if (!data) return null;

  // Build community board — general (all categories for this year)
  const allVotesThisYear = votes.filter((v) => v.year === year);
  const boardMap = new Map<
    number,
    { coupleId: number; dancer1: string; dancer2: string; category: string; gold: number; silver: number; bronze: number }
  >();
  for (const vote of allVotesThisYear) {
    for (const pick of vote.picks) {
      const existing = boardMap.get(pick.coupleId) ?? {
        coupleId: pick.coupleId,
        dancer1: pick.dancer1,
        dancer2: pick.dancer2,
        category: vote.category,
        gold: 0,
        silver: 0,
        bronze: 0,
      };
      if (pick.rank === 1) existing.gold++;
      else if (pick.rank === 2) existing.silver++;
      else existing.bronze++;
      boardMap.set(pick.coupleId, existing);
    }
  }
  const board = [...boardMap.values()].sort((a, b) => {
    const scoreA = a.gold * 3 + a.silver * 2 + a.bronze;
    const scoreB = b.gold * 3 + b.silver * 2 + b.bronze;
    return scoreB - scoreA;
  });

  const excluded = slots.filter(Boolean).map((s) => s!.coupleId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !country.trim()) {
      setError(t("picksFieldsRequired"));
      return;
    }
    if (slots.some((s) => s === null)) {
      setError(t("picksAll3Required"));
      return;
    }
    const voter: VoterInfo = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      country: country.trim(),
      tangoComm: tangoComm.trim(),
    };
    const picks: PickEntry[] = (slots as ScoreRow[]).map((row, i) => ({
      coupleId: row.coupleId,
      rank: (i + 1) as 1 | 2 | 3,
      dancer1: row.dancer1,
      dancer2: row.dancer2,
    }));
    submitPicks(year, category, picks, voter);
    setEditing(false);
    setError("");
  }

  function startEdit() {
    if (myVote && data) {
      setFirstName(myVote.voter.firstName);
      setLastName(myVote.voter.lastName);
      setCountry(myVote.voter.country);
      setTangoComm(myVote.voter.tangoComm);
      const resolvedSlots = myVote.picks
        .sort((a, b) => a.rank - b.rank)
        .map((p) => data.rows.find((r) => r.coupleId === p.coupleId) ?? null);
      setSlots([
        resolvedSlots[0] ?? null,
        resolvedSlots[1] ?? null,
        resolvedSlots[2] ?? null,
      ]);
    }
    clearPicks(year, category);
    setEditing(true);
  }

  const showForm = !already || editing;
  const catLabel = category === "pista" ? t("categoryPistaShort") : t("categoryEscenarioShort");

  return (
    <div className="page picks-page">
      <section className="hero-panel picks-hero">
        <div className="hero-kicker">{t("picksKicker")}</div>
        <h1>
          {t("picksTitle")}
          <span> · {catLabel} {year}</span>
        </h1>
        <p className="lede">{t("picksSubtitle")}</p>
      </section>

      {/* ── Form (hidden when already voted and not editing) ── */}
      {showForm && (
        <section className="panel picks-form-panel">
          <h2>{t("picksYourTop3")}</h2>
          <form className="picks-form" onSubmit={handleSubmit} noValidate>
            <div className="picks-voter-row">
              <div className="picks-field">
                <label htmlFor="picks-fn">{t("picksVoterName")}</label>
                <input
                  id="picks-fn"
                  type="text"
                  className="search-input"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  maxLength={60}
                  required
                />
              </div>
              <div className="picks-field">
                <label htmlFor="picks-ln">{t("picksVoterLastName")}</label>
                <input
                  id="picks-ln"
                  type="text"
                  className="search-input"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  maxLength={60}
                  required
                />
              </div>
              <div className="picks-field">
                <label htmlFor="picks-country">{t("picksVoterCountry")}</label>
                <input
                  id="picks-country"
                  type="text"
                  className="search-input"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  maxLength={60}
                  required
                />
              </div>
              <div className="picks-field picks-field--wide">
                <label htmlFor="picks-comm">{t("picksVoterTangoComm")}</label>
                <input
                  id="picks-comm"
                  type="text"
                  className="search-input"
                  value={tangoComm}
                  onChange={(e) => setTangoComm(e.target.value)}
                  maxLength={80}
                  placeholder={t("picksVoterTangoCommHint")}
                />
              </div>
            </div>

            <div className="picks-slot-grid">
              {([0, 1, 2] as const).map((i) => (
                <div key={i} className="picks-slot">
                  <span className="picks-slot-emoji">{SLOT_EMOJI[i]}</span>
                  <CouplePickerInput
                    rows={data.rows}
                    value={slots[i]}
                    onChange={(row) => {
                      const next = [...slots] as typeof slots;
                      next[i] = row;
                      setSlots(next);
                    }}
                    label={t(i === 0 ? "picksSlot1" : i === 1 ? "picksSlot2" : "picksSlot3")}
                    excluded={excluded.filter((_, idx) => idx !== i)}
                  />
                </div>
              ))}
            </div>

            {error && <p className="picks-error">{error}</p>}

            <div className="picks-actions">
              <button type="submit" className="btn btn-primary picks-submit">
                {t("picksSubmit")}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ── My picks summary (after voting) ── */}
      {already && !editing && myVote && (
        <section className="panel picks-summary">
          <h2>{t("picksAlreadyVoted")}</h2>
          <p className="muted">
            {myVote.voter.firstName} {myVote.voter.lastName} · {myVote.voter.country}
            {myVote.voter.tangoComm ? ` · ${myVote.voter.tangoComm}` : ""}
          </p>
          <ol className="picks-my-list">
            {myVote.picks
              .sort((a, b) => a.rank - b.rank)
              .map((p) => (
                <li key={p.rank} className="picks-my-item">
                  <span className="picks-slot-emoji">{SLOT_EMOJI[p.rank - 1]}</span>
                  <span className="picks-my-id">#{p.coupleId}</span>
                  <span className="picks-my-name">
                    {p.dancer1} &amp; {p.dancer2}
                  </span>
                </li>
              ))}
          </ol>
          <button type="button" className="btn picks-edit-btn" onClick={startEdit}>
            {t("picksEditPicks")}
          </button>
        </section>
      )}

      {/* ── Community board (general — all categories for this year) ── */}
      <section className="panel">
        <h2>
          {t("picksCommunityBoard")}
          {allVotesThisYear.length > 0 && (
            <span className="picks-board-count">
              {" "}— {allVotesThisYear.length} {t("picksVotes")}
            </span>
          )}
        </h2>
        <p className="muted">{t("picksBoardHint")}</p>

        {board.length === 0 ? (
          <p className="muted">{t("picksNoVotes")}</p>
        ) : (
          <div className="picks-board-wrap">
            <table className="rank-table picks-board">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("couple")}</th>
                  <th>{t("dancers")}</th>
                  <th title={t("picksGoldTitle")}>🥇</th>
                  <th title={t("picksSilverTitle")}>🥈</th>
                  <th title={t("picksBronzeTitle")}>🥉</th>
                </tr>
              </thead>
              <tbody>
                {board.map((entry, idx) => (
                  <tr key={entry.coupleId} className="picks-board-row">
                    <td className="picks-board-pos">{idx + 1}</td>
                    <td>
                      <span className="couple-num" style={{ fontSize: "1rem" }}>
                        #{entry.coupleId}
                      </span>
                    </td>
                    <td className="picks-board-names">
                      {entry.dancer1} &amp; {entry.dancer2}
                    </td>
                    <td className="picks-board-medal">{entry.gold || "—"}</td>
                    <td className="picks-board-medal">{entry.silver || "—"}</td>
                    <td className="picks-board-medal">{entry.bronze || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {allVotesThisYear.length > 0 && (
          <details className="picks-voters-details">
            <summary className="picks-voters-toggle">{t("picksVoterInfo")}</summary>
            <ul className="picks-voters-list">
              {allVotesThisYear.map((v, i) => (
                <li key={i} className="picks-voter-row">
                  <strong>{v.voter.firstName} {v.voter.lastName}</strong>
                  {v.voter.country && <span className="muted"> · {v.voter.country}</span>}
                  {v.voter.tangoComm && <span className="muted"> · {v.voter.tangoComm}</span>}
                  <span className="badge" style={{ marginLeft: 6, textTransform: "none" }}>
                    {v.category === "pista" ? t("categoryPistaShort") : t("categoryEscenarioShort")}
                  </span>
                  <span className="picks-voter-picks">
                    {v.picks
                      .sort((a, b) => a.rank - b.rank)
                      .map((p) => `#${p.coupleId}`)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
