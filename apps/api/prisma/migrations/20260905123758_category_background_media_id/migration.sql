-- Category background images now live in the tenant's own WordPress media
-- library. `backgroundImage` keeps the public URL WordPress returns, which the
-- featured-image pipeline already knows how to read; this column keeps the
-- media id so the image can be removed from their library again.
--
-- Nullable and unbackfilled on purpose: a background set as a bare URL has no
-- media id, and no row carried an uploaded image when this shipped.
ALTER TABLE "categories" ADD COLUMN "backgroundImageMediaId" INTEGER;
