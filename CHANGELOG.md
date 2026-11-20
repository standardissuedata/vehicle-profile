# Release notes

## 0.1.0 — local release candidate

Initial MIT-licensed release of Vehicle Profile from Standard Issue Data.

- npm package: `@standardissuedata/vehicle-profile`; CLI: `vehicle-profile`.
- Standalone TypeScript ESM library and CLI for Node.js 22 or later, with no runtime dependencies or SID credentials.
- VIN identity from NHTSA vPIC; model-year recall campaigns and owner complaints from NHTSA; configuration-specific NHTSA crash ratings; rated fuel economy, MPGe, and electric range from EPA/DOE FuelEconomy.gov.
- Versioned JSON with source URLs, matching scope, compatible candidates, and per-section statuses for ambiguity, missing records, and source failures.

### Correctness fixes before release

- Known truck cab types filter direct and alias crash-rating candidates, including NHTSA's PU/CC, PU/EC, and PU/RC descriptions. Unknown cabs remain ambiguous.
- Complaint filing dates use month/day/year while recall dates retain day/month/year. Invalid calendar dates return null.
- Plug-in hybrids match fuel fields in either source order while known PHEV, HEV, BEV, and combustion configurations remain distinct.
- Combined legacy EPA drivetrain labels use `awd_or_4wd`, compatible with AWD or 4WD while excluding two-wheel drive.
- Primary and secondary CNG ratings use MPGe. Non-electric secondary-fuel ranges are not labeled electric range.

### Validation and boundaries

- Seventeen offline tests cover the original matching behavior and release regressions. CI builds, tests, and checks an installed tarball on Node.js 22, 24, and 26.
- Scope is public U.S. NHTSA and EPA/DOE data. VIN and configuration coverage varies with upstream records; the release is not a comprehensive vehicle-coverage benchmark.
- Model-year recall campaigns do not establish an individual VIN's unrepaired-recall status; use NHTSA's VIN-specific recall check separately.
- No public repository, npm release, or automated publication is created by this candidate.
