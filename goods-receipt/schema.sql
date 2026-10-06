-- Goods receipt log (who received what, with photos). Only CREATE ... IF NOT EXISTS,
-- so the deploy workflow can apply this file every time without touching saved records.
CREATE TABLE IF NOT EXISTS receipts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     TEXT NOT NULL,               -- ISO time (UTC) set by the server when the record is saved
  receiver       TEXT NOT NULL,
  items          TEXT NOT NULL,               -- old free-text goods; left empty now that goods go to receipt_lines
  qty            TEXT NOT NULL,               -- old free-text quantity; left empty
  supplier       TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  product_photos TEXT NOT NULL DEFAULT '[]',  -- JSON list of photo keys in the R2 bucket
  invoice_photos TEXT NOT NULL DEFAULT '[]'
);

-- One row per item received, so a single delivery can list several goods, each with its own quantity.
CREATE TABLE IF NOT EXISTS receipt_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id),
  line_no    INTEGER NOT NULL,
  item       TEXT NOT NULL,
  qty        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS receipt_lines_receipt ON receipt_lines (receipt_id, line_no);

-- Small settings kept by the app itself, e.g. line_group_id: the LINE group that gets the announcements.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
