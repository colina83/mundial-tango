import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isLikelyResultsPdf,
  isSkippablePdf,
  isStagePdfFilename,
  pdfMatchesStage,
  STAGE_SOURCES,
} from "./ingest.ts";
import { latestPublishedStage, publishedStages } from "../src/lib/year.ts";
import { sourcePageFor } from "./year-io.ts";
import type { Dataset } from "../src/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ESCENARIO_A =
  "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Escenario-Clasificatorias-2026-25_8-A.pdf";
const ESCENARIO_B =
  "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Escenario-Clasificatorias-2026-25_8-B.pdf";
const PISTA_D =
  "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Pista-Clasificatorias-2026-24_8-D.pdf";
const COMBINED =
  "https://tangoba.org/wp-content/uploads/2026/08/resultado-final-pista-escenario-2026.pdf";

test("pista isLikelyResultsPdf rejects escenario URLs even when other result keywords match", () => {
  assert.equal(isLikelyResultsPdf(ESCENARIO_A), false);
  assert.equal(isLikelyResultsPdf(COMBINED), false);
});

test("escenario isLikelyResultsPdf accepts escenario sheets and rejects pista/combined", () => {
  assert.equal(isLikelyResultsPdf(ESCENARIO_A, "escenario"), true);
  assert.equal(isLikelyResultsPdf(PISTA_D, "escenario"), false);
  assert.equal(isLikelyResultsPdf(COMBINED, "escenario"), false);
});

test("Escenario PDF candidates are excluded from pista URLs and raw stage filenames", () => {
  assert.equal(isSkippablePdf(ESCENARIO_B), true);
  assert.equal(isSkippablePdf(PISTA_D), false);
  assert.equal(
    isStagePdfFilename(
      "Jurados-_-Escenario-Clasificatorias-2026-25_8-B-Copia-de-JURADOS-_-RONDAS-TODAS-258-B.pdf",
    ),
    false,
  );
  assert.equal(isStagePdfFilename("pista-clasificatorias-2026-24-08-D.pdf"), true);
});

test("Escenario PDF candidates are accepted for escenario ingest", () => {
  assert.equal(isSkippablePdf(ESCENARIO_B, "escenario"), false);
  assert.equal(isSkippablePdf(PISTA_D, "escenario"), true);
  assert.equal(
    isStagePdfFilename(
      "Jurados-_-Escenario-Clasificatorias-2026-25_8-B-Copia-de-JURADOS-_-RONDAS-TODAS-258-B.pdf",
      "escenario",
    ),
    true,
  );
  assert.equal(
    isStagePdfFilename("pista-clasificatorias-2026-24-08-D.pdf", "escenario"),
    false,
  );
});

test("pista senior sheets are skipped", () => {
  const seniorPdf =
    "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Pista-FINAL-2026-Ranking-Senior.pdf";
  const seniorPage = "https://tangoba.org/resultados-semifinal-tango-de-pista-senior-2026/";
  assert.equal(isSkippablePdf(seniorPdf), true);
  assert.equal(isLikelyResultsPdf(seniorPdf), false);
  assert.equal(isStagePdfFilename("final-senior.pdf"), false);
  assert.equal(pdfMatchesStage(seniorPdf, "final"), false);
  assert.equal(pdfMatchesStage(seniorPage, "semifinal"), false);
});

test("pdfMatchesStage keeps cuartos sheets out of final ingest", () => {
  const cuartos =
    "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Pista-Cuartos-2026-27_8-A.pdf";
  const finalSheet =
    "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Pista-Final-2026-31_8-A.pdf";
  assert.equal(pdfMatchesStage(cuartos, "cuartos"), true);
  assert.equal(pdfMatchesStage(cuartos, "final"), false);
  assert.equal(pdfMatchesStage("resultados-cuartos-final-tango-de-pista-2026", "final"), false);
  assert.equal(pdfMatchesStage(finalSheet, "final"), true);
});

test("2026 cuartos source pages use the published de-final URLs", () => {
  assert.equal(
    sourcePageFor(2026, "cuartos", "pista"),
    "https://tangoba.org/resultados-cuartos-de-final-tango-de-pista-2026/",
  );
  assert.equal(
    sourcePageFor(2026, "cuartos", "escenario"),
    "https://tangoba.org/resultados-cuartos-de-final-tango-escenario-2026/",
  );
  const pista = STAGE_SOURCES.find((s) => s.category === "pista" && s.stage === "cuartos");
  const escenario = STAGE_SOURCES.find((s) => s.category === "escenario" && s.stage === "cuartos");
  assert.equal(pista?.sourcePage, sourcePageFor(2026, "cuartos", "pista"));
  assert.equal(escenario?.sourcePage, sourcePageFor(2026, "cuartos", "escenario"));
});

test("2026 published JSON classified counts come from highlights, not 50%", async () => {
  async function load(rel: string): Promise<Dataset> {
    return JSON.parse(await readFile(join(ROOT, rel), "utf8")) as Dataset;
  }
  const pistaSemi = await load("public/data/2026/results-semifinal.json");
  assert.equal(pistaSemi.blocks[0]!.classifiedCount, 36);
  assert.notEqual(36, Math.ceil(pistaSemi.rows.length / 2));
  const cantarini = pistaSemi.rows.find((r) => r.coupleId === 452);
  assert.equal(cantarini?.classified, true);
  assert.equal(cantarini?.cutoffDelta, 0);

  const pistaClas = await load("public/data/2026/results-clasificatoria.json");
  assert.equal(pistaClas.blocks[0]!.classifiedCount, 75);
  assert.notEqual(75, Math.ceil(pistaClas.blocks[0]!.coupleCount / 2));

  const pistaCuartos = await load("public/data/2026/results-cuartos.json");
  assert.equal(pistaCuartos.rows.find((r) => r.coupleId === 452)?.classified, true);
  assert.equal(
    pistaCuartos.blocks.reduce((s, b) => s + b.classifiedCount, 0),
    146,
  );

  const escClas = await load("public/data/2026/escenario/results-clasificatoria.json");
  const escIn = escClas.blocks.reduce((s, b) => s + b.classifiedCount, 0);
  assert.equal(escIn, 69);
  assert.notEqual(escIn, Math.ceil(escClas.rows.length / 2));

  const escCuartos = await load("public/data/2026/escenario/results-cuartos.json");
  assert.deepEqual(
    escCuartos.blocks.map((b) => b.classifiedCount),
    [20, 20],
  );
});

test("publishedStages hides a fake final copied from cuartos", () => {
  const stages = publishedStages([
    { stage: "clasificatoria", rowCount: 545 },
    { stage: "cuartos", rowCount: 292 },
    { stage: "final", rowCount: 292 },
  ]);
  assert.deepEqual(stages, ["clasificatoria", "cuartos"]);
  assert.equal(
    latestPublishedStage(2026, [
      { stage: "clasificatoria", rowCount: 545 },
      { stage: "cuartos", rowCount: 292 },
      { stage: "final", rowCount: 292 },
    ]),
    "cuartos",
  );
});
