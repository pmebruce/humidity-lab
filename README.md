# 濕度計算

Responsive, dependency-free Traditional Chinese psychrometric calculator and offline PWA. Authored static assets are in `dist/` and must remain tracked in Git.

## Capabilities

- Dry-bulb / relative-humidity and dry-bulb / thermodynamic-wet-bulb input.
- Independent A and B conditions, each with pressure and volume.
- Live SVG psychrometric chart with RH curves, saturation curve, optional enthalpy/wet-bulb lines, current-state markers and dew/frost-point construction.
- Surface condensation assessment with configurable safety margin and surface-RH estimate.
- Constant-pressure A → B sensible heating/cooling paths, including a saturation-curve turn and condensate estimate after crossing the dew/frost point.
- Target-temperature/RH mode with humidification or dehumidification mass calculated for condition A's dry-air mass.
- Separate chart pressures when A and B do not have equal pressure.
- Complete property table, B − A differences, and numerical formula substitutions.
- Installable manifest, raster/maskable/Apple icons, full app precache, explicit update action.
- Device-local settings only; calculation needs no external API, font, script or service.

## Model

SI ideal-moist-air relations from ASHRAE Fundamentals 2017 chapter 1, cross-checked against [PsychroLib's published implementation](https://psychrometrics.github.io/psychrolib/_modules/psychrolib.html).

- Pressure: kPa absolute. Temperature: °C. Humidity ratio: kg water/kg dry air.
- Input dry bulb −20…80 °C, wet bulb −50…80 °C, pressure 20…200 kPa, positive volume.
- Saturation is over ice at and below the water triple point (0.01 °C). Negative dew/frost-point results are labeled frost point.
- Water- and ice-wet-bulb branches are solved separately. A state in the small ideal-model phase-change gap returns no wet-bulb value rather than a fabricated 0 °C.
- RH = 0 is an exact dry-air state with no finite dew point. Positive vapor pressure below the saturation fit's −100 °C limit has no reported dew/frost point.
- Density distinguishes dry-air partial density, total moist-air density, and hypothetical pure-dry-air density at the same total pressure.
- Vapor mass is computed from actual vapor density, not pure-dry-air density times W.
- Specific heat is at constant W: cp,da = 1.006 + 1.86 W; cp,ma = cp,da/(1+W). It is not h/T.
- Generated processes preserve total pressure and condition A's dry-air mass, so B volume changes with state. Target-temperature/RH mode applies temperature change first, then moisture adjustment at B temperature.
- Independent A/B conditions remain available as a comparison, not a mixing calculation.

The uploaded legacy screenshots are input/output references, not the numerical oracle. At 30 °C / 60% RH / 100 kPa / 1 m³ the model yields W = 0.016259 kg/kg, dew point 21.388 °C, vapor mass 18.209 g, and enthalpy 71.751 kJ/kg dry air. Several legacy density, vapor-mass and heat-capacity values differ due to their definitions or calculations.

## Validation and maintenance

Run `node --test tests/*.test.mjs` for numerical, chart-coordinate and service-worker contract checks. No browser QA is implied by these checks.

Serve `dist/` from HTTPS (or localhost for development). On every release that changes an app asset, change the cache name in `dist/sw.js`. The new cache is installed only when all requested assets are available. Existing clients can explicitly apply the update without mixing assets across releases.

## GitHub Pages

Create a public GitHub repository, push these files to its `main` branch, and select **Settings → Pages → Build and deployment → GitHub Actions**. The included workflow publishes `dist/` on every push. App links, manifest scope and service worker paths are relative, so the PWA works under the repository path. Install it from the GitHub Pages URL and open it online once to cache the app.


