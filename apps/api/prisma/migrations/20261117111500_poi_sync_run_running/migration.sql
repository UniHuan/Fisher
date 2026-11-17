-- A sync run is created before the provider call so failures and in-flight runs
-- are observable in the admin workspace. Keep the original terminal statuses.
ALTER TABLE "poi_sync_run" DROP CONSTRAINT "poi_sync_run_status_check";
ALTER TABLE "poi_sync_run"
  ADD CONSTRAINT "poi_sync_run_status_check"
  CHECK ("status" IN ('running', 'success', 'failed'));
