# Lunar Window project and source credits

Lunar Window project team · NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator

The submission team should list its registered roster and approved code licence in the project entry. The ZIP includes the app, scripts, derived data, and the underlying validation responses so reviewers can inspect the calculation directly.

| Material | Source |
|---|---|
| Lunar observer ephemerides and cached validation responses | [NASA/JPL Horizons](https://ssd.jpl.nasa.gov/horizons/). Query URLs and hashes appear in `validation-data.js`. |
| Polar topography | [Lunar Reconnaissance Orbiter LOLA data](https://pds-geosciences.wustl.edu/lro/lrolola.html). The raster product sources and hashes appear in `data.js`. |
| Landing-area coordinates | [NASA Lunar Surface Data Book](https://ntrs.nasa.gov/citations/20230007818), Table A2-2. |
| Opening photograph | NASA / Artemis II, [lunar day-night boundary photograph](https://science.nasa.gov/feature/artemis-ii-preliminary-lunar-science-report/), art002e010405. |
| Optional local model commentary | [Ollama](https://ollama.com/) with [Qwen2.5](https://ollama.com/library/qwen2.5) by default. The planner computes its numeric results using fixed rules. |

For the competition entry, review the [Space Apps terms](https://www.spaceappschallenge.org/legal/) and [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide). Confirm the software licence and cite the source materials. Check the event guidance on prior work before describing the project's development timeline.
