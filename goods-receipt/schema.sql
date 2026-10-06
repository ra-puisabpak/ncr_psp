-- Goods receipt log (who received what, with photos). Only CREATE ... IF NOT EXISTS,
-- so the deploy workflow can apply this file every time without touching saved records.
CREATE TABLE IF NOT EXISTS receipts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     TEXT NOT NULL,               -- ISO time (UTC) set by the server when the record is saved
  receiver       TEXT NOT NULL,
  items          TEXT NOT NULL,
  qty            TEXT NOT NULL,
  supplier       TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  product_photos TEXT NOT NULL DEFAULT '[]',  -- JSON list of photo keys in the R2 bucket
  invoice_photos TEXT NOT NULL DEFAULT '[]'
);
