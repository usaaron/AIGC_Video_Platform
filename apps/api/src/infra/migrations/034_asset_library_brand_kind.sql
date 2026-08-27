ALTER TABLE asset_library_items DROP CONSTRAINT IF EXISTS asset_library_items_kind_check;

ALTER TABLE asset_library_items
  ADD CONSTRAINT asset_library_items_kind_check
  CHECK (kind IN (
    'character',
    'scene',
    'prop',
    'costume',
    'brand',
    'audio',
    'image',
    'script',
    'video',
    'final-cut'
  ));
