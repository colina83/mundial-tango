import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CouplePickerInput } from "../components/CouplePickerInput";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { PicksApiError, usePicks } from "../context/PicksContext";
import { useData } from "../context/DataContext";
import { useI18n } from "../context/I18nContext";
import { coupleName, fold, formatIngestTime } from "../lib/format";
import { countryOptions } from "../lib/countries";
import type {
  BallotConfirmation,
  BallotInput,
  PickCandidate,
  PicksSnapshot,
  VoterInput,
} from "../lib/picks";
import { assignNextPick, movePick } from "../lib/picks";
import type { MessageKey } from "../i18n";
import type { Category, Dataset, StageManifest } from "../types";

const EMPTY_VOTER: VoterInput = {
  firstName: "",
  lastName: "",
  country: "",
  community: "",
};

const ERROR_KEYS: Record<string, MessageKey> = {
  duplicate_ballot: "picksErrorDuplicate",
  duplicate_pick: "picksErrorThree",
  edit_token_invalid: "picksErrorEdit",
  edit_token_missing: "picksErrorEdit",
  ineligible_couple: "picksErrorEligibility",
  invalid_picks: "picksErrorThree",
  missing_fields: "picksErrorFields",
  picks_closed: "picksClosed",
  rate_limited: "picksErrorRate",
  turnstile_failed: "picksErrorSecurity",
  turnstile_required: "picksErrorSecurity",
};

async function loadDevPreview(year: number, category: Category): Promise<PicksSnapshot> {
  const categoryPath = category === "escenario" ? "/escenario" : "";
  const base = `${import.meta.env.BASE_URL}data/${year}${categoryPath}`;
  const manifest = (await fetch(`${base}/manifest.json`).then((response) =>
    response.json(),
  )) as StageManifest;
  const latest = manifest.stages.at(-1);
  if (!latest) throw new Error("No candidate stage.");
  const dataset = (await fetch(`${base}/results-${latest.stage}.json`).then((response) =>
    response.json(),
  )) as Dataset;
  const candidates = new Map<number, PickCandidate>();
  const eligibleRows = dataset.rows.filter((row) => row.classified);
  for (const row of eligibleRows.length ? eligibleRows : dataset.rows) {
    candidates.set(row.coupleId, {
      coupleId: row.coupleId,
      dancer1: row.dancer1,
      dancer2: row.dancer2,
    });
  }
  return {
    year,
    category,
    candidates: [...candidates.values()].sort((a, b) => a.coupleId - b.coupleId),
    candidateStage: latest.stage,
    leaderboard: [],
    ballotCount: 0,
    updatedAt: null,
    closed: false,
    closesAt: null,
    myBallot: null,
  };
}

