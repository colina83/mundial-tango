import test from "node:test";
import assert from "node:assert/strict";
import {
  isLikelyResultsPdf,
  isSkippablePdf,
  isStagePdfFilename,
} from "./ingest.ts";

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
