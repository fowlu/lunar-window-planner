# Lunar Window Planner

Lunar Window is a 2026 NASA Space Apps Challenge prototype for the [Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/). It estimates when sunlight and a direct Earth sightline are geometrically available at lunar south-pole sites. Power engineers can use the longest modeled shadow period as an input to battery sizing. Communications engineers can use the line-of-sight intervals as an input to relay and contact planning.

## Run the planner

Extract the ZIP. Open `index.html` for the five presets, computed mission answers and CSV export. For custom locations and the model endpoint, run the included HTTP server with Node.js 22 or newer from the extracted folder.

```sh
node server.mjs
```

Then open [127.0.0.1:8787](http://127.0.0.1:8787). The server binds to the local machine. Custom terrain uses a Web Worker and the browser’s gzip decompressor. Its two raster files load once per worker session, on the first custom calculation.

### Optional model explanations

Install and start [Ollama](https://ollama.com/download) on the same machine. In a terminal, download the default model.

```sh
ollama pull qwen2.5:1.5b
```

Keep Ollama running, select **Add optional local Ollama commentary**, then click **Evaluate question**. If the Ollama app is closed, use `ollama serve` to start its API. The included server calls Ollama's local [chat endpoint](https://docs.ollama.com/api/chat) with structured output. Set the server's `LUNAR_OLLAMA_MODEL` environment variable to use another installed model. The default setup requires no API key. Static hosting uses computed answers and hides the local commentary control.

The planner first evaluates both options and fixes the verdict and numeric evidence. Ollama receives this structured result and the question. Its response can reference only supplied evidence and next-test IDs. The interface shows the computed explanation immediately and adds model commentary when a valid reply arrives. If the model is unavailable or rejects the request, the computed explanation stays visible. A mission setting change clears the answer.

## Read the decision

The opening scenario compares Malapert Massif with de Gerlache Rim 2 for the 24 hours after 17 November 2026 at 00:00 UTC, using a 2 m antenna. Change **LOLA terrain** to **Flat reference**. The longest Earth blackout reverses the decision.

| Horizon and antenna | Malapert Massif | de Gerlache Rim 2 |
|---|---:|---:|
| Flat reference, 2 m | 0.0 h | 1.1 h |
| LOLA terrain, 2 m | 20.5 h | 7.7 h |
| LOLA terrain, 5 m | 10.9 h | 7.6 h |

The height sweep illustrates model sensitivity. At Malapert, the longest outage is 10.9–20.5 hours across the two modeled heights. Because the terrain grid cannot resolve meter-scale siting, use this comparison to identify where finer data or a site survey would matter.

Set the end time or a duration of one hour to 30 days. The bundled ephemerides cover 14 November through 20 December 2026 UTC. Choose a priority and optionally enter a report deadline. **Compare nearby touchdown times** evaluates the same two sites and window length at the selected start and 6, 12 and 24 hours later where covered. The deadline screens for geometric Earth visibility by the selected time.

Click a timeline to choose a site and time. The clock scrubber also supports keyboard arrows. **Play window** walks through the selected interval, while **Find terrain blockage** seeks a modeled obstruction for the inspected site. At 5 m, the dashed skyline belongs to the Earth antenna and the solid skyline to the 2 m solar observer. The cross-section uses LOLA terrain and shows the highest sampled obstruction where the full slice is unavailable.

Solid green bars mark clear sightlines in the model. Diagonal red stripes mark blocked sightlines. Fine gray stripes mark intervals where terrain coverage or the distant-terrain test leaves visibility uncertain. Percentage and longest-outage ranges reflect unknown intervals. Point markers and azimuths describe body centers. A clear Earth sightline supplies one input to a link budget, and visible Sun supplies one input to an energy budget.

The fixed ranking rules return indeterminate when ranges overlap, values are too close for the 30-minute screening rule, or missing terrain leaves the deadline uncertain. The tie rule spans three 10-minute ephemeris steps and serves as a comparison convention. Quick questions display the deadline, height and priority they used. **Export comparison CSV** downloads intervals for both horizon models for the selected sites, time range and antenna height. The included `intervals.csv` is a reference export for all five presets and both heights. The planner loads `data.js` directly.

## Reproduce the checks

- **Observer geometry.** Six archived site-centered Horizons queries supply 10,374 paired Earth and Sun samples, from 14 November 00:00 to 26 November 00:00 UTC. Rebuilding local angles from the stored body vectors gives largest differences of 0.000002° in bearing and 0.000001° in elevation. With the terrain held fixed, the longest modeled Earth outage moved by less than 0.001 minutes in the checked 24-hour UTC windows. Malapert at 2 m is the reference observer. The de Gerlache queries test projection to separate observer coordinates. All of these tracks share the JPL ephemeris. Terrain accuracy remains a separate question.
- **Custom terrain.** Running the worker at the preset coordinates for the same demo and 2 m antenna changed Malapert from 20.48 h to 11.53 h and de Gerlache from 7.66 h to 8.23 h. This check changes the raster and the ray sampling together. At 50 km, the custom 1° rays are about 870 m apart.
- **Finite bodies.** At the demo's 2 m Malapert setting, 117 of 144 samples place Earth's center within one apparent Earth radius of the modeled skyline at its bearing. This identifies potentially partial views along that bearing. Full-disc visibility also depends on the skyline at adjacent bearings.

Run the offline observer comparison from the extracted folder with Python 3 and NumPy. The archived query responses and their hashes ship in the ZIP.

```sh
python analysis/validate_observers.py
node tests/check.mjs
```

The Node check exercises visibility, ranking, custom terrain, playback, CSV, and the server with a simulated model response. It uses a test DOM for the browser logic. Source and data credits are in [CREDITS.md](CREDITS.md).

## NASA data and methods

| Source | Role |
|---|---|
| [LRO LOLA LDEM_80S_80M](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_80s_80m.lbl) and [LDEM_75S_240M](https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.LBL) | Digital elevation model. Presets use 80 m data where available and 240 m elsewhere. Custom coordinates use the 240 m grid. |
| [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) | Ten-minute azimuth, elevation and range for the Earth and Sun from a lunar observer. The build stores the queries and transforms observations into approximate Moon-fixed vectors for local projection. The first 12 days of the original pair retain directly queried local tracks when reproduced with the verification build. |
| [NASA Lunar Surface Data Book, Table A2-2](https://ntrs.nasa.gov/citations/20230007818) | Representative evaluation coordinates for the five presets. |
| [NASA Scientific Visualization Studio](https://svs.gsfc.nasa.gov/5587) | Independent subpoint geometry cross-check for the original two-site dates. |
| [NASA Artemis II preliminary science report](https://science.nasa.gov/feature/artemis-ii-preliminary-lunar-science-report/) | Artemis II crew photograph of the lunar day-night boundary (art002e010405), used as the opening artwork. |

The terrain scan follows great circles up to 270 km and calculates the maximum vertical angle above the local tangent along each bearing. Presets sample every 40 m along rays spaced 0.1° apart. The custom-site calculation samples every 120 m along rays spaced 1° apart between 89.99° S and 84° S. The app interpolates horizon angle between bearings and linearly estimates visibility changes between 10-minute ephemeris samples. The Earth and Sun have independent intervals, so any combination of solar and Earth visibility is possible.

The model approximates alignment between the LOLA DE421 mean Earth/polar-axis frame and the Horizons lunar mean Earth frame. The 12 km maximum lunar elevation envelope bounds distant terrain beyond the search radius. The default 24-hour case checks the original site pair against the directly queried local angles and retains both flat and terrain scenarios. DEM resolution can strongly affect individual timings. In the original check the 240 m grid shifted Malapert's longest blackout by roughly nine hours. This is a geometric screening prototype. It leaves irradiance, battery state of charge, antenna pointing, finite body disks, station schedules and RF link margin to downstream analyses.

`analysis/rebuild.py` makes the 36-day data package. `analysis/terrain.py` provides the ray tracing, original two-site verification and interval algorithms. From the checkout root, with NumPy installed:

```sh
python analysis/terrain.py --extended --cache cache --out original
python analysis/rebuild.py --cache cache --out rebuilt --reuse original/data.js
```

The base data build also runs without the optional `--reuse` argument. `lunar-motion.js` controls pointer-responsive motion in the hero. `lunar-terrain-worker.js` computes the custom terrain horizons.