export function Picks() {
  const { year, category } = useData();
  const { lang, t } = useI18n();
  const api = usePicks();
  const [snapshot, setSnapshot] = useState<PicksSnapshot | null>(null);
  const [voter, setVoter] = useState<VoterInput>(EMPTY_VOTER);
  const [slots, setSlots] = useState<Array<PickCandidate | null>>([null, null, null]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [challengeKey, setChallengeKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [browseQuery, setBrowseQuery] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getSnapshot(year, category);
      setSnapshot(next);
      if (next.myBallot) {
        setVoter(next.myBallot.voter);
        setSlots(
          next.myBallot.picks
            .sort((a, b) => a.rank - b.rank)
            .map(({ coupleId, dancer1, dancer2 }) => ({ coupleId, dancer1, dancer2 })),
        );
      } else {
        setVoter(EMPTY_VOTER);
        setSlots([null, null, null]);
      }
    } catch {
      if (import.meta.env.DEV) {
        try {
          setSnapshot(await loadDevPreview(year, category));
          setVoter(EMPTY_VOTER);
          setSlots([null, null, null]);
          return;
        } catch {
          /* Fall through to the unavailable state. */
        }
      }
      setError("picksErrorUnavailable");
    } finally {
      setLoading(false);
    }
  }, [api, category, year]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!drawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [drawerOpen]);

  const countries = useMemo(() => countryOptions(lang), [lang]);
  const selectedIds = slots.flatMap((slot) => (slot ? [slot.coupleId] : []));
  const browseCandidates = useMemo(() => {
    const query = fold(browseQuery);
    return (snapshot?.candidates ?? [])
      .filter(
        (candidate) =>
          !query ||
          String(candidate.coupleId).includes(query) ||
          fold(candidate.dancer1).includes(query) ||
          fold(candidate.dancer2).includes(query),
      )
      .slice(0, 100);
  }, [browseQuery, snapshot?.candidates]);

  const onTurnstileError = useCallback(() => setError("picksErrorSecurity"), []);
  const onTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

  function setSlot(index: number, candidate: PickCandidate | null) {
    setSlots((current) => current.map((slot, slotIndex) => (slotIndex === index ? candidate : slot)));
    setError(null);
  }

  function moveSlot(index: number, direction: -1 | 1) {
    setSlots((current) => movePick(current, index, direction));
  }

  function chooseFromDrawer(candidate: PickCandidate) {
    setSlots((current) => assignNextPick(current, candidate));
    setDrawerOpen(false);
  }

  function apiErrorKey(cause: unknown): MessageKey {
    return cause instanceof PicksApiError
      ? (ERROR_KEYS[cause.code] ?? "picksErrorUnavailable")
      : "picksErrorUnavailable";
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!voter.firstName.trim() || !voter.lastName.trim() || !voter.country) {
      setError("picksErrorFields");
      return;
    }
    if (slots.some((slot) => slot === null) || new Set(selectedIds).size !== 3) {
      setError("picksErrorThree");
      return;
    }
    if (!turnstileToken) {
      setError("picksErrorSecurity");
      return;
    }
    const input: BallotInput = {
      year,
      category,
      voter,
      picks: (slots as PickCandidate[]).map((slot, index) => ({
        rank: (index + 1) as 1 | 2 | 3,
        coupleId: slot.coupleId,
      })),
      turnstileToken,
    };
    setSaving(true);
    setError(null);
    try {
      const ballot = editing ? await api.update(input) : await api.submit(input);
      setSnapshot((current) => (current ? { ...current, myBallot: ballot } : current));
      setEditing(false);
      await refresh();
    } catch (cause) {
      setError(apiErrorKey(cause));
      setTurnstileToken("");
      setChallengeKey((key) => key + 1);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="state-card">{t("picksLoading")}</div>;
  }
  if (!snapshot) {
    return (
      <div className="state-card">
        <p>{t(error ?? "picksErrorUnavailable")}</p>
        <button type="button" className="btn" onClick={() => void refresh()}>
          {t("retry")}
        </button>
      </div>
    );
  }

  const showForm = !snapshot.myBallot || editing;
  const stageKey = `stage${snapshot.candidateStage[0]?.toUpperCase()}${snapshot.candidateStage.slice(1)}` as MessageKey;

  return (
    <div className="page picks-page">
      <section className="hero-panel picks-hero">
        <div>
          <div className="hero-kicker">{t("picksKicker")}</div>
          <h1>
            {t("picksTitle")} <span>· {category === "pista" ? t("categoryPistaShort") : t("categoryEscenarioShort")}</span>
          </h1>
          <p className="lede">{t("picksSubtitle")}</p>
        </div>
        <div className="picks-hero-total">
          <strong>{snapshot.ballotCount}</strong>
          <span>{t("picksBallots")}</span>
        </div>
      </section>

      <div className="picks-layout">
        <section className="panel picks-ballot-panel">
          {snapshot.closed ? (
            <div className="picks-closed">
              <h2>{t("picksClosedTitle")}</h2>
              <p>{t("picksClosed")}</p>
              {snapshot.myBallot && (
                <BallotSummary
                  ballot={snapshot.myBallot}
                  editLabel={t("picksEdit")}
                  heading={t("picksSubmitted")}
                />
              )}
            </div>
          ) : showForm ? (
            <>
              <div className="section-heading">
                <div>
                  <h2>{editing ? t("picksEditTitle") : t("picksYourTop3")}</h2>
                  <p className="muted">
                    {t("picksCandidatePool")} {t(stageKey)}
                  </p>
                </div>
                <button type="button" className="btn" onClick={() => setDrawerOpen(true)}>
                  {t("picksBrowse")}
                </button>
              </div>
              <form className="picks-form" onSubmit={submit}>
                <div className="picks-fields">
                  <label>
                    <span>{t("picksFirstName")}</span>
                    <input
                      value={voter.firstName}
                      maxLength={60}
                      autoComplete="given-name"
                      onChange={(event) => setVoter({ ...voter, firstName: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>{t("picksLastName")}</span>
                    <input
                      value={voter.lastName}
                      maxLength={60}
                      autoComplete="family-name"
                      onChange={(event) => setVoter({ ...voter, lastName: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>{t("picksCountry")}</span>
                    <select
                      value={voter.country}
                      autoComplete="country"
                      onChange={(event) => setVoter({ ...voter, country: event.target.value })}
                    >
                      <option value="">{t("picksCountryPlaceholder")}</option>
                      {countries.map((country) => (
                        <option value={country.code} key={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{t("picksCommunity")}</span>
                    <input
                      value={voter.community}
                      maxLength={80}
                      placeholder={t("picksCommunityHint")}
                      onChange={(event) => setVoter({ ...voter, community: event.target.value })}
                    />
                  </label>
                </div>

                <div className="picks-slots">
                  {slots.map((slot, index) => (
                    <div className="picks-slot" key={index}>
                      <span className="picks-rank">{index + 1}</span>
                      <CouplePickerInput
                        candidates={snapshot.candidates}
                        value={slot}
                        excluded={selectedIds.filter((id) => id !== slot?.coupleId)}
                        label={t(index === 0 ? "firstPlace" : index === 1 ? "secondPlace" : "thirdPlace")}
                        placeholder={t("picksSearch")}
                        removeLabel={t("picksRemove")}
                        emptyLabel={t("noResults")}
                        onChange={(candidate) => setSlot(index, candidate)}
                      />
                      <div className="picks-move">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveSlot(index, -1)}
                          aria-label={t("picksMoveUp")}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === 2}
                          onClick={() => moveSlot(index, 1)}
                          aria-label={t("picksMoveDown")}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="picks-privacy">{t("picksPrivacy")}</p>
                <TurnstileWidget
                  key={challengeKey}
                  onToken={onTurnstileToken}
                  onError={onTurnstileError}
                />
                {error && (
                  <p className="picks-error" role="alert">
                    {t(error)}
                  </p>
                )}
                <div className="picks-actions">
                  {editing && (
                    <button type="button" className="btn" onClick={() => setEditing(false)}>
                      {t("picksCancel")}
                    </button>
                  )}
                  <button className="btn btn-primary" disabled={saving} type="submit">
                    {saving ? t("picksSaving") : editing ? t("picksSave") : t("picksSubmit")}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <BallotSummary
              ballot={snapshot.myBallot!}
              editLabel={t("picksEdit")}
              heading={t("picksSubmitted")}
              onEdit={() => setEditing(true)}
            />
          )}
        </section>

        <section className="panel picks-community">
          <div className="section-heading">
            <div>
              <h2>{t("picksCommunityTitle")}</h2>
              <p className="muted">{t("picksPointsHint")}</p>
            </div>
            {snapshot.updatedAt && (
              <time dateTime={snapshot.updatedAt}>
                {formatIngestTime(snapshot.updatedAt, lang === "es" ? "es-AR" : "en-GB")}
              </time>
            )}
          </div>
          {snapshot.leaderboard.length ? (
            <>
              <div className="picks-community-top">
                {snapshot.leaderboard.slice(0, 3).map((entry, index) => (
                  <article key={entry.coupleId}>
                    <span className="picks-rank">{index + 1}</span>
                    <div>
                      <strong>#{entry.coupleId} {coupleName(entry)}</strong>
                      <p>{entry.points} {t("picksPoints")} · {entry.first} {t("picksFirstVotes")}</p>
                    </div>
                  </article>
                ))}
              </div>
              <details className="picks-full-board">
                <summary>{t("picksFullRanking")}</summary>
                <div className="picks-board-scroll">
                  <table className="rank-table">
                    <thead>
                      <tr>
                        <th>{t("rank")}</th>
                        <th>{t("dancers")}</th>
                        <th>{t("picksPoints")}</th>
                        <th>{t("firstPlace")}</th>
                        <th>{t("secondPlace")}</th>
                        <th>{t("thirdPlace")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.leaderboard.map((entry, index) => (
                        <tr key={entry.coupleId}>
                          <td>{index + 1}</td>
                          <td>#{entry.coupleId} {coupleName(entry)}</td>
                          <td>{entry.points}</td>
                          <td>{entry.first}</td>
                          <td>{entry.second}</td>
                          <td>{entry.third}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <p className="picks-empty">{t("picksNoBallots")}</p>
          )}
        </section>
      </div>

      {drawerOpen && (
        <div className="picks-drawer-backdrop" role="presentation" onMouseDown={() => setDrawerOpen(false)}>
          <section
            className="picks-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="picks-drawer-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="picks-drawer-title">{t("picksParticipants")}</h2>
                <p>{snapshot.candidates.length} {t("couples")}</p>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} aria-label={t("picksClose")}>
                ×
              </button>
            </header>
            <input
              autoFocus
              className="search-input"
              value={browseQuery}
              placeholder={t("searchPlaceholder")}
              onChange={(event) => setBrowseQuery(event.target.value)}
            />
            <div className="picks-participant-list">
              {browseCandidates.map((candidate) => {
                const selected = selectedIds.includes(candidate.coupleId);
                return (
                  <button
                    type="button"
                    disabled={selected || slots.every(Boolean)}
                    key={candidate.coupleId}
                    onClick={() => chooseFromDrawer(candidate)}
                  >
                    <strong>#{candidate.coupleId}</strong>
                    <span>{coupleName(candidate)}</span>
                    <small>{selected ? t("picksSelected") : t("picksAdd")}</small>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function BallotSummary({
  ballot,
  heading,
  editLabel,
  onEdit,
}: {
  ballot: BallotConfirmation;
  heading: string;
  editLabel: string;
  onEdit?: () => void;
}) {
  return (
    <div className="picks-summary">
      <h2>{heading}</h2>
      <ol>
        {ballot.picks.map((pick) => (
          <li key={pick.rank}>
            <span className="picks-rank">{pick.rank}</span>
            <span>
              <strong>#{pick.coupleId}</strong> {pick.dancer1} &amp; {pick.dancer2}
            </span>
          </li>
        ))}
      </ol>
      {onEdit && (
        <button type="button" className="btn" onClick={onEdit}>
          {editLabel}
        </button>
      )}
    </div>
  );
}
