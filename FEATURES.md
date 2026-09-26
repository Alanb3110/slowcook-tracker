# Tracking and offline behavior (v3.3.0)

- `predictionLog` was already part of cooking schema v5. New `eta-v1` entries
  are appended when a measurement is entered, using the measurements available
  **at that instant**. Entries include the measured temperature, target,
  selected model, confidence, and estimated arrival range, or the reason an ETA
  could not be given. Existing cooking JSON imports retain their records and
  receive no retroactively reconstructed predictions. The JSON schema version
  stays at 5; export/import of the entire state or one cooking retains entries.
- The target crossing can only be bounded by the last measurement below the
  target and the first one reaching it. A recorded ETA is compatible if its
  range intersects this crossing interval, too early if it ends before the
  interval, and too late if it starts after it. Unknown, invalidated, or
  event-interrupted forecasts are excluded from this comparison. Editing or deleting a measurement invalidates forecasts issued
  after the first affected time; changing the target invalidates earlier
  entries. This is retrospective descriptive checking, not a calibrated
  confidence interval or automatic fit correction.
- Phase-related events now include mode changes, covering/uncovering, turning,
  wrapping, setpoint changes, and other marked changes. Users can supply or
  correct the time in the event editor. The event remains a statistical prior;
  an event alone does not force a phase boundary. Backdated corrections
  invalidate affected recorded forecasts.
- Next-measurement guidance is a simple scheduling heuristic, independent of
  the ETA algorithm. It prioritizes a stale or suspicious last measurement,
  recent phase-related events, and proximity to the target; otherwise it
  suggests a broad 20–30 minute window. It neither sets alarms nor asserts a
  thermal response time or food safety limit.
- The service worker caches only the versioned application shell and serves
  it on failed navigation after a successful first online install. On online
  navigation it fetches fresh HTML. The browser keeps cooking records in local
  storage; the service worker never stores cooking JSON, uploads, or syncs them.
  A manual JSON export remains the recovery path if local browser data is
  cleared or the device changes. Offline operation in an actual iPhone home
  screen installation should be checked manually.
