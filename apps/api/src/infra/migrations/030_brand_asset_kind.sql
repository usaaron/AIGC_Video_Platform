ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_kind_check;
ALTER TABLE assets
  ADD CONSTRAINT assets_kind_check
  CHECK (kind IN ('character', 'scene', 'prop', 'costume', 'brand', 'audio'));
