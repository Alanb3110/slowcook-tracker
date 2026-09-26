# Temperature analysis v4.1.1

The recording schema stays at v5. Existing cooking exports import unchanged;
`currentAnalysis` is derived data and ignored on import. Newly exported cooking
files use `analysisVersion: "web-4.1.1"`. Units are milliseconds (timestamps),
hours (local regression axis), °C (temperature), and °C/h (derivative).

1. Sort by timestamp and retain one observation per instant. Estimate normal
   sampling cadence from the lower half of recent intervals. A gap only creates
   a warning; it is never a phase boundary or an exclusion rule.
2. Start with contiguous blocks of four measurements (merge a tail of fewer
   than three). Repeatedly merge the adjacent pair with the best gain while
   the cost of merging is no more than 12. The cost is the sum of squared
   residuals capped at 9 °C² each, divided by 0.8 °C squared, plus
   `p × ln(n)`, where `p=2` for a line and `p=3` otherwise. Refine a retained
   boundary by up to three sample positions, with at least three points on
   each side. A marked event reduces the merge threshold from 12 to 9 and
   receives a small boundary bonus during refinement within a 45 min lag
   window. Evidence from temperature measurements is still required.
3. Fit line and, when identifiable, quadratic, shifted logarithm, and
   asymptotic exponential. Least squares is iteratively reweighted to limit
   outlier influence. Nonlinear parameters are profiled on bounded grids.
   Model score combines in-sample RMSE, chronologically held-out RMSE when
   training data suffice, and a complexity penalty. Complex models cannot be
   selected before nine measurements and must improve on a line by 0.32 °C
   in score. Neither oven setpoint nor target constrains the fitted plateau.
4. The active phase alone supplies the derivative and a 15 min projection.
   Target crossing uses its local model, anchored to the latest measured
   temperature. Reject nonpositive slope, a target at or above an exponential
   plateau, divergent/reversing quadratic extrapolation, and crossings beyond
   `min(8 h, max(2 h, 3 × phase duration))`. Other competitive model crossings
   widen the ETA range. Recent prediction error, disagreement, data count,
   phase duration, sampling gaps, and measurement age reduce confidence.
   Stale measurements suspend ETA, while retaining the descriptive trend.

The chart draws measured points and historical straight-line joins, with
detected phase boundaries and the active phase highlighted. Its dashed 15 min
extension displays the prediction separately; the joins do not extrapolate.
Ranges and confidence labels are engineering heuristics, not calibrated
statistical confidence intervals. A new phase needs repeated supporting
measurements. Manually check an unstable or stale ETA with a fresh probe
measurement before relying on it for timing.

The external analysis module has a versioned URL so a browser does not pair a
new dashboard with a stale cached analysis script after publication.
