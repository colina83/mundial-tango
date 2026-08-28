import test from "node:test";
import assert from "node:assert/strict";
import {
  isLikelyResultsPdf,
  isSkippablePdf,
  isStagePdfFilename,
  pdfMatchesStage,
} from "./ingest.ts";
import { latestPublishedStage, publishedStages } from "../src/lib/year.ts";

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
