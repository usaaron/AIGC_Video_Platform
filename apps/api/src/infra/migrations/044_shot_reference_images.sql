ALTER TABLE shots ADD COLUMN reference_images jsonb;
ALTER TABLE shots ADD CONSTRAINT shots_reference_images_array CHECK (
  reference_images IS NULL OR
  CASE WHEN jsonb_typeof(reference_images) = 'array'
    THEN jsonb_array_length(reference_images) <= 9 ELSE false END
);
