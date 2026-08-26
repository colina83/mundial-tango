import test from "node:test";
import assert from "node:assert/strict";
import {
  isLikelyResultsPdf,
  isSkippablePdf,
  isStagePdfFilename,
} from "./ingest.ts";

test("isLikelyResultsPdf rejects escenario URLs even when other result keywords match", () => {
  assert.equal(
    isLikelyResultsPdf(
      "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Escenario-Clasificatorias-2026-25_8-A.pdf",
    ),
    false,
  );
  assert.equal(
    isLikelyResultsPdf(
      "https://tangoba.org/wp-content/uploads/2026/08/resultado-final-pista-escenario-2026.pdf",
    ),
    false,
  );
});

test("Escenario PDF candidates are excluded from URLs and raw stage filenames", () => {
  assert.equal(
    isSkippablePdf(
      "https://tangoba.org/wp-content/uploads/2026/08/Jurados-_-Escenario-Clasificatorias-2026-25_8-B.pdf",
    ),
    true,
  );
  assert.equal(
    isStagePdfFilename(
      "Jurados-_-Escenario-Clasificatorias-2026-25_8-B-Copia-de-JURADOS-_-RONDAS-TODAS-258-B.pdf",
    ),
    false,
  );
  assert.equal(isStagePdfFilename("pista-clasificatorias-2026-24-08-D.pdf"), true);
});
